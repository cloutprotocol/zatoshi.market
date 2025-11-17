async function getBlockchainInfo() {
  const response = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 't-691ab5fae2b53035df472a13-2ea27385c5964a15b092bdab'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'getblockchaininfo',
      params: [],
      id: 1
    })
  });

  const result = await response.json();
  console.log('\n🔗 Zcash Blockchain Info\n');
  console.log(JSON.stringify(result.result, null, 2));
}

getBlockchainInfo().then(() => process.exit(0)).catch(console.error);
