/**
 * Create Zcash Ordinals-style Inscription
 * Two-transaction commit/reveal pattern with ZIP 244 signatures
 */

import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import bs58check from 'bs58check';
import { getTransparentSignatureHash, hash160 } from './zip244';
import { buildRevealScript, buildInscriptionData, buildP2SHScript, buildP2PKHScript, varint } from './ordinals-builder';

// Set up secp256k1
secp256k1.etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) =>
  hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));

const WALLET = {
  address: 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

const TATUM_API_KEY = 't-691ab5fae2b53035df472a13-2ea27385c5964a15b092bdab';

/**
 * Decode WIF private key
 */
function decodeWIF(wif: string): Buffer {
  const decoded = bs58check.decode(wif);
  return decoded.slice(1, decoded.length === 34 ? 33 : undefined);
}

/**
 * Decode Zcash address to pubkey hash
 */
function decodeAddress(address: string): Buffer {
  const decoded = bs58check.decode(address);
  return decoded.slice(2); // Skip version bytes
}

/**
 * Get current consensus branch ID from network
 */
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
  const consensusHex = result.result.consensus.nextblock;

  return parseInt(consensusHex, 16);
}

/**
 * Fetch UTXOs
 */
async function getUTXOs(address: string) {
  const response = await fetch(`https://utxos.zerdinals.com/api/utxos/${address}`);
  return response.json();
}

/**
 * Convert signature to DER format (canonical)
 */
function signatureToDER(signature: Uint8Array): Buffer {
  let r = signature.slice(0, 32);
  let s = signature.slice(32, 64);

  // Remove leading zeros, but keep one if high bit is set
  function toCanonicalBytes(bytes: Uint8Array): Buffer {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0 && !(bytes[start + 1] & 0x80)) {
      start++;
    }
    // If high bit is set and we stripped all zeros, add one back
    if (bytes[start] & 0x80) {
      return Buffer.concat([Buffer.from([0x00]), Buffer.from(bytes.slice(start))]);
    }
    return Buffer.from(bytes.slice(start));
  }

  const rBytes = toCanonicalBytes(r);
  const sBytes = toCanonicalBytes(s);

  // Low-S enforcement: s must be <= curve order / 2
  const curveN = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
  const halfN = curveN / 2n;
  const sValue = BigInt('0x' + Buffer.from(sBytes).toString('hex'));

  let finalS = sBytes;
  if (sValue > halfN) {
    // s = n - s
    const newS = curveN - sValue;
    finalS = toCanonicalBytes(Buffer.from(newS.toString(16).padStart(64, '0'), 'hex'));
  }

  const derR = Buffer.concat([Buffer.from([0x02, rBytes.length]), rBytes]);
  const derS = Buffer.concat([Buffer.from([0x02, finalS.length]), finalS]);

  const derSig = Buffer.concat([derR, derS]);
  return Buffer.concat([Buffer.from([0x30, derSig.length]), derSig]);
}

/**
 * Build commit transaction
 */
