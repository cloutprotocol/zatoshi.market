import { NextResponse } from 'next/server';

export const runtime = 'edge';

/**
 * Zcash Price API (ZEC/USD)
 *
 * Fetches current ZEC to USD exchange rate from CoinGecko
 *
 * Used By:
 * - Wallet drawer (portfolio value display)
 * - Balance displays (showing USD equivalent)
 *
 * Architecture:
 * - Uses CoinGecko free API (no auth required)
 * - Server-side caching (60 seconds) to minimize external API calls
 * - Fallback to last cached price if API fails
 *
 * Rate Limits:
 * - CoinGecko free tier: ~50 calls/minute
 * - 60-second cache ensures we stay well under limit
 *
 * Returns:
 * - usd: Current ZEC price in USD
 */

// Cache price for 60 seconds to reduce API calls
let cachedPrice: { price: number; timestamp: number } | null = null;
const CACHE_DURATION = 60 * 1000; // 60 seconds

export async function GET() {
  try {
    // Return cached price if still valid
    if (cachedPrice && Date.now() - cachedPrice.timestamp < CACHE_DURATION) {
      return NextResponse.json({ usd: cachedPrice.price });
    }

    // Fetch fresh price from CoinGecko
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd'
    );
    const data = await response.json();
    const price = data.zcash?.usd || 0;

    // Update cache
    cachedPrice = { price, timestamp: Date.now() };

    return NextResponse.json({ usd: price });
  } catch (error) {
    console.error('Price API error:', error);
    // Return cached price if available, otherwise 0
    return NextResponse.json({ usd: cachedPrice?.price || 0 });
  }
}
