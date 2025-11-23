import { NextResponse } from 'next/server';
import { IPFS_REQUEST_TIMEOUT_MS, UPSTREAM_IPFS_GATEWAYS } from '@/config/ipfs';

export const runtime = 'edge';

const CACHE_CONTROL_HEADER = 'public, max-age=86400, stale-while-revalidate=604800';

async function fetchWithTimeout(url: string, timeout = IPFS_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeSegments(segments: string[]) {
  return segments.every((segment) => segment && !segment.includes('..') && !segment.includes('\\'));
}

export async function GET(_req: Request, { params }: { params: { cid: string; path?: string[] } }) {
  const cid = params.cid;
  const pathSegments = params.path ?? [];

  if (!cid || !/^[a-zA-Z0-9]+$/.test(cid)) {
    return NextResponse.json({ error: 'Invalid CID' }, { status: 400 });
  }

  if (!pathSegments.length || !sanitizeSegments(pathSegments)) {
    return NextResponse.json({ error: 'Invalid IPFS path' }, { status: 400 });
  }

  const relativePath = pathSegments.join('/');
  let lastError: unknown = null;

  for (const base of UPSTREAM_IPFS_GATEWAYS) {
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const targetUrl = `${normalizedBase}/${cid}/${relativePath}`;
    try {
      const upstream = await fetchWithTimeout(targetUrl);
      if (!upstream.ok || !upstream.body) {
        lastError = new Error(`Gateway ${base} responded ${upstream.status}`);
        continue;
      }

      const headers = new Headers();
      headers.set('Cache-Control', CACHE_CONTROL_HEADER);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      headers.set('x-ipfs-gateway', targetUrl);

      const contentType = upstream.headers.get('content-type');
      if (contentType) headers.set('Content-Type', contentType);
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) headers.set('Content-Length', contentLength);
      const etag = upstream.headers.get('etag') || upstream.headers.get('x-ipfs-etag');
      if (etag) headers.set('ETag', etag);

      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      });
    } catch (err) {
      lastError = err;
    }
  }

  console.warn('IPFS proxy failed', { cid, path: relativePath, error: lastError });
  return NextResponse.json({ error: 'Failed to load IPFS asset' }, { status: 502 });
}