async function buildCommitTransaction(
  utxos: any[],
  p2shScript: Buffer,
  privateKeyBytes: Buffer,
  publicKey: Buffer,
  consensusBranchId: number
): Promise<string> {
  console.log('\n📝 Building Commit Transaction\n');

  // Transaction header
  const version = Buffer.allocUnsafe(4);
  version.writeUInt32LE(0x80000004); // Overwintered v4

  const versionGroupId = Buffer.allocUnsafe(4);
  versionGroupId.writeUInt32LE(0x892f2085); // Sapling

  // Use first UTXO
  const utxo = utxos[0];
  const inputCount = varint(1);

  const prevTxId = Buffer.from(utxo.txid, 'hex').reverse();
  const prevOutIndex = Buffer.allocUnsafe(4);
  prevOutIndex.writeUInt32LE(utxo.vout);

  const sequence = Buffer.allocUnsafe(4);
  sequence.writeUInt32LE(0xfffffffd); // RBF-enabled sequence

  // Outputs
  const outputCount = varint(2);

  // Output 1: P2SH (for reveal to spend)
  const p2shAmount = 10000; // 0.0001 ZEC locked in script
  const output1Value = Buffer.allocUnsafe(8);
  output1Value.writeBigUInt64LE(BigInt(p2shAmount));
  const output1ScriptLen = varint(p2shScript.length);

  // Output 2: Change
  const fee = 10000;
  const changeAmount = utxo.value - p2shAmount - fee;
  const output2Value = Buffer.allocUnsafe(8);
  output2Value.writeBigUInt64LE(BigInt(changeAmount));

  const pubKeyHash = decodeAddress(WALLET.address);
  const changeScript = buildP2PKHScript(pubKeyHash);
  const output2ScriptLen = varint(changeScript.length);

  const lockTime = Buffer.allocUnsafe(4);
  lockTime.writeUInt32LE(0);

  const expiryHeight = Buffer.allocUnsafe(4);
  expiryHeight.writeUInt32LE(0);

  const valueBalance = Buffer.allocUnsafe(8);
  valueBalance.writeBigInt64LE(BigInt(0));

  const nShieldedSpend = varint(0);
  const nShieldedOutput = varint(0);
  const nJoinSplit = varint(0);

  console.log(`   Input: ${utxo.value} zatoshis`);
  console.log(`   P2SH lock: ${p2shAmount} zatoshis`);
  console.log(`   Change: ${changeAmount} zatoshis`);
  console.log(`   Fee: ${fee} zatoshis\n`);

  // Get signature hash (ZIP 244)
  const txData = {
    version: 0x80000004,
    versionGroupId: 0x892f2085,
    consensusBranchId,
    lockTime: 0,
    expiryHeight: 0,
    inputs: [{
      txid: utxo.txid,
      vout: utxo.vout,
      sequence: 0xfffffffd,
      value: utxo.value,
      scriptPubKey: buildP2PKHScript(pubKeyHash)
    }],
    outputs: [
      { value: p2shAmount, scriptPubKey: p2shScript },
      { value: changeAmount, scriptPubKey: changeScript }
    ]
  };

  console.log('✍️  Signing with ZIP 244...\n');
  const sigHash = getTransparentSignatureHash(txData, 0);
  console.log(`   Signature hash: ${Buffer.from(sigHash).toString('hex')}\n`);

  const signature = await secp256k1.sign(sigHash, privateKeyBytes);
  const compactSig = (signature as any).toCompactRawBytes();
  const signatureDER = signatureToDER(compactSig);
  const sigWithHashType = Buffer.concat([signatureDER, Buffer.from([0x01])]);

  // Build scriptSig
  const scriptSig = Buffer.concat([
    Buffer.from([sigWithHashType.length]),
    sigWithHashType,
    Buffer.from([publicKey.length]),
    publicKey
  ]);
  const scriptSigLength = varint(scriptSig.length);

  // Assemble transaction
  const tx = Buffer.concat([
    version, versionGroupId, inputCount,
    prevTxId, prevOutIndex, scriptSigLength, scriptSig, sequence,
    outputCount,
    output1Value, output1ScriptLen, p2shScript,
    output2Value, output2ScriptLen, changeScript,
    lockTime, expiryHeight, valueBalance,
    nShieldedSpend, nShieldedOutput, nJoinSplit
  ]);

  return tx.toString('hex');
}

/**
 * Build reveal transaction
 */
