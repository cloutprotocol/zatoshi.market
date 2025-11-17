/**
 * Test simple ZEC send (no inscription) to verify wallet works
 */

// Monkey-patch lodash for bitcore
import * as lodash from 'lodash';
(globalThis as any)._ = lodash;

import * as bitcore from 'bitcore-lib-zcash';

const WALLET = {
  address: 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

// Send to a different address (or back to same address)
const TO_ADDRESS = 't1TvCHyAAYsnVfwRHjmgrbKV19YjmhW7zCj'; // Test address

async function testSimpleSend() {
  console.log('\n🧪 Testing Simple ZEC Send\n');
  console.log('═══════════════════════════════════════\n');

  // Get UTXOs
  const utxosResponse = await fetch(
    `https://utxos.zerdinals.com/api/utxos/${WALLET.address}`
  );
  const utxos = await utxosResponse.json();
  console.log(`Found ${utxos.length} UTXO(s)\n`);

  const privateKey = bitcore.PrivateKey.fromWIF(WALLET.privateKeyWIF);
  const tx = new bitcore.Transaction();

  // Add input - let bitcore derive the script
  tx.from({
    txId: utxos[0].txid,
    outputIndex: utxos[0].vout,
    satoshis: utxos[0].value,
    address: WALLET.address
  });

  // Add output - send small amount to test address
  const sendAmount = 10000; // 0.0001 ZEC
  tx.to(TO_ADDRESS, sendAmount);

  // Change back to our address
  const fee = 10000;
  const changeAmount = utxos[0].value - sendAmount - fee;
  tx.to(WALLET.address, changeAmount);

  console.log('Transaction:');
  console.log(`  From: ${WALLET.address}`);
  console.log(`  To: ${TO_ADDRESS} (${sendAmount} zatoshis)`);
  console.log(`  Change: ${changeAmount} zatoshis`);
  console.log(`  Fee: ${fee} zatoshis\n`);

  // Sign
  tx.sign(privateKey);

  const signedHex = tx.uncheckedSerialize();
  console.log(`Signed TX: ${signedHex.substring(0, 80)}...`);
  console.log(`Length: ${signedHex.length / 2} bytes\n`);

  // Try broadcast
  console.log('📡 Broadcasting...\n');

  const tatumResponse = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 't-691ab5fae2b53035df472a13-2ea27385c5964a15b092bdab'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'sendrawtransaction',
      params: [signedHex],
      id: 1
    })
  });

  const result = await tatumResponse.json();
  console.log('Result:', JSON.stringify(result, null, 2));
}

testSimpleSend()
  .then(() => {
    console.log('\n✅ Test complete\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  });
