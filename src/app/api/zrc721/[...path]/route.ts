import { NextRequest, NextResponse } from 'next/server';

const ZRC721_API_BASE = 'http://135.181.6.234:3333/api/v1/zrc721';

/**
 * Proxy for ZRC-721 indexer API
 * This proxies requests to avoid CORS and mixed content issues
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    const searchParams = request.nextUrl.searchParams;
    const queryString = searchParams.toString();

    const url = queryString
      ? `${ZRC721_API_BASE}/${path}?${queryString}`
      : `${ZRC721_API_BASE}/${path}`;

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
      // Cache for 10 seconds to reduce load on indexer
      next: { revalidate: 10 }
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch from ZRC-721 indexer' },
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
    console.error('ZRC-721 API proxy error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