async function buildRevealTransaction(
  commitTxid: string,
  revealScript: Buffer,
  inscriptionData: Buffer,
  privateKeyBytes: Buffer,
  publicKey: Buffer,
  consensusBranchId: number
): Promise<string> {
  console.log('\n📝 Building Reveal Transaction\n');

  // Transaction header
  const version = Buffer.allocUnsafe(4);
  version.writeUInt32LE(0x80000004);

  const versionGroupId = Buffer.allocUnsafe(4);
  versionGroupId.writeUInt32LE(0x892f2085);

  const inputCount = varint(1);

  // Input: Spend P2SH from commit
  const prevTxId = Buffer.from(commitTxid, 'hex').reverse();
  const prevOutIndex = Buffer.allocUnsafe(4);
  prevOutIndex.writeUInt32LE(0); // First output of commit tx

  const sequence = Buffer.allocUnsafe(4);
  sequence.writeUInt32LE(0xffffffff); // Final sequence for reveal

  // Output: Send to our address
  const outputCount = varint(1);

  const fee = 10000;
  const outputAmount = 10000 - fee; // P2SH amount minus fee
  const outputValue = Buffer.allocUnsafe(8);
  outputValue.writeBigUInt64LE(BigInt(outputAmount));

  const pubKeyHash = decodeAddress(WALLET.address);
  const outputScript = buildP2PKHScript(pubKeyHash);
  const outputScriptLen = varint(outputScript.length);

  const lockTime = Buffer.allocUnsafe(4);
  lockTime.writeUInt32LE(0);

  const expiryHeight = Buffer.allocUnsafe(4);
  expiryHeight.writeUInt32LE(0);

  const valueBalance = Buffer.allocUnsafe(8);
  valueBalance.writeBigInt64LE(BigInt(0));

  const nShieldedSpend = varint(0);
  const nShieldedOutput = varint(0);
  const nJoinSplit = varint(0);

  console.log(`   Input: ${10000} zatoshis (from P2SH)`);
  console.log(`   Output: ${outputAmount} zatoshis`);
  console.log(`   Fee: ${fee} zatoshis\n`);

  // Get signature hash (ZIP 244)
  const p2shScript = buildP2SHScript(revealScript);
  const txData = {
    version: 0x80000004,
    versionGroupId: 0x892f2085,
    consensusBranchId,
    lockTime: 0,
    expiryHeight: 0,
    inputs: [{
      txid: commitTxid,
      vout: 0,
      sequence: 0xffffffff,
      value: 10000,
      scriptPubKey: p2shScript
    }],
    outputs: [
      { value: outputAmount, scriptPubKey: outputScript }
    ]
  };

  console.log('✍️  Signing with ZIP 244...\n');
  const sigHash = getTransparentSignatureHash(txData, 0);

  const signature = await secp256k1.sign(sigHash, privateKeyBytes);
  const compactSig = (signature as any).toCompactRawBytes();
  const signatureDER = signatureToDER(compactSig);
  const sigWithHashType = Buffer.concat([signatureDER, Buffer.from([0x01])]);

  // Build scriptSig: <inscription data> <signature> <reveal script>
  // The reveal script gets pushed as a single item
  const scriptSig = Buffer.concat([
    inscriptionData,                      // Inscription data (ord marker + content)
    Buffer.from([sigWithHashType.length]), // Push signature
    sigWithHashType,
    Buffer.from([revealScript.length]),   // Push reveal script
    revealScript
  ]);
  const scriptSigLength = varint(scriptSig.length);

  // Assemble transaction
  const tx = Buffer.concat([
    version, versionGroupId, inputCount,
    prevTxId, prevOutIndex, scriptSigLength, scriptSig, sequence,
    outputCount,
    outputValue, outputScriptLen, outputScript,
    lockTime, expiryHeight, valueBalance,
    nShieldedSpend, nShieldedOutput, nJoinSplit
  ]);

  return tx.toString('hex');
}

/**
 * Broadcast transaction
 */
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

/**
 * Create inscription
 */
