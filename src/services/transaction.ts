/**
 * Zcash Transaction Service
 *
 * Handles building, signing, and broadcasting Zcash transactions
 * for sending ZEC between addresses.
 *
 * Architecture:
 * - Uses bitcore-lib-zcash for transaction construction
 * - Fetches UTXOs from our API (Blockchair backend)
 * - Calculates fees based on transaction size
 * - Signs with user's private key (client-side only)
 * - Broadcasts via our API (Tatum RPC backend)
 *
 * Security:
 * - Private keys never leave the browser
 * - All signing happens client-side
 * - Only signed transactions are sent to server
 */

import * as bitcore from 'bitcore-lib-zcash';
import { zcashRPC } from './zcash';
import { getSafeUTXOs } from '@/utils/utxoProtection';

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

interface TransactionResult {
  txid: string;
  fee: number;
  sentAmount: number;
  changeAmount: number;
}

/**
 * Calculate transaction fee based on size
 * Uses dynamic fee from API or fallback to 0.0001 ZEC/KB
 */
async function calculateFee(txSize: number): Promise<number> {
  try {
    const feeData = await zcashRPC.getFeeEstimate();
    const feePerKB = feeData.feerate || 0.0001; // ZEC per KB
    const feeInZEC = (txSize / 1000) * feePerKB;
    return Math.ceil(feeInZEC * 100000000); // Convert to zatoshis
  } catch (error) {
    console.warn('Failed to get fee estimate, using default:', error);
    // Fallback: 0.0001 ZEC per KB
    const feeInZEC = (txSize / 1000) * 0.0001;
    return Math.ceil(feeInZEC * 100000000);
  }
}

/**
 * Estimate transaction size in bytes
 * Simple formula: (inputs * 180) + (outputs * 34) + 10
 */
function estimateTransactionSize(inputCount: number, outputCount: number): number {
  return (inputCount * 180) + (outputCount * 34) + 10;
}

/**
 * Select UTXOs for transaction (simple greedy algorithm)
 * Selects smallest UTXOs first until we have enough to cover amount + estimated fee
 */
function selectUTXOs(utxos: UTXO[], amountNeeded: number): UTXO[] {
  // Sort by satoshis ascending (use smallest first)
  const sorted = [...utxos].sort((a, b) => a.satoshis - b.satoshis);

  const selected: UTXO[] = [];
  let total = 0;

  // Use simple fee estimation (0.0001 ZEC per KB)
  const estimateFeeSync = (txSize: number) => Math.ceil((txSize / 1000) * 0.0001 * 100000000);

  for (const utxo of sorted) {
    selected.push(utxo);
    total += utxo.satoshis;

    // Recalculate fee with current input count
    const txSize = estimateTransactionSize(selected.length, 2);
    const estimatedFee = estimateFeeSync(txSize);

    // Check if we have enough
    if (total >= amountNeeded + estimatedFee) {
      break;
    }
  }

  // Final check with estimated fee
  const finalTxSize = estimateTransactionSize(selected.length, 2);
  const finalEstimatedFee = estimateFeeSync(finalTxSize);

  if (total < amountNeeded + finalEstimatedFee) {
    throw new Error(`Insufficient funds. Need ${(amountNeeded + finalEstimatedFee) / 100000000} ZEC, have ${total / 100000000} ZEC`);
  }

  return selected;
}

/**
 * Build and sign a send transaction in one step
 * (Avoids serialization/deserialization issues with bitcore-lib-zcash)
 *
 * @param fromAddress - Sender's address
 * @param toAddress - Recipient's address
 * @param amount - Amount to send in ZEC
 * @param utxos - Available UTXOs for sender
 * @param privateKeyWIF - WIF format private key
 * @returns Signed transaction hex and metadata
 */
