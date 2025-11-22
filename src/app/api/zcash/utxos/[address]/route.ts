import { NextRequest, NextResponse } from 'next/server';
import { callZcashRPC } from '../../rpcHelper';

/**
 * Zcash UTXO Fetcher API
 *
 * Fetches unspent transaction outputs (UTXOs) for a Zcash address
 * using Zatoshi RPC (Insight-compatible).
 */

export async function GET(
  request: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;

  try {
    // Use Zatoshi RPC (getaddressutxos)
    const utxos = await callZcashRPC('getaddressutxos', [{ addresses: [address] }]);

    if (Array.isArray(utxos)) {
      const formattedUtxos = utxos.map((utxo: any) => ({
        txid: utxo.txid,
        vout: utxo.outputIndex,
        address: utxo.address,
        scriptPubKey: utxo.script,
        amount: utxo.satoshis / 100000000,
        satoshis: utxo.satoshis,
        height: utxo.height,
        confirmations: utxo.confirmations || 0
      }));
      return NextResponse.json({ utxos: formattedUtxos });
    }

    return NextResponse.json({ utxos: [] });
  } catch (error) {
    console.error('UTXO fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch UTXOs', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
