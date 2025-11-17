import bs58check from "bs58check";
import { blake2b } from "@noble/hashes/blake2b";
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import * as secp256k1 from "@noble/secp256k1";
import { hmac } from "@noble/hashes/hmac";

// Ensure noble-secp256k1 has HMAC helpers available in this runtime
if (!secp256k1.etc.hmacSha256Sync) {
  secp256k1.etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) =>
    hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));
}
if (!secp256k1.etc.hmacSha256Async) {
  secp256k1.etc.hmacSha256Async = async (key: Uint8Array, ...msgs: Uint8Array[]) =>
    hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));
}

export type Utxo = { txid: string; vout: number; value: number };

// Uint8Array utilities
const TE = new TextEncoder();
export function utf8(s: string): Uint8Array { return TE.encode(s); }
export function hexToBytes(hex: string): Uint8Array {
  const h = hex.length % 2 === 0 ? hex : `0${hex}`;
  const arr = new Uint8Array(h.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(h.substr(i * 2, 2), 16);
  return arr;
}
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function reverseBytes(b: Uint8Array): Uint8Array { const c = new Uint8Array(b.length); for (let i=0;i<b.length;i++) c[i] = b[b.length-1-i]; return c; }
export function u32le(n: number): Uint8Array { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; }
export function u64le(n: number): Uint8Array { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; }
export function varint(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) { const b = new Uint8Array(3); b[0]=0xfd; new DataView(b.buffer).setUint16(1, n, true); return b; }
  const b = new Uint8Array(5); b[0]=0xfe; new DataView(b.buffer).setUint32(1, n, true); return b;
}

export function hash160(buf: Uint8Array): Uint8Array { return ripemd160(sha256(buf)); }

export function buildP2PKHScript(pkh: Uint8Array): Uint8Array {
  return concatBytes([new Uint8Array([0x76, 0xa9, 0x14]), pkh, new Uint8Array([0x88, 0xac])]);
}

export function buildInscriptionChunks(contentType: string, data: string | Uint8Array): (Uint8Array|number)[] {
  return [utf8("ord"), 0x51, utf8(contentType), 0x00, (typeof data === 'string' ? utf8(data) : data)];
}

export function buildInscriptionDataBuffer(content: string | Uint8Array, contentType: string): Uint8Array {
  const body = (typeof content === 'string') ? utf8(content) : content;
  const mime = utf8(contentType);
  return concatBytes([
    new Uint8Array([3]), utf8("ord"),
    new Uint8Array([0x51]),
    new Uint8Array([mime.length]), mime,
    new Uint8Array([0x00]),
    new Uint8Array([body.length]), body
  ]);
}

export function createRevealScript(pubKey: Uint8Array, inscriptionChunks: (Uint8Array|number)[]): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(new Uint8Array([pubKey.length]), pubKey);
  parts.push(new Uint8Array([0xad])); // OP_CHECKSIGVERIFY
  for (let i=0;i<inscriptionChunks.length;i++) parts.push(new Uint8Array([0x75]));
  parts.push(new Uint8Array([0x51])); // OP_TRUE
  return concatBytes(parts);
}

export function p2shFromRedeem(redeemScript: Uint8Array): { script: Uint8Array; hash: Uint8Array } {
  const h = hash160(redeemScript);
  const script = concatBytes([new Uint8Array([0xa9, 0x14]), h, new Uint8Array([0x87])]);
  return { script, hash: h };
}

export function wifToPriv(wif: string): Uint8Array {
  const d = bs58check.decode(wif) as unknown as Uint8Array;
  return d.slice(1, (d.length === 34 ? 33 : undefined));
}
export function addressToPkh(addr: string): Uint8Array {
  const d = bs58check.decode(addr) as unknown as Uint8Array;
  return d.slice(2);
}

