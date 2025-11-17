/**
 * Test Tatum RPC methods for Zcash
 *
 * This script tests various Tatum RPC calls to understand
 * what's available for building inscriptions
 */

import { TatumSDK, Network, ZCash } from '@tatumio/tatum';

async function testTatumRPC() {
  console.log('🧪 Testing Tatum RPC for Zcash\n');

  const apiKey = process.env.TATUM_API_KEY;
  if (!apiKey) {
    throw new Error('TATUM_API_KEY not set');
  }

  const tatum = await TatumSDK.init<ZCash>({
    network: Network.ZCASH,
    apiKey: apiKey,
  });

  try {
    // Test 1: Get blockchain info
    console.log('1️⃣ Getting blockchain info...');
    try {
      const blockchainInfo = await tatum.rpc.getBlockchainInfo();
      console.log('   Chain:', blockchainInfo.chain);
      console.log('   Blocks:', blockchainInfo.blocks);
      console.log('   ✅ Success\n');
    } catch (e: any) {
      console.log('   ❌ Error:', e.message, '\n');
    }

    // Test 2: Get block count
    console.log('2️⃣ Getting block count...');
    try {
      const blockCount = await tatum.rpc.getBlockCount();
      console.log('   Block count:', blockCount);
      console.log('   ✅ Success\n');
    } catch (e: any) {
      console.log('   ❌ Error:', e.message, '\n');
    }

    // Test 3: Get network info
    console.log('3️⃣ Getting network info...');
    try {
      const networkInfo = await tatum.rpc.getNetworkInfo();
      console.log('   Version:', networkInfo.version);
      console.log('   Subversion:', networkInfo.subversion);
      console.log('   ✅ Success\n');
    } catch (e: any) {
      console.log('   ❌ Error:', e.message, '\n');
    }

    // Test 4: Estimate fee
    console.log('4️⃣ Estimating fee...');
    try {
      const fee = await tatum.rpc.estimateFee(6); // 6 blocks
      console.log('   Estimated fee (6 blocks):', fee);
      console.log('   ✅ Success\n');
    } catch (e: any) {
      console.log('   ❌ Error:', e.message, '\n');
    }

    // Test 5: Create raw transaction (demo)
    console.log('5️⃣ Testing createRawTransaction format...');
    try {
      // This will likely fail but shows us the expected format
      const inputs = [{ txid: '0000000000000000000000000000000000000000000000000000000000000000', vout: 0 }];
      const outputs = { 't1TvCHyAAYsnVfwRHjmgrbKV19YjmhW7zCj': 0.001 };

      console.log('   Input format:', JSON.stringify(inputs));
      console.log('   Output format:', JSON.stringify(outputs));

      // Uncomment to test (will fail with invalid input):
      // const rawTx = await tatum.rpc.createRawTransaction(inputs, outputs);
      console.log('   ⚠️  Skipped (would fail with mock data)\n');
    } catch (e: any) {
      console.log('   ❌ Error:', e.message, '\n');
    }

    // Test 6: Check available RPC methods
    console.log('6️⃣ Available RPC methods on tatum.rpc:');
    const rpcMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(tatum.rpc))
      .filter(name => !name.startsWith('_') && name !== 'constructor')
      .sort();

    console.log('   Total methods:', rpcMethods.length);
    console.log('   Methods:', rpcMethods.join(', '));
    console.log('   ✅ Success\n');

  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    await tatum.destroy();
    console.log('✅ Tatum SDK destroyed\n');
  }
}

// Run
if (require.main === module) {
  testTatumRPC()
    .then(() => {
      console.log('✅ Tests complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Tests failed:', error);
      process.exit(1);
    });
}

export { testTatumRPC };
