/**
 * Inscription Protection Service
 *
 * Following Zerdinals best practices:
 * 1. Fetch all UTXOs for address
 * 2. Check EACH UTXO location in the indexer
 * 3. Filter out any UTXOs that contain inscriptions
 * 4. Only use clean UTXOs for transactions
 *
 * CRITICAL: Prevents accidentally destroying valuable inscriptions
 */

interface UTXO {
  value: number;
  txid: string;
  vout: number;
  address: string;
  blockHeight?: number;
  confirmed?: boolean;
}

interface InscriptionCheck {
  location: string; // "txid:vout"
  hasInscription: boolean;
  inscriptionData?: any;
}

/**
 * Fetch UTXOs from Zerdinals UTXO service
 * Uses the same API as zerdinals.com
 */
export async function fetchUTXOs(address: string): Promise<UTXO[]> {
  try {
    const response = await fetch(
      `https://utxos.zerdinals.com/api/utxos/${address}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch UTXOs: ${response.statusText}`);
    }

    const utxos: UTXO[] = await response.json();
    return utxos;
  } catch (error) {
    console.error('Error fetching UTXOs:', error);
    throw error;
  }
}

/**
 * Check if a specific UTXO location contains an inscription
 * Following Zerdinals indexer API pattern
 */
export async function checkUTXOForInscription(
  txid: string,
  vout: number
): Promise<InscriptionCheck> {
  const location = `${txid}:${vout}`;

  try {
    const response = await fetch(
      `https://indexer.zerdinals.com/location/${location}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) {
      // 404 means no inscription - SAFE to spend
      if (response.status === 404) {
        return {
          location,
          hasInscription: false
        };
      }
      throw new Error(`Indexer error: ${response.statusText}`);
    }

    const data = await response.json();

    // Check response format
    // 404 response: {"code":404,"message":"0 Inscription  found!"}
    if (data.code === 404 || data.message?.includes('0 Inscription')) {
      return {
        location,
        hasInscription: false
      };
    }

    // Has inscription data - NOT SAFE to spend
    return {
      location,
      hasInscription: true,
      inscriptionData: data
    };
  } catch (error: any) {
    // CRITICAL: If we can't verify, we MUST fail
    // Never assume safe if verification fails
    console.error(`❌ CRITICAL: Cannot verify ${location}:`, error.message);
    throw new Error(
      `Cannot verify UTXO ${location} is safe. ` +
      `Inscription check failed: ${error.message}. ` +
      `ABORTING to prevent potential inscription loss.`
    );
  }
}

/**
 * Get safe UTXOs (no inscriptions) for spending
 * This is the CRITICAL function that prevents inscription loss
 */
export async function getSafeUTXOs(address: string): Promise<{
  allUtxos: UTXO[];
  safeUtxos: UTXO[];
  inscribedUtxos: UTXO[];
  totalValue: number;
  safeValue: number;
}> {
  console.log(`🔒 Checking UTXOs for inscriptions: ${address}`);

  // Step 1: Fetch all UTXOs
  const allUtxos = await fetchUTXOs(address);
  console.log(`   Found ${allUtxos.length} total UTXO(s)`);

  if (allUtxos.length === 0) {
    return {
      allUtxos: [],
      safeUtxos: [],
      inscribedUtxos: [],
      totalValue: 0,
      safeValue: 0
    };
  }

  // Step 2: Check each UTXO for inscriptions (in parallel)
  // CRITICAL: This check is MANDATORY. If it fails, the entire operation MUST abort.
  console.log(`   Checking for inscriptions (MANDATORY)...`);

  let checks: InscriptionCheck[];
  try {
    checks = await Promise.all(
      allUtxos.map(utxo => checkUTXOForInscription(utxo.txid, utxo.vout))
    );
  } catch (error: any) {
    console.error(`\n❌ CRITICAL ERROR: Inscription check failed`);
    console.error(`   ${error.message}`);
    console.error(`\n🛑 OPERATION ABORTED to prevent inscription loss\n`);
    throw error;
  }

  // Step 3: Filter results
  const safeUtxos: UTXO[] = [];
  const inscribedUtxos: UTXO[] = [];

  allUtxos.forEach((utxo, index) => {
    const check = checks[index];
    if (check.hasInscription) {
      inscribedUtxos.push(utxo);
      console.log(`   ⚠️  INSCRIBED: ${utxo.txid.substring(0, 16)}...${utxo.vout}`);
    } else {
      safeUtxos.push(utxo);
      console.log(`   ✅ SAFE: ${utxo.txid.substring(0, 16)}...${utxo.vout}`);
    }
  });

  const totalValue = allUtxos.reduce((sum, u) => sum + u.value, 0);
  const safeValue = safeUtxos.reduce((sum, u) => sum + u.value, 0);

  console.log(`\n   📊 Results:`);
  console.log(`      Total UTXOs: ${allUtxos.length}`);
  console.log(`      Safe: ${safeUtxos.length} (${(safeValue / 100000000).toFixed(8)} ZEC)`);
  console.log(`      Inscribed: ${inscribedUtxos.length} (PROTECTED)`);

  if (inscribedUtxos.length > 0) {
    console.log(`\n   🛡️  Protection: ${inscribedUtxos.length} inscribed UTXO(s) will NOT be spent`);
  }

  if (safeUtxos.length === 0) {
    throw new Error(
      `⛔ Cannot proceed: All ${allUtxos.length} UTXO(s) contain inscriptions. ` +
      `Spending would destroy your inscriptions permanently!`
    );
  }

  return {
    allUtxos,
    safeUtxos,
    inscribedUtxos,
    totalValue,
    safeValue
  };
}

/**
 * Verify sufficient funds in safe UTXOs
 */
export async function verifySafeFunds(
  address: string,
  requiredAmount: number
): Promise<UTXO[]> {
  const { safeUtxos, safeValue, inscribedUtxos } = await getSafeUTXOs(address);

  if (safeValue < requiredAmount) {
    const message = inscribedUtxos.length > 0
      ? `Insufficient funds in safe UTXOs. Need ${requiredAmount}, have ${safeValue} zatoshis. ` +
        `(${inscribedUtxos.length} UTXO(s) contain inscriptions and are protected)`
      : `Insufficient funds. Need ${requiredAmount}, have ${safeValue} zatoshis`;

    throw new Error(message);
  }

  return safeUtxos;
}
