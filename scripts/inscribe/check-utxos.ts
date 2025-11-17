/**
 * Check UTXOs for Existing Inscriptions
 *
 * CRITICAL: Before spending a UTXO, check if it contains an inscription!
 * Spending an inscribed UTXO can destroy the inscription.
 */

interface UTXO {
  transaction_hash: string;
  index: number;
  value: number;
  block_id?: number;
}

interface InscriptionCheck {
  utxo: UTXO;
  hasInscription: boolean;
  inscriptionId?: string;
  safeToSpend: boolean;
}

/**
 * Fetch UTXOs from Blockchair
 */
async function fetchUTXOs(address: string): Promise<UTXO[]> {
  const apiKey = process.env.BLOCKCHAIR_API_KEY || '';
  const url = `https://api.blockchair.com/zcash/dashboards/address/${address}${
    apiKey ? `?key=${apiKey}` : ''
  }`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch UTXOs: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data?.[address]?.utxo || [];
}

/**
 * Check if a UTXO contains an inscription
 *
 * Methods to detect inscriptions:
 * 1. Check Zerdinals API for known inscriptions
 * 2. Check transaction for OP_RETURN in same tx (new inscriptions)
 * 3. Check if UTXO value is exactly 546 sats (dust limit - common for inscriptions)
 */
async function checkUTXOForInscription(utxo: UTXO): Promise<InscriptionCheck> {
  // Method 1: Check Zerdinals API
  try {
    // Check if this UTXO is a known inscription
    const inscriptionId = `${utxo.transaction_hash}i${utxo.index}`;
    const zerdResponse = await fetch(
      `https://zerdinals.com/api/inscription/${inscriptionId}`,
      { signal: AbortSignal.timeout(3000) }
    );

    if (zerdResponse.ok) {
      const data = await zerdResponse.json();
      if (data && data.inscription) {
        return {
          utxo,
          hasInscription: true,
          inscriptionId,
          safeToSpend: false
        };
      }
    }
  } catch (error) {
    // API might be down or inscription doesn't exist
  }

  // Method 2: Check if it's dust (546 zatoshis = common inscription amount)
  // This is a heuristic - not all dust is inscriptions, but be safe
  if (utxo.value === 546) {
    return {
      utxo,
      hasInscription: false, // uncertain
      safeToSpend: false // be conservative
    };
  }

  // Method 3: Check transaction output for OP_RETURN
  // (Would require fetching raw transaction - skip for now)

  // Default: assume safe if > dust and not found in Zerdinals
  return {
    utxo,
    hasInscription: false,
    safeToSpend: utxo.value > 1000 // safe if > 1000 zatoshis and not inscribed
  };
}

/**
 * Get safe UTXOs for spending (no inscriptions)
 */
async function getSafeUTXOs(address: string): Promise<{
  all: UTXO[];
  safe: UTXO[];
  unsafe: InscriptionCheck[];
}> {
  console.log(`📦 Checking UTXOs for ${address}...\n`);

  const utxos = await fetchUTXOs(address);
  console.log(`   Found ${utxos.length} total UTXO(s)\n`);

  const checks: InscriptionCheck[] = [];

  for (const utxo of utxos) {
    const check = await checkUTXOForInscription(utxo);
    checks.push(check);

    const status = check.safeToSpend ? '✅ Safe' : '⚠️  Unsafe';
    const reason = check.hasInscription
      ? '(has inscription)'
      : check.utxo.value === 546
      ? '(dust - might be inscription)'
      : '';

    console.log(`   ${status} ${utxo.transaction_hash.substring(0, 16)}...`);
    console.log(`          Index: ${utxo.index}`);
    console.log(`          Value: ${utxo.value} zatoshis`);
    if (reason) console.log(`          ${reason}`);
    console.log();
  }

  const safe = checks.filter(c => c.safeToSpend).map(c => c.utxo);
  const unsafe = checks.filter(c => !c.safeToSpend);

  return { all: utxos, safe, unsafe };
}

/**
 * Get UTXOs safe for inscription creation
 */
async function getCleanUTXOsForInscription(
  address: string,
  minAmount: number = 10000 // need at least 10000 for fee
): Promise<UTXO[]> {
  const { safe } = await getSafeUTXOs(address);

  const totalSafe = safe.reduce((sum, u) => sum + u.value, 0);

  console.log(`\n💰 Safe balance: ${totalSafe} zatoshis (${(totalSafe / 100000000).toFixed(8)} ZEC)`);

  if (totalSafe < minAmount) {
    throw new Error(`Insufficient safe funds. Need ${minAmount}, have ${totalSafe} zatoshis`);
  }

  console.log(`✅ Safe to use ${safe.length} UTXO(s) for inscription\n`);

  return safe;
}

// CLI
if (require.main === module) {
  const address = process.argv[2];

  if (!address) {
    console.log('\nUsage:');
    console.log('  ./run-with-env.sh check-utxos.ts <address>\n');
    console.log('Example:');
    console.log('  ./run-with-env.sh check-utxos.ts t1ABC...\n');
    process.exit(1);
  }

  getCleanUTXOsForInscription(address)
    .then((utxos) => {
      console.log(`✅ Found ${utxos.length} clean UTXO(s) for inscription`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error:', error.message);
      process.exit(1);
    });
}

export { getSafeUTXOs, getCleanUTXOsForInscription, checkUTXOForInscription };
