import bs58check from "bs58check";
import { blake2b } from "@noble/hashes/blake2b";
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import * as secp256k1 from "@noble/secp256k1";
import { hmac } from "@noble/hashes/hmac";

secp256k1.etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) =>
  hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));

export type Utxo = { txid: string; vout: number; value: number };

function varint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.allocUnsafe(3);
    b[0] = 0xfd;
    b.writeUInt16LE(n, 1);
    return b;
  }
  const b = Buffer.allocUnsafe(5);
  b[0] = 0xfe;
  b.writeUInt32LE(n, 1);
  return b;
}
function u32le(n: number): Buffer { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(n); return b; }
function u64le(n: number): Buffer { const b = Buffer.allocUnsafe(8); b.writeBigUInt64LE(BigInt(n)); return b; }

export function hash160(buf: Uint8Array): Buffer { return Buffer.from(ripemd160(sha256(buf))); }

export function buildP2PKHScript(pkh: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), pkh, Buffer.from([0x88, 0xac])]);
}

export function buildInscriptionChunks(contentType: string, data: string | Buffer): (Buffer|number)[] {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const chunks: (Buffer|number)[] = [Buffer.from("ord","utf8"), 0x51, Buffer.from(contentType,"utf8"), 0x00];

  // Split data into 520-byte chunks (MAX_SCRIPT_ELEMENT_SIZE)
  const MAX_CHUNK = 520;
  for (let i = 0; i < body.length; i += MAX_CHUNK) {
    chunks.push(body.slice(i, i + MAX_CHUNK));
  }

  return chunks;
}

function pushData(data: Buffer): Buffer {
  const len = data.length;
  if (len <= 75) {
    return Buffer.concat([Buffer.from([len]), data]);
  } else if (len <= 0xff) {
    return Buffer.concat([Buffer.from([0x4c, len]), data]);
  } else if (len <= 0xffff) {
    const lenBuf = Buffer.allocUnsafe(2);
    lenBuf.writeUInt16LE(len);
    return Buffer.concat([Buffer.from([0x4d]), lenBuf, data]);
  } else {
    const lenBuf = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32LE(len);
    return Buffer.concat([Buffer.from([0x4e]), lenBuf, data]);
  }
}

export function buildInscriptionDataBuffer(content: string | Buffer, contentType: string): Buffer {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const mime = Buffer.from(contentType, 'utf8');

  // Ordinals envelope format (as used by Zerdinals):
  // OP_PUSH "ord" | OP_1 | OP_PUSH <mime> | OP_0 | OP_PUSH <chunk1> | OP_PUSH <chunk2> | ...
  // Note: For numbers 0-16, Bitcoin script requires using OP_0 through OP_16 (0x00-0x60)
  // to satisfy SCRIPT_VERIFY_MINIMALDATA. OP_1 = 0x51, OP_0 = 0x00.
  // Content is split into 520-byte chunks to comply with MAX_SCRIPT_ELEMENT_SIZE
  const parts = [
    pushData(Buffer.from("ord","utf8")),
    Buffer.from([0x51]),  // OP_1 (content type tag)
    pushData(mime),
    Buffer.from([0x00])   // OP_0 (content tag)
  ];

  // Split body into 520-byte chunks and push each separately
  const MAX_CHUNK = 520;
  for (let i = 0; i < body.length; i += MAX_CHUNK) {
    parts.push(pushData(body.slice(i, i + MAX_CHUNK)));
  }

  return Buffer.concat(parts);
}

export function createRevealScript(pubKey: Buffer, inscriptionChunks: (Buffer|number)[]): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from([pubKey.length]), pubKey);
  parts.push(Buffer.from([0xad])); // OP_CHECKSIGVERIFY
  for (let i=0;i<inscriptionChunks.length;i++) parts.push(Buffer.from([0x75]));
  parts.push(Buffer.from([0x51])); // OP_TRUE
  return Buffer.concat(parts);
}

export function p2shFromRedeem(redeemScript: Buffer): { script: Buffer; hash: Buffer } {
  const h = hash160(redeemScript);
  const script = Buffer.concat([Buffer.from([0xa9, 0x14]), h, Buffer.from([0x87])]);
  return { script, hash: h };
}

export function wifToPriv(wif: string): Buffer {
  const d = bs58check.decode(wif);
  return d.slice(1, d.length === 34 ? 33 : undefined);
}
export function addressToPkh(addr: string): Buffer {
  const d = bs58check.decode(addr);
  return d.slice(2);
}

