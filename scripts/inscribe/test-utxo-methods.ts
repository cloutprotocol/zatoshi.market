/**
 * Test different UTXO fetching methods
 */

import { TatumSDK, Network, ZCash } from '@tatumio/tatum';

const address = 't1WAHTLFAgVWVVh4a8XegCmkP7RnxvQKQhC';

async function testUTXOMethods() {
  console.log('🧪 Testing UTXO Fetch Methods\n');
  console.log(`Address: ${address}\n`);

  const apiKey = process.env.TATUM_API_KEY;
  if (!apiKey) {
    throw new Error('TATUM_API_KEY not set');
  }

  const tatum = await TatumSDK.init<ZCash>({
    network: Network.ZCASH,
    apiKey: apiKey,
  });

  try {
    // Method 1: SDK listUnspent (like your endpoint uses)
    console.log('1️⃣ Testing tatum.rpc.listUnspent()...');
    try {
      const utxos = await tatum.rpc.listUnspent(0, 9999999, [address]);
      console.log('   ✅ SUCCESS!');
      console.log('   Result:', JSON.stringify(utxos, null, 2));
    } catch (e: any) {
      console.log('   ❌ FAILED:', e.message);
    }

    // Method 2: Raw RPC call
    console.log('\n2️⃣ Testing rawRpcCall with listunspent...');
    try {
      const result = await tatum.rpc.rawRpcCall({
        method: 'listunspent',
        params: [0, 9999999, [address]]
      });
      console.log('   ✅ SUCCESS!');
      console.log('   Result:', JSON.stringify(result, null, 2));
    } catch (e: any) {
      console.log('   ❌ FAILED:', e.message);
    }

    // Method 3: Check if SDK has getAddressBalance
    console.log('\n3️⃣ Checking available methods on tatum.rpc...');
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(tatum.rpc))
      .filter(name => !name.startsWith('_') && name !== 'constructor')
      .filter(name => name.toLowerCase().includes('unspent') || name.toLowerCase().includes('utxo'))
      .sort();
    console.log('   UTXO-related methods:', methods.length > 0 ? methods : 'None found');

  } finally {
    await tatum.destroy();
  }
}

testUTXOMethods()
  .then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
