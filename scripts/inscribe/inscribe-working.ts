/**
 * Working Inscription Tool
 * Uses ZcashBlockExplorer.com free API for UTXOs
 * Broadcasts via Tatum
 */

import { TatumSDK, Network, ZCash } from '@tatumio/tatum';
import * as bitcore from 'bitcore-lib-zcash';

interface UTXO {
  txid: string;
  vout: number;
  value: number; // zatoshis
  scriptPubKey: string;
}

/**
 * Fetch UTXOs from ZcashBlockExplorer API
 */
async function fetchUTXOs(address: string): Promise<UTXO[]> {
  // Try multiple free APIs
  const apis = [
    `https://api.zcha.in/v2/mainnet/accounts/${address}`,
    `https://zcashblockexplorer.com/api/addr/${address}/utxo`,
  ];

  for (const apiUrl of apis) {
    try {
      console.log(`   Trying: ${apiUrl}`);
      const response = await fetch(apiUrl);

      if (!response.ok) {
        console.log(`   Failed: ${response.statusText}`);
        continue;
      }

      const data = await response.json();

      // Handle different API response formats
      let utxos: any[] = [];

      // Format 1: Direct array
      if (Array.isArray(data)) {
        utxos = data;
      }
      // Format 2: Wrapped in data property
      else if (data.data && Array.isArray(data.data)) {
        utxos = data.data;
      }
      // Format 3: Wrapped in utxos property
      else if (data.utxos && Array.isArray(data.utxos)) {
        utxos = data.utxos;
      }

      if (utxos.length > 0) {
        console.log(`   ✅ Found ${utxos.length} UTXO(s)`);
        return utxos.map((u: any) => ({
          txid: u.txid || u.tx_hash || u.transaction_hash,
          vout: u.vout || u.index || u.output_index,
          value: u.satoshis || u.amount || u.value,
          scriptPubKey: u.scriptPubKey || u.script || ''
        }));
      }
    } catch (error: any) {
      console.log(`   Error: ${error.message}`);
      continue;
    }
  }

  throw new Error('Could not fetch UTXOs from any API');
}

/**
 * Create inscription data
 */
function createInscriptionData(content: string, protocol: string = 'zerd'): Buffer {
  const inscriptionText = `${protocol}|${content}`;
  return Buffer.from(inscriptionText, 'utf8');
}

/**
 * Build transaction
 */
function buildTransaction(
  utxos: UTXO[],
  inscriptionData: Buffer,
  changeAddress: string,
  fee: number = 10000 // 0.0001 ZEC
): { rawTx: string; totalInput: number } {
  const tx = new bitcore.Transaction();

  // Add inputs
  let totalInput = 0;
  for (const utxo of utxos) {
    totalInput += utxo.value;
    tx.from({
      txId: utxo.txid,
      outputIndex: utxo.vout,
      satoshis: utxo.value,
      script: bitcore.Script.buildPublicKeyHashOut(
        bitcore.Address.fromString(changeAddress)
      )
    });

    // Use enough UTXOs to cover fee
    if (totalInput >= fee + 1000) break;
  }

  // Add OP_RETURN output
  const script = bitcore.Script.buildDataOut(inscriptionData);
  tx.addOutput(new bitcore.Transaction.Output({
    script: script,
    satoshis: 0
  }));

  // Add change
  const changeAmount = totalInput - fee;
  if (changeAmount < 0) {
    throw new Error(`Need ${fee} zatoshis, have ${totalInput}`);
  }

  if (changeAmount > 546) {
    tx.to(changeAddress, changeAmount);
  }

  return { rawTx: tx.uncheckedSerialize(), totalInput };
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
    // Use sendRawTransaction method
    const txid = await tatum.rpc.sendRawTransaction(signedTx);
    return txid;
  } finally {
    await tatum.destroy();
  }
}

/**
 * Main function
 */
async function inscribe(
  address: string,
  content: string,
  privateKey?: string,
  protocol: string = 'zerd'
) {
  console.log('═══════════════════════════════════════');
  console.log('    Zcash Inscription Tool v1.0');
  console.log('═══════════════════════════════════════\n');

  try {
    // 1. Fetch UTXOs
    console.log('1️⃣  Fetching UTXOs...');
    console.log(`    Address: ${address}`);
    const utxos = await fetchUTXOs(address);

    const total = utxos.reduce((sum, u) => sum + u.value, 0);
    console.log(`    Total: ${total} zatoshis (${(total / 100000000).toFixed(8)} ZEC)\n`);

    // 2. Create inscription
    console.log('2️⃣  Creating inscription...');
    const inscriptionData = createInscriptionData(content, protocol);
    console.log(`    Protocol: ${protocol}`);
    console.log(`    Content: ${content}`);
    console.log(`    Size: ${inscriptionData.length} bytes`);
    console.log(`    Data: ${inscriptionData.toString('hex')}\n`);

    // 3. Build transaction
    console.log('3️⃣  Building transaction...');
    const fee = 10000;
    const { rawTx, totalInput } = buildTransaction(utxos, inscriptionData, address, fee);
    console.log(`    Inputs: ${totalInput} zatoshis`);
    console.log(`    Fee: ${fee} zatoshis (${(fee / 100000000).toFixed(8)} ZEC)`);
    console.log(`    Change: ${totalInput - fee} zatoshis\n`);

    // 4. Sign
    if (!privateKey) {
      console.log('⚠️  PREVIEW MODE (no private key)');
      console.log(`    Raw TX: ${rawTx}\n`);
      console.log('To broadcast, run:');
      console.log(`./run-with-env.sh inscribe-working.ts "${address}" "${content}" YOUR_PRIVATE_KEY\n`);
      return { rawTx, mode: 'preview' };
    }

    console.log('4️⃣  Signing transaction...');
    const signedTx = signTransaction(rawTx, privateKey);
    console.log(`    ✅ Signed (${signedTx.length} bytes)\n`);

    // 5. Broadcast
    console.log('5️⃣  Broadcasting...');
    const txid = await broadcastTransaction(signedTx);

    console.log('\n═══════════════════════════════════════');
    console.log('         ✅ SUCCESS!');
    console.log('═══════════════════════════════════════');
    console.log(`TXID: ${txid}`);
    console.log(`\nView on:`);
    console.log(`  • https://zcashblockexplorer.com/transactions/${txid}`);
    console.log(`  • https://zerdinals.com/inscription/${txid}`);
    console.log('═══════════════════════════════════════\n');

    return { txid, mode: 'broadcast' };

  } catch (error: any) {
    console.error('\n❌ ERROR:', error.message);
    throw error;
  }
}

// CLI
if (require.main === module) {
  const [address, content, privateKey, protocol] = process.argv.slice(2);

  if (!address || !content) {
    console.log('Zcash Inscription Tool\n');
    console.log('Usage:');
    console.log('  npx tsx inscribe-working.ts <address> <content> [privateKey] [protocol]\n');
    console.log('Examples:');
    console.log('  # Preview (no broadcast)');
    console.log('  ./run-with-env.sh inscribe-working.ts t1ABC... "Hello Zcash!"\n');
    console.log('  # Create inscription');
    console.log('  ./run-with-env.sh inscribe-working.ts t1ABC... "Hello!" L5oLk...\n');
    console.log('  # Custom protocol');
    console.log('  ./run-with-env.sh inscribe-working.ts t1ABC... "data" KEY zrc20\n');
    process.exit(1);
  }

  inscribe(address, content, privateKey, protocol || 'zerd')
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { inscribe, createInscriptionData, fetchUTXOs };
