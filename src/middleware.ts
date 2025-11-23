import { NextResponse, type NextRequest } from 'next/server';

const RATE_LIMIT = Number(process.env.CLAIM_RATE_LIMIT || 40); // requests per minute
const WINDOW_MS = 60_000;
const ipBuckets = new Map<string, { count: number; expires: number }>();

function hitLimit(ip: string) {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || bucket.expires < now) {
    ipBuckets.set(ip, { count: 1, expires: now + WINDOW_MS });
    return false;
  }
  if (bucket.count >= RATE_LIMIT) return true;
  bucket.count += 1;
  return false;
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  if (!pathname.startsWith('/claim')) {
    return NextResponse.next();
  }

  const ip =
    req.ip ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';

  if (ip !== 'unknown' && hitLimit(ip)) {
    return new NextResponse('Too many requests', {
      status: 429,
      headers: {
        'Retry-After': '60',
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/claim/:path*'],
};