export async function buildAndSignSendTransaction(
  fromAddress: string,
  toAddress: string,
  amount: number,
  utxos: UTXO[],
  privateKeyWIF: string
): Promise<{ signedTx: string; fee: number; selectedUtxos: UTXO[] }> {
  // Validate inputs
  if (amount <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  if (utxos.length === 0) {
    throw new Error('No UTXOs available');
  }

  // Validate addresses
  try {
    bitcore.Address.fromString(toAddress);
    bitcore.Address.fromString(fromAddress);
  } catch (error) {
    throw new Error('Invalid Zcash address');
  }

  // Convert amount to zatoshis
  const amountSatoshis = Math.floor(amount * 100000000);

  // Select UTXOs
  const selectedUtxos = selectUTXOs(utxos, amountSatoshis);

  // Calculate total input
  const totalInput = selectedUtxos.reduce((sum, utxo) => sum + utxo.satoshis, 0);

  // Build transaction
  const tx = new bitcore.Transaction();

  // Create UnspentOutput objects for each UTXO
  const unspents = selectedUtxos.map((utxo) => {
    return new bitcore.Transaction.UnspentOutput({
      txId: utxo.txid,
      outputIndex: utxo.vout,
      address: fromAddress,
      script: bitcore.Script.buildPublicKeyHashOut(bitcore.Address.fromString(fromAddress)).toHex(),
      satoshis: utxo.satoshis
    });
  });

  // Add inputs
  tx.from(unspents);

  // Add output to recipient
  tx.to(toAddress, amountSatoshis);

  // Calculate actual fee based on transaction size
  const txSize = estimateTransactionSize(selectedUtxos.length, 2); // 2 outputs (recipient + change)
  const fee = await calculateFee(txSize);

  // Calculate change
  const changeAmount = totalInput - amountSatoshis - fee;

  // Add change output if significant (dust limit is 546 zatoshis)
  if (changeAmount > 546) {
    tx.to(fromAddress, changeAmount);
  } else if (changeAmount < 0) {
    throw new Error(`Insufficient funds to cover fee. Need ${fee / 100000000} ZEC fee`);
  }

  // Sign transaction
  try {
    const privateKey = bitcore.PrivateKey.fromWIF(privateKeyWIF);
    tx.sign(privateKey);
    const signedTx = tx.serialize();

    return {
      signedTx,
      fee,
      selectedUtxos
    };
  } catch (error) {
    throw new Error(`Failed to sign transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Send ZEC to an address
 *
 * Complete flow:
 * 1. Fetch UTXOs and inscriptions from API
 * 2. Filter out inscribed UTXOs (protection against losing inscriptions)
 * 3. Build transaction with safe UTXOs only
 * 4. Sign transaction
 * 5. Broadcast to network
 *
 * @param fromAddress - Sender's address
 * @param toAddress - Recipient's address
 * @param amount - Amount to send in ZEC
 * @param privateKeyWIF - Sender's private key (WIF format)
 * @returns Transaction details including txid
 */
export async function sendZEC(
  fromAddress: string,
  toAddress: string,
  amount: number,
  privateKeyWIF: string
): Promise<TransactionResult> {
  console.log('📤 Sending ZEC...');
  console.log(`   From: ${fromAddress}`);
  console.log(`   To: ${toAddress}`);
  console.log(`   Amount: ${amount} ZEC`);

  // Step 1: Fetch UTXOs
  console.log('   Fetching UTXOs...');
  const allUtxos = await zcashRPC.getUTXOs(fromAddress);

  if (allUtxos.length === 0) {
    throw new Error('No UTXOs available. Address may have no balance.');
  }

  console.log(`   Found ${allUtxos.length} UTXOs`);

  // Step 2: Filter out inscribed UTXOs (protection against losing inscriptions)
  console.log('   Checking for inscribed UTXOs...');
  const safeUtxos = await getSafeUTXOs(fromAddress, allUtxos, 'send');

  console.log(`   Using ${safeUtxos.length} safe UTXOs`);

  // Step 3: Build and sign transaction with safe UTXOs only
  console.log('   Building and signing transaction...');
  const { signedTx, fee, selectedUtxos } = await buildAndSignSendTransaction(
    fromAddress,
    toAddress,
    amount,
    safeUtxos, // Use only non-inscribed UTXOs
    privateKeyWIF
  );

  console.log(`   Using ${selectedUtxos.length} inputs`);
  console.log(`   Fee: ${fee / 100000000} ZEC`);

  // Step 4: Broadcast transaction
  console.log('   Broadcasting transaction...');
  const txid = await zcashRPC.broadcastTransaction(signedTx);

  console.log(`   ✅ Transaction broadcast!`);
  console.log(`   TXID: ${txid}`);

  const totalInput = selectedUtxos.reduce((sum, utxo) => sum + utxo.satoshis, 0);
  const changeAmount = totalInput - (amount * 100000000) - fee;

  return {
    txid,
    fee: fee / 100000000,
    sentAmount: amount,
    changeAmount: changeAmount / 100000000
  };
}