function blake(data: Uint8Array, p: string): Uint8Array {
  return blake2b(data, { dkLen: 32, personalization: utf8(p) });
}
function prevoutsHash(inputs: {txid:string; vout:number; sequence:number}[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for(const i of inputs){ parts.push(reverseBytes(hexToBytes(i.txid)), u32le(i.vout)); }
  return blake(concatBytes(parts), 'ZcashPrevoutHash');
}
function sequenceHash(inputs: {txid:string; vout:number; sequence:number}[]): Uint8Array {
  const parts: Uint8Array[] = inputs.map(i=>u32le(i.sequence));
  return blake(concatBytes(parts), 'ZcashSequencHash');
}
function outputsHash(outputs: {value:number; scriptPubKey:Uint8Array}[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for(const o of outputs){ parts.push(u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey); }
  return blake(concatBytes(parts), 'ZcashOutputsHash');
}

export function zip243Sighash(tx: {
  version: number;
  versionGroupId: number;
  consensusBranchId: number;
  lockTime: number;
  expiryHeight: number;
  inputs: { txid: string; vout: number; sequence: number; value: number; scriptPubKey: Uint8Array }[];
  outputs: { value: number; scriptPubKey: Uint8Array }[];
}, inputIndex: number): Uint8Array {
  const i = tx.inputs[inputIndex];
  const pre = concatBytes([
    u32le(tx.version), u32le(tx.versionGroupId),
    prevoutsHash(tx.inputs), sequenceHash(tx.inputs), outputsHash(tx.outputs),
    new Uint8Array(32), new Uint8Array(32), new Uint8Array(32),
    u32le(tx.lockTime), u32le(tx.expiryHeight), u64le(0),
    u32le(1), // SIGHASH_ALL
    reverseBytes(hexToBytes(i.txid)), u32le(i.vout),
    varint(i.scriptPubKey.length), i.scriptPubKey,
    u64le(i.value), u32le(i.sequence)
  ]);
  const pers = new Uint8Array(16);
  const z = utf8('ZcashSigHash');
  pers.set(z.slice(0, 12), 0);
  pers.set(u32le(tx.consensusBranchId), 12);
  return blake2b(pre, { dkLen: 32, personalization: pers });
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
  redeemScript: Uint8Array;
  p2shScript: Uint8Array;
  platformFeeZats?: number;
  platformTreasuryAddress?: string;
}): Promise<{ hex: string; pubKey: Uint8Array }>{
  const priv = wifToPriv(params.wif);
  const pub = await secp256k1.getPublicKey(priv, true);
  const pkh = addressToPkh(params.address);
  const inputs = [{ txid: params.utxo.txid, vout: params.utxo.vout, sequence: 0xfffffffd, value: params.utxo.value, scriptPubKey: buildP2PKHScript(pkh) }];
  const outputs: { value: number; scriptPubKey: Uint8Array }[] = [
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
  const sigWithType = concatBytes([der, new Uint8Array([0x01])]);
  const version = u32le(0x80000004), vgid = u32le(0x892f2085), inCount = varint(1);
  const prev = reverseBytes(hexToBytes(params.utxo.txid)), vout = u32le(params.utxo.vout), seq = u32le(0xfffffffd);
  const scriptSig = concatBytes([ new Uint8Array([sigWithType.length]), sigWithType, new Uint8Array([pub.length]), pub ]);
  const scriptLen = varint(scriptSig.length);
  const outCount = varint(outputs.length);
  const outsBuf = concatBytes(outputs.map(o=>concatBytes([u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey])));
  const lock = u32le(0), exp = u32le(0), valBal = new Uint8Array(8), nSS=new Uint8Array([0x00]), nSO=new Uint8Array([0x00]), nJS=new Uint8Array([0x00]);
  const raw = concatBytes([ version, vgid, inCount, prev, vout, scriptLen, scriptSig, seq, outCount, outsBuf, lock, exp, valBal, nSS, nSO, nJS ]);
  return { hex: bytesToHex(raw), pubKey: pub };
}

export async function buildRevealTxHex(params: {
  commitTxid: string;
  address: string;
  wif: string;
  inscriptionAmount: number;
  fee: number;
  consensusBranchId: number;
  redeemScript: Uint8Array;
  inscriptionData: Uint8Array;
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
  const sigWithType = concatBytes([der, new Uint8Array([0x01])]);
  const version = u32le(0x80000004), vgid = u32le(0x892f2085), inCount = varint(1);
  const prev = reverseBytes(hexToBytes(params.commitTxid)), vout = u32le(0), seq = u32le(0xffffffff);
  const scriptSig = concatBytes([ params.inscriptionData, new Uint8Array([sigWithType.length]), sigWithType, new Uint8Array([params.redeemScript.length]), params.redeemScript ]);
  const scriptLen = varint(scriptSig.length);
  const outCount = varint(1);
  const outBuf = concatBytes([u64le(params.inscriptionAmount - params.fee), varint(outputScript.length), outputScript]);
  const lock = u32le(0), exp = u32le(0), valBal = new Uint8Array(8), nSS=new Uint8Array([0x00]), nSO=new Uint8Array([0x00]), nJS=new Uint8Array([0x00]);
  const raw = concatBytes([ version, vgid, inCount, prev, vout, scriptLen, scriptSig, seq, outCount, outBuf, lock, exp, valBal, nSS, nSO, nJS ]);
  return bytesToHex(raw);
}

export async function fetchUtxos(address: string){
  const r = await fetch(`https://utxos.zerdinals.com/api/utxos/${address}`);
  if (!r.ok) throw new Error('UTXO fetch failed');
  return r.json() as Promise<Utxo[]>;
}
export async function checkInscriptionAt(location: string){
  try{ const r = await fetch(`https://indexer.zerdinals.com/location/${location}`); if(r.status===404) return false; const j= await r.json(); if(j?.code===404) return false; return true; }catch(e){ throw new Error(`Indexer check failed for ${location}`); }
}

export function signatureToDER(sig64: Uint8Array): Uint8Array {
  const r = sig64.slice(0, 32);
  const s = sig64.slice(32, 64);
  const canon = (bytes: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0 && !(bytes[start + 1] & 0x80)) start++;
    if (bytes[start] & 0x80) return concatBytes([new Uint8Array([0x00]), bytes.slice(start)]);
    return bytes.slice(start);
  };
  const n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const half = n / 2n;
  const rB = canon(r); let sB = canon(s);
  const sV = BigInt('0x' + bytesToHex(sB));
  if (sV > half) sB = canon(hexToBytes((n - sV).toString(16).padStart(64, '0')));
  const body = concatBytes([new Uint8Array([0x02, rB.length]), rB, new Uint8Array([0x02, sB.length]), sB]);
  return concatBytes([new Uint8Array([0x30, body.length]), body]);
}

// Helpers for client-side signing flow
export function buildCommitSighash(params: {
  utxo: Utxo;
  address: string;
  inscriptionAmount: number;
  fee: number;
  consensusBranchId: number;
  p2shScript: Uint8Array;
  platformFeeZats?: number;
  platformTreasuryAddress?: string;
}): Uint8Array {
  const pkh = addressToPkh(params.address);
  const inputs = [{ txid: params.utxo.txid, vout: params.utxo.vout, sequence: 0xfffffffd, value: params.utxo.value, scriptPubKey: buildP2PKHScript(pkh) }];
  const outputs: { value: number; scriptPubKey: Uint8Array }[] = [ { value: params.inscriptionAmount, scriptPubKey: params.p2shScript } ];
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
  return zip243Sighash(txData, 0);
}

export function assembleCommitTxHex(params: {
  utxo: Utxo;
  address: string;
  pubKey: Uint8Array;
  signatureRaw64: Uint8Array;
  inscriptionAmount: number;
  fee: number;
  consensusBranchId: number;
  p2shScript: Uint8Array;
  platformFeeZats?: number;
  platformTreasuryAddress?: string;
}): string {
  const pkh = addressToPkh(params.address);
  const outputs: { value: number; scriptPubKey: Uint8Array }[] = [ { value: params.inscriptionAmount, scriptPubKey: params.p2shScript } ];
  const platformFee = Math.max(0, params.platformFeeZats || 0);
  if (platformFee > 0) {
    const treasuryAddr = params.platformTreasuryAddress || '';
    const tPkh = treasuryAddr ? addressToPkh(treasuryAddr) : null;
    if (!tPkh) throw new Error('Platform fee enabled but no treasury address provided');
    outputs.push({ value: platformFee, scriptPubKey: buildP2PKHScript(tPkh) });
  }
  const change = params.utxo.value - params.inscriptionAmount - params.fee - platformFee;
  if (change > 546) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });

  const der = signatureToDER(params.signatureRaw64);
  const sigWithType = concatBytes([der, new Uint8Array([0x01])]);
  const version = u32le(0x80000004), vgid = u32le(0x892f2085), inCount = varint(1);
  const prev = reverseBytes(hexToBytes(params.utxo.txid)), vout = u32le(params.utxo.vout), seq = u32le(0xfffffffd);
  const scriptSig = concatBytes([ new Uint8Array([sigWithType.length]), sigWithType, new Uint8Array([params.pubKey.length]), params.pubKey ]);
  const scriptLen = varint(scriptSig.length);
  const outCount = varint(outputs.length);
  const outsBuf = concatBytes(outputs.map(o=>concatBytes([u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey])));
  const lock = u32le(0), exp = u32le(0), valBal = new Uint8Array(8), nSS=new Uint8Array([0x00]), nSO=new Uint8Array([0x00]), nJS=new Uint8Array([0x00]);
  const raw = concatBytes([ version, vgid, inCount, prev, vout, scriptLen, scriptSig, seq, outCount, outsBuf, lock, exp, valBal, nSS, nSO, nJS ]);
  return bytesToHex(raw);
}

