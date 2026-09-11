/**
 * POST /api/waitlist  { email }  →  { ok: true, already?: boolean }
 *
 * Access-request capture for the coming-soon page, stored in Convex (convex/waitlist.ts).
 *
 * The browser never talks to Convex directly here: routing through this handler keeps the
 * deployment URL out of the client bundle for this flow and lets us derive the caller's IP for
 * rate limiting. Only a salted SHA-256 of the IP is passed on — the raw address is never stored.
 *
 * Returns 503 when NEXT_PUBLIC_CONVEX_URL is absent so a misconfigured deploy fails loudly
 * instead of silently dropping signups.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../convex/_generated/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@,]+\.[a-z]{2,}$/i;

function convexUrl(): string {
  const env = (process.env.NEXT_PUBLIC_CONVEX_ENV || '').toLowerCase();
  return (
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    (env === 'prod' ? process.env.NEXT_PUBLIC_CONVEX_URL_PROD : process.env.NEXT_PUBLIC_CONVEX_URL_DEV) ||
    process.env.NEXT_PUBLIC_CONVEX_URL_DEV ||
    process.env.NEXT_PUBLIC_CONVEX_URL_PROD ||
    ''
  );
}

export async function POST(req: NextRequest) {
  const url = convexUrl();
  if (!url) {
    console.error('[waitlist] NEXT_PUBLIC_CONVEX_URL missing; signup dropped');
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
    '';
  // Salted so the hashes are not reversible via a rainbow table of the IPv4 space.
  const ipHash = ip
    ? createHash('sha256').update(`${process.env.WAITLIST_IP_SALT ?? 'zatoshi'}:${ip}`).digest('hex')
    : undefined;

  try {
    const client = new ConvexHttpClient(url);
    const result = await client.mutation(api.waitlist.join, {
      email,
      source: 'coming-soon',
      referer: req.headers.get('referer') ?? undefined,
      country: req.headers.get('x-vercel-ip-country') ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
      ipHash,
    });
    return NextResponse.json({ ok: true, already: result.already });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('rate-limited')) {
      return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
    }
    if (msg.includes('invalid-email')) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }
    console.error('[waitlist] store failed:', msg);
    return NextResponse.json(
      { error: 'Could not save your request. Try again shortly.' },
      { status: 502 },
    );
  }
}
