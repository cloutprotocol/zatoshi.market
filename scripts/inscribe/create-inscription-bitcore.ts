/**
 * Create Zcash inscription using bitcore-lib-zcash
 * This bypasses ZIP 243 implementation issues by using the proven library
 */

import * as bitcore from 'bitcore-lib-zcash';
import * as lodash from 'lodash';
import { buildInscriptionData, buildRevealScript, buildP2SHScript } from './ordinals-builder';

// Monkey-patch lodash for bitcore compatibility
(globalThis as any)._ = {
  ...lodash,
  sumBy: (arr: any[], iteratee: any) => {
    return arr.reduce((sum, item) => {
      const value = typeof iteratee === 'function' ? iteratee(item) : item[iteratee];
      return sum + (value || 0);
    }, 0);
  }
};

const WALLET = {
  address: 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

const TATUM_API_KEY = 't-691ab5fae2b53035df472a13-2ea27385c5964a15b092bdab';

interface UTXO {
  txid: string;
  vout: number;
  value: number;
  scriptPubKey?: string;
}

async function getUTXOs(address: string): Promise<UTXO[]> {
  const response = await fetch(`https://utxos.zerdinals.com/api/utxos/${address}`);
  return response.json();
}

async function getConsensusBranchId(): Promise<number> {
  const response = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': TATUM_API_KEY
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'getblockchaininfo',
      id: 1
    })
  });

  const result = await response.json();
  return parseInt(result.result.consensus.nextblock, 16);
}

async function broadcastTransaction(txHex: string): Promise<string> {
  // Try Zerdinals first
  try {
    const response = await fetch('https://utxos.zerdinals.com/api/send-transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawTransaction: txHex })
    });

    const result = await response.json();
    if (response.ok && (result.result || result.txid)) {
      return result.result || result.txid;
    }
  } catch (e) {}

  // Try Tatum
  const response = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': TATUM_API_KEY
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'sendrawtransaction',
      params: [txHex],
      id: 1
    })
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(JSON.stringify(result.error));
  }

  return result.result;
}

async function createInscription() {
  console.log('\n🚀 Creating "Hello World" Inscription with bitcore-lib-zcash\n');
  console.log('═══════════════════════════════════════\n');

  // 1. Setup
  const privateKey = bitcore.PrivateKey.fromWIF(WALLET.privateKeyWIF);
  const publicKey = privateKey.toPublicKey();
  const address = privateKey.toAddress();

  console.log('🔑 Wallet loaded');
  console.log(`   Address: ${address.toString()}`);
  console.log(`   Public key: ${publicKey.toString()}\n`);

  // 2. Build reveal script
  const revealScript = buildRevealScript(Buffer.from(publicKey.toBuffer()));
  const p2shScript = buildP2SHScript(revealScript);

  console.log('📜 Reveal script created');
  console.log(`   Length: ${revealScript.length} bytes`);
  console.log(`   P2SH script: ${p2shScript.toString('hex')}\n`);

  // 3. Build inscription data
  const inscriptionData = buildInscriptionData('hello world', 'text/plain');
  console.log('📝 Inscription data created');
  console.log(`   Content: "hello world"`);
  console.log(`   Type: text/plain\n`);

  // 4. Get UTXOs
  console.log('💰 Fetching UTXOs...\n');
  const utxos = await getUTXOs(WALLET.address);
  console.log(`   Found ${utxos.length} UTXO(s)\n`);

  if (utxos.length === 0) {
    throw new Error('No UTXOs available');
  }

  // 5. Build commit transaction
  console.log('═══════════════════════════════════════');
  console.log('📌 STEP 1: COMMIT TRANSACTION');
  console.log('═══════════════════════════════════════\n');

  const consensusBranchId = await getConsensusBranchId();
  console.log(`Consensus Branch ID: 0x${consensusBranchId.toString(16)}\n`);

  // Use bitcore to build commit transaction
  const commitTx = new bitcore.Transaction()
    .from({
      txId: utxos[0].txid,
      outputIndex: utxos[0].vout,
      address: WALLET.address,
      script: bitcore.Script.buildPublicKeyHashOut(address).toString(),
      satoshis: utxos[0].value
    })
    .to(
      bitcore.Script.fromBuffer(p2shScript).toScriptHashOut().toAddress(),
      60000  // Amount to lock in P2SH
    )
    .change(address)
    .fee(10000)
    .sign(privateKey);

  const commitTxHex = commitTx.uncheckedSerialize();

  console.log(`Transaction built`);
  console.log(`   Size: ${commitTxHex.length / 2} bytes`);
  console.log(`   Hex (first 100): ${commitTxHex.substring(0, 100)}...\n`);

  console.log('📡 Broadcasting commit transaction...\n');

  try {
    const commitTxid = await broadcastTransaction(commitTxHex);
    console.log(`✅ Commit transaction broadcasted!`);
    console.log(`   TXID: ${commitTxid}\n`);

    // 6. Wait for propagation
    console.log('⏳ Waiting 10 seconds for network propagation...\n');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // 7. Build reveal transaction
    console.log('═══════════════════════════════════════');
    console.log('📌 STEP 2: REVEAL TRANSACTION');
    console.log('═══════════════════════════════════════\n');

    // For reveal, we need to manually build the scriptSig with inscription data
    // This is complex with bitcore, so we'll handle it separately
    console.log('⚠️  Reveal transaction requires custom scriptSig handling');
    console.log('   This needs to be implemented with manual transaction building\n');

    console.log('✅ Commit transaction completed successfully!');
    console.log(`   Next step: Build reveal transaction spending ${commitTxid}:0\n`);

  } catch (error: any) {
    console.error(`❌ Commit transaction failed: ${error.message}\n`);
    throw error;
  }
}

// Run
createInscription()
  .then(() => {
    console.log('✅ Process complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  });
