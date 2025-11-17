/**
 * Create "Hello World" Inscription
 * Using manual transaction building to avoid bitcore-lib-zcash issues
 */

import { TatumSDK, Network, ZCash } from '@tatumio/tatum';
import * as bitcoin from 'bitcoinjs-lib';

const WALLET = {
  address: 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

const UTXO = {
  txid: '48d9a62d2b368e5446409b5a346290fa7173d242dee744f36ec9575d05009ab1',
  vout: 0,
  value: 500000 // zatoshis
};

async function createHelloWorldInscription() {
  console.log('\n🚀 Creating "Hello World" Inscription\n');
  console.log('═══════════════════════════════════════\n');

  // Step 1: Create inscription data
  console.log('📝 Step 1: Create Inscription Data');
  const content = 'hello world';
  const protocol = 'zerd';
  const inscriptionText = `${protocol}|${content}`;
  const inscriptionData = Buffer.from(inscriptionText, 'utf8');

  console.log(`   Protocol: ${protocol}`);
  console.log(`   Content: "${content}"`);
  console.log(`   Full: "${inscriptionText}"`);
  console.log(`   Hex: ${inscriptionData.toString('hex')}`);
  console.log(`   Size: ${inscriptionData.length} bytes\n`);

  // Step 2: Build transaction using Zcash RPC
  console.log('🔨 Step 2: Build Transaction via Tatum RPC');

  const apiKey = process.env.TATUM_API_KEY;
  if (!apiKey) {
    throw new Error('TATUM_API_KEY not set');
  }

  const tatum = await TatumSDK.init<ZCash>({
    network: Network.ZCASH,
    apiKey: apiKey,
  });

  try {
    // Create raw transaction using Tatum RPC
    const fee = 10000; // 0.0001 ZEC
    const changeAmount = UTXO.value - fee;

    console.log(`   Input: ${UTXO.value} zatoshis`);
    console.log(`   Fee: ${fee} zatoshis`);
    console.log(`   Change: ${changeAmount} zatoshis\n`);

    // Build the inputs and outputs for createrawtransaction
    const inputs = [{
      txid: UTXO.txid,
      vout: UTXO.vout
    }];

    // For OP_RETURN, we use the "data" key
    const outputs: any = {
      data: inscriptionData.toString('hex')
    };

    // Add change output
    if (changeAmount > 546) { // dust threshold
      outputs[WALLET.address] = changeAmount / 100000000; // Convert to ZEC
    }

    console.log('📋 Transaction Structure:');
    console.log('   Inputs:', JSON.stringify(inputs, null, 2));
    console.log('   Outputs:', JSON.stringify(outputs, null, 2));
    console.log('');

    // Try to create raw transaction
    console.log('🔧 Creating raw transaction via Tatum RPC...');

    try {
      const rawTx = await tatum.rpc.rawRpcCall({
        method: 'createrawtransaction',
        params: [inputs, outputs]
      });

      console.log('   Raw TX created:', rawTx);
      console.log('\n⚠️  Note: Transaction created but signing requires wallet import');
      console.log('   Tatum RPC does not support wallet operations (signrawtransaction)');
      console.log('\n💡 Alternative: Use Zerdinals transaction building API\n');

    } catch (rpcError: any) {
      console.error('   ❌ RPC Error:', rpcError.message);
      console.log('\n🔄 Falling back to manual transaction building...\n');

      // Manual transaction building would go here
      // But this requires proper Zcash transaction format implementation
      console.log('⚠️  Manual transaction building requires:');
      console.log('   1. Proper Zcash transaction format');
      console.log('   2. Signature hashing (SIGHASH_ALL)');
      console.log('   3. Script building for P2PKH');
      console.log('   4. Proper serialization\n');

      console.log('💡 Recommended approach:');
      console.log('   Use Zerdinals mint API or build transaction locally with working library\n');
    }

  } finally {
    await tatum.destroy();
  }

  return {
    success: false,
    message: 'Transaction building blocked by library limitations',
    recommendation: 'Use Zerdinals API or implement raw transaction builder'
  };
}

// Run
createHelloWorldInscription()
  .then((result) => {
    console.log('═══════════════════════════════════════');
    console.log('Result:', result.message);
    console.log('═══════════════════════════════════════\n');
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
  });
