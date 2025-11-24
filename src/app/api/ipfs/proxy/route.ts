import { NextResponse } from 'next/server';
import { IPFS_GATEWAYS, IPFS_REQUEST_TIMEOUT_MS } from '@/config/ipfs';

const CID_PATTERN = /^[a-zA-Z0-9]+$/;
const CACHE_CONTROL = 'public, max-age=60, s-maxage=600, stale-while-revalidate=3600';
const PASSTHROUGH_HEADERS = ['content-type', 'content-length', 'content-disposition'];

type Method = 'GET' | 'HEAD';

type Target = {
  cid: string;
  path: string;
};

function sanitizeCid(cid: string): string | null {
  const trimmed = cid.trim();
  if (!CID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function parsePath(raw: string | null): string {
  if (!raw) return '';
  return raw
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function normalizeBase(base: string) {
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function parseTarget(searchParams: URLSearchParams): Target | null {
  const cidParam = searchParams.get('cid') ?? searchParams.get('hash');
  const pathParam = searchParams.get('path') ?? searchParams.get('file');
  if (cidParam) {
    const cid = sanitizeCid(cidParam);
    if (!cid) return null;
    const path = parsePath(pathParam);
    return { cid, path };
  }

  const ipfsParam = searchParams.get('ipfs') ?? searchParams.get('target');
  if (ipfsParam) {
    let value = ipfsParam.trim();
    if (value.startsWith('ipfs://')) {
      value = value.replace('ipfs://', '');
    }
    value = value.replace(/^\/?ipfs\//, '').replace(/^\//, '');
    const [cidPart, ...rest] = value.split('/');
    const cid = sanitizeCid(cidPart);
    if (!cid) return null;
    const path = parsePath(rest.join('/'));
    return { cid, path };
  }

  return null;
}

function buildGatewayUrls(target: Target) {
  const suffix = target.path ? `${target.cid}/${target.path}` : target.cid;
  return IPFS_GATEWAYS.map((base) => `${normalizeBase(base)}/${suffix}`);
}

async function fetchWithTimeout(url: string, method: Method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IPFS_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function proxyFromGateways(urls: string[], method: Method) {
  let lastError: unknown;
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, method);
      if (res.ok && (method === 'HEAD' || res.body)) {
        return { res, gateway: new URL(url).origin };
      }
      lastError = new Error(`Gateway responded ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('All gateways failed');
}

function buildProxyResponse(upstream: Response, gateway: string) {
  const headers = new Headers();
  headers.set('Cache-Control', CACHE_CONTROL);
  PASSTHROUGH_HEADERS.forEach((key) => {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  });
  headers.set('x-ipfs-gateway', gateway);
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function handle(request: Request, method: Method) {
  const url = new URL(request.url);
  const target = parseTarget(url.searchParams);
  if (!target) {
    return NextResponse.json({ error: 'cid parameter required' }, { status: 400 });
  }

  try {
    const sources = buildGatewayUrls(target);
    const { res, gateway } = await proxyFromGateways(sources, method);
    return buildProxyResponse(res, gateway);
  } catch (err) {
    console.error('IPFS proxy failed', err);
    return NextResponse.json({ error: 'Unable to retrieve asset' }, { status: 502 });
  }
}

export async function GET(request: Request) {
  return handle(request, 'GET');
}

export async function HEAD(request: Request) {
  return handle(request, 'HEAD');
}
