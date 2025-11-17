/**
 * Create Inscription using Zerdinals API
 * This uses their actual mint/send endpoint
 */

// Monkey-patch lodash for bitcore-lib-zcash compatibility
import * as lodash from 'lodash';
(globalThis as any)._ = lodash;

import * as bitcore from 'bitcore-lib-zcash';

const WALLET = {
  address: 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

async function createInscriptionViaZerdinals() {
  console.log('\n🚀 Creating Inscription via Zerdinals API\n');
  console.log('═══════════════════════════════════════\n');

  // Step 1: Get UTXOs
  console.log('📦 Step 1: Fetching UTXOs');
  const utxosResponse = await fetch(
    `https://utxos.zerdinals.com/api/utxos/${WALLET.address}`
  );

  const utxos = await utxosResponse.json();
  console.log(`   Found ${utxos.length} UTXO(s)\n`);

  if (utxos.length === 0) {
    throw new Error('No UTXOs available');
  }

  // Step 2: Build inscription transaction manually
  console.log('🔨 Step 2: Building Transaction\n');

  const content = 'hello world';
  const protocol = 'zerd';
  const inscriptionData = Buffer.from(`${protocol}|${content}`, 'utf8');

  console.log(`   Content: "${content}"`);
  console.log(`   Hex: ${inscriptionData.toString('hex')}\n`);

  try {
    // Build transaction using bitcore
    const privateKey = bitcore.PrivateKey.fromWIF(WALLET.privateKeyWIF);
    const tx = new bitcore.Transaction();

    // Add input with exact scriptPubKey from source transaction
    const scriptPubKeyHex = '76a914ad147aafdeaeba4dbb59874e7aec3c44110283be88ac';
    tx.from({
      txId: utxos[0].txid,
      outputIndex: utxos[0].vout,
      satoshis: utxos[0].value,
      script: bitcore.Script.fromHex(scriptPubKeyHex)
    });

    // Add OP_RETURN output with inscription
    const script = bitcore.Script.buildDataOut(inscriptionData);
    tx.addOutput(new bitcore.Transaction.Output({
      script: script,
      satoshis: 0
    }));

    // Add change output
    const fee = 10000;
    const changeAmount = utxos[0].value - fee;

    if (changeAmount > 546) {
      tx.to(WALLET.address, changeAmount);
    }

    console.log('   Signing transaction...\n');

    // Sign transaction
    tx.sign(privateKey);

    // Use uncheckedSerialize to bypass lodash bug
    const signedHex = tx.uncheckedSerialize();
    console.log(`   Signed TX (${signedHex.length / 2} bytes):`);
    console.log(`   Full hex: ${signedHex}\n`);

    // Step 3: Broadcast via Zerdinals
    console.log('📡 Step 3: Broadcasting via Zerdinals API\n');

    const broadcastResponse = await fetch(
      'https://utxos.zerdinals.com/api/send-transaction',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ rawTransaction: signedHex })
      }
    );

    const result = await broadcastResponse.json();

    if (!broadcastResponse.ok) {
      console.error('   ❌ Zerdinals broadcast failed:', result);

      // Try Tatum as fallback
      console.log('\n📡 Trying Tatum API...\n');
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

      const tatumResult = await tatumResponse.json();
      console.log('   Tatum result:', tatumResult);

      if (tatumResult.error) {
        throw new Error(`All broadcast attempts failed. Tatum: ${JSON.stringify(tatumResult.error)}`);
      }

      const txid = tatumResult.result;
      console.log('\n✅ Broadcast successful via Tatum!\n');
      console.log(`TXID: ${txid}\n`);
      return { result: txid };
    }

    console.log('\n═══════════════════════════════════════');
    console.log('         ✅ SUCCESS!');
    console.log('═══════════════════════════════════════\n');
    console.log(`TXID: ${result.result || result.txid || result}\n`);
    console.log('View inscription:');
    console.log(`• https://zcashblockexplorer.com/transactions/${result.result || result.txid}`);
    console.log(`• https://zerdinals.com/inscription/${result.result || result.txid}i0\n`);

    return result;

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    throw error;
  }
}

// Run
createInscriptionViaZerdinals()
  .then(() => {
    console.log('✅ Inscription created successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed to create inscription');
    process.exit(1);
  });