export function buildRevealSighash(params: {
  commitTxid: string;
  address: string;
  inscriptionAmount: number;
  fee: number;
  consensusBranchId: number;
  redeemScript: Uint8Array;
}): Uint8Array {
  const pkh = addressToPkh(params.address);
  const outputScript = buildP2PKHScript(pkh);
  const inputs = [{ txid: params.commitTxid, vout: 0, sequence: 0xffffffff, value: params.inscriptionAmount, scriptPubKey: params.redeemScript }];
  const outputs = [{ value: params.inscriptionAmount - params.fee, scriptPubKey: outputScript }];
  const txData = { version: 0x80000004, versionGroupId: 0x892f2085, consensusBranchId: params.consensusBranchId, lockTime:0, expiryHeight:0, inputs, outputs };
  return zip243Sighash(txData, 0);
}

export function assembleRevealTxHex(params: {
  commitTxid: string;
  address: string;
  redeemScript: Uint8Array;
  inscriptionAmount: number;
  fee: number;
  inscriptionData: Uint8Array;
  signatureRaw64: Uint8Array;
  consensusBranchId: number;
}): string {
  const pkh = addressToPkh(params.address);
  const outputScript = buildP2PKHScript(pkh);
  const der = signatureToDER(params.signatureRaw64);
  const sigWithType = concatBytes([der, new Uint8Array([0x01])]);
  const version = u32le(0x80000004), vgid = u32le(0x892f2085), inCount = varint(1);
  const prev = reverseBytes(hexToBytes(params.commitTxid)), vout = u32le(0), seq = u32le(0xffffffff);
  const scriptSig = concatBytes([ params.inscriptionData, new Uint8Array([sigWithType.length]), sigWithType, new Uint8Array([params.redeemScript.length]), params.redeemScript ]);
  const scriptLen = varint(scriptSig.length);
  const outCount = varint(1);
  const outBuf = concatBytes([u64le(params.inscriptionAmount - params.fee), varint(outputScript.length), outputScript]);
  const lock = u32le(0), exp = u32le(0), valBal = new Uint8Array(8), nSS=new Uint8Array([0x00]), nSO=new Uint8Array([0x00]), nJS=new Uint8Array([0x00]);
  const raw = concatBytes([ version, vgid, inCount, prev, vout, scriptLen, scriptSig, seq, outCount, outBuf, lock, exp, valBal, nSS, nSO, nJS ]);
  return bytesToHex(raw);
}

