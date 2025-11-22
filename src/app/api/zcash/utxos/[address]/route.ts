import { NextRequest, NextResponse } from 'next/server';
import { TatumSDK, Network, ZCash } from '@tatumio/tatum';

export const runtime = 'edge';

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
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true';

  try {
    // Note: Tatum's listUnspent() is NOT available on their public gateway
    // Using Blockchair API as fallback (requires API key for production)

    const blockchairKey = process.env.BLOCKCHAIR_API_KEY;

    // Try Blockchair if API key is available
    if (blockchairKey) {
      const cacheBust = forceRefresh ? `&_t=${Date.now()}` : '';
      const url = `https://api.blockchair.com/zcash/dashboards/address/${address}?key=${blockchairKey}${cacheBust}`;
      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();
        const utxos = data.data?.[address]?.utxo || [];

        // Transform to standard format
        const formattedUtxos = utxos.map((utxo: any) => ({
          txid: utxo.transaction_hash,
          vout: utxo.index,
          address: address,
          scriptPubKey: '',
          amount: utxo.value / 100000000, // zatoshis to ZEC
          satoshis: utxo.value,
          height: utxo.block_id,
          confirmations: utxo.confirmations || (utxo.block_id ? 1 : 0)
        }));

        return NextResponse.json({ utxos: formattedUtxos });
      }
    }

    // Fallback: Try free explorers (unreliable but no API key needed)
    const explorers = [
      `https://api.zcha.in/v2/mainnet/accounts/${address}`,
      `https://zcashblockexplorer.com/api/addr/${address}/utxo`
    ];

    for (const explorer of explorers) {
      const explorerUrl = forceRefresh ? `${explorer}?_=${Date.now()}` : explorer;
      try {
        const response = await fetch(explorerUrl, {
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
          const data = await response.json();

          // Handle different response formats
          let utxos: any[] = [];
          if (Array.isArray(data)) {
            utxos = data;
          } else if (data.utxos) {
            utxos = data.utxos;
          } else if (data.data) {
            utxos = Array.isArray(data.data) ? data.data : [];
          }

          if (utxos.length > 0) {
            // Normalize format
            const formattedUtxos = utxos.map((utxo: any) => ({
              txid: utxo.txid || utxo.tx_hash || utxo.transaction_hash,
              vout: utxo.vout || utxo.index || utxo.output_index,
              address: address,
              scriptPubKey: utxo.scriptPubKey || utxo.script || '',
              amount: utxo.amount || (utxo.satoshis || utxo.value) / 100000000,
              satoshis: utxo.satoshis || utxo.value || Math.floor((utxo.amount || 0) * 100000000),
              height: utxo.height || utxo.block_id || 0,
              confirmations: utxo.confirmations || 0
            }));

            return NextResponse.json({ utxos: formattedUtxos });
          }
        }
      } catch (explorerError) {
        // Continue to next explorer
        continue;
      }
    }

    // No UTXOs found or all APIs failed
    return NextResponse.json({ utxos: [] });

  } catch (error) {
    console.error('UTXO fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch UTXOs', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
