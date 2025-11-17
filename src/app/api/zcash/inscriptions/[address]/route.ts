import { NextRequest, NextResponse } from 'next/server';

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

/**
 * Zcash Inscriptions Lookup API
 *
 * Fetches all inscriptions owned by a Zcash address from zerdinals indexer
 * Used to identify inscribed UTXOs that must not be spent in regular transactions
 *
 * Architecture:
 * - Queries zerdinals.com indexer API
 * - Returns inscription locations (txid:vout format)
 * - Client filters these out when selecting UTXOs for sends
 *
 * Critical Use Case:
 * - **UTXO Protection**: Prevents accidental spending of inscribed UTXOs
 * - If you spend an inscribed UTXO, the inscription is permanently lost
 *
 * Returns:
 * - inscribedLocations: Array of "txid:vout" strings for inscribed UTXOs
 * - count: Total number of inscriptions owned by address
 */

// Enterprise-grade cache: 5 minutes (inscriptions are immutable once created)
// Client-side has additional localStorage cache layer for even better performance
const inscriptionCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function GET(
  request: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;

  // Check if refresh is requested (bypass cache)
  const searchParams = request.nextUrl.searchParams;
  const forceRefresh = searchParams.get('refresh') === 'true';

  try {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = inscriptionCache.get(address);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return NextResponse.json(cached.data);
      }
    }

    // Step 1: Fetch UTXOs for this address with retry logic
    // Add cache-busting parameter when force refresh is requested
    const cacheBuster = forceRefresh ? `&_t=${Date.now()}` : '';
    const utxoResponse = await fetchWithRetry(
      `https://api.blockchair.com/zcash/dashboards/address/${address}?key=A___e4MleX7tmjVk50SHfdfZR0pLqcOs${cacheBuster}`
    );

    if (!utxoResponse.ok) {
      throw new Error(`Failed to fetch UTXOs: ${utxoResponse.statusText}`);
    }

    const utxoData = await utxoResponse.json();
    const utxos = utxoData.data?.[address]?.utxo || [];

    // Step 2: Check each UTXO for inscriptions by location
    const inscriptions: any[] = [];
    const inscribedLocations: string[] = [];

    await Promise.all(
      utxos.map(async (utxo: any) => {
        const location = `${utxo.transaction_hash}:${utxo.index}`;
        try {
          // Use retry logic for indexer calls
          const response = await fetchWithRetry(
            `https://indexer.zerdinals.com/location/${location}`,
            1 // Max 1 retry for indexer (it's fast, so don't wait too long)
          );

          if (response.ok) {
            const data = await response.json();
            // If location has inscriptions, add them
            if (data.data?.result && data.data.result.length > 0) {
              for (const insc of data.data.result) {
                inscriptions.push(insc);
                inscribedLocations.push(location);
              }
            }
          }
        } catch (err) {
          // Silently ignore errors for individual UTXO checks after retries
          console.error(`Failed to check location ${location} after retries:`, err);
        }
      })
    );

    const result = {
      inscribedLocations,
      count: inscriptions.length,
      inscriptions
    };

    // Update cache
    inscriptionCache.set(address, { data: result, timestamp: Date.now() });

    // Clean old cache entries (keep last 50 addresses)
    if (inscriptionCache.size > 50) {
      const firstKey = inscriptionCache.keys().next().value;
      inscriptionCache.delete(firstKey);
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('Inscription lookup error:', error);

    // Return empty result on error (safer to show no inscriptions than fail send)
    return NextResponse.json({
      inscribedLocations: [],
      count: 0,
      inscriptions: [],
      error: error instanceof Error ? error.message : 'Failed to fetch inscriptions'
    });
  }
}
