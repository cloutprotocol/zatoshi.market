/**
 * Build and (optionally) broadcast the Reveal Transaction for a Zcash inscription
 *
 * - Spends the P2SH output from commit
 * - Pushes inscription data in scriptSig: "ord" OP_1 <mime> OP_0 <data>
 * - Signs with ZIP-243 using the redeem script as scriptCode
 */

const bs58check = require('bs58check').default;
const { blake2b } = require('@noble/hashes/blake2b');
const { sha256 } = require('@noble/hashes/sha256');
const { ripemd160 } = require('@noble/hashes/ripemd160');
const secp256k1 = require('@noble/secp256k1');
const { hmac } = require('@noble/hashes/hmac');
secp256k1.etc.hmacSha256Sync = (key, ...msgs) => hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));

// Config via env
const COMMIT_TXID = process.env.COMMIT_TXID || '';
const INSCRIPTION_AMOUNT = Number(process.env.INSCRIPTION_AMOUNT || 60000); // must match commit amount
const TX_FEE = Number(process.env.TX_FEE || 10000);
const CONTENT = process.env.CONTENT || 'hello world';
const CONTENT_JSON = process.env.CONTENT_JSON; // if provided, use as raw JSON string
const CONTENT_TYPE = process.env.CONTENT_TYPE || 'text/plain';

const WALLET = {
  address: 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

function varint(n) {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) { const b = Buffer.allocUnsafe(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b; }
  const b = Buffer.allocUnsafe(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b;
}
function u32le(n) { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(n); return b; }
function u64le(n) { const b = Buffer.allocUnsafe(8); b.writeBigUInt64LE(BigInt(n)); return b; }

function hash160(buf) { return Buffer.from(ripemd160(sha256(buf))); }

function buildP2PKHScript(pubKeyHash) {
  return Buffer.concat([
    Buffer.from([0x76]), Buffer.from([0xa9]), Buffer.from([0x14]), pubKeyHash,
    Buffer.from([0x88]), Buffer.from([0xac])
  ]);
}

function compilePush(data) {
  if (data.length <= 75) return Buffer.concat([Buffer.from([data.length]), data]);
  if (data.length <= 0xff) return Buffer.concat([Buffer.from([0x4c, data.length]), data]);
  const len = Buffer.allocUnsafe(2); len.writeUInt16LE(data.length); return Buffer.concat([Buffer.from([0x4d]), len, data]);
}

function buildInscriptionDataBuffer(content, mime) {
  const ord = Buffer.from('ord', 'utf8');
  const mimeBuf = Buffer.from(mime, 'utf8');
  const contentBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return Buffer.concat([
    compilePush(ord),
    Buffer.from([0x51]), // OP_1
    compilePush(mimeBuf),
    Buffer.from([0x00]), // OP_0
    compilePush(contentBuf)
  ]);
}

function createInscriptionChunks(contentType, data) {
  return [Buffer.from('ord', 'utf8'), 0x51, Buffer.from(contentType, 'utf8'), 0x00, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')];
}

function compileScript(elements) {
  const parts = [];
  for (const el of elements) {
    if (Buffer.isBuffer(el)) parts.push(compilePush(el));
    else if (typeof el === 'number') parts.push(Buffer.from([el]));
    else throw new Error('Unsupported element');
  }
  return Buffer.concat(parts);
}

function createRevealRedeemScript(publicKey, inscriptionChunks) {
  const ops = [publicKey, 0xad]; // <pubkey> OP_CHECKSIGVERIFY
  for (let i = 0; i < inscriptionChunks.length; i++) ops.push(0x75); // OP_DROP x N
  ops.push(0x51); // OP_TRUE
  return compileScript(ops);
}

function wifToPrivateKey(wif) { const d = bs58check.decode(wif); return d.slice(1, d.length === 34 ? 33 : undefined); }
function addressToPubKeyHash(addr) { const d = bs58check.decode(addr); return d.slice(2); }

// ZIP-243 helpers
function getPrevoutsHash(inputs) {
  const parts = [];
  for (const inp of inputs) { parts.push(Buffer.from(inp.txid, 'hex').reverse()); parts.push(u32le(inp.vout)); }
  return Buffer.from(blake2b(Buffer.concat(parts), { dkLen: 32, personalization: Buffer.from('ZcashPrevoutHash') }));
}
function getSequenceHash(inputs) {
  const parts = inputs.map(i => u32le(i.sequence));
  return Buffer.from(blake2b(Buffer.concat(parts), { dkLen: 32, personalization: Buffer.from('ZcashSequencHash') }));
}
function getOutputsHash(outputs) {
  const parts = [];
  for (const o of outputs) { parts.push(u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey); }
  return Buffer.from(blake2b(Buffer.concat(parts), { dkLen: 32, personalization: Buffer.from('ZcashOutputsHash') }));
}
function getTransparentSignatureHashV4(tx, inputIndex) {
  const input = tx.inputs[inputIndex];
  const preimage = Buffer.concat([
    u32le(tx.version), u32le(tx.versionGroupId),
    getPrevoutsHash(tx.inputs), getSequenceHash(tx.inputs), getOutputsHash(tx.outputs),
    Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(32),
    u32le(tx.lockTime), u32le(tx.expiryHeight), u64le(0),
    u32le(1),
    Buffer.from(input.txid, 'hex').reverse(), u32le(input.vout),
    varint(input.scriptPubKey.length), input.scriptPubKey,
    u64le(input.value), u32le(input.sequence)
  ]);
  const pers = Buffer.alloc(16); Buffer.from('ZcashSigHash').copy(pers); u32le(tx.consensusBranchId).copy(pers, 12);
  return Buffer.from(blake2b(preimage, { dkLen: 32, personalization: pers }));
}

function signatureToDER(sig64) {
  const r = sig64.slice(0, 32), s = sig64.slice(32, 64);
  const canon = (bytes) => { let i = 0; while (i < bytes.length - 1 && bytes[i] === 0 && !(bytes[i + 1] & 0x80)) i++; return (bytes[i] & 0x80) ? Buffer.concat([Buffer.from([0x00]), Buffer.from(bytes.slice(i))]) : Buffer.from(bytes.slice(i)); };
  const rB = canon(r); let sB = canon(s);
  const n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n; const halfN = n / 2n; const sVal = BigInt('0x' + sB.toString('hex'));
  if (sVal > halfN) sB = canon(Buffer.from((n - sVal).toString(16).padStart(64, '0'), 'hex'));
  const body = Buffer.concat([Buffer.from([0x02, rB.length]), rB, Buffer.from([0x02, sB.length]), sB]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

async function getConsensusBranchId() {
  const url = 'https://api.tatum.io/v3/blockchain/node/zcash-mainnet';
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.TATUM_API_KEY || '' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'getblockchaininfo', id: 1 }) });
  const j = await r.json();
  if (!j?.result?.consensus?.nextblock) throw new Error('Failed to fetch consensusBranchId');
  return parseInt(j.result.consensus.nextblock, 16);
}

async function broadcast(txHex) {
  try {
    const r = await fetch('https://utxos.zerdinals.com/api/send-transaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawTransaction: txHex }) });
    const j = await r.json(); if (r.ok && (j.result || j.txid)) return j.result || j.txid;
  } catch (_) {}
  const r2 = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.TATUM_API_KEY || '' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'sendrawtransaction', params: [txHex], id: 1 }) });
  const j2 = await r2.json(); if (j2.error) throw new Error(j2.error?.message || JSON.stringify(j2.error)); return j2.result;
}

