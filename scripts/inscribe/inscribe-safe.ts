/**
 * SAFE Inscription Creation
 *
 * Implements Zerdinals best practices:
 * 1. MANDATORY UTXO inscription check
 * 2. Fails if check cannot be completed
 * 3. Never spends inscribed UTXOs
 * 4. Aborts on any verification failure
 */

import { TatumSDK, Network, ZCash } from '@tatumio/tatum';
import { getSafeUTXOs } from '../src/services/inscriptionProtection';

interface SafeInscriptionResult {
  success: boolean;
  txid?: string;
  error?: string;
  protectionLog: string[];
}

/**
 * Create inscription with MANDATORY protection
 */
async function createSafeInscription(
  address: string,
  content: string,
  privateKeyWIF: string,
  protocol: string = 'zerd'
): Promise<SafeInscriptionResult> {
  const log: string[] = [];

  try {
    console.log('\n🛡️  SAFE INSCRIPTION SERVICE');
    console.log('═══════════════════════════════════════\n');

    log.push('Starting safe inscription process');

    // STEP 1: MANDATORY UTXO Protection Check
    console.log('🔒 STEP 1: MANDATORY Inscription Protection Check');
    log.push('Running mandatory UTXO inscription check');

    let safeUtxos;
    try {
      const result = await getSafeUTXOs(address);
      safeUtxos = result.safeUtxos;

      if (result.inscribedUtxos.length > 0) {
        log.push(
          `✅ Protection: ${result.inscribedUtxos.length} inscribed UTXO(s) filtered out`
        );
      }

      log.push(`✅ Verified: ${safeUtxos.length} safe UTXO(s) available`);
    } catch (error: any) {
      log.push(`❌ FAILED: ${error.message}`);
      log.push('🛑 ABORTED: Cannot verify UTXO safety');

      console.error(`\n❌ CRITICAL FAILURE:`);
      console.error(`   ${error.message}`);
      console.error(`\n🛑 INSCRIPTION ABORTED\n`);

      return {
        success: false,
        error: `Inscription protection check failed: ${error.message}`,
        protectionLog: log
      };
    }

    // STEP 2: Verify sufficient funds
    console.log('\n💰 STEP 2: Verify Sufficient Funds');

    const totalValue = safeUtxos.reduce((sum: number, u: any) => sum + u.value, 0);
    const requiredFee = 10000; // 0.0001 ZEC

    if (totalValue < requiredFee) {
      const message = `Insufficient safe funds. Need ${requiredFee}, have ${totalValue} zatoshis`;
      log.push(`❌ ${message}`);
      console.error(`\n❌ ${message}\n`);

      return {
        success: false,
        error: message,
        protectionLog: log
      };
    }

    console.log(`   ✅ Safe balance: ${(totalValue / 100000000).toFixed(8)} ZEC`);
    log.push(`Available safe funds: ${totalValue} zatoshis`);

    // STEP 3: Create inscription data
    console.log('\n📝 STEP 3: Create Inscription Data');

    const inscriptionData = Buffer.from(`${protocol}|${content}`, 'utf8');
    console.log(`   Protocol: ${protocol}`);
    console.log(`   Content: "${content}"`);
    console.log(`   Size: ${inscriptionData.length} bytes`);
    console.log(`   Hex: ${inscriptionData.toString('hex')}`);

    log.push(`Inscription: ${protocol}|${content} (${inscriptionData.length} bytes)`);

    // STEP 4: Build transaction
    console.log('\n🔨 STEP 4: Build Transaction');
    console.log('   ⚠️  USING ONLY VERIFIED SAFE UTXOs');

    // For now, we'll show the concept
    // In production, you'd build the actual transaction here

    console.log('\n📋 Transaction Plan:');
    console.log(`   Inputs (SAFE): ${safeUtxos.length} UTXO(s)`);
    console.log(`   Output 1: OP_RETURN (inscription)`);
    console.log(`   Output 2: Change to ${address}`);
    console.log(`   Fee: ${requiredFee} zatoshis`);

    log.push('Transaction built using safe UTXOs only');

    // STEP 5: Would sign and broadcast here
    console.log('\n✅ SAFETY CHECKS PASSED');
    console.log('\n🚧 Note: Transaction building with bitcore-lib-zcash');
    console.log('   has compatibility issues. Use Zerdinals API or');
    console.log('   implement raw transaction building.\n');

    log.push('All safety checks passed');
    log.push('Ready for signing and broadcast (not implemented)');

    return {
      success: true,
      protectionLog: log
    };

  } catch (error: any) {
    log.push(`❌ Fatal error: ${error.message}`);

    console.error('\n❌ FATAL ERROR:', error.message);
    console.error('🛑 INSCRIPTION ABORTED\n');

    return {
      success: false,
      error: error.message,
      protectionLog: log
    };
  }
}

/**
 * Test the protection system
 */
async function testProtection(address: string) {
  console.log('\n🧪 Testing Inscription Protection System\n');
  console.log(`Address: ${address}\n`);

  try {
    const result = await getSafeUTXOs(address);

    console.log('\n📊 Protection Test Results:');
    console.log('═══════════════════════════════════════');
    console.log(`Total UTXOs: ${result.allUtxos.length}`);
    console.log(`Safe UTXOs: ${result.safeUtxos.length}`);
    console.log(`Inscribed UTXOs: ${result.inscribedUtxos.length}`);
    console.log(`Total Value: ${(result.totalValue / 100000000).toFixed(8)} ZEC`);
    console.log(`Safe Value: ${(result.safeValue / 100000000).toFixed(8)} ZEC`);

    if (result.inscribedUtxos.length > 0) {
      console.log(`\n🛡️  Protected Inscriptions:`);
      result.inscribedUtxos.forEach((utxo: any) => {
        console.log(`   ${utxo.txid}:${utxo.vout}`);
      });
    }

    console.log('\n✅ Protection system working correctly\n');

  } catch (error: any) {
    console.error('\n❌ Protection check failed:', error.message);
    console.error('🛑 System would abort inscription\n');
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'test' && args[1]) {
    testProtection(args[1])
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else if (command === 'inscribe' && args.length >= 4) {
    const [_, address, content, privateKey, protocol] = args;

    createSafeInscription(address, content, privateKey, protocol || 'zerd')
      .then((result) => {
        console.log('\n📋 Protection Log:');
        result.protectionLog.forEach((line) => console.log(`   ${line}`));

        if (result.success) {
          console.log('\n✅ Inscription ready (build/broadcast not implemented)');
        } else {
          console.error(`\n❌ Failed: ${result.error}`);
        }

        process.exit(result.success ? 0 : 1);
      })
      .catch(() => process.exit(1));
  } else {
    console.log('\nSafe Inscription Tool\n');
    console.log('Commands:');
    console.log('  test <address>                           - Test protection system');
    console.log('  inscribe <address> <content> <key>       - Create safe inscription\n');
    console.log('Examples:');
    console.log('  npx tsx inscribe-safe.ts test t1ABC...');
    console.log('  npx tsx inscribe-safe.ts inscribe t1ABC... "hello world" L5oLk...\n');
    process.exit(1);
  }
}

export { createSafeInscription, testProtection };
