/**
 * Decode our transaction using Tatum to see what the node sees
 */

// Our signed transaction hex (from bitcore)
const TX_HEX = '0400008085202f8901b19a00055d57c96ef344e7de42d27371fa9062345a9b4046548e362b2da6d948000000006b483045022100bb8473b1da7501e10a02491c7df3a2c3065bbcc2c77c65765923fddd92326ce302204debf051f17abc0339ba50f5bdabe09356288298cd0d8fa44029b772ca6bad65012103cbe99e3fd41a3f4ed04961c7dafc5074b790ccc076fc3b7aafff5a59bac96a8bffffffff020000000000000000126a107a6572647c68656c6c6f20776f726c64107a0700000000001976a914ad147aafdeaeba4dbb59874e7aec3c44110283be88ac00000000000000000000000000000000000000';

async function decodeTx() {
  console.log('\n🔍 Decoding Transaction\n');

  const response = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 't-691ab5fae2b53035df472a13-2ea27385c5964a15b092bdab'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'decoderawtransaction',
      params: [TX_HEX],
      id: 1
    })
  });

  const result = await response.json();

  if (result.error) {
    console.error('❌ Decode error:', result.error);
    return;
  }

  console.log(JSON.stringify(result.result, null, 2));

  // Try testmempoolaccept for more detailed error
  console.log('\n📡 Testing mempool accept...\n');

  const testResponse = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 't-691ab5fae2b53035df472a13-2ea27385c5964a15b092bdab'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'testmempoolaccept',
      params: [[TX_HEX]],
      id: 1
    })
  });

  const testResult = await testResponse.json();
  console.log('Mempool test:', JSON.stringify(testResult, null, 2));
}

decodeTx()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
