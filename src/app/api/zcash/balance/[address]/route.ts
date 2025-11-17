import { NextRequest, NextResponse } from 'next/server';

/**
 * Zcash Address Balance API
 *
 * Fetches confirmed and unconfirmed balance for a Zcash transparent address
 * using Blockchair API (requires valid API key for production use)
 *
 * Architecture:
 * - Uses Blockchair for balance lookups (dashboards/address endpoint)
 * - Server-side caching per address (30 seconds) to minimize external API calls
 * - Client-side has additional localStorage cache layer
 * - Retry logic for resilient fetching
 * - Handles API errors gracefully with informative error messages
 *
 * Rate Limits:
 * - Free tier: 10,000 requests/day with API key
 * - Without key: ~10 requests/hour (will get 430 rate limited)
 *
 * Returns:
 * - confirmed: Balance in ZEC (satoshis / 100000000)
 * - unconfirmed: Unconfirmed balance in ZEC
 */

/**
 * Simple retry helper for external API calls
 */
async function fetchWithRetry(url: string, maxRetries = 2): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  throw lastError || new Error('Request failed');
}

// Cache balances per address for 30 seconds (client has additional localStorage cache)
const balanceCache = new Map<string, { balance: any; timestamp: number }>();
const CACHE_DURATION = 30 * 1000; // 30 seconds

export async function GET(
  request: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;

  // Check if refresh is requested (bypass cache)
  const searchParams = request.nextUrl.searchParams;
  const forceRefresh = searchParams.get('refresh') === 'true';

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = balanceCache.get(address);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return NextResponse.json(cached.balance);
    }
  }

  // Use Blockchair API (REQUIRES valid API key)
  try {
    const apiKey = process.env.BLOCKCHAIR_API_KEY || '';

    if (!apiKey) {
      console.warn('BLOCKCHAIR_API_KEY not set - balance lookups will be rate limited');
    }

    // Add cache-busting parameter when force refresh is requested
    const cacheBuster = forceRefresh ? `&_t=${Date.now()}` : '';
    const url = apiKey
      ? `https://api.blockchair.com/zcash/dashboards/address/${address}?key=${apiKey}${cacheBuster}`
      : `https://api.blockchair.com/zcash/dashboards/address/${address}${forceRefresh ? `?_t=${Date.now()}` : ''}`;

    // Use retry logic for resilient fetching
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Check for API errors
    if (data.context?.code === 402) {
      console.error('Invalid Blockchair API key');
      return NextResponse.json(
        { error: 'Invalid API key - get one at https://blockchair.com/api', confirmed: 0, unconfirmed: 0 },
        { status: 402 }
      );
    }

    if (data.context?.code === 430) {
      console.error('Blockchair rate limited - need valid API key');
      return NextResponse.json(
        { error: 'Rate limited - need API key from https://blockchair.com/api', confirmed: 0, unconfirmed: 0 },
        { status: 429 }
      );
    }

    let balance = { confirmed: 0, unconfirmed: 0 };

    if (data.data && data.data[address]) {
      const addressData = data.data[address].address;
      balance = {
        confirmed: addressData.balance / 100000000,
        unconfirmed: addressData.unconfirmed_balance / 100000000,
      };
    }

    // Update cache
    balanceCache.set(address, { balance, timestamp: Date.now() });

    // Clean old cache entries (keep last 100)
    if (balanceCache.size > 100) {
      const firstKey = balanceCache.keys().next().value;
      balanceCache.delete(firstKey);
    }

    return NextResponse.json(balance);
  } catch (error) {
    console.error('Balance API failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch balance', confirmed: 0, unconfirmed: 0 },
      { status: 500 }
    );
  }
}
