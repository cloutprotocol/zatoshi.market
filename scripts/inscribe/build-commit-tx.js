/**
 * Build and (optionally) broadcast the Commit Transaction for a Zcash inscription
 *
 * - Uses v4 Overwintered/Sapling transaction format
 * - Transparent signature hash per ZIP-243 with personalization
 * - Follows the guide’s construction with minor corrections (BLAKE2b hashing)
 */

const bs58check = require('bs58check').default;
const { blake2b } = require('@noble/hashes/blake2b');
const { sha256 } = require('@noble/hashes/sha256');
const { ripemd160 } = require('@noble/hashes/ripemd160');
const secp256k1 = require('@noble/secp256k1');

// Deterministic ECDSA per noble’s RFC6979
const { hmac } = require('@noble/hashes/hmac');
secp256k1.etc.hmacSha256Sync = (key, ...msgs) => hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));

// Config
const WALLET = {
  address: 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

const INSCRIPTION_AMOUNT = Number(process.env.INSCRIPTION_AMOUNT || 10000); // zatoshis
const TX_FEE = Number(process.env.TX_FEE || 10000); // zatoshis
const CONTENT_ENV = process.env.CONTENT || 'hello world';
const CONTENT_JSON = process.env.CONTENT_JSON; // if provided, use as raw JSON string
const CONTENT_TYPE = process.env.CONTENT_TYPE || 'text/plain';
const USE_MAINNET = true;

// Simple helpers
function varint(n) {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.allocUnsafe(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b;
  }
  const b = Buffer.allocUnsafe(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b;
}
function u32le(n) { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(n); return b; }
function u64le(n) { const b = Buffer.allocUnsafe(8); b.writeBigUInt64LE(BigInt(n)); return b; }

function hash160(buf) { return Buffer.from(ripemd160(sha256(buf))); }

function buildP2PKHScript(pubKeyHash) {
  return Buffer.concat([
    Buffer.from([0x76]), // OP_DUP
    Buffer.from([0xa9]), // OP_HASH160
    Buffer.from([0x14]), // push 20
    pubKeyHash,
    Buffer.from([0x88]), // OP_EQUALVERIFY
    Buffer.from([0xac])  // OP_CHECKSIG
  ]);
}

function buildP2SHScriptFromRedeem(redeemScript) {
  const scriptHash = hash160(redeemScript);
  return Buffer.concat([
    Buffer.from([0xa9]), // OP_HASH160
    Buffer.from([0x14]), // push 20
    scriptHash,
    Buffer.from([0x87])  // OP_EQUAL
  ]);
}

function createInscriptionChunks(contentType, data) {
  const chunks = [];
  chunks.push(Buffer.from('ord', 'utf8'));
  chunks.push(0x51); // OP_1
  chunks.push(Buffer.from(contentType, 'utf8'));
  chunks.push(0x00); // OP_0
  if (typeof data === 'string') {
    chunks.push(Buffer.from(data, 'utf8'));
  } else if (Buffer.isBuffer(data)) {
    chunks.push(data);
  } else {
    chunks.push(Buffer.from(JSON.stringify(data), 'utf8'));
  }
  return chunks;
}

function compileScript(elements) {
  const parts = [];
  for (const el of elements) {
    if (Buffer.isBuffer(el)) {
      if (el.length <= 75) {
        parts.push(Buffer.from([el.length]));
        parts.push(el);
      } else if (el.length <= 0xff) {
        parts.push(Buffer.from([0x4c, el.length]));
        parts.push(el);
      } else if (el.length <= 0xffff) {
        const len = Buffer.allocUnsafe(2); len.writeUInt16LE(el.length);
        parts.push(Buffer.from([0x4d]));
        parts.push(len);
        parts.push(el);
      } else {
        throw new Error('Data push too large');
      }
    } else if (typeof el === 'number') {
      parts.push(Buffer.from([el]));
    } else {
      throw new Error('Unsupported element');
    }
  }
  return Buffer.concat(parts);
}

function createRedeemScript(publicKey, inscriptionChunks) {
  const ops = [];
  ops.push(publicKey);
  ops.push(0xad); // OP_CHECKSIGVERIFY
  for (let i = 0; i < inscriptionChunks.length; i++) ops.push(0x75); // OP_DROP for each chunk
  ops.push(0x51); // OP_TRUE
  return compileScript(ops);
}

function wifToPrivateKey(wif) {
  const decoded = bs58check.decode(wif);
  // Strip version and optional compression flag
  return decoded.slice(1, decoded.length === 34 ? 33 : undefined);
}

function addressToPubKeyHash(address) {
  const decoded = bs58check.decode(address);
  return decoded.slice(2); // drop 2-byte version prefix
}

function redeemScriptToP2SHAddress(redeemScript, mainnet = true) {
  const scriptHash = hash160(redeemScript);
  const prefix = mainnet ? Buffer.from([0x1c, 0xbd]) : Buffer.from([0x1c, 0xba]);
  const payload = Buffer.concat([prefix, scriptHash]);
  return bs58check.encode(payload);
}

// ZIP-243 (v4) signature hash helpers
function getPrevoutsHash(inputs) {
  const parts = [];
  for (const inp of inputs) {
    parts.push(Buffer.from(inp.txid, 'hex').reverse());
    parts.push(u32le(inp.vout));
  }
  const data = Buffer.concat(parts);
  return Buffer.from(blake2b(data, { dkLen: 32, personalization: Buffer.from('ZcashPrevoutHash') }));
}
function getSequenceHash(inputs) {
  const parts = [];
  for (const inp of inputs) parts.push(u32le(inp.sequence));
  const data = Buffer.concat(parts);
  return Buffer.from(blake2b(data, { dkLen: 32, personalization: Buffer.from('ZcashSequencHash') }));
}
function getOutputsHash(outputs) {
  const parts = [];
  for (const out of outputs) {
    parts.push(u64le(out.value));
    parts.push(varint(out.scriptPubKey.length));
    parts.push(out.scriptPubKey);
  }
  const data = Buffer.concat(parts);
  return Buffer.from(blake2b(data, { dkLen: 32, personalization: Buffer.from('ZcashOutputsHash') }));
}
function getTransparentSignatureHashV4(tx, inputIndex) {
  const input = tx.inputs[inputIndex];
  const preimage = Buffer.concat([
    u32le(tx.version),
    u32le(tx.versionGroupId),
    getPrevoutsHash(tx.inputs),
    getSequenceHash(tx.inputs),
    getOutputsHash(tx.outputs),
    Buffer.alloc(32), // hashJoinSplits
    Buffer.alloc(32), // hashShieldedSpends
    Buffer.alloc(32), // hashShieldedOutputs
    u32le(tx.lockTime),
    u32le(tx.expiryHeight),
    u64le(0), // valueBalance
    u32le(1), // nHashType SIGHASH_ALL
    Buffer.from(input.txid, 'hex').reverse(),
    u32le(input.vout),
    varint(input.scriptPubKey.length),
    input.scriptPubKey,
    u64le(input.value),
    u32le(input.sequence)
  ]);

  // Personalization: "ZcashSigHash" + branchId (LE)
  const pers = Buffer.alloc(16);
  Buffer.from('ZcashSigHash').copy(pers, 0);
  u32le(tx.consensusBranchId).copy(pers, 12);
  return Buffer.from(blake2b(preimage, { dkLen: 32, personalization: pers }));
}

function signatureToDER(sig64) {
  const r = sig64.slice(0, 32);
  const s = sig64.slice(32, 64);
  function canon(bytes) {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0 && !(bytes[start + 1] & 0x80)) start++;
    if (bytes[start] & 0x80) return Buffer.concat([Buffer.from([0x00]), Buffer.from(bytes.slice(start))]);
    return Buffer.from(bytes.slice(start));
  }
  const rB = canon(r);
  let sB = canon(s);
  const n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
  const halfN = n / 2n;
  const sVal = BigInt('0x' + sB.toString('hex'));
  if (sVal > halfN) {
    const newS = n - sVal;
    sB = canon(Buffer.from(newS.toString(16).padStart(64, '0'), 'hex'));
  }
  const derR = Buffer.concat([Buffer.from([0x02, rB.length]), rB]);
  const derS = Buffer.concat([Buffer.from([0x02, sB.length]), sB]);
  const body = Buffer.concat([derR, derS]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

async function getConsensusBranchId() {
  if (process.env.CONSENSUS_BRANCH_ID) {
    const v = process.env.CONSENSUS_BRANCH_ID.trim();
    return v.startsWith('0x') ? parseInt(v, 16) : parseInt(v, 10);
  }
  const url = 'https://api.tatum.io/v3/blockchain/node/zcash-mainnet';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.TATUM_API_KEY || '' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'getblockchaininfo', id: 1 })
  });
  const out = await res.json();
  if (!out?.result?.consensus?.nextblock) throw new Error('Failed to fetch consensusBranchId');
  return parseInt(out.result.consensus.nextblock, 16);
}

