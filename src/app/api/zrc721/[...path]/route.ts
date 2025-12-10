import { NextRequest, NextResponse } from 'next/server';

const API_BASE = 'http://135.181.6.234:3333/api/v1';

/**
 * Proxy for ZRC-721 indexer API
 * This proxies requests to avoid CORS and mixed content issues
 * Also proxies /inscriptions for getting recent mints with timestamps
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    const searchParams = request.nextUrl.searchParams;
    const queryString = searchParams.toString();

    // Handle inscriptions endpoint (not under /zrc721)
    const apiPath = path === 'inscriptions' || path.startsWith('inscriptions/')
      ? path
      : `zrc721/${path}`;

    const url = queryString
      ? `${API_BASE}/${apiPath}?${queryString}`
      : `${API_BASE}/${apiPath}`;

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
      // Cache for 10 seconds to reduce load on indexer
      next: { revalidate: 10 }
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch from indexer' },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
      },
    });
  } catch (error) {
    console.error('Indexer API proxy error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
