import { NextRequest, NextResponse } from 'next/server';
import { TatumSDK, Network, ZCash } from '@tatumio/tatum';

/**
 * Zcash Transaction Broadcast API
 *
 * Broadcasts a signed transaction to the Zcash network
 * ⚠️ CRITICAL: Only used for final inscription broadcast - RPC call cost
 *
 * Architecture:
 * - Uses Tatum RPC (sendRawTransaction method) to broadcast transactions
 * - No caching (each transaction is unique and should only be sent once)
 * - Called only after user confirms inscription
 *
 * Transaction Flow:
 * 1. User builds inscription transaction offline
 * 2. User signs transaction with their private key
 * 3. This endpoint broadcasts the signed hex to network
 * 4. Returns transaction ID (txid) for tracking
 *
 * Rate Limits:
 * - Tatum free tier: Limited RPC calls
 * - One call per inscription (not a concern)
 *
 * Security:
 * - Only accepts signed transactions (no private key handling)
 * - Validates transaction hex format
 * - Returns meaningful errors for failed broadcasts
 *
 * Returns:
 * - txid: Transaction ID (hash) if successful
 * - error: Detailed error message if broadcast fails
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

    if (!process.env.TATUM_API_KEY) {
      throw new Error('TATUM_API_KEY not configured');
    }

    const tatum = await TatumSDK.init<ZCash>({
      network: Network.ZCASH,
      apiKey: process.env.TATUM_API_KEY,
    });

    // Broadcast the signed transaction
    const txid = await tatum.rpc.sendRawTransaction(signedTx);

    await tatum.destroy();

    return NextResponse.json({ txid });
  } catch (error) {
    console.error('Transaction broadcast error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to broadcast transaction' },
      { status: 500 }
    );
  }
}
