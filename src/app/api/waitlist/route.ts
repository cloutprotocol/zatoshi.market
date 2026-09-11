/**
 * POST /api/waitlist  { email }  →  { ok: true, already?: boolean }
 *
 * Access-request capture for the coming-soon page. Backed by Upstash Redis (Vercel Marketplace),
 * chosen because a waitlist is an append-only set with dedupe — no schema or migrations needed.
 *
 * Storage layout:
 *   waitlist:emails        sorted set, score = signup epoch ms, member = email (dedupe + ordering)
 *   waitlist:meta:<email>  hash of signup metadata (source, referer, ua, ip country)
 *   waitlist:rl:<ip>       counter with TTL, cheap abuse throttle
 *
 * Export the list with:  ZRANGE waitlist:emails 0 -1 WITHSCORES
 *
 * Returns 503 when the Upstash env vars are absent so a misconfigured deploy fails loudly
 * instead of silently dropping signups.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAILS_KEY = 'waitlist:emails';
const MAX_PER_WINDOW = 5;
const WINDOW_SECONDS = 60 * 10;

// RFC 5322 is not worth implementing; this rejects the mistakes people actually make.
const EMAIL_RE = /^[^\s@]+@[^\s@,]+\.[a-z]{2,}$/i;

function redisOrNull(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function POST(req: NextRequest) {
  const redis = redisOrNull();
  if (!redis) {
    console.error('[waitlist] Upstash env vars missing; signup dropped');
    return NextResponse.json(
      { error: 'Signups are not available right now. Try again shortly.' },
      { status: 503 },
    );
  }

  let email: string;
  try {
    const body = (await req.json()) as { email?: unknown };
    email = String(body.email ?? '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';

  try {
    const rlKey = `waitlist:rl:${ip}`;
    const hits = await redis.incr(rlKey);
    if (hits === 1) await redis.expire(rlKey, WINDOW_SECONDS);
    if (hits > MAX_PER_WINDOW) {
      return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
    }

    // NX so a repeat signup keeps its original position in the queue.
    const added = await redis.zadd(EMAILS_KEY, { nx: true }, { score: Date.now(), member: email });
    const already = added === 0;

    if (!already) {
      await redis.hset(`waitlist:meta:${email}`, {
        at: new Date().toISOString(),
        source: 'coming-soon',
        referer: req.headers.get('referer') ?? '',
        ua: (req.headers.get('user-agent') ?? '').slice(0, 300),
        country: req.headers.get('x-vercel-ip-country') ?? '',
      });
    }

    return NextResponse.json({ ok: true, already });
  } catch (err) {
    console.error('[waitlist] store failed:', err);
    return NextResponse.json(
      { error: 'Could not save your request. Try again shortly.' },
      { status: 502 },
    );
  }
}
