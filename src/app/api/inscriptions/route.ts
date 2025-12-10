/**
 * Proxy endpoint for inscription queries
 * Proxies requests to the onchain indexer to avoid mixed content issues
 */

import { NextRequest, NextResponse } from 'next/server';

const INDEXER_BASE_URL = 'http://135.181.6.234:3333/api/v1';

// Simple in-memory cache
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 10000; // 10 seconds

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const page = searchParams.get('page') || '0';
        const limit = searchParams.get('limit') || '1000';

        const cacheKey = `inscriptions:${page}:${limit}`;
        const cached = cache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return NextResponse.json(cached.data);
        }

        const url = `${INDEXER_BASE_URL}/inscriptions?page=${page}&limit=${limit}`;
        const response = await fetch(url);

        if (!response.ok) {
            return NextResponse.json(
                { error: 'Failed to fetch from indexer' },
                { status: response.status }
            );
        }

        const data = await response.json();
        cache.set(cacheKey, { data, timestamp: Date.now() });

        return NextResponse.json(data);
    } catch (error) {
        console.error('Error proxying inscription request:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
