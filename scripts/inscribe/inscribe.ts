/**
 * Complete Inscription Tool - Uses Internal API
 *
 * This version uses your existing /api/zcash/utxos endpoint
 * and Tatum for broadcasting
 */

import { TatumSDK, Network, ZCash } from '@tatumio/tatum';
import * as bitcore from 'bitcore-lib-zcash';

interface UTXO {
  txid: string;
  vout: number;
  address: string;
  scriptPubKey: string;
  amount: number; // in ZEC
  satoshis: number; // in zatoshis
  height: number;
  confirmations: number;
}

/**
 * Fetch UTXOs using your internal API
 */
async function fetchUTXOs(address: string, apiUrl: string = 'http://localhost:3000'): Promise<UTXO[]> {
  const url = `${apiUrl}/api/zcash/utxos/${address}`;
  console.log(`   Fetching from: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.utxos || [];
}

/**
 * Create inscription data (OP_RETURN format)
 */
function createInscriptionData(content: string, protocol: string = 'zerd'): Buffer {
  return Buffer.from(`${protocol}|${content}`, 'utf8');
}

/**
 * Build Zcash transaction with inscription
 */
function buildTransaction(
  utxos: UTXO[],
  inscriptionData: Buffer,
  changeAddress: string,
  fee: number = 10000 // 0.0001 ZEC
): { rawTx: string; totalInput: number; changeAmount: number } {
  const tx = new bitcore.Transaction();

  // Add inputs until we have enough for fee
  let totalInput = 0;
  const usedUtxos: UTXO[] = [];

  for (const utxo of utxos) {
    const satoshis = Math.floor(utxo.amount * 100000000);
    totalInput += satoshis;
    usedUtxos.push(utxo);

    tx.from({
      txId: utxo.txid,
      outputIndex: utxo.vout,
      satoshis: satoshis,
      script: bitcore.Script.buildPublicKeyHashOut(
        bitcore.Address.fromString(changeAddress)
      )
    });

    if (totalInput >= fee + 1000) break; // enough for fee + dust
  }

  if (totalInput < fee) {
    throw new Error(`Insufficient funds. Need ${fee} zatoshis, have ${totalInput}`);
  }

  // Add OP_RETURN output with inscription
  const script = bitcore.Script.buildDataOut(inscriptionData);
  tx.addOutput(new bitcore.Transaction.Output({
    script: script,
    satoshis: 0
  }));

  // Add change output
  const changeAmount = totalInput - fee;
  if (changeAmount > 546) { // dust threshold
    tx.to(changeAddress, changeAmount);
  }

  return {
    rawTx: tx.uncheckedSerialize(),
    totalInput,
    changeAmount
  };
}

/**
 * Sign transaction with private key
 */
function signTransaction(rawTx: string, privateKeyWIF: string): string {
  const privateKey = bitcore.PrivateKey.fromWIF(privateKeyWIF);
  const tx = new bitcore.Transaction(rawTx);
  tx.sign(privateKey);
  return tx.serialize();
}

/**
 * Broadcast transaction via Tatum
 */
async function broadcast(signedTx: string): Promise<string> {
  const apiKey = process.env.TATUM_API_KEY;
  if (!apiKey) {
    throw new Error('TATUM_API_KEY not set');
  }

  const tatum = await TatumSDK.init<ZCash>({
    network: Network.ZCASH,
    apiKey: apiKey,
  });

  try {
    const txid = await tatum.rpc.sendRawTransaction(signedTx);
    return txid;
  } finally {
    await tatum.destroy();
  }
}

/**
 * Main inscription function
 */
async function inscribe(
  address: string,
  content: string,
  privateKey?: string,
  protocol: string = 'zerd',
  apiUrl?: string
) {
  console.log('\n┌─────────────────────────────────────┐');
  console.log('│   Zcash Inscription Tool v1.0      │');
  console.log('└─────────────────────────────────────┘\n');

  try {
    // 1. Fetch UTXOs
    console.log('📦 Step 1: Fetching UTXOs');
    console.log(`   Address: ${address}`);
    const utxos = await fetchUTXOs(address, apiUrl);

    if (!utxos || utxos.length === 0) {
      throw new Error('No UTXOs found. Address needs funds.');
    }

    const total = utxos.reduce((sum, u) => sum + Math.floor(u.amount * 100000000), 0);
    console.log(`   ✅ Found ${utxos.length} UTXO(s)`);
    console.log(`   Total: ${(total / 100000000).toFixed(8)} ZEC (${total.toLocaleString()} zatoshis)\n`);

    // 2. Create inscription
    console.log('📝 Step 2: Creating inscription');
    const inscriptionData = createInscriptionData(content, protocol);
    console.log(`   Protocol: ${protocol}`);
    console.log(`   Content: "${content}"`);
    console.log(`   Size: ${inscriptionData.length} bytes`);
    console.log(`   Hex: ${inscriptionData.toString('hex')}\n`);

    // 3. Build transaction
    console.log('🔨 Step 3: Building transaction');
    const fee = 10000;
    const { rawTx, totalInput, changeAmount } = buildTransaction(
      utxos,
      inscriptionData,
      address,
      fee
    );

    console.log(`   Input: ${(totalInput / 100000000).toFixed(8)} ZEC`);
    console.log(`   Fee: ${(fee / 100000000).toFixed(8)} ZEC`);
    console.log(`   Change: ${(changeAmount / 100000000).toFixed(8)} ZEC\n`);

    // 4. Sign
    if (!privateKey) {
      console.log('⚠️  PREVIEW MODE (no private key provided)\n');
      console.log('   Unsigned transaction (hex):');
      console.log(`   ${rawTx}\n`);
      console.log('   To create inscription, run:');
      console.log(`   ./run-with-env.sh inscribe.ts "${address}" "${content}" YOUR_PRIVATE_KEY\n`);
      return { status: 'preview', rawTx };
    }

    console.log('✍️  Step 4: Signing transaction');
    const signedTx = signTransaction(rawTx, privateKey);
    console.log(`   ✅ Signed (${signedTx.length / 2} bytes)\n`);

    // 5. Broadcast
    console.log('📡 Step 5: Broadcasting transaction');
    const txid = await broadcast(signedTx);

    console.log('\n┌─────────────────────────────────────┐');
    console.log('│          ✅ SUCCESS!                │');
    console.log('└─────────────────────────────────────┘');
    console.log(`\nTransaction ID:\n${txid}`);
    console.log('\nView inscription:');
    console.log(`• https://zcashblockexplorer.com/transactions/${txid}`);
    console.log(`• https://zerdinals.com/inscription/${txid}\n`);

    return { status: 'success', txid };

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    throw error;
  }
}

// CLI
if (require.main === module) {
  const [address, content, privateKey, protocol, apiUrl] = process.argv.slice(2);

  if (!address || !content) {
    console.log('\nZcash Inscription Tool');
    console.log('Usage:');
    console.log('  ./run-with-env.sh inscribe.ts <address> <content> [privateKey] [protocol] [apiUrl]\n');
    console.log('Examples:');
    console.log('  # Preview (requires dev server running)');
    console.log('  ./run-with-env.sh inscribe.ts t1ABC... "Hello Zcash!"\n');
    console.log('  # Create inscription');
    console.log('  ./run-with-env.sh inscribe.ts t1ABC... "Hello!" L5oLk...\n');
    console.log('  # Custom protocol');
    console.log('  ./run-with-env.sh inscribe.ts t1ABC... "data" KEY zrc20\n');
    console.log('  # Custom API URL');
    console.log('  ./run-with-env.sh inscribe.ts t1ABC... "data" KEY zerd http://localhost:3000\n');
    process.exit(1);
  }

  inscribe(address, content, privateKey, protocol || 'zerd', apiUrl)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { inscribe, createInscriptionData, fetchUTXOs, buildTransaction, signTransaction, broadcast };
