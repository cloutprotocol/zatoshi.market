import { NextRequest, NextResponse } from 'next/server';
import { callZcashRPC } from '../../rpcHelper';

/**
 * Zcash Inscriptions Lookup API
 *
 * Fetches all inscriptions owned by a Zcash address using Zatoshi RPC.
 * Used to identify inscribed UTXOs that must not be spent in regular transactions.
 */

// Cache inscriptions for 30 seconds
const inscriptionCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 30 * 1000; // 30 seconds

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

    // Step 1: Fetch UTXOs for this address
    const utxos = await callZcashRPC('getaddressutxos', [{ addresses: [address] }]);

    if (!Array.isArray(utxos)) {
      return NextResponse.json({ inscribedLocations: [], count: 0, inscriptions: [] });
    }

    // Step 2: Check each UTXO for inscriptions by location
    const inscriptions: any[] = [];
    const inscribedLocations: string[] = [];

    // Process in parallel
    await Promise.all(
      utxos.map(async (utxo: any) => {
        const location = `${utxo.txid}:${utxo.outputIndex}`;
        try {
          // Check for "ord" tag in scriptSig using getrawtransaction
          const tx = await callZcashRPC('getrawtransaction', [utxo.txid, 1]);
          const vins = tx?.vin || [];

          const hasOrd = vins.some((vin: any) => {
            const hex: string = vin?.scriptSig?.hex || '';
            return typeof hex === 'string' && hex.toLowerCase().includes('6f7264'); // 'ord'
          });

          if (hasOrd && utxo.outputIndex === 0) {
            // It's an inscription!
            // We don't have full inscription data (content type etc) easily available 
            // without parsing the scriptSig fully, but we can flag it as inscribed.
            // For the wallet view, we might need more data, but for protection, this is enough.
            // The wallet page fetches content via /api/zcash/inscription-content/[id] anyway.

            inscribedLocations.push(location);
            inscriptions.push({
              id: `${utxo.txid}i0`,
              txid: utxo.txid,
              vout: utxo.outputIndex,
              // Placeholder data - real data fetched by content API
              contentType: 'unknown',
            });
          }
        } catch (err) {
          console.error(`Failed to check location ${location}:`, err);
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

    // Clean old cache entries
    if (inscriptionCache.size > 50) {
      const firstKey = inscriptionCache.keys().next().value;
      inscriptionCache.delete(firstKey);
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('Inscription lookup error:', error);
    return NextResponse.json({
      inscribedLocations: [],
      count: 0,
      inscriptions: [],
      error: error instanceof Error ? error.message : 'Failed to fetch inscriptions'
    });
  }
}
