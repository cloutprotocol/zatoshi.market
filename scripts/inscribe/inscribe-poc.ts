/**
 * Inscription Proof of Concept using Tatum SDK
 *
 * This script demonstrates how to create a Zcash inscription by:
 * 1. Fetching UTXOs from an address
 * 2. Building a transaction with OP_RETURN data (inscription)
 * 3. Signing the transaction
 * 4. Broadcasting via Tatum
 */

import { TatumSDK, Network, ZCash } from '@tatumio/tatum';
import * as bitcoin from 'bitcoinjs-lib';

// Configuration
const CONFIG = {
  TATUM_API_KEY: process.env.TATUM_API_KEY || '',
  // Test address (replace with your own)
  FROM_ADDRESS: 't1TvCHyAAYsnVfwRHjmgrbKV19YjmhW7zCj',
  // Private key in WIF format (replace with your own for testing)
  PRIVATE_KEY_WIF: '',
};

// Inscription protocol prefix for Zerdinals
const ZERDINALS_PREFIX = 'zerd';

/**
 * Create inscription data in OP_RETURN format
 */
function createInscriptionData(content: string, contentType: string = 'text/plain'): Buffer {
  // Format: zerd|content-type|content
  const inscriptionText = `${ZERDINALS_PREFIX}|${contentType}|${content}`;
  return Buffer.from(inscriptionText, 'utf8');
}

/**
 * Build a transaction with OP_RETURN inscription
 */
async function buildInscriptionTransaction(
  tatum: ZCash,
  fromAddress: string,
  utxos: any[],
  inscriptionData: Buffer,
  changeAddress: string
): Promise<string> {
  const txb = new bitcoin.TransactionBuilder();

  // Calculate total input amount
  let totalInput = 0;
  utxos.forEach((utxo) => {
    totalInput += utxo.value;
    txb.addInput(utxo.txid, utxo.vout);
  });

  // Fee estimation (in zatoshis)
  const estimatedSize = 250 + inscriptionData.length; // rough estimate
  const feeRate = 1; // zatoshis per byte
  const fee = estimatedSize * feeRate;

  // Add OP_RETURN output with inscription
  const opReturnScript = bitcoin.script.compile([
    bitcoin.opcodes.OP_RETURN,
    inscriptionData
  ]);
  txb.addOutput(opReturnScript, 0);

  // Add change output
  const changeAmount = totalInput - fee;
  if (changeAmount < 0) {
    throw new Error(`Insufficient funds. Need ${fee} zatoshis, have ${totalInput}`);
  }

  if (changeAmount > 546) { // dust threshold
    txb.addOutput(changeAddress, changeAmount);
  }

  return txb.buildIncomplete().toHex();
}

/**
 * Main inscription creation flow
 */
async function createInscription(content: string, contentType: string = 'text/plain') {
  console.log('🚀 Starting inscription POC...\n');

  if (!CONFIG.TATUM_API_KEY) {
    throw new Error('TATUM_API_KEY not set in environment');
  }

  // Initialize Tatum SDK
  console.log('📡 Initializing Tatum SDK...');
  const tatum = await TatumSDK.init<ZCash>({
    network: Network.ZCASH,
    apiKey: CONFIG.TATUM_API_KEY,
  });

  try {
    // Step 1: Fetch UTXOs
    console.log(`📦 Fetching UTXOs for ${CONFIG.FROM_ADDRESS}...`);
    // Note: You'll need to implement UTXO fetching via Tatum or another service
    // const utxos = await fetchUtxos(CONFIG.FROM_ADDRESS);

    // For POC, using mock UTXO
    const mockUtxos = [
      {
        txid: '0000000000000000000000000000000000000000000000000000000000000000',
        vout: 0,
        value: 10000, // 0.0001 ZEC in zatoshis
        scriptPubKey: ''
      }
    ];

    console.log(`✅ Found ${mockUtxos.length} UTXOs\n`);

    // Step 2: Create inscription data
    console.log('📝 Creating inscription data...');
    const inscriptionData = createInscriptionData(content, contentType);
    console.log(`   Content: ${content}`);
    console.log(`   Type: ${contentType}`);
    console.log(`   Size: ${inscriptionData.length} bytes\n`);

    // Step 3: Build transaction
    console.log('🔨 Building inscription transaction...');
    const unsignedTx = await buildInscriptionTransaction(
      tatum,
      CONFIG.FROM_ADDRESS,
      mockUtxos,
      inscriptionData,
      CONFIG.FROM_ADDRESS // use same address for change
    );
    console.log(`   Unsigned TX: ${unsignedTx.substring(0, 64)}...\n`);

    // Step 4: Sign transaction (requires private key)
    console.log('✍️  Signing transaction...');
    if (!CONFIG.PRIVATE_KEY_WIF) {
      console.log('⚠️  No private key configured - stopping here');
      console.log('   To complete: Set PRIVATE_KEY_WIF in config');
      console.log('   Then sign and broadcast using Tatum SDK:\n');
      console.log('   const txid = await tatum.rpc.sendRawTransaction(signedTx);');
      return;
    }

    // TODO: Implement signing
    // const signedTx = signTransaction(unsignedTx, CONFIG.PRIVATE_KEY_WIF);

    // Step 5: Broadcast via Tatum
    console.log('📡 Broadcasting transaction...');
    // const txid = await tatum.rpc.sendRawTransaction(signedTx);
    // console.log(`✅ Inscription created! TXID: ${txid}`);

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await tatum.destroy();
    console.log('\n✅ Tatum SDK destroyed');
  }
}

// Run if called directly
if (require.main === module) {
  const testContent = 'Hello Zcash Inscriptions!';
  const testContentType = 'text/plain';

  createInscription(testContent, testContentType)
    .then(() => {
      console.log('\n✅ POC Complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ POC Failed:', error);
      process.exit(1);
    });
}

export { createInscription, createInscriptionData };
