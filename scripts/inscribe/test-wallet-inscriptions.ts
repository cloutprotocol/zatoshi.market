/**
 * Test wallet for inscriptions
 */

interface UTXO {
  value: number;
  txid: string;
  vout: number;
  address: string;
  blockHeight?: number;
  confirmed?: boolean;
}

async function checkWalletInscriptions(address: string) {
  console.log('\n🔍 Checking Wallet for Inscriptions\n');
  console.log(`Address: ${address}\n`);

  // Fetch UTXOs
  console.log('📦 Fetching UTXOs...');
  const utxosResponse = await fetch(
    `https://utxos.zerdinals.com/api/utxos/${address}`
  );

  if (!utxosResponse.ok) {
    throw new Error(`Failed to fetch UTXOs: ${utxosResponse.statusText}`);
  }

  const utxos: UTXO[] = await utxosResponse.json();
  console.log(`   Found ${utxos.length} UTXO(s)\n`);

  if (utxos.length === 0) {
    console.log('✅ No UTXOs found (empty wallet)\n');
    return;
  }

  // Check each UTXO for inscriptions
  console.log('🔒 Checking each UTXO for inscriptions...\n');

  const results = [];
  let inscribedCount = 0;
  let safeCount = 0;

  for (const utxo of utxos) {
    const location = `${utxo.txid}:${utxo.vout}`;

    try {
      const response = await fetch(
        `https://indexer.zerdinals.com/location/${location}`
      );

      const data = await response.json();

      if (response.status === 404 || data.code === 404) {
        // No inscription - safe
        console.log(`✅ SAFE: ${utxo.txid.substring(0, 16)}...${utxo.vout}`);
        console.log(`   Value: ${utxo.value} zatoshis (${(utxo.value / 100000000).toFixed(8)} ZEC)\n`);

        results.push({ utxo, hasInscription: false });
        safeCount++;
      } else {
        // Has inscription
        console.log(`⚠️  INSCRIBED: ${utxo.txid.substring(0, 16)}...${utxo.vout}`);
        console.log(`   Value: ${utxo.value} zatoshis`);
        console.log(`   Inscription: ${location}`);
        console.log(`   🛡️  MUST NOT SPEND - contains inscription!\n`);

        results.push({ utxo, hasInscription: true, data });
        inscribedCount++;
      }
    } catch (error: any) {
      console.log(`❌ ERROR checking ${location}: ${error.message}\n`);
      results.push({ utxo, hasInscription: null, error: error.message });
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════');
  console.log('📊 Summary\n');
  console.log(`Total UTXOs: ${utxos.length}`);
  console.log(`Safe to spend: ${safeCount}`);
  console.log(`Inscribed (PROTECTED): ${inscribedCount}`);

  const totalValue = utxos.reduce((sum, u) => sum + u.value, 0);
  const safeValue = results
    .filter((r: any) => !r.hasInscription)
    .reduce((sum: number, r: any) => sum + r.utxo.value, 0);

  console.log(`\nTotal Value: ${(totalValue / 100000000).toFixed(8)} ZEC`);
  console.log(`Safe Value: ${(safeValue / 100000000).toFixed(8)} ZEC`);

  if (inscribedCount > 0) {
    console.log(`\n🛡️  This wallet has ${inscribedCount} inscription(s)`);
    console.log(`   They are protected and will NOT be spent`);
  }

  console.log('═══════════════════════════════════════\n');

  return {
    total: utxos.length,
    safe: safeCount,
    inscribed: inscribedCount,
    totalValue,
    safeValue
  };
}

// Run
if (require.main === module) {
  const address = process.argv[2];

  if (!address) {
    console.log('\nUsage:');
    console.log('  npx tsx test-wallet-inscriptions.ts <address>\n');
    console.log('Example:');
    console.log('  npx tsx test-wallet-inscriptions.ts t1ABC...\n');
    process.exit(1);
  }

  checkWalletInscriptions(address)
    .then((result) => {
      if (result) {
        console.log(`✅ Check complete: ${result.inscribed} inscription(s) found`);
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error:', error.message);
      process.exit(1);
    });
}

export { checkWalletInscriptions };
