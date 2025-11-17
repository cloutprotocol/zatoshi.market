/**
 * Manual Zcash Transaction Builder
 * Builds inscription transaction without buggy libraries
 */

import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import bs58check from 'bs58check';

// Set up secp256k1 with hmac
secp256k1.etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) =>
  hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));

const WALLET = {
  address: 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

const UTXO = {
  txid: '48d9a62d2b368e5446409b5a346290fa7173d242dee744f36ec9575d05009ab1',
  vout: 0,
  value: 500000
};

/**
 * Decode WIF private key
 */
function decodeWIF(wif: string): Buffer {
  const decoded = bs58check.decode(wif);
  // Remove version byte (first byte) and compression flag (last byte if present)
  return decoded.slice(1, decoded.length === 34 ? 33 : undefined);
}

/**
 * Decode Zcash t-address to get pubkey hash
 */
function decodeAddress(address: string): Buffer {
  const decoded = bs58check.decode(address);
  // Remove version bytes (first 2 bytes for Zcash t-address)
  return decoded.slice(2);
}

/**
 * Create OP_RETURN script
 */
function createOpReturnScript(data: Buffer): Buffer {
  const OP_RETURN = 0x6a;

  // OP_RETURN + push data
  const scriptParts: Buffer[] = [];
  scriptParts.push(Buffer.from([OP_RETURN]));

  if (data.length <= 75) {
    scriptParts.push(Buffer.from([data.length]));
  } else if (data.length <= 255) {
    scriptParts.push(Buffer.from([0x4c, data.length]));
  }

  scriptParts.push(data);

  return Buffer.concat(scriptParts);
}

/**
 * Create P2PKH script
 */
function createP2PKHScript(pubKeyHash: Buffer): Buffer {
  const OP_DUP = 0x76;
  const OP_HASH160 = 0xa9;
  const OP_EQUALVERIFY = 0x88;
  const OP_CHECKSIG = 0xac;

  return Buffer.concat([
    Buffer.from([OP_DUP, OP_HASH160, pubKeyHash.length]),
    pubKeyHash,
    Buffer.from([OP_EQUALVERIFY, OP_CHECKSIG])
  ]);
}

/**
 * Serialize varint
 */
function varint(n: number): Buffer {
  if (n < 0xfd) {
    return Buffer.from([n]);
  } else if (n <= 0xffff) {
    const buf = Buffer.allocUnsafe(3);
    buf.writeUInt8(0xfd, 0);
    buf.writeUInt16LE(n, 1);
    return buf;
  } else {
    const buf = Buffer.allocUnsafe(5);
    buf.writeUInt8(0xfe, 0);
    buf.writeUInt32LE(n, 1);
    return buf;
  }
}

/**
 * Convert signature to DER format
 */
function signatureToDER(signature: Uint8Array): Buffer {
  const r = signature.slice(0, 32);
  const s = signature.slice(32, 64);

  // Remove leading zeros but keep one if needed for sign bit
  function trimLeadingZeros(bytes: Uint8Array): Uint8Array {
    let start = 0;
    while (start < bytes.length && bytes[start] === 0) {
      start++;
    }
    // If first byte has high bit set, need leading zero
    if (start === bytes.length || bytes[start] & 0x80) {
      start--;
    }
    return bytes.slice(start);
  }

  const rBytes = trimLeadingZeros(r);
  const sBytes = trimLeadingZeros(s);

  const derR = Buffer.concat([Buffer.from([0x02, rBytes.length]), Buffer.from(rBytes)]);
  const derS = Buffer.concat([Buffer.from([0x02, sBytes.length]), Buffer.from(sBytes)]);

  const derSig = Buffer.concat([derR, derS]);
  return Buffer.concat([Buffer.from([0x30, derSig.length]), derSig]);
}

/**
 * Build complete signed transaction
 */
async function buildSignedTransaction() {
  console.log('\n🔨 Building Raw Zcash Transaction\n');

  // Decode private key
  const privateKeyBytes = decodeWIF(WALLET.privateKeyWIF);
  const publicKey = await secp256k1.getPublicKey(privateKeyBytes, true);

  // Transaction components
  // Version 4 with overwintered bit set (0x80000004)
  const version = Buffer.allocUnsafe(4);
  version.writeUInt32LE(0x80000004);

  const versionGroupId = Buffer.allocUnsafe(4);
  versionGroupId.writeUInt32LE(0x892f2085);

  const inputCount = varint(1);
  const prevTxId = Buffer.from(UTXO.txid, 'hex').reverse();
  const prevOutIndex = Buffer.allocUnsafe(4);
  prevOutIndex.writeUInt32LE(UTXO.vout);
  const sequence = Buffer.allocUnsafe(4);
  sequence.writeUInt32LE(0xffffffff); // Disable locktime and RBF

  // Outputs
  const inscriptionData = Buffer.from('zerd|hello world', 'utf8');
  const opReturnScript = createOpReturnScript(inscriptionData);

  console.log(`   Inscription: "${inscriptionData.toString()}"`);
  console.log(`   Hex: ${inscriptionData.toString('hex')}\n`);

  const fee = 10000;
  const changeAmount = UTXO.value - fee;

  const output1Value = Buffer.allocUnsafe(8);
  output1Value.writeBigUInt64LE(BigInt(0));
  const output1ScriptLen = varint(opReturnScript.length);

  const output2Value = Buffer.allocUnsafe(8);
  output2Value.writeBigUInt64LE(BigInt(changeAmount));

  const pubKeyHash = decodeAddress(WALLET.address);
  const changeScript = createP2PKHScript(pubKeyHash);
  const output2ScriptLen = varint(changeScript.length);

  console.log(`   Input: ${UTXO.value} zatoshis`);
  console.log(`   Fee: ${fee} zatoshis`);
  console.log(`   Change: ${changeAmount} zatoshis\n`);

  const outputCount = varint(2);
  const lockTime = Buffer.allocUnsafe(4);
  lockTime.writeUInt32LE(0);
  const expiryHeight = Buffer.allocUnsafe(4);
  expiryHeight.writeUInt32LE(0);
  const valueBalance = Buffer.allocUnsafe(8);
  valueBalance.writeBigInt64LE(BigInt(0));
  const nShieldedSpend = varint(0);
  const nShieldedOutput = varint(0);
  const nJoinSplit = varint(0);

  // Create signature hash
  const prevOutScript = createP2PKHScript(pubKeyHash);
  const prevOutScriptLen = varint(prevOutScript.length);
  const inputValue = Buffer.allocUnsafe(8);
  inputValue.writeBigUInt64LE(BigInt(UTXO.value));

  const hashPrevouts = sha256(sha256(Buffer.concat([prevTxId, prevOutIndex])));
  const hashSequence = sha256(sha256(sequence));
  const hashOutputs = sha256(sha256(Buffer.concat([
    output1Value, output1ScriptLen, opReturnScript,
    output2Value, output2ScriptLen, changeScript
  ])));

  const SIGHASH_ALL = Buffer.allocUnsafe(4);
  SIGHASH_ALL.writeUInt32LE(1);

  const preimage = Buffer.concat([
    version, versionGroupId, hashPrevouts, hashSequence, hashOutputs,
    Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(32),
    lockTime, expiryHeight, valueBalance, SIGHASH_ALL,
    prevTxId, prevOutIndex, prevOutScriptLen, prevOutScript, inputValue, sequence
  ]);

  const hashForSig = sha256(sha256(preimage));
  console.log(`   Signature hash: ${Buffer.from(hashForSig).toString('hex')}\n`);

  // Sign with secp256k1
  console.log('✍️  Signing transaction...\n');
  const signature = await secp256k1.sign(hashForSig, privateKeyBytes);

  // Get compact 64-byte signature and convert to DER
  const compactSig = (signature as any).toCompactRawBytes();
  const signatureDER = signatureToDER(compactSig);
  const sigWithHashType = Buffer.concat([signatureDER, Buffer.from([0x01])]);

  console.log(`   Signature (DER): ${sigWithHashType.toString('hex').substring(0, 60)}...`);
  console.log(`   Public Key: ${Buffer.from(publicKey).toString('hex')}\n`);

  // Build scriptSig: <sig length> <sig> <pubkey length> <pubkey>
  // Use direct push opcodes (not varint) for data <= 75 bytes
  const sigLength = sigWithHashType.length;
  const pubKeyLength = publicKey.length;

  const scriptSig = Buffer.concat([
    Buffer.from([sigLength]),      // Push sig length (should be ~70-72 bytes)
    sigWithHashType,
    Buffer.from([pubKeyLength]),   // Push pubkey length (should be 33 bytes compressed)
    Buffer.from(publicKey)
  ]);
  const scriptSigLength = varint(scriptSig.length);

  // Build final signed transaction
  const signedTx = Buffer.concat([
    version, versionGroupId, inputCount,
    prevTxId, prevOutIndex, scriptSigLength, scriptSig, sequence,
    outputCount,
    output1Value, output1ScriptLen, opReturnScript,
    output2Value, output2ScriptLen, changeScript,
    lockTime, expiryHeight, valueBalance,
    nShieldedSpend, nShieldedOutput, nJoinSplit
  ]);

  console.log(`   Signed TX size: ${signedTx.length} bytes\n`);

  return signedTx.toString('hex');
}

/**
 * Broadcast transaction via multiple endpoints
 */
async function broadcastTransaction(signedTxHex: string) {
  console.log('📡 Broadcasting transaction...\n');

  // Try Zerdinals first (they definitely support inscriptions)
  try {
    console.log('   Trying Zerdinals API...');
    const zerdResponse = await fetch('https://utxos.zerdinals.com/api/send-transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawTransaction: signedTxHex })
    });

    const zerdResult = await zerdResponse.json();

    if (zerdResponse.ok && (zerdResult.result || zerdResult.txid)) {
      console.log('   ✓ Broadcast successful via Zerdinals\n');
      return zerdResult.result || zerdResult.txid;
    }

    console.log(`   ✗ Zerdinals failed:`, zerdResult);
  } catch (error: any) {
    console.log(`   ✗ Zerdinals error:`, error.message);
  }

  // Try Tatum as fallback
  try {
    console.log('   Trying Tatum API...');
    const TATUM_API_KEY = 't-691ab5fae2b53035df472a13-2ea27385c5964a15b092bdab';

    const response = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': TATUM_API_KEY
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'sendrawtransaction',
        params: [signedTxHex],
        id: 1
      })
    });

    const result = await response.json();

    if (result.error) {
      console.log(`   ✗ Tatum failed:`, result.error);
      throw new Error(`Broadcast error: ${result.error.message}`);
    }

    console.log('   ✓ Broadcast successful via Tatum\n');
    return result.result;
  } catch (error: any) {
    throw new Error(`All broadcast attempts failed. Last error: ${error.message}`);
  }
}

/**
 * Create and broadcast inscription
 */
async function createInscription() {
  try {
    console.log('\n🚀 Creating "Hello World" Inscription\n');
    console.log('═══════════════════════════════════════\n');

    // Build and sign transaction
    const signedTxHex = await buildSignedTransaction();

    console.log('📋 Signed Transaction:\n');
    console.log(`   Full hex: ${signedTxHex}`);
    console.log(`   Length: ${signedTxHex.length} chars (${signedTxHex.length / 2} bytes)\n`);

    // Broadcast
    const txid = await broadcastTransaction(signedTxHex);

    console.log('═══════════════════════════════════════');
    console.log('         ✅ SUCCESS!');
    console.log('═══════════════════════════════════════\n');
    console.log(`Transaction ID: ${txid}\n`);
    console.log('View transaction:');
    console.log(`• https://zcashblockexplorer.com/transactions/${txid}`);
    console.log(`\nView inscription (once indexed):`);
    console.log(`• https://zerdinals.com/inscription/${txid}i0\n`);

    return txid;
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    throw error;
  }
}

// Run
createInscription()
  .then(() => {
    console.log('✅ Inscription created successfully!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed to create inscription\n');
    process.exit(1);
  });
