import { NextResponse } from 'next/server';
import { TatumSDK, Network, ZCash } from '@tatumio/tatum';

export const runtime = 'edge';

/**
 * Zcash Network Fee Estimation API
 *
 * Uses Tatum SDK to estimate smart fees for inscription transactions
 * ⚠️ CRITICAL: Only call when building inscription transactions to minimize RPC usage
 *
 * Architecture:
 * - Uses Tatum RPC (estimateSmartFee method) for accurate fee estimation
 * - Server-side caching (10 minutes) to minimize expensive RPC calls
 * - Falls back to safe default (0.0001 ZEC/KB) if API fails
 *
 * Fee Calculation:
 * - Estimates for 6 confirmations (balance between speed and cost)
 * - Returns feerate in ZEC per kilobyte
 * - Used to calculate total fee based on transaction size
 *
 * Rate Limits:
 * - Tatum free tier: Limited RPC calls (use sparingly!)
 * - Long cache duration (10 min) acceptable since fees change slowly
 *
 * Returns:
 * - feerate: Recommended fee in ZEC per KB
 * - blocks: Target confirmation blocks (usually 6)
 */

// Cache fees for 10 minutes to reduce API calls
// Only call when actually needed for inscriptions
let cachedFees: { fees: any; timestamp: number } | null = null;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

export async function GET() {
  try {
    // Return cached fees if still valid
    if (cachedFees && Date.now() - cachedFees.timestamp < CACHE_DURATION) {
      return NextResponse.json(cachedFees.fees);
    }

    if (!process.env.TATUM_API_KEY) {
      throw new Error('TATUM_API_KEY not configured');
    }

    // Initialize Tatum SDK
    const tatum = await TatumSDK.init<ZCash>({
      network: Network.ZCASH,
      apiKey: process.env.TATUM_API_KEY,
    });

    // Estimate smart fee for 6 confirmations
    const feeEstimate = await tatum.rpc.estimateSmartFee(6);

    await tatum.destroy();

    const fees = {
      feerate: feeEstimate.feerate || 0.0001, // Fallback to 0.0001 ZEC per KB
      blocks: feeEstimate.blocks || 6,
    };

    // Update cache
    cachedFees = { fees, timestamp: Date.now() };

    return NextResponse.json(fees);
  } catch (error) {
    console.error('Fee estimation error:', error);

    // Return reasonable defaults on error
    return NextResponse.json({
      feerate: 0.0001, // Default 0.0001 ZEC per KB
      blocks: 6,
    });
  }
}
