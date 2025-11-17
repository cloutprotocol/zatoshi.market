/**
 * Inscription POC using Tatum Raw RPC Calls
 *
 * This creates a Zcash inscription by embedding data in OP_RETURN
 */

import { TatumSDK, Network, ZCash } from '@tatumio/tatum';
import * as bitcoin from 'bitcoinjs-lib';
import * as bitcore from 'bitcore-lib-zcash';

interface UTXO {
  txid: string;
  vout: number;
  value: number; // in zatoshis
  scriptPubKey: string;
}

/**
 * Fetch UTXOs for an address using Tatum RPC
 */
async function fetchUTXOs(tatum: any, address: string): Promise<UTXO[]> {
  try {
    // Use listunspent RPC call
    const result = await tatum.rpc.rawRpcCall({
      method: 'listunspent',
      params: [1, 9999999, [address]]
    });

    console.log('   Raw UTXO result:', JSON.stringify(result, null, 2));

    // Handle both direct result and wrapped result
    const utxos = result.result || result;

    if (!Array.isArray(utxos)) {
      console.log('   No UTXOs found or invalid response');
      return [];
    }

    return utxos.map((utxo: any) => ({
      txid: utxo.txid,
      vout: utxo.vout,
      value: Math.floor(utxo.amount * 100000000), // Convert ZEC to zatoshis
      scriptPubKey: utxo.scriptPubKey
    }));
  } catch (error: any) {
    console.error('   Error fetching UTXOs:', error.message);
    // Fallback: try using a different method
    return [];
  }
}

/**
 * Create inscription data
 */
function createInscriptionData(content: string, protocol: string = 'zerd'): Buffer {
  // Simple format: protocol|content
  const inscriptionText = `${protocol}|${content}`;
  return Buffer.from(inscriptionText, 'utf8');
}

/**
 * Build raw transaction with OP_RETURN
 */
function buildRawTransaction(
  utxos: UTXO[],
  inscriptionData: Buffer,
  changeAddress: string,
  fee: number = 1000 // default fee in zatoshis
): string {
  const tx = new bitcore.Transaction();

  // Calculate total input
  let totalInput = 0;
  utxos.forEach((utxo) => {
    totalInput += utxo.value;
    tx.from({
      txId: utxo.txid,
      outputIndex: utxo.vout,
      satoshis: utxo.value,
      script: utxo.scriptPubKey
    });
  });

  console.log(`   Total input: ${totalInput} zatoshis`);
  console.log(`   Fee: ${fee} zatoshis`);

  // Add OP_RETURN output with inscription
  const opReturnScript = bitcore.Script.buildDataOut(inscriptionData);
  tx.addOutput(new bitcore.Transaction.Output({
    script: opReturnScript,
    satoshis: 0
  }));

  console.log(`   OP_RETURN size: ${inscriptionData.length} bytes`);

  // Add change output
  const changeAmount = totalInput - fee;
  console.log(`   Change: ${changeAmount} zatoshis`);

  if (changeAmount < 0) {
    throw new Error(`Insufficient funds. Need ${fee} zatoshis for fee, have ${totalInput}`);
  }

  if (changeAmount > 546) { // dust threshold
    tx.to(changeAddress, changeAmount);
  }

  // Return unsigned transaction
  return tx.uncheckedSerialize();
}

/**
 * Create and broadcast inscription
 */
async function createInscription(
  fromAddress: string,
  privateKeyWIF: string | null,
  content: string,
  protocol: string = 'zerd'
) {
  console.log('🚀 Inscription POC v2\n');

  const apiKey = process.env.TATUM_API_KEY;
  if (!apiKey) {
    throw new Error('TATUM_API_KEY not set');
  }

  const tatum = await TatumSDK.init<ZCash>({
    network: Network.ZCASH,
    apiKey: apiKey,
  });

  try {
    // Step 1: Fetch UTXOs
    console.log(`📦 Fetching UTXOs for ${fromAddress}...`);
    const utxos = await fetchUTXOs(tatum, fromAddress);

    if (utxos.length === 0) {
      console.log('❌ No UTXOs found. Make sure the address has funds.');
      return;
    }

    console.log(`✅ Found ${utxos.length} UTXO(s)`);
    console.log(`   Total available: ${utxos.reduce((sum, u) => sum + u.value, 0)} zatoshis\n`);

    // Step 2: Create inscription data
    console.log('📝 Creating inscription...');
    const inscriptionData = createInscriptionData(content, protocol);
    console.log(`   Protocol: ${protocol}`);
    console.log(`   Content: ${content}`);
    console.log(`   Data: ${inscriptionData.toString('hex')}\n`);

    // Step 3: Build transaction
    console.log('🔨 Building transaction...');
    const unsignedTx = buildRawTransaction(
      utxos,
      inscriptionData,
      fromAddress,
      1000 // fee
    );

    console.log(`\n📄 Unsigned transaction:`);
    console.log(`   ${unsignedTx}\n`);

    // Step 4: Sign transaction
    if (!privateKeyWIF) {
      console.log('⚠️  No private key provided.');
      console.log('   To broadcast, you need to:');
      console.log('   1. Sign this transaction with your private key');
      console.log('   2. Call: tatum.rpc.rawRpcCall({ method: "sendrawtransaction", params: [signedTx] })');
      return unsignedTx;
    }

    console.log('✍️  Signing transaction...');
    const privateKey = bitcore.PrivateKey.fromWIF(privateKeyWIF);
    const tx = new bitcore.Transaction(unsignedTx);
    tx.sign(privateKey);
    const signedTx = tx.serialize();

    console.log(`   Signed: ${signedTx}\n`);

    // Step 5: Broadcast
    console.log('📡 Broadcasting transaction...');
    const broadcastResult = await tatum.rpc.rawRpcCall({
      method: 'sendrawtransaction',
      params: [signedTx]
    });

    const txid = broadcastResult.result || broadcastResult;
    console.log(`\n✅ Success! Transaction ID: ${txid}`);
    console.log(`   View on explorer: https://zcashblockexplorer.com/transactions/${txid}`);

    return txid;

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('   Response:', error.response);
    }
    throw error;
  } finally {
    await tatum.destroy();
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: npx tsx inscribe-v2.ts <address> <content> [privateKeyWIF]');
    console.log('\nExample:');
    console.log('  npx tsx inscribe-v2.ts t1ABC... "Hello Zcash!"');
    console.log('  npx tsx inscribe-v2.ts t1ABC... "Hello Zcash!" L5oLk...');
    process.exit(1);
  }

  const [address, content, privateKeyWIF] = args;

  createInscription(address, privateKeyWIF || null, content)
    .then(() => {
      console.log('\n✅ Complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Failed:', error.message);
      process.exit(1);
    });
}

export { createInscription, createInscriptionData, fetchUTXOs };
