/**
 * GET /api/inscriptions/status/[id]
 *
 * Public status for an inscription created through this platform.
 * `id` is an inscription id ("<revealTxid>i0") or a bare reveal txid.
 *
 * 200 { inscriptionId, txid, status: "pending"|"confirmed"|"failed", confirmations,
 *       blockHeight?, blockHash?, createdAt, confirmedAt?, checkedAt, source, explorer }
 * 400 invalid id · 404 unknown to this platform · 503 Convex not configured
 *
 * Chain truth is resolved server-side by convex/inscriptionStatusActions.checkInscriptionOnChain,
 * which also persists the transition so the /inscribe history view stays in sync.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../../convex/_generated/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID_RE = /^[0-9a-fA-F]{64}(?:i\d+)?$/;

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

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = (params.id || '').trim();
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid inscription id or txid' }, { status: 400 });
  }

  const url = convexUrl();
  if (!url) {
    return NextResponse.json({ error: 'Status service not configured (NEXT_PUBLIC_CONVEX_URL)' }, { status: 503 });
  }

  try {
    const client = new ConvexHttpClient(url);
    const result = await client.action(api.inscriptionStatusActions.checkInscriptionOnChain, { id });
    if (!result) {
      return NextResponse.json({ error: 'Inscription not found on this platform' }, { status: 404 });
    }
    return NextResponse.json(
      { ...result, explorer: `https://blockchair.com/zcash/transaction/${result.txid}` },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    console.error('[inscriptions/status] lookup failed:', error?.message || error);
    return NextResponse.json({ error: 'Status lookup failed' }, { status: 502 });
  }
}
