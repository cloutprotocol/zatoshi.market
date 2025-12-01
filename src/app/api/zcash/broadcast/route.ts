import { NextRequest, NextResponse } from 'next/server';
import { callZcashRPC } from '../rpcHelper';

async function isInputInscribed(txid: string, vout: number): Promise<boolean> {
  try {
    const tx = await callZcashRPC('getrawtransaction', [txid, 1]);
    const vins: any[] = Array.isArray(tx?.vin) ? tx.vin : [];
    const hasOrd = vins.some((vin: any) => {
      const hex: string = vin?.scriptSig?.hex || '';
      return typeof hex === 'string' && hex.toLowerCase().includes('6f7264'); // 'ord'
    });
    return hasOrd && vout === 0;
  } catch (e) {
    // Fail-safe: if we cannot verify, treat as inscribed to protect user assets
    return true;
  }
}

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

    // Decode to inspect inputs and enforce inscription protection
    try {
      const decoded = await callZcashRPC('decoderawtransaction', [signedTx]);
      const vins: any[] = Array.isArray(decoded?.vin) ? decoded.vin : [];
      for (const vin of vins) {
        if (!vin?.txid || typeof vin?.vout !== 'number') continue;
        const unsafe = await isInputInscribed(vin.txid, vin.vout);
        if (unsafe) {
          return NextResponse.json(
            { error: `Refusing to broadcast: input ${vin.txid}:${vin.vout} appears to be an inscribed UTXO` },
            { status: 400 }
          );
        }
      }
    } catch (e) {
      // If decode fails, still do a best-effort by trying to extract prevouts via getrawtransaction after sendrawtransaction would fail anyway.
      // For maximum safety, deny broadcasting when verification cannot be performed.
      return NextResponse.json({ error: 'Unable to verify inputs are safe to spend (inscription protection)' }, { status: 400 });
    }

    // Broadcast using Zatoshi RPC (only after passing inscription checks)
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
