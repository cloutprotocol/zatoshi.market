import { NextResponse } from 'next/server';

const TOKEN_API_BASE = 'https://token-api.zerdinals.com';
const INDEXER_API_BASE = 'https://indexer.zerdinals.com';

export async function GET(request: Request, { params }: { params: { path: string[] } }) {
  const path = params.path?.join('/') || '';
  const { searchParams } = new URL(request.url);

  // Determine which API to use based on path
  let apiBase = TOKEN_API_BASE;
  if (path.startsWith('inscription') || path.startsWith('content') || path.startsWith('address')) {
    apiBase = INDEXER_API_BASE;
  }

  try {
    const queryString = searchParams.toString();
    const url = `${apiBase}/${path}${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch from Zerdinals API' },
        { status: response.status }
      );
    }

    const contentType = response.headers.get('content-type') || 'application/json';

    // For binary content (images, etc.), pass through as-is
    if (contentType.startsWith('image/') || contentType.startsWith('application/octet-stream') || path.startsWith('content/')) {
      const arrayBuffer = await response.arrayBuffer();
      return new NextResponse(arrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // For JSON responses
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Zerdinals API proxy error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
