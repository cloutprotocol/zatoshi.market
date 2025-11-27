import { NextResponse } from 'next/server';

const ORDINAL_INDEX_API_BASE =
  process.env.ORDINAL_INDEX_API_BASE?.replace(/\/$/, '') ||
  process.env.NEXT_PUBLIC_ORDINAL_INDEX_API?.replace(/\/$/, '') ||
  'http://135.181.6.234:3333';

export async function GET(
  request: Request,
  { params }: { params: { path: string[] } }
) {
  const path = params.path?.join('/') ?? '';
  const { searchParams } = new URL(request.url);
  const query = searchParams.toString();
  const targetUrl = `${ORDINAL_INDEX_API_BASE}/${path}${
    query ? `?${query}` : ''
  }`;

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'User-Agent': 'zatoshi.market/ordinal-index-proxy',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const message = await response.text();
      return NextResponse.json(
        {
          error: 'Failed to reach ordinal index API',
          details: message,
        },
        { status: response.status }
      );
    }

    const contentType =
      response.headers.get('content-type') ?? 'application/octet-stream';

    if (contentType.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data);
    }

    if (contentType.includes('text/')) {
      const text = await response.text();
      return new NextResponse(text, {
        status: 200,
        headers: {
          'Content-Type': contentType,
        },
      });
    }

    const buffer = await response.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
      },
    });
  } catch (error) {
    console.error('Ordinal Index proxy error:', error);
    return NextResponse.json(
      { error: 'Internal proxy error' },
      { status: 500 }
    );
  }
}
