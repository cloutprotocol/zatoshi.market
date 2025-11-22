import { NextRequest, NextResponse } from 'next/server';
import { callZcashRPC } from '../../rpcHelper';

/**
 * Zcash Address Balance API
 *
 * Fetches confirmed and unconfirmed balance for a Zcash transparent address
 * using Zatoshi RPC (Insight-compatible).
 */

// Cache balances per address for 1 minute to reduce RPC calls
const balanceCache = new Map<string, { balance: any; timestamp: number }>();
const CACHE_DURATION = 60 * 1000; // 1 minute

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

  try {
    // Use Zatoshi RPC (getaddressbalance)
    // Returns { balance: satoshis, received: satoshis }
    // Note: "balance" here is usually confirmed. Unconfirmed might need getaddressutxos or similar.
    // Let's try getaddressbalance first.
    const result = await callZcashRPC('getaddressbalance', [{ addresses: [address] }]);

    // Insight getaddressbalance usually returns confirmed balance.
    // To get unconfirmed, we might need getaddressutxos or getaddressmempool.
    // For simplicity and speed, we'll assume balance is confirmed.
    // If we need unconfirmed, we can check mempool.

    const confirmedZats = result.balance;

    // Check mempool for unconfirmed
    let unconfirmedZats = 0;
    try {
      const mempool = await callZcashRPC('getaddressmempool', [{ addresses: [address] }]);
      if (Array.isArray(mempool)) {
        unconfirmedZats = mempool.reduce((sum: number, tx: any) => sum + (tx.satoshis || 0), 0);
      }
    } catch (e) {
      // Mempool check failed, ignore
    }

    const balance = {
      confirmed: confirmedZats / 100000000,
      unconfirmed: unconfirmedZats / 100000000,
    };

    // Update cache
    balanceCache.set(address, { balance, timestamp: Date.now() });

    // Clean old cache entries (keep last 100)
    if (balanceCache.size > 100) {
      const firstKey = balanceCache.keys().next().value;
      balanceCache.delete(firstKey);
    }

    return NextResponse.json(balance);
  } catch (error) {
    console.error('Balance RPC failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch balance', confirmed: 0, unconfirmed: 0 },
      { status: 500 }
    );
  }
}
