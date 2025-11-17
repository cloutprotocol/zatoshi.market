/**
 * Complete Inscription Solution
 * - Fetch UTXOs from Blockchair API
 * - Build inscription transaction with OP_RETURN
 * - Broadcast via Tatum
 */

import { TatumSDK, Network, ZCash } from '@tatumio/tatum';
import * as bitcore from 'bitcore-lib-zcash';

interface UTXO {
  transaction_hash: string;
  index: number;
  value: number; // in zatoshis
}

/**
 * Fetch UTXOs from Blockchair API
 */
async function fetchUTXOsFromBlockchair(address: string): Promise<UTXO[]> {
  const apiKey = process.env.BLOCKCHAIR_API_KEY || '';
  const apiUrl = `https://api.blockchair.com/zcash/dashboards/address/${address}${
    apiKey ? `?key=${apiKey}` : ''
  }`;

  console.log(`   API: ${apiUrl.replace(apiKey, 'xxx')}`);

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Blockchair API error: ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.data || !data.data[address]) {
    throw new Error('Invalid response from Blockchair');
  }

  const utxos = data.data[address].utxo || [];

  return utxos.map((utxo: any) => ({
    transaction_hash: utxo.transaction_hash,
    index: utxo.index,
    value: utxo.value,
  }));
}

/**
 * Create inscription data
 */
function createInscriptionData(content: string, protocol: string = 'zerd'): Buffer {
  const inscriptionText = `${protocol}|${content}`;
  return Buffer.from(inscriptionText, 'utf8');
}

/**
 * Build transaction with inscription
 */
function buildInscriptionTransaction(
  utxos: UTXO[],
  inscriptionData: Buffer,
  changeAddress: string,
  fee: number = 1000
): { rawTx: string; totalInput: number } {
  const tx = new bitcore.Transaction();

  // Add inputs
  let totalInput = 0;
  utxos.forEach((utxo) => {
    totalInput += utxo.value;
    tx.from({
      txId: utxo.transaction_hash,
      outputIndex: utxo.index,
      satoshis: utxo.value,
      script: bitcore.Script.buildPublicKeyHashOut(bitcore.Address.fromString(changeAddress))
    });
  });

  // Add OP_RETURN output with inscription
  const script = bitcore.Script.buildDataOut(inscriptionData);
  tx.addOutput(new bitcore.Transaction.Output({
    script: script,
    satoshis: 0
  }));

  // Add change output
  const changeAmount = totalInput - fee;

  if (changeAmount < 0) {
    throw new Error(`Insufficient funds. Need ${fee}, have ${totalInput} zatoshis`);
  }

  if (changeAmount > 546) {
    tx.to(changeAddress, changeAmount);
  }

  return {
    rawTx: tx.uncheckedSerialize(),
    totalInput
  };
}

/**
 * Sign transaction
 */
function signTransaction(rawTx: string, privateKeyWIF: string): string {
  const privateKey = bitcore.PrivateKey.fromWIF(privateKeyWIF);
  const tx = new bitcore.Transaction(rawTx);
  tx.sign(privateKey);
  return tx.serialize();
}

/**
 * Broadcast via Tatum
 */
async function broadcastTransaction(signedTx: string): Promise<string> {
  const apiKey = process.env.TATUM_API_KEY;
  if (!apiKey) {
    throw new Error('TATUM_API_KEY not set');
  }

  const tatum = await TatumSDK.init<ZCash>({
    network: Network.ZCASH,
    apiKey: apiKey,
  });

  try {
    const result = await tatum.rpc.rawRpcCall({
      method: 'sendrawtransaction',
      params: [signedTx]
    });

    const txid = result.result || result;
    return txid;
  } finally {
    await tatum.destroy();
  }
}

/**
 * Main inscription function
 */
async function createInscription(
  fromAddress: string,
  content: string,
  privateKeyWIF?: string,
  protocol: string = 'zerd'
) {
  console.log('🚀 Zcash Inscription Tool\n');

  // Step 1: Fetch UTXOs
  console.log(`📦 Fetching UTXOs for ${fromAddress}...`);
  const utxos = await fetchUTXOsFromBlockchair(fromAddress);

  if (utxos.length === 0) {
    throw new Error('No UTXOs found. Address needs funds.');
  }

  const totalAvailable = utxos.reduce((sum, u) => sum + u.value, 0);
  console.log(`✅ Found ${utxos.length} UTXO(s)`);
  console.log(`   Total: ${totalAvailable} zatoshis (${(totalAvailable / 100000000).toFixed(8)} ZEC)\n`);

  // Step 2: Create inscription
  console.log('📝 Creating inscription...');
  const inscriptionData = createInscriptionData(content, protocol);
  console.log(`   Protocol: ${protocol}`);
  console.log(`   Content: ${content}`);
  console.log(`   Size: ${inscriptionData.length} bytes`);
  console.log(`   Hex: ${inscriptionData.toString('hex')}\n`);

  // Step 3: Build transaction
  console.log('🔨 Building transaction...');
  const fee = 1000; // 0.00001 ZEC
  const { rawTx, totalInput } = buildInscriptionTransaction(
    utxos,
    inscriptionData,
    fromAddress,
    fee
  );

  console.log(`   Input: ${totalInput} zatoshis`);
  console.log(`   Fee: ${fee} zatoshis`);
  console.log(`   Change: ${totalInput - fee} zatoshis\n`);

  console.log(`📄 Unsigned TX: ${rawTx.substring(0, 80)}...\n`);

  // Step 4: Sign (if private key provided)
  if (!privateKeyWIF) {
    console.log('⚠️  No private key provided');
    console.log('   To broadcast, run with:');
    console.log(`   ./run-with-env.sh inscribe-final.ts "${fromAddress}" "${content}" YOUR_PRIVATE_KEY\n`);
    return { rawTx, unsigned: true };
  }

  console.log('✍️  Signing transaction...');
  const signedTx = signTransaction(rawTx, privateKeyWIF);
  console.log(`   Signed TX: ${signedTx.substring(0, 80)}...\n`);

  // Step 5: Broadcast
  console.log('📡 Broadcasting via Tatum...');
  const txid = await broadcastTransaction(signedTx);

  console.log(`\n✅ SUCCESS! Inscription created!`);
  console.log(`   TXID: ${txid}`);
  console.log(`   Explorer: https://zcashblockexplorer.com/transactions/${txid}`);
  console.log(`   Zerdinals: https://zerdinals.com/inscription/${txid}\n`);

  return { txid, signed: true };
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage:');
    console.log('  npx tsx inscribe-final.ts <address> <content> [privateKey] [protocol]\n');
    console.log('Examples:');
    console.log('  # Preview (no broadcast)');
    console.log('  npx tsx inscribe-final.ts t1ABC... "Hello Zcash!"\n');
    console.log('  # Create inscription');
    console.log('  npx tsx inscribe-final.ts t1ABC... "Hello Zcash!" L5oLk...\n');
    console.log('  # Custom protocol');
    console.log('  npx tsx inscribe-final.ts t1ABC... "data" L5oLk... zrc20\n');
    process.exit(1);
  }

  const [address, content, privateKey, protocol] = args;

  createInscription(address, content, privateKey, protocol || 'zerd')
    .then((result) => {
      if (!result.signed) {
        console.log('✅ Preview complete (no broadcast)');
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error:', error.message);
      if (error.stack) {
        console.error(error.stack);
      }
      process.exit(1);
    });
}

export { createInscription, createInscriptionData, fetchUTXOsFromBlockchair };