function blake(data: Uint8Array, p: string): Buffer {
  return Buffer.from(blake2b(data, { dkLen: 32, personalization: Buffer.from(p) }));
}
function prevoutsHash(inputs: {txid:string; vout:number; sequence:number}[]): Buffer {
  const parts: Buffer[] = [];
  for(const i of inputs){ parts.push(Buffer.from(i.txid,'hex').reverse(), u32le(i.vout)); }
  return blake(Buffer.concat(parts), 'ZcashPrevoutHash');
}
function sequenceHash(inputs: {txid:string; vout:number; sequence:number}[]): Buffer {
  const parts: Buffer[] = inputs.map(i=>u32le(i.sequence));
  return blake(Buffer.concat(parts), 'ZcashSequencHash');
}
function outputsHash(outputs: {value:number; scriptPubKey:Buffer}[]): Buffer {
  const parts: Buffer[] = [];
  for(const o of outputs){ parts.push(u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey); }
  return blake(Buffer.concat(parts), 'ZcashOutputsHash');
}

export function zip243Sighash(tx: {
  version: number;
  versionGroupId: number;
  consensusBranchId: number;
  lockTime: number;
  expiryHeight: number;
  inputs: { txid: string; vout: number; sequence: number; value: number; scriptPubKey: Buffer }[];
  outputs: { value: number; scriptPubKey: Buffer }[];
}, inputIndex: number): Buffer {
  const i = tx.inputs[inputIndex];
  const pre = Buffer.concat([
    u32le(tx.version), u32le(tx.versionGroupId),
    prevoutsHash(tx.inputs), sequenceHash(tx.inputs), outputsHash(tx.outputs),
    Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(32),
    u32le(tx.lockTime), u32le(tx.expiryHeight), u64le(0),
    u32le(1), // SIGHASH_ALL
    Buffer.from(i.txid,'hex').reverse(), u32le(i.vout),
    varint(i.scriptPubKey.length), i.scriptPubKey,
    u64le(i.value), u32le(i.sequence)
  ]);
  const pers = Buffer.alloc(16); Buffer.from('ZcashSigHash').copy(pers); u32le(tx.consensusBranchId).copy(pers,12);
  return Buffer.from(blake2b(pre, { dkLen: 32, personalization: pers }));
}

export async function getConsensusBranchId(tatumKey?: string): Promise<number> {
  const url = 'https://api.tatum.io/v3/blockchain/node/zcash-mainnet';
  const r = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json', 'x-api-key': tatumKey || process.env.TATUM_API_KEY || '' }, body: JSON.stringify({ jsonrpc:'2.0', method:'getblockchaininfo', id:1 }) });
  const j = await r.json();
  if (!j?.result?.consensus?.nextblock) throw new Error('Failed to fetch consensusBranchId');
  return parseInt(j.result.consensus.nextblock, 16);
}

export async function broadcastTransaction(hex: string, tatumKey?: string): Promise<string> {
  try {
    const r = await fetch('https://utxos.zerdinals.com/api/send-transaction', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ rawTransaction: hex }) });
    const j = await r.json(); if ((r.ok && (j.result || j.txid))) return j.result || j.txid;
  } catch(_) {}
  const r2 = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', { method:'POST', headers:{ 'Content-Type':'application/json', 'x-api-key': tatumKey || process.env.TATUM_API_KEY || '' }, body: JSON.stringify({ jsonrpc:'2.0', method:'sendrawtransaction', params:[hex], id:1 }) });
  const j2 = await r2.json(); if (j2.error) throw new Error(j2.error?.message || JSON.stringify(j2.error)); return j2.result;
}

export async function buildCommitTxHex(params: {
  utxo: Utxo;
  address: string;
  wif: string;
  inscriptionAmount: number;
  fee: number;
  consensusBranchId: number;
  redeemScript: Buffer;
  p2shScript: Buffer;
  platformFeeZats?: number;
  platformTreasuryAddress?: string;
}): Promise<{ hex: string; pubKey: Buffer }>{
  const priv = wifToPriv(params.wif);
  const pub = Buffer.from(await secp256k1.getPublicKey(priv, true));
  const pkh = addressToPkh(params.address);
  const inputs = [{ txid: params.utxo.txid, vout: params.utxo.vout, sequence: 0xfffffffd, value: params.utxo.value, scriptPubKey: buildP2PKHScript(pkh) }];
  const outputs: { value: number; scriptPubKey: Buffer }[] = [
    { value: params.inscriptionAmount, scriptPubKey: params.p2shScript }
  ];
  const platformFee = Math.max(0, params.platformFeeZats || 0);
  if (platformFee > 0) {
    const treasuryAddr = params.platformTreasuryAddress || '';
    const tPkh = treasuryAddr ? addressToPkh(treasuryAddr) : null;
    if (!tPkh) throw new Error('Platform fee enabled but no treasury address provided');
    outputs.push({ value: platformFee, scriptPubKey: buildP2PKHScript(tPkh) });
  }
  const change = params.utxo.value - params.inscriptionAmount - params.fee - platformFee;
  if (change > 546) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });
  const txData = { version: 0x80000004, versionGroupId: 0x892f2085, consensusBranchId: params.consensusBranchId, lockTime:0, expiryHeight:0, inputs, outputs };
  const sigHash = zip243Sighash(txData, 0);
  const sig = await secp256k1.sign(sigHash, priv);
  const der = signatureToDER(sig.toCompactRawBytes?sig.toCompactRawBytes():sig);
  const sigWithType = Buffer.concat([der, Buffer.from([0x01])]);
  const version = u32le(0x80000004), vgid = u32le(0x892f2085), inCount = varint(1);
  const prev = Buffer.from(params.utxo.txid,'hex').reverse(), vout = u32le(params.utxo.vout), seq = u32le(0xfffffffd);
  const scriptSig = Buffer.concat([ Buffer.from([sigWithType.length]), sigWithType, Buffer.from([pub.length]), pub ]);
  const scriptLen = varint(scriptSig.length);
  const outCount = varint(outputs.length);
  const outsBuf = Buffer.concat(outputs.map(o=>Buffer.concat([u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey])));
  const lock = u32le(0), exp = u32le(0), valBal = Buffer.alloc(8), nSS=Buffer.from([0x00]), nSO=Buffer.from([0x00]), nJS=Buffer.from([0x00]);
  const raw = Buffer.concat([ version, vgid, inCount, prev, vout, scriptLen, scriptSig, seq, outCount, outsBuf, lock, exp, valBal, nSS, nSO, nJS ]);
  return { hex: raw.toString('hex'), pubKey: pub };
}

