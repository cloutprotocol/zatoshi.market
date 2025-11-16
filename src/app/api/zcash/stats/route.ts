import { NextResponse } from 'next/server';

export async function GET() {
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

    return NextResponse.json({
      blocks: data.data.blocks,
      best_block_hash: data.data.best_block_hash,
      difficulty: data.data.difficulty,
      hashrate_24h: data.data.hashrate_24h,
    });
  } catch (error) {
    console.error('Failed to fetch Zcash stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch blockchain stats' },
      { status: 500 }
    );
  }
}