async function createInscription() {
  console.log('\n🚀 Creating "Hello World" Ordinals Inscription\n');
  console.log('═══════════════════════════════════════\n');

  // 1. Get consensus branch ID
  console.log('🔗 Getting network consensus branch ID...\n');
  const consensusBranchId = await getConsensusBranchId();
  console.log(`   Consensus Branch ID: 0x${consensusBranchId.toString(16)}\n`);

  // 2. Get wallet keys
  const privateKeyBytes = decodeWIF(WALLET.privateKeyWIF);
  const publicKey = await secp256k1.getPublicKey(privateKeyBytes, true);
  console.log('🔑 Wallet keys loaded');
  console.log(`   Public key: ${Buffer.from(publicKey).toString('hex')}\n`);

  // 3. Build reveal script (without inscription data)
  const revealScript = buildRevealScript(Buffer.from(publicKey));
  console.log('📜 Reveal script created');
  console.log(`   Length: ${revealScript.length} bytes\n`);

  // 4. Build inscription data (for scriptSig)
  const inscriptionData = buildInscriptionData('hello world', 'text/plain');
  console.log('📝 Inscription data created');
  console.log(`   Content: "hello world"`);
  console.log(`   Type: text/plain`);
  console.log(`   Data length: ${inscriptionData.length} bytes\n`);

  // 5. Build P2SH script
  const p2shScript = buildP2SHScript(revealScript);
  console.log('🔒 P2SH script created');
  console.log(`   Script: ${p2shScript.toString('hex')}\n`);

  // 6. Get UTXOs
  console.log('💰 Fetching UTXOs...\n');
  const utxos = await getUTXOs(WALLET.address);
  console.log(`   Found ${utxos.length} UTXO(s)\n`);

  // 7. Build and broadcast commit transaction
  console.log('═══════════════════════════════════════');
  console.log('📌 STEP 1: COMMIT TRANSACTION');
  console.log('═══════════════════════════════════════');

  const commitTx = await buildCommitTransaction(
    utxos,
    p2shScript,
    privateKeyBytes,
    Buffer.from(publicKey),
    consensusBranchId
  );

  console.log(`   Transaction size: ${commitTx.length / 2} bytes\n`);
  console.log('🔍 Transaction hex (first 200 chars):');
  console.log(`   ${commitTx.substring(0, 200)}...\n`);
  console.log('📡 Broadcasting commit transaction...\n');

  const commitTxid = await broadcastTransaction(commitTx);
  console.log(`✅ Commit transaction broadcasted!`);
  console.log(`   TXID: ${commitTxid}`);
  console.log(`   Explorer: https://zcashblockexplorer.com/transactions/${commitTxid}\n`);

  // 8. Wait for propagation
  console.log('⏳ Waiting 10 seconds for network propagation...\n');
  await new Promise(resolve => setTimeout(resolve, 10000));

  // 9. Build and broadcast reveal transaction
  console.log('═══════════════════════════════════════');
  console.log('📌 STEP 2: REVEAL TRANSACTION');
  console.log('═══════════════════════════════════════');

  const revealTx = await buildRevealTransaction(
    commitTxid,
    revealScript,
    inscriptionData,
    privateKeyBytes,
    Buffer.from(publicKey),
    consensusBranchId
  );

  console.log(`   Transaction size: ${revealTx.length / 2} bytes\n`);
  console.log('📡 Broadcasting reveal transaction...\n');

  const revealTxid = await broadcastTransaction(revealTx);
  console.log(`✅ Reveal transaction broadcasted!`);
  console.log(`   TXID: ${revealTxid}\n`);

  // 9. Success!
  console.log('═══════════════════════════════════════');
  console.log('         🎉 SUCCESS!');
  console.log('═══════════════════════════════════════\n');
  console.log('📝 Inscription Details:\n');
  console.log(`   Content: "hello world"`);
  console.log(`   Type: text/plain`);
  console.log(`   Commit TXID: ${commitTxid}`);
  console.log(`   Reveal TXID: ${revealTxid}\n`);
  console.log('🔍 View Inscription:\n');
  console.log(`   Zerdinals: https://zerdinals.com/inscription/${revealTxid}i0`);
  console.log(`   Explorer: https://zcashblockexplorer.com/transactions/${revealTxid}\n`);
}

// Run
createInscription()
  .then(() => {
    console.log('✅ Inscription creation complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  });