export async function buildRevealTxHex(params: {
  commitTxid: string;
  address: string;
  wif: string;
  inscriptionAmount: number;
  fee: number;
  consensusBranchId: number;
  redeemScript: Buffer;
  inscriptionData: Buffer;
}): Promise<string> {
  const priv = wifToPriv(params.wif);
  const pkh = addressToPkh(params.address);
  const outputScript = buildP2PKHScript(pkh);
  const inputs = [{ txid: params.commitTxid, vout: 0, sequence: 0xffffffff, value: params.inscriptionAmount, scriptPubKey: params.redeemScript }];
  const outputs = [{ value: params.inscriptionAmount - params.fee, scriptPubKey: outputScript }];
  const txData = { version: 0x80000004, versionGroupId: 0x892f2085, consensusBranchId: params.consensusBranchId, lockTime:0, expiryHeight:0, inputs, outputs };
  const sigHash = zip243Sighash(txData, 0);
  const sig = await secp256k1.sign(sigHash, priv);
  const der = signatureToDER(sig.toCompactRawBytes?sig.toCompactRawBytes():sig);
  const sigWithType = Buffer.concat([der, Buffer.from([0x01])]);
  const version = u32le(0x80000004), vgid = u32le(0x892f2085), inCount = varint(1);
  const prev = Buffer.from(params.commitTxid,'hex').reverse(), vout = u32le(0), seq = u32le(0xffffffff);
  const scriptSig = Buffer.concat([ params.inscriptionData, Buffer.from([sigWithType.length]), sigWithType, Buffer.from([params.redeemScript.length]), params.redeemScript ]);
  const scriptLen = varint(scriptSig.length);
  const outCount = varint(1);
  const outBuf = Buffer.concat([u64le(params.inscriptionAmount - params.fee), varint(outputScript.length), outputScript]);
  const lock = u32le(0), exp = u32le(0), valBal = Buffer.alloc(8), nSS=Buffer.from([0x00]), nSO=Buffer.from([0x00]), nJS=Buffer.from([0x00]);
  const raw = Buffer.concat([ version, vgid, inCount, prev, vout, scriptLen, scriptSig, seq, outCount, outBuf, lock, exp, valBal, nSS, nSO, nJS ]);
  return raw.toString('hex');
}

export async function fetchUtxos(address: string){
  const r = await fetch(`https://utxos.zerdinals.com/api/utxos/${address}`);
  if (!r.ok) throw new Error('UTXO fetch failed');
  return r.json() as Promise<Utxo[]>;
}
export async function checkInscriptionAt(location: string){
  try{ const r = await fetch(`https://indexer.zerdinals.com/location/${location}`); if(r.status===404) return false; const j= await r.json(); if(j?.code===404) return false; return true; }catch(e){ throw new Error(`Indexer check failed for ${location}`); }
}

export function signatureToDER(sig64: Uint8Array): Buffer {
  const r = sig64.slice(0, 32);
  const s = sig64.slice(32, 64);
  const canon = (bytes: Uint8Array): Buffer => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0 && !(bytes[start + 1] & 0x80)) start++;
    if (bytes[start] & 0x80) return Buffer.concat([Buffer.from([0x00]), Buffer.from(bytes.slice(start))]);
    return Buffer.from(bytes.slice(start));
  };
  const n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const half = n / 2n;
  const rB = canon(r); let sB = canon(s);
  const sV = BigInt('0x' + sB.toString('hex'));
  if (sV > half) sB = canon(Buffer.from((n - sV).toString(16).padStart(64, '0'), 'hex'));
  const body = Buffer.concat([Buffer.from([0x02, rB.length]), rB, Buffer.from([0x02, sB.length]), sB]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}
