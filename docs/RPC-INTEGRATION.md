Perfect! ✅ Both servers updated with dev.zatoshi.market access.

  ---
  .env.local Configuration

  Add these variables to your .env.local file:

  # Zcash RPC Endpoint Configuration
  NEXT_PUBLIC_ZCASH_RPC_URL=https://rpc.zatoshi.market/api/rpc
  ZCASH_RPC_USERNAME=zatoshi
  ZCASH_RPC_PASSWORD=ZcashRPC2024!

  ---
  Usage Examples

  Option 1: From dev.zatoshi.market (No Auth Needed)

  // No credentials needed - origin-based authentication
  const response = await fetch('https://rpc.zatoshi.market/api/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      method: 'getblockchaininfo',
      params: []
    })
  });

  const data = await response.json();
  console.log(data.result);

  Option 2: From localhost (Requires Basic Auth)

  // Use Basic Auth for localhost development
  const username = process.env.ZCASH_RPC_USERNAME; // zatoshi
  const password = process.env.ZCASH_RPC_PASSWORD; // ZcashRPC2024!

  const response = await fetch(process.env.NEXT_PUBLIC_ZCASH_RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + btoa(`${username}:${password}`)
    },
    body: JSON.stringify({
      method: 'getblockchaininfo',
      params: []
    })
  });

  const data = await response.json();
  console.log(data.result);

  Helper Function (Recommended)

  // lib/zcashRpc.ts
  export async function callZcashRPC(method: string, params: any[] = []) {
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };

    // Add Basic Auth for localhost
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      const auth = btoa(
        `${process.env.ZCASH_RPC_USERNAME}:${process.env.ZCASH_RPC_PASSWORD}`
      );
      headers['Authorization'] = `Basic ${auth}`;
    }

    const response = await fetch(process.env.NEXT_PUBLIC_ZCASH_RPC_URL!, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        method,
        params,
        id: 'zatoshi-app'
      })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || 'RPC call failed');
    }

    return data.result;
  }

  // Usage:
  const blockInfo = await callZcashRPC('getblockchaininfo');
  const rawTx = await callZcashRPC('getrawtransaction', ['txid', 1]);
  const addressBalance = await callZcashRPC('getaddressbalance', [{ addresses: ['t1abc...'] }]);

  ---
  Available RPC Methods

  Blockchain:
  - getblockchaininfo, getblock, getblockhash, getblockheader, getbestblockhash, getchaintips,
  getdifficulty, gettxout, gettxoutsetinfo

  Transactions:
  - getrawtransaction, sendrawtransaction, decoderawtransaction, decodescript, gettransaction

  Address/UTXO (InsightExplorer):
  - getaddressbalance, getaddressdeltas, getaddresstxids, getaddressutxos, getaddressmempool

  Mempool:
  - getmempoolinfo, getrawmempool

  Network:
  - getpeerinfo, getnetworkinfo, getconnectioncount

  Utility:
  - validateaddress, z_validateaddress, estimatefee

  ---
  Allowed Origins (No Password Required)

  ✅ https://zatoshi.market✅ https://www.zatoshi.market✅ https://dev.zatoshi.market🔐
  http://localhost:3000 (requires Basic Auth)🔐 http://localhost:5173 (requires Basic Auth)

  Your dev.zatoshi.market deployment will work automatically without credentials! 🚀

● How is Claude doing this session? (optional)
  1: Bad    2: Fine   3: Good   0: Dismiss
