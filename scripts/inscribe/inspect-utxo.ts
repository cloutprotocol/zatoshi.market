/**
 * Inspect the source transaction to get actual scriptPubKey
 */

const UTXO_TXID = '48d9a62d2b368e5446409b5a346290fa7173d242dee744f36ec9575d05009ab1';
const UTXO_VOUT = 0;

async function inspectUTXO() {
  console.log('\n🔍 Inspecting Source Transaction\n');
  console.log('═══════════════════════════════════════\n');
  console.log(`Transaction: ${UTXO_TXID}`);
  console.log(`Output: ${UTXO_VOUT}\n`);

  // Get raw transaction via Tatum
  const response = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 't-691ab5fae2b53035df472a13-2ea27385c5964a15b092bdab'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'getrawtransaction',
      params: [UTXO_TXID, 1], // 1 = verbose
      id: 1
    })
  });

  const result = await response.json();

  if (result.error) {
    console.error('❌ Error:', result.error);
    return;
  }

  const tx = result.result;
  console.log('Transaction Details:\n');
  console.log(`  Version: ${tx.version}`);
  console.log(`  Confirmations: ${tx.confirmations}`);
  console.log(`  Outputs: ${tx.vout?.length || 0}\n`);

  if (tx.vout && tx.vout[UTXO_VOUT]) {
    const output = tx.vout[UTXO_VOUT];
    console.log(`Output ${UTXO_VOUT}:\n`);
    console.log(`  Value: ${output.value} ZEC (${output.valueZat} zatoshis)`);
    console.log(`  Script Type: ${output.scriptPubKey?.type}`);
    console.log(`  Script Hex: ${output.scriptPubKey?.hex}`);
    console.log(`  Script ASM: ${output.scriptPubKey?.asm}`);
    console.log(`  Addresses: ${output.scriptPubKey?.addresses?.join(', ')}\n`);

    // Verify it matches our expected address
    const expectedAddress = 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x';
    const matches = output.scriptPubKey?.addresses?.includes(expectedAddress);
    console.log(`  Matches expected address: ${matches ? '✅' : '❌'}`);
  }

  console.log('\n═══════════════════════════════════════\n');
}

inspectUTXO()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
