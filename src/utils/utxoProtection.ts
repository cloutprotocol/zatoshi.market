/**
 * UTXO Inscription Protection Utility
 *
 * Prevents accidental spending of inscribed UTXOs across all services
 * (send transactions, inscriptions, ZMAP purchases, etc.)
 *
 * ⚠️ CRITICAL: Spending an inscribed UTXO permanently destroys the inscription!
 *
 * Usage:
 * ```ts
 * const safeUtxos = await filterInscribedUTXOs(address, allUtxos);
 * // Use safeUtxos for building transactions
 * ```
 */

interface UTXO {
  txid: string;
  vout: number;
  [key: string]: any;
}

interface InscriptionData {
  inscribedLocations: string[];
  count: number;
}

/**
 * Fetch inscriptions for an address
 */
async function fetchInscriptions(address: string): Promise<InscriptionData> {
  try {
    const response = await fetch(`/api/zcash/inscriptions/${address}`);
    const data = await response.json();
    return {
      inscribedLocations: data.inscribedLocations || [],
      count: data.count || 0
    };
  } catch (error) {
    console.error('Failed to fetch inscriptions:', error);
    // Return empty on error (safer to continue than fail completely)
    return { inscribedLocations: [], count: 0 };
  }
}

/**
 * Filter out inscribed UTXOs from a UTXO set
 *
 * @param address - Zcash address to check
 * @param utxos - Array of UTXOs to filter
 * @returns Object with safeUtxos (non-inscribed), inscribedUtxos, and stats
 */
export async function filterInscribedUTXOs<T extends UTXO>(
  address: string,
  utxos: T[]
): Promise<{
  safeUtxos: T[];
  inscribedUtxos: T[];
  totalUtxos: number;
  inscribedCount: number;
  inscriptionCount: number;
}> {
  // Fetch inscriptions for this address
  const inscriptionData = await fetchInscriptions(address);

  // Create a Set for fast lookup
  const inscribedLocations = new Set(inscriptionData.inscribedLocations);

  // Separate safe and inscribed UTXOs
  const safeUtxos: T[] = [];
  const inscribedUtxos: T[] = [];

  for (const utxo of utxos) {
    const location = `${utxo.txid}:${utxo.vout}`;
    if (inscribedLocations.has(location)) {
      inscribedUtxos.push(utxo);
    } else {
      safeUtxos.push(utxo);
    }
  }

  return {
    safeUtxos,
    inscribedUtxos,
    totalUtxos: utxos.length,
    inscribedCount: inscribedUtxos.length,
    inscriptionCount: inscriptionData.count
  };
}

/**
 * Validate that UTXOs are safe to spend (throws if all are inscribed)
 *
 * @param address - Zcash address
 * @param utxos - Array of UTXOs
 * @param operation - Name of operation (for error message)
 * @returns Filtered safe UTXOs
 * @throws Error if all UTXOs are inscribed
 */
export async function getSafeUTXOs<T extends UTXO>(
  address: string,
  utxos: T[],
  operation: string = 'transaction'
): Promise<T[]> {
  if (utxos.length === 0) {
    throw new Error('No UTXOs available');
  }

  const { safeUtxos, inscribedCount, totalUtxos } = await filterInscribedUTXOs(address, utxos);

  // Log filtering if any were removed
  if (inscribedCount > 0) {
    console.log(`⚠️  Inscription Protection: Filtered out ${inscribedCount}/${totalUtxos} inscribed UTXOs`);
  }

  // Error if all UTXOs are inscribed
  if (safeUtxos.length === 0) {
    throw new Error(
      `Cannot proceed with ${operation}: All ${totalUtxos} UTXOs contain inscriptions. ` +
      `Spending inscribed UTXOs would destroy your inscriptions permanently.`
    );
  }

  return safeUtxos;
}

/**
 * Check if a specific UTXO is inscribed
 *
 * @param address - Zcash address
 * @param txid - Transaction ID
 * @param vout - Output index
 * @returns true if UTXO contains an inscription
 */
export async function isUTXOInscribed(
  address: string,
  txid: string,
  vout: number
): Promise<boolean> {
  const inscriptionData = await fetchInscriptions(address);
  const location = `${txid}:${vout}`;
  return inscriptionData.inscribedLocations.includes(location);
}
