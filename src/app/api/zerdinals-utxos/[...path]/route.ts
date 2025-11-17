import { NextResponse } from 'next/server';

export async function GET(_request: Request, { params }: { params: { path: string[] } }) {
  const path = params.path?.join('/') || '';
  const url = `https://utxos.zerdinals.com/api/${path}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch from Zerdinals UTXO API: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Zerdinals UTXO API proxy error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, { params }: { params: { path: string[] } }) {
  const path = params.path?.join('/') || '';
  const url = `https://utxos.zerdinals.com/api/${path}`;

  try {
    const body = await request.text();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `Failed to POST to Zerdinals UTXO API: ${response.status} ${response.statusText}`, details: text },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Zerdinals UTXO API proxy POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

