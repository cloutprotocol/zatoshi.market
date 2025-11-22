import { NextRequest, NextResponse } from 'next/server';
import { callZcashRPC } from '../rpcHelper';

/**
 * Zcash Transaction Broadcast API
 *
 * Broadcasts a signed transaction to the Zcash network
 * using Zatoshi RPC.
 */

export async function POST(request: NextRequest) {
  try {
    const { signedTx } = await request.json();

    if (!signedTx) {
      return NextResponse.json(
        { error: 'Missing signedTx parameter' },
        { status: 400 }
      );
    }

    // Broadcast using Zatoshi RPC
    const txid = await callZcashRPC('sendrawtransaction', [signedTx]);

    return NextResponse.json({ txid });
  } catch (error) {
    console.error('Transaction broadcast error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to broadcast transaction' },
      { status: 500 }
    );
  }
}
