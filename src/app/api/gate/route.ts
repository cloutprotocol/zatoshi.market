import { NextRequest, NextResponse } from 'next/server';
import { callConvexGate } from '@/lib/callConvexGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_OPS = new Set([
  'ping',
  'unsignedCommit',
  'finalizeCommit',
  'broadcastReveal',
  'splitBuild',
  'splitBroadcast',
  'batchMint',
]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const op = String(body.op || '').trim();
    const params = (body.params && typeof body.params === 'object') ? body.params : {};

    if (!op || !ALLOWED_OPS.has(op)) {
      return NextResponse.json({ error: 'Invalid op' }, { status: 400 });
    }

    const data = await callConvexGate(op, params);
    return NextResponse.json(data, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Internal error' },
      { status: 502 }
    );
  }
}
