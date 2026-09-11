/**
 * Proxy endpoint for inscription queries
 * Proxies requests to the onchain indexer (zord) to avoid mixed content issues
 */

import { NextRequest, NextResponse } from 'next/server';

// Same resolution order as /api/ordinal-index so one env var moves every indexer consumer.
const INDEXER_BASE_URL = (
    process.env.ORDINAL_INDEX_API_BASE ||
    process.env.NEXT_PUBLIC_ORDINAL_INDEX_API ||
    'http://135.181.6.234:3333'
).replace(/\/$/, '') + '/api/v1';
const UPSTREAM_TIMEOUT_MS = 8000;

// Simple in-memory cache
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 10000; // 10 seconds

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const page = searchParams.get('page') || '0';
    const limit = searchParams.get('limit') || '1000';

    const cacheKey = `inscriptions:${page}:${limit}`;
    const cached = cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return NextResponse.json(cached.data);
    }

    const url = `${INDEXER_BASE_URL}/inscriptions?page=${page}&limit=${limit}`;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), cache: 'no-store' });

        if (!response.ok) {
            return NextResponse.json(
                { error: 'Failed to fetch from indexer', upstreamStatus: response.status },
                { status: response.status >= 500 ? 502 : response.status }
            );
        }

        const data = await response.json();
        cache.set(cacheKey, { data, timestamp: Date.now() });

        return NextResponse.json(data);
    } catch (error: any) {
        // Indexer unreachable (down, DNS, timeout): surface it as 503 so the UI can show
        // "indexer offline" instead of a generic failure, and so uptime checks see it.
        console.error('[inscriptions] indexer unreachable:', error?.name || '', error?.message || error);
        return NextResponse.json(
            { error: 'Indexer unavailable', detail: error?.name === 'TimeoutError' ? 'timeout' : 'unreachable' },
            { status: 503, headers: { 'Retry-After': '30' } }
        );
    }
}