async function fetchUTXOs(address) {
  const url = `https://utxos.zerdinals.com/api/utxos/${address}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`UTXO fetch failed: ${res.status}`);
  return res.json();
}

async function broadcast(txHex) {
  // Prefer Zerdinals
  try {
    const r = await fetch('https://utxos.zerdinals.com/api/send-transaction', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawTransaction: txHex })
    });
    const j = await r.json();
    console.log('Zerdinals response:', JSON.stringify(j));
    if (r.ok && (j.result || j.txid)) return j.result || j.txid;
  } catch (_) {}
  // Fallback Tatum
  const r2 = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.TATUM_API_KEY || '' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'sendrawtransaction', params: [txHex], id: 1 })
  });
  const j2 = await r2.json();
  console.log('Tatum response:', JSON.stringify(j2));
  if (j2.error) throw new Error(j2.error?.message || JSON.stringify(j2.error));
  return j2.result;
}

async function main() {
  console.log('\n=== Build Commit Transaction ===');

  const privKey = wifToPrivateKey(WALLET.privateKeyWIF);
  const pubKey = Buffer.from(await secp256k1.getPublicKey(privKey, true));
  const pubKeyHash = addressToPubKeyHash(WALLET.address);

  // Build inscriptionChunks to determine OP_DROP count in redeem script
  const contentData = CONTENT_JSON ? CONTENT_JSON : CONTENT_ENV;
  const inscriptionChunks = createInscriptionChunks(CONTENT_TYPE, contentData);
  const redeemScript = createRedeemScript(pubKey, inscriptionChunks);
  const p2shScript = buildP2SHScriptFromRedeem(redeemScript);
  const p2shAddress = redeemScriptToP2SHAddress(redeemScript, USE_MAINNET);

  console.log('P2SH address:', p2shAddress);
  console.log('Redeem script:', redeemScript.toString('hex'));
  console.log('P2SH script  :', p2shScript.toString('hex'));

  const utxos = await fetchUTXOs(WALLET.address);
  const required = INSCRIPTION_AMOUNT + TX_FEE;
  const selected = utxos.filter(u => u.confirmed !== false).find(u => u.value >= required);
  if (!selected) throw new Error(`Insufficient funds: need ${required}`);

  console.log('Selected UTXO:', `${selected.txid}:${selected.vout}`, 'value=', selected.value);

  // Build tx object for hashing
  const consensusBranchId = await getConsensusBranchId();
  console.log('ConsensusBranchId: 0x' + consensusBranchId.toString(16));
  const input = {
    txid: selected.txid,
    vout: selected.vout,
    sequence: 0xfffffffd,
    value: selected.value,
    scriptPubKey: buildP2PKHScript(pubKeyHash) // scriptCode for signing P2PKH input
  };

  const outputs = [
    { value: INSCRIPTION_AMOUNT, scriptPubKey: p2shScript }
  ];
  const change = selected.value - INSCRIPTION_AMOUNT - TX_FEE;
  if (change > 546) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(pubKeyHash) });

  const txData = {
    version: 0x80000004,
    versionGroupId: 0x892f2085,
    consensusBranchId,
    lockTime: 0,
    expiryHeight: 0,
    inputs: [input],
    outputs
  };

  const sigHash = getTransparentSignatureHashV4(txData, 0);
  const sig = await secp256k1.sign(sigHash, privKey);
  const pubVerify = await secp256k1.verify(sig, sigHash, pubKey);
  console.log('Local signature verify:', pubVerify ? 'OK' : 'FAIL');
  const der = signatureToDER(sig.toCompactRawBytes ? sig.toCompactRawBytes() : sig);
  const sigWithType = Buffer.concat([der, Buffer.from([0x01])]); // SIGHASH_ALL

  // Serialize full transaction
  const version = u32le(0x80000004);
  const versionGroupId = u32le(0x892f2085);
  const inputCount = varint(1);
  const prevTxId = Buffer.from(selected.txid, 'hex').reverse();
  const prevOutIndex = u32le(selected.vout);
  const scriptSig = Buffer.concat([
    Buffer.from([sigWithType.length]), sigWithType,
    Buffer.from([pubKey.length]), pubKey
  ]);
  const scriptSigLen = varint(scriptSig.length);
  const sequence = u32le(0xfffffffd);

  const outputCount = varint(outputs.length);
  const outputsBuf = Buffer.concat(outputs.map(o => Buffer.concat([
    u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey
  ])));

  const lockTime = u32le(0);
  const expiryHeight = u32le(0);
  const valueBalance = Buffer.alloc(8); // 0
  const nShieldedSpend = Buffer.from([0x00]);
  const nShieldedOutput = Buffer.from([0x00]);
  const nJoinSplit = Buffer.from([0x00]);

  const raw = Buffer.concat([
    version, versionGroupId,
    inputCount,
    prevTxId, prevOutIndex, scriptSigLen, scriptSig, sequence,
    outputCount, outputsBuf,
    lockTime, expiryHeight, valueBalance,
    nShieldedSpend, nShieldedOutput, nJoinSplit
  ]);

  const hex = raw.toString('hex');
  console.log('\nCommit TX hex:', hex);
  console.log('Size (bytes):', hex.length / 2);

  if (process.env.BROADCAST === '1') {
    console.log('\nBroadcasting...');
    const txid = await broadcast(hex);
    console.log('Broadcasted txid:', txid);
  }
}

main().catch(err => {
  console.error('Error:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
