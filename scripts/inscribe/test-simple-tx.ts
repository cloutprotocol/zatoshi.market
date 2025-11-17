/**
 * Test simple P2PKH transaction to verify ZIP 244 works
 */

import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import bs58check from 'bs58check';
import { getTransparentSignatureHashV4 } from './zip243';
import { buildP2PKHScript, varint } from './ordinals-builder';

secp256k1.etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) =>
  hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));

const WALLET = {
  address: 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

const TATUM_API_KEY = 't-691ab5fae2b53035df472a13-2ea27385c5964a15b092bdab';

function decodeWIF(wif: string): Buffer {
  const decoded = bs58check.decode(wif);
  return decoded.slice(1, decoded.length === 34 ? 33 : undefined);
}

function decodeAddress(address: string): Buffer {
  const decoded = bs58check.decode(address);
  return decoded.slice(2);
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
  const consensusHex = result.result.consensus.nextblock;
  return parseInt(consensusHex, 16);
}

async function getUTXOs(address: string) {
  const response = await fetch(`https://utxos.zerdinals.com/api/utxos/${address}`);
  return response.json();
}

function signatureToDER(signature: Uint8Array): Buffer {
  let r = signature.slice(0, 32);
  let s = signature.slice(32, 64);

  function toCanonicalBytes(bytes: Uint8Array): Buffer {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0 && !(bytes[start + 1] & 0x80)) {
      start++;
    }
    if (bytes[start] & 0x80) {
      return Buffer.concat([Buffer.from([0x00]), Buffer.from(bytes.slice(start))]);
    }
    return Buffer.from(bytes.slice(start));
  }

  const rBytes = toCanonicalBytes(r);
  const sBytes = toCanonicalBytes(s);

  const curveN = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
  const halfN = curveN / 2n;
  const sValue = BigInt('0x' + Buffer.from(sBytes).toString('hex'));

  let finalS = sBytes;
  if (sValue > halfN) {
    const newS = curveN - sValue;
    finalS = toCanonicalBytes(Buffer.from(newS.toString(16).padStart(64, '0'), 'hex'));
  }

  const derR = Buffer.concat([Buffer.from([0x02, rBytes.length]), rBytes]);
  const derS = Buffer.concat([Buffer.from([0x02, finalS.length]), finalS]);

  const derSig = Buffer.concat([derR, derS]);
  return Buffer.concat([Buffer.from([0x30, derSig.length]), derSig]);
}

async function broadcastTransaction(txHex: string): Promise<string> {
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

async function testSimpleTransaction() {
  console.log('\n🧪 Testing Simple P2PKH Transaction\n');
  console.log('═══════════════════════════════════════\n');

  const consensusBranchId = await getConsensusBranchId();
  console.log(`Consensus Branch ID: 0x${consensusBranchId.toString(16)}\n`);

  const privateKeyBytes = decodeWIF(WALLET.privateKeyWIF);
  const publicKey = await secp256k1.getPublicKey(privateKeyBytes, true);
  console.log(`Public key: ${Buffer.from(publicKey).toString('hex')}\n`);

  const utxos = await getUTXOs(WALLET.address);
  console.log(`Found ${utxos.length} UTXO(s)\n`);

  const utxo = utxos[0];
  console.log(`Using UTXO: ${utxo.txid}:${utxo.vout}`);
  console.log(`Value: ${utxo.value} zatoshis`);
  console.log(`ScriptPubKey: ${utxo.scriptPubKey || 'not provided'}\n`);

  // Build simple tx: send to self
  const version = Buffer.allocUnsafe(4);
  version.writeUInt32LE(0x80000004);

  const versionGroupId = Buffer.allocUnsafe(4);
  versionGroupId.writeUInt32LE(0x892f2085);

  const inputCount = varint(1);

  const prevTxId = Buffer.from(utxo.txid, 'hex').reverse();
  const prevOutIndex = Buffer.allocUnsafe(4);
  prevOutIndex.writeUInt32LE(utxo.vout);

  const sequence = Buffer.allocUnsafe(4);
  sequence.writeUInt32LE(0xfffffffd);

  const outputCount = varint(1);

  const fee = 10000;
  const outputAmount = utxo.value - fee;
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

  // Get signature hash (with consensus branch ID for NU6)
  const txData = {
    version: 0x80000004,
    versionGroupId: 0x892f2085,
    consensusBranchId,               // NU6 consensus branch ID
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
      { value: outputAmount, scriptPubKey: outputScript }
    ]
  };

  console.log('Signing transaction with ZIP 243 (v4)...\n');
  const sigHash = getTransparentSignatureHashV4(txData, 0);
  console.log(`Signature hash: ${Buffer.from(sigHash).toString('hex')}\n`);

  const signature = await secp256k1.sign(sigHash, privateKeyBytes);
  const compactSig = (signature as any).toCompactRawBytes();

  // Verify signature locally
  const isValid = await secp256k1.verify(signature, sigHash, publicKey);
  console.log(`Signature verification (local): ${isValid ? '✓' : '✗'}\n`);

  const signatureDER = signatureToDER(compactSig);
  const sigWithHashType = Buffer.concat([signatureDER, Buffer.from([0x01])]);

  console.log(`DER signature length: ${signatureDER.length}`);
  console.log(`DER signature: ${signatureDER.toString('hex')}\n`);

  const scriptSig = Buffer.concat([
    Buffer.from([sigWithHashType.length]),
    sigWithHashType,
    Buffer.from([publicKey.length]),
    Buffer.from(publicKey)
  ]);
  const scriptSigLength = varint(scriptSig.length);

  const tx = Buffer.concat([
    version, versionGroupId, inputCount,
    prevTxId, prevOutIndex, scriptSigLength, scriptSig, sequence,
    outputCount,
    outputValue, outputScriptLen, outputScript,
    lockTime, expiryHeight, valueBalance,
    nShieldedSpend, nShieldedOutput, nJoinSplit
  ]);

  const txHex = tx.toString('hex');
  console.log(`Transaction size: ${txHex.length / 2} bytes\n`);
  console.log(`First 200 chars: ${txHex.substring(0, 200)}...\n`);

  console.log('Broadcasting...\n');
  try {
    const txid = await broadcastTransaction(txHex);
    console.log(`✅ SUCCESS! TXID: ${txid}\n`);
  } catch (error: any) {
    console.log(`❌ FAILED: ${error.message}\n`);
  }
}

testSimpleTransaction()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
