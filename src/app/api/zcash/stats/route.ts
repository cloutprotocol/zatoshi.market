import { NextResponse } from 'next/server';

export const runtime = 'edge';

/**
 * Zcash Blockchain Stats API
 *
 * Fetches current blockchain statistics from Blockchair (no API key required for stats)
 *
 * Used By:
 * - Home page (block height for ZMAPS count)
 * - ZMAPS page (block count display)
 * - Wallet operations (blockchain sync status)
 *
 * Architecture:
 * - Uses Blockchair free stats endpoint (no auth required)
 * - Server-side caching (2 minutes) to minimize external API calls
 * - Client-side polling at 2-minute intervals matches cache duration
 *
 * Returns:
 * - blocks: Current block height
 * - best_block_hash: Latest block hash
 * - difficulty: Current mining difficulty
 * - hashrate_24h: Network hashrate (24h average)
 */

// Cache block count for 2 minutes to minimize API calls
let cachedStats: { stats: any; timestamp: number } | null = null;
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

export async function GET() {
  // Return cached stats if still valid
  if (cachedStats && Date.now() - cachedStats.timestamp < CACHE_DURATION) {
    return NextResponse.json(cachedStats.stats);
  }

  // Use Blockchair (free, no RPC needed for simple block count)
  try {
    const response = await fetch('https://api.blockchair.com/zcash/stats', {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Blockchair API error: ${response.statusText}`);
    }

    const data = await response.json();

    const stats = {
      blocks: data.data.blocks,
      best_block_hash: data.data.best_block_hash,
      difficulty: data.data.difficulty,
      hashrate_24h: data.data.hashrate_24h,
    };

    // Update cache
    cachedStats = { stats, timestamp: Date.now() };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Failed to fetch Zcash stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch blockchain stats' },
      { status: 500 }
    );
  }
}