// Split UTXOs helpers (client-signing)
export function buildSplitSighash(params: {
  utxo: Utxo;
  address: string;
  outputs: { value: number; scriptPubKey: Uint8Array }[];
  consensusBranchId: number;
}): Uint8Array {
  const pkh = addressToPkh(params.address);
  const inputs = [{ txid: params.utxo.txid, vout: params.utxo.vout, sequence: 0xfffffffd, value: params.utxo.value, scriptPubKey: buildP2PKHScript(pkh) }];
  const outputs = params.outputs;
  const txData = { version: 0x80000004, versionGroupId: 0x892f2085, consensusBranchId: params.consensusBranchId, lockTime:0, expiryHeight:0, inputs, outputs };
  return zip243Sighash(txData, 0);
}

export function assembleSplitTxHex(params: {
  utxo: Utxo;
  address: string;
  pubKey: Uint8Array;
  outputs: { value: number; scriptPubKey: Uint8Array }[];
  signatureRaw64: Uint8Array;
  consensusBranchId: number;
}): string {
  const pkh = addressToPkh(params.address);
  const der = signatureToDER(params.signatureRaw64);
  const sigWithType = concatBytes([der, new Uint8Array([0x01])]);
  const version = u32le(0x80000004), vgid = u32le(0x892f2085), inCount = varint(1);
  const prev = reverseBytes(hexToBytes(params.utxo.txid)), vout = u32le(params.utxo.vout), seq = u32le(0xfffffffd);
  const scriptSig = concatBytes([ new Uint8Array([sigWithType.length]), sigWithType, new Uint8Array([params.pubKey.length]), params.pubKey ]);
  const scriptLen = varint(scriptSig.length);
  const outCount = varint(params.outputs.length);
  const outsBuf = concatBytes(params.outputs.map(o=>concatBytes([u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey])));
  const lock = u32le(0), exp = u32le(0), valBal = new Uint8Array(8), nSS=new Uint8Array([0x00]), nSO=new Uint8Array([0x00]), nJS=new Uint8Array([0x00]);
  const raw = concatBytes([ version, vgid, inCount, prev, vout, scriptLen, scriptSig, seq, outCount, outsBuf, lock, exp, valBal, nSS, nSO, nJS ]);
  return bytesToHex(raw);
}
