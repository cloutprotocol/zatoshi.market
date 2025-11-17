/**
 * Test broadcasting Zerdinals transaction to see if it's still valid
 */

const ZERDINALS_COMMIT_TX = '0400008085202f8901061530f1c5bdcfdaf8a224622e409fa2bc745b623207da735b1328fbc1c610f0020000006b483045022100b64e465f2177bc7d368cab8f4a62d12ac66a5940e6416129e4c35851643544db022068359c293fe01e666e46ad8b332825c4536b75f5c1cd0f9da61d030e0315f822012102ae86217e8e275ba60cedbcace0d7a9a4029b5b3df9788aed70a579f5f8215362fdffffff0560ea00000000000017a9142e12c4f03d19dbda53fedc5521db7d177dac14d08721f30000000000001976a914554965aa597a93de0ea124b04d815d5486cdf81688ac21f30000000000001976a914a2d7ad3b122ce538e3c6667861d759b962322e0b88ac21f30000000000001976a9141a5bb0f7b52c20e81cb23b4b398bfd1ffe5370f388acac820900000000001976a914a1748be68ef48742bb38bc46957f9c512c3f15e088ac00000000000000000000000000000000000000';

const TATUM_API_KEY = 't-691ab5fae2b53035df472a13-2ea27385c5964a15b092bdab';

async function testBroadcast() {
  console.log('Testing Zerdinals transaction broadcast...\n');

  const response = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': TATUM_API_KEY
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'sendrawtransaction',
      params: [ZERDINALS_COMMIT_TX],
      id: 1
    })
  });

  const result = await response.json();
  console.log('Result:', JSON.stringify(result, null, 2));
}

testBroadcast();