async function main() {
  if (!COMMIT_TXID) throw new Error('Set COMMIT_TXID to the commit transaction ID');

  console.log('\n=== Build Reveal Transaction ===');
  console.log('Commit txid:', COMMIT_TXID);

  const priv = wifToPrivateKey(WALLET.privateKeyWIF);
  const pub = Buffer.from(await secp256k1.getPublicKey(priv, true));
  const pkh = addressToPubKeyHash(WALLET.address);

  const contentData = CONTENT_JSON ? CONTENT_JSON : CONTENT;
  const chunks = createInscriptionChunks(CONTENT_TYPE, contentData);
  const redeemScript = createRevealRedeemScript(pub, chunks);
  const inscriptionData = buildInscriptionDataBuffer(contentData, CONTENT_TYPE);

  // Build output to self: commit amount - fee
  const outValue = INSCRIPTION_AMOUNT - TX_FEE; if (outValue <= 0) throw new Error('Insufficient inscription amount for fee');
  const outputScript = buildP2PKHScript(pkh);

  const consensusBranchId = await getConsensusBranchId();
  const txData = {
    version: 0x80000004,
    versionGroupId: 0x892f2085,
    consensusBranchId,
    lockTime: 0,
    expiryHeight: 0,
    inputs: [{
      txid: COMMIT_TXID,
      vout: 0,
      sequence: 0xffffffff,
      value: INSCRIPTION_AMOUNT,
      // scriptCode for signing MUST be the redeem script
      scriptPubKey: redeemScript
    }],
    outputs: [{ value: outValue, scriptPubKey: outputScript }]
  };

  const sigHash = getTransparentSignatureHashV4(txData, 0);
  const sig = await secp256k1.sign(sigHash, priv);
  const der = signatureToDER(sig.toCompactRawBytes ? sig.toCompactRawBytes() : sig);
  const sigWithType = Buffer.concat([der, Buffer.from([0x01])]);

  // scriptSig = <inscription data> <signature> <redeemScript>
  const scriptSig = Buffer.concat([
    inscriptionData,
    Buffer.from([sigWithType.length]), sigWithType,
    Buffer.from([redeemScript.length]), redeemScript
  ]);

  // Serialize reveal tx
  const version = u32le(0x80000004);
  const versionGroupId = u32le(0x892f2085);
  const inputCount = varint(1);
  const prevTxId = Buffer.from(COMMIT_TXID, 'hex').reverse();
  const prevOutIndex = u32le(0);
  const scriptSigLen = varint(scriptSig.length);
  const sequence = u32le(0xffffffff);
  const outputCount = varint(1);
  const outputBuf = Buffer.concat([u64le(outValue), varint(outputScript.length), outputScript]);
  const lockTime = u32le(0);
  const expiryHeight = u32le(0);
  const valueBalance = Buffer.alloc(8);
  const nShieldedSpend = Buffer.from([0x00]);
  const nShieldedOutput = Buffer.from([0x00]);
  const nJoinSplit = Buffer.from([0x00]);

  const raw = Buffer.concat([
    version, versionGroupId,
    inputCount,
    prevTxId, prevOutIndex, scriptSigLen, scriptSig, sequence,
    outputCount, outputBuf,
    lockTime, expiryHeight, valueBalance,
    nShieldedSpend, nShieldedOutput, nJoinSplit
  ]);

  const hex = raw.toString('hex');
  console.log('Reveal TX hex:', hex);
  console.log('Size (bytes):', hex.length / 2);

  if (process.env.BROADCAST === '1') {
    console.log('\nBroadcasting...');
    const txid = await broadcast(hex);
    console.log('Broadcasted reveal txid:', txid);
    console.log('Inscription ID:', `${txid}i0`);
  }
}

main().catch(err => {
  console.error('Error:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
