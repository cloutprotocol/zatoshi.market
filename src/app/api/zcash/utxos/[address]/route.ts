import { NextRequest, NextResponse } from 'next/server';
import { TatumSDK, Network, ZCash } from '@tatumio/tatum';

/**
 * Zcash UTXO Fetcher API
 *
 * Fetches unspent transaction outputs (UTXOs) for a Zcash address
 * ⚠️ CRITICAL: Only call when building inscription transactions to minimize RPC usage
 *
 * Architecture:
 * - Uses Tatum RPC (listUnspent method) to get UTXOs
 * - No caching (UTXOs change frequently with new transactions)
 * - Only used during inscription transaction construction
 *
 * Use Cases:
 * - Building inscription transactions (selecting inputs to spend)
 * - Calculating available balance for inscriptions
 * - Coin selection for optimal fee calculation
 *
 * Rate Limits:
 * - Tatum free tier: Limited RPC calls
 * - Only call immediately before inscription (not for balance display)
 * - Use Blockchair balance API for non-critical balance checks
 *
 * Returns:
 * - utxos: Array of unspent outputs with txid, vout, amount, confirmations
 */

export async function GET(
  request: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;

  try {
    if (!process.env.TATUM_API_KEY) {
      throw new Error('TATUM_API_KEY not configured');
    }

    const tatum = await TatumSDK.init<ZCash>({
      network: Network.ZCASH,
      apiKey: process.env.TATUM_API_KEY,
    });

    // Get UTXOs for address
    const utxos = await tatum.rpc.listUnspent(0, 9999999, [address]);

    await tatum.destroy();

    return NextResponse.json({ utxos });
  } catch (error) {
    console.error('UTXO fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch UTXOs' },
      { status: 500 }
    );
  }
}
