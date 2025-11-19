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
export function base64ToBytes(base64: string): Uint8Array {
  // Remove whitespace and handle URL-safe base64
  const cleaned = base64.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  const padded = cleaned + '=='.slice(0, (4 - (cleaned.length % 4)) % 4);
  // Decode using Buffer (available in Convex Node runtime)
  return new Uint8Array(Buffer.from(padded, 'base64'));
}
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
  const body = (typeof data === 'string' ? utf8(data) : data);
  const chunks: (Uint8Array|number)[] = [utf8("ord"), 0x51, utf8(contentType), 0x00];

  // Split data into 520-byte chunks (MAX_SCRIPT_ELEMENT_SIZE)
  const MAX_CHUNK = 520;
  for (let i = 0; i < body.length; i += MAX_CHUNK) {
    chunks.push(body.slice(i, i + MAX_CHUNK));
  }

  return chunks;
}

export function pushData(data: Uint8Array): Uint8Array {
  const len = data.length;
  if (len <= 75) {
    return concatBytes([new Uint8Array([len]), data]);
  } else if (len <= 0xff) {
    return concatBytes([new Uint8Array([0x4c, len]), data]);
  } else if (len <= 0xffff) {
    const lenBuf = new Uint8Array(2);
    new DataView(lenBuf.buffer).setUint16(0, len, true);
    return concatBytes([new Uint8Array([0x4d]), lenBuf, data]);
  } else {
    const lenBuf = new Uint8Array(4);
    new DataView(lenBuf.buffer).setUint32(0, len, true);
    return concatBytes([new Uint8Array([0x4e]), lenBuf, data]);
  }
}

export function buildInscriptionDataBuffer(content: string | Uint8Array, contentType: string): Uint8Array {
  const body = (typeof content === 'string') ? utf8(content) : content;
  const mime = utf8(contentType);

  // Ordinals envelope format (as used by Zerdinals):
  // OP_PUSH "ord" | OP_1 | OP_PUSH <mime> | OP_0 | OP_PUSH <content>
  // Note: For numbers 0-16, Bitcoin script requires using OP_0 through OP_16 (0x00-0x60)
  // to satisfy SCRIPT_VERIFY_MINIMALDATA. OP_1 = 0x51, OP_0 = 0x00.
  const parts = [
    pushData(utf8("ord")),
    new Uint8Array([0x51]),  // OP_1 (content type tag)
    pushData(mime),
    new Uint8Array([0x00])   // OP_0 (content tag)
  ];

  // For content < 520 bytes, use single push (Zerdinals standard format)
  // For larger content, split into 520-byte chunks (MAX_SCRIPT_ELEMENT_SIZE)
  const MAX_CHUNK = 520;
  if (body.length < MAX_CHUNK) {
    // Single push for small content (standard Zerdinals format)
    parts.push(pushData(body));
  } else {
    // Chunked format for larger content
    for (let i = 0; i < body.length; i += MAX_CHUNK) {
      parts.push(pushData(body.slice(i, i + MAX_CHUNK)));
    }
  }

  return concatBytes(parts);
}

// Cross-runtime safe timeout signal helper. Falls back if AbortSignal.timeout is unavailable.
function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    const anyAbort: any = AbortSignal as any;
    if (anyAbort && typeof anyAbort.timeout === 'function') {
      return anyAbort.timeout(ms);
    }
  } catch {}
  try {
    const ac = new AbortController();
    const id = setTimeout(() => ac.abort(), ms);
    // Clear timeout on abort to avoid leaks
    ac.signal.addEventListener('abort', () => clearTimeout(id), { once: true });
    return ac.signal;
  } catch {}
  // If we cannot construct a signal, return undefined (no timeout)
  return undefined;
}

// Tolerant txid extraction: accepts nested JSON or plain text bodies containing a 64-hex txid.
function is64Hex(v: any): v is string {
  return typeof v === 'string' && /^[0-9a-fA-F]{64}$/.test(v);
}
function findTxidDeep(o: any): string | null {
  if (o == null) return null;
  if (is64Hex(o)) return o;
  if (Array.isArray(o)) {
    for (const it of o) { const f = findTxidDeep(it); if (f) return f; }
    return null;
  }
  if (typeof o === 'object') {
    const candidates = ['txid', 'txId', 'result', 'data', 'hash', 'transaction_hash', 'tx_hash', 'transactionId'];
    for (const k of candidates) {
      if (k in o) { const f = findTxidDeep(o[k]); if (f) return f; }
    }
    for (const k of Object.keys(o)) { const f = findTxidDeep(o[k]); if (f) return f; }
  }
  return null;
}
async function extractTxidFromResponse(provider: string, r: Response): Promise<{ txid: string | null; snippet: string; ct: string; status: number }>{
  const ct = r.headers.get('content-type') || '';
  const text = await r.text();
  const snippet = text.slice(0, 240).replace(/[\n\r\t]+/g, ' ');
  try {
    const j = JSON.parse(text);
    const deep = findTxidDeep(j);
    if (deep) {
      console.log(`[broadcast][${provider}] parsed txid from JSON`, { status: r.status, ct, txid: deep.slice(0, 16) + '…' });
      return { txid: deep, snippet, ct, status: r.status };
    }
  } catch {}
  const m = text.match(/[0-9a-fA-F]{64}/);
  if (m) {
    console.log(`[broadcast][${provider}] extracted txid via regex`, { status: r.status, ct, txid: m[0].slice(0, 16) + '…' });
    return { txid: m[0], snippet, ct, status: r.status };
  }
  console.warn(`[broadcast][${provider}] no txid in response`, { status: r.status, ct, snippet });
  return { txid: null, snippet, ct, status: r.status };
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

// Cache the consensusBranchId in-memory to avoid hammering RPC and hitting provider limits
let _cachedBranchId: { value: number; expiresAt: number } | null = null;
const BRANCH_ID_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Obtain the current Zcash consensus branch ID with caching and fallbacks.
 * - Caches value for 10 minutes to avoid provider rate limits.
 * - Verifies JSON Content-Type before parsing (guards against HTML error pages).
 * - Falls back to env override `ZCASH_CONSENSUS_BRANCH_ID` if RPC is blocked.
 */
export async function getConsensusBranchId(tatumKey?: string): Promise<number> {
  const now = Date.now();
  if (_cachedBranchId && _cachedBranchId.expiresAt > now) {
    return _cachedBranchId.value;
  }
  const url = 'https://api.tatum.io/v3/blockchain/node/zcash-mainnet';
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': tatumKey || process.env.TATUM_API_KEY || ''
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'getblockchaininfo', id: 1 })
    });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.includes('application/json')) {
      throw new Error(`Unexpected response (${r.status})`);
    }
    const j = await r.json();
    const hex: string | undefined = j?.result?.consensus?.nextblock || j?.result?.consensus?.branchid;
    const value = typeof hex === 'string'
      ? parseInt(hex.startsWith('0x') ? hex.slice(2) : hex, 16)
      : NaN;
    if (!Number.isFinite(value)) throw new Error('Malformed consensus data');
    _cachedBranchId = { value, expiresAt: now + BRANCH_ID_TTL_MS };
    return value;
  } catch (_) {
    // Secondary fallback: try REST-style explorers for getblockchaininfo
    const restCandidates: string[] = [];
    const restBase = process.env.NEXT_PUBLIC_ZCASH_RPC_URL || '';
    if (restBase) restCandidates.push(restBase.replace(/\/$/, '') + '/getblockchaininfo');
    // Known public explorer (best-effort)
    restCandidates.push('https://mainnet.zcashexplorer.app/api/getblockchaininfo');
    for (const restUrl of restCandidates) {
      try {
        const r = await fetch(restUrl);
        const ct = r.headers.get('content-type') || '';
        if (!r.ok || !ct.includes('application/json')) continue;
        const j = await r.json();
        const pick = (obj: any): string | undefined => {
          const c1 = obj?.result?.consensus?.nextblock;
          const c2 = obj?.result?.consensus?.branchid;
          const c3 = obj?.consensus?.nextblock;
          const c4 = obj?.consensus?.branchid;
          if (typeof c1 === 'string') return c1;
          if (typeof c2 === 'string') return c2;
          if (typeof c3 === 'string') return c3;
          if (typeof c4 === 'string') return c4;
          // Try upgrades structure
          const upgrades = obj?.result?.upgrades || obj?.upgrades;
          if (upgrades && typeof upgrades === 'object') {
            // Prefer NU5 if present, else take the last upgrade object
            const nu5 = upgrades.NU5 || upgrades.nu5;
            if (nu5?.branchid) return nu5.branchid;
            const keys = Object.keys(upgrades);
            if (keys.length) {
              const last = upgrades[keys[keys.length - 1]];
              if (last?.branchid) return last.branchid;
            }
          }
          return undefined;
        };
        const hex = pick(j);
        if (hex) {
          const val = hex.startsWith('0x') ? parseInt(hex.slice(2), 16) : parseInt(hex, 16);
          if (Number.isFinite(val)) {
            _cachedBranchId = { value: val, expiresAt: now + BRANCH_ID_TTL_MS };
            return val;
          }
        }
      } catch {}
    }

    // Fallback to env override if provided
    const envHex = process.env.ZCASH_CONSENSUS_BRANCH_ID || process.env.NEXT_PUBLIC_ZCASH_CONSENSUS_BRANCH_ID;
    if (envHex) {
      const val = envHex.startsWith('0x') ? parseInt(envHex.slice(2), 16) : Number(envHex);
      if (Number.isFinite(val)) {
        _cachedBranchId = { value: val, expiresAt: now + BRANCH_ID_TTL_MS };
        return val;
      }
    }
    // Last-resort constant for Zcash mainnet (NU5)
    const NU5_MAINNET = 0xf919a198;
    _cachedBranchId = { value: NU5_MAINNET, expiresAt: now + BRANCH_ID_TTL_MS };
    return NU5_MAINNET;
  }
}

export async function broadcastTransaction(hex: string, tatumKey?: string): Promise<string> {
  const SIGNAL = timeoutSignal(8000);
  const errors: string[] = [];

  // 1) Zerdinals helper relay (previous default) — most likely to accept reveal immediately
  //    after commit because it sees the commit right away. We use this as the first option
  //    to restore prior reliability during ongoing fee/platform changes.
  try {
    const r = await fetch('https://utxos.zerdinals.com/api/send-transaction', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawTransaction: hex }), signal: SIGNAL
    });
    if (r.ok) {
      const { txid, snippet } = await extractTxidFromResponse('zerdinals', r);
      if (txid) return txid;
      errors.push(`zerdinals: ${snippet}`);
    } else {
      const text = await r.text().catch(() => 'unknown error');
      errors.push(`zerdinals(${r.status}): ${text.slice(0, 200)}`);
    }
  } catch (e: any) {
    errors.push(`zerdinals: ${e?.message || 'network error'}`);
  }

  // 3) Tatum JSON-RPC fallback
  try {
    const r = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': tatumKey || process.env.TATUM_API_KEY || '' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'sendrawtransaction', params: [hex], id: 1 }),
      signal: SIGNAL,
    });
    if (r.ok) {
      const { txid, snippet } = await extractTxidFromResponse('tatum', r);
      if (txid) return txid;
      errors.push(`tatum: ${snippet}`);
    } else {
      const text = await r.text().catch(() => 'unknown error');
      errors.push(`tatum(${r.status}): ${text.slice(0, 200)}`);
    }
  } catch (e: any) {
    errors.push(`tatum: ${e?.message || 'network error'}`);
  }

  // 4) Blockchair push (if available)
  try {
    const key = process.env.BLOCKCHAIR_API_KEY;
    const url = key
      ? `https://api.blockchair.com/zcash/push/transaction?key=${key}`
      : `https://api.blockchair.com/zcash/push/transaction`;
    const body = new URLSearchParams({ data: hex });
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: SIGNAL });
    if (r.ok) {
      const { txid, snippet } = await extractTxidFromResponse('blockchair', r);
      if (txid) return txid;
      errors.push(`blockchair: ${snippet}`);
    } else {
      const text = await r.text().catch(() => 'unknown error');
      errors.push(`blockchair(${r.status}): ${text.slice(0, 200)}`);
    }
  } catch (e: any) {
    errors.push(`blockchair: ${e?.message || 'network error'}`);
  }

  // Log all provider errors for debugging
  console.error('[broadcast] All providers failed:', errors);

  // Try to extract a meaningful error message for the user
  const errorMsg = errors.join(' | ');
  if (errorMsg.includes('scriptsig-not-pushonly')) {
    throw new Error('Transaction rejected: Invalid script format. Please try again or contact support.');
  }
  if (errorMsg.includes('unpaid action') || errorMsg.includes('insufficient fee')) {
    throw new Error('Transaction fee too low. Please increase the fee and try again.');
  }
  if (errorMsg.includes('missing inputs') || errorMsg.includes('bad-txns-inputs-missingorspent')) {
    throw new Error('Transaction inputs unavailable. Please wait a moment and try again.');
  }

  throw new Error(`Broadcast failed. Network response: ${errors[0] || 'Unknown error'}`);
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

// Exact pre-change provider order: Blockchair first, fallback to Zerdinals helper.
export async function fetchUtxos(address: string): Promise<Utxo[]> {
  // Blockchair first
  try {
    const key = process.env.BLOCKCHAIR_API_KEY;
    const url = key
      ? `https://api.blockchair.com/zcash/dashboards/address/${address}?key=${key}`
      : `https://api.blockchair.com/zcash/dashboards/address/${address}`;
    const r = await fetch(url);
    if (r.ok) {
      const j: any = await r.json();
      const d = j?.data?.[address] || j?.data?.[Object.keys(j?.data || {})[0]];
      const utxoArr: any[] = d?.utxo || [];
      if (Array.isArray(utxoArr)) {
        const mapped: Utxo[] = utxoArr.map((u: any) => {
          const rawVal = (u?.value ?? u?.satoshis ?? u?.amount);
          let value: number;
          if (typeof rawVal === 'string') {
            const f = parseFloat(rawVal);
            if (!Number.isFinite(f)) value = 0;
            else if (rawVal.includes('.') || f < 1) value = Math.round(f * 1e8);
            else value = Math.round(f);
          } else if (typeof rawVal === 'number') {
            if (Number.isInteger(rawVal)) value = rawVal;
            else if (rawVal > 0 && rawVal < 1) value = Math.round(rawVal * 1e8);
            else value = Math.round(rawVal);
          } else {
            value = 0;
          }
          const vout = Number(u?.index ?? u?.vout ?? u?.n ?? 0);
          const txid = u?.transaction_hash || u?.txid || u?.hash || u?.tx_hash;
          return { txid, vout, value } as Utxo;
        }).filter((u: Utxo) => !!u.txid && Number.isFinite(u.vout) && Number.isFinite(u.value));
        if (mapped.length > 0) return mapped;
      }
    }
  } catch (_) {}
  // Fallback to Zerdinals helper service
  const r2 = await fetch(`https://utxos.zerdinals.com/api/utxos/${address}`);
  if (!r2.ok) throw new Error('UTXO fetch failed');
  return r2.json() as Promise<Utxo[]>;
}
// Check if a given outpoint is inscribed.
// Primary: Zerdinals indexer. Fallback: Heuristic check via raw transaction
// by scanning input script for the ASCII marker "ord" and treating vout 0 as inscribed.
export async function checkInscriptionAt(location: string){
  try {
    const r = await fetch(`https://indexer.zerdinals.com/location/${location}`);
    if (r.status === 404) return false;
    if (!r.ok) throw new Error(`indexer status ${r.status}`);
    const j = await r.json();
    if (j?.code === 404) return false;
    // Only trust explicit inscription indicators to avoid false positives
    const hasPositiveSignal = Boolean(
      j?.inscriptionId ||
      (Array.isArray(j?.inscriptions) && j.inscriptions.length > 0) ||
      (Array.isArray(j?.locations) && j.locations.length > 0) ||
      j?.inscribed === true
    );
    console.log(`[inscription-check] ${location} → ${hasPositiveSignal ? 'INSCRIBED' : 'clean'} (response keys: ${Object.keys(j || {}).join(', ')})`);
    return hasPositiveSignal;
  } catch (err) {
    console.log(`[inscription-check] ${location} → indexer failed, using fallback: ${err}`);
    // Fallback to on-node heuristic via Tatum RPC
    try {
      const [txid, voutStr] = location.split(":");
      const vout = parseInt(voutStr || "0", 10) || 0;
      const tatumKey = process.env.TATUM_API_KEY || "";
      const url = 'https://api.tatum.io/v3/blockchain/node/zcash-mainnet';
      const body = { jsonrpc:'2.0', method:'getrawtransaction', params:[txid, 1], id:1 };
      const r2 = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json', 'x-api-key': tatumKey }, body: JSON.stringify(body) });
      const j2 = await r2.json();
      const vins = j2?.result?.vin || [];
      // Reveal-style tx includes redeemScript in scriptSig (hex) containing 'ord'
      const hasOrd = vins.some((vin:any)=>{
        const hex: string = vin?.scriptSig?.hex || '';
        return typeof hex === 'string' && hex.toLowerCase().includes('6f7264'); // 'ord'
      });
      if (hasOrd && vout === 0) return true;
      return false;
    } catch {
      // Default to not inscribed when we cannot verify; UI still warns users, and our reveal construction
      // never consumes inscribed UTXOs created by our own flow.
      return false;
    }
  }
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

  // Use proper pushData for commit scriptSig elements
  const scriptSig = concatBytes([pushData(sigWithType), pushData(params.pubKey)]);
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
  const inputs = [{ txid: params.commitTxid, vout: 0, sequence: 0xfffffffd, value: params.inscriptionAmount, scriptPubKey: params.redeemScript }];
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

  console.log(`[asm] signatureRaw64: ${params.signatureRaw64.length} bytes`);
  console.log(`[asm] DER signature: ${der.length} bytes, with type: ${sigWithType.length} bytes`);
  console.log(`[asm] redeemScript: ${params.redeemScript.length} bytes`);

  const version = u32le(0x80000004), vgid = u32le(0x892f2085), inCount = varint(1);
  const prev = reverseBytes(hexToBytes(params.commitTxid)), vout = u32le(0), seq = u32le(0xfffffffd);

  // Build scriptSig for P2SH spend
  // inscriptionData is already a script fragment (not raw data) - it contains pushData ops for each chunk
  // When executed, it pushes 5 items to stack (for the 5 OP_DROPs in redeemScript)
  // Signature and redeemScript must be wrapped in pushData since they're data elements
  const sigPushed = pushData(sigWithType);
  const rsPushed = pushData(params.redeemScript);

  console.log(`[asm] pushData(sig): ${sigPushed.length} bytes (first 2: ${bytesToHex(sigPushed.slice(0,2))})`);
  console.log(`[asm] pushData(rs): ${rsPushed.length} bytes (first 2: ${bytesToHex(rsPushed.slice(0,2))})`);

  const scriptSig = concatBytes([
    params.inscriptionData,       // Already formatted script bytes (pushData ops inside)
    sigPushed,                    // Push signature (data)
    rsPushed                      // Push redeem script (data)
  ]);
  const scriptLen = varint(scriptSig.length);

  console.log(`[asm] scriptSig total: ${scriptSig.length} bytes, varint: ${bytesToHex(scriptLen)}`);

  const outCount = varint(1);
  const outValue = params.inscriptionAmount - params.fee;
  const outBuf = concatBytes([u64le(outValue), varint(outputScript.length), outputScript]);

  console.log(`[asm] output value: ${outValue} zats (${bytesToHex(u64le(outValue))})`);
  console.log(`[asm] output script: ${outputScript.length} bytes`);

  const lock = u32le(0), exp = u32le(0), valBal = new Uint8Array(8), nSS=new Uint8Array([0x00]), nSO=new Uint8Array([0x00]), nJS=new Uint8Array([0x00]);
  const raw = concatBytes([ version, vgid, inCount, prev, vout, scriptLen, scriptSig, seq, outCount, outBuf, lock, exp, valBal, nSS, nSO, nJS ]);

  console.log(`[asm] raw tx: ${raw.length} bytes`);
  console.log(`[asm] components: ver=4 vgid=4 in=1 prev=32 vout=4 scLen=${scriptLen.length} sc=${scriptSig.length} seq=4 outCnt=1 out=${outBuf.length} lock=4 exp=4 valBal=8 shields=3`);
  const expectedTotal = 4+4+1+32+4+scriptLen.length+scriptSig.length+4+1+outBuf.length+4+4+8+3;
  console.log(`[asm] expected total: ${expectedTotal}, actual: ${raw.length}`);

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

// Multi-input split sighashes (one per input)
export function buildSplitSighashes(params: {
  inputs: Utxo[];
  address: string;
  outputs: { value: number; scriptPubKey: Uint8Array }[];
  consensusBranchId: number;
}): Uint8Array[] {
  const pkh = addressToPkh(params.address);
  const inputs = params.inputs.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    sequence: 0xfffffffd,
    value: u.value,
    scriptPubKey: buildP2PKHScript(pkh),
  }));
  const txData = {
    version: 0x80000004,
    versionGroupId: 0x892f2085,
    consensusBranchId: params.consensusBranchId,
    lockTime: 0,
    expiryHeight: 0,
    inputs,
    outputs: params.outputs,
  };
  return inputs.map((_, idx) => zip243Sighash(txData as any, idx));
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

// Assemble a multi-input split transaction from raw 64-byte signatures (one per input)
export function assembleSplitTxHexMulti(params: {
  inputs: Utxo[];
  address: string;
  pubKey: Uint8Array;
  outputs: { value: number; scriptPubKey: Uint8Array }[];
  signaturesRaw64: Uint8Array[];
  consensusBranchId: number;
}): string {
  if (params.inputs.length !== params.signaturesRaw64.length) throw new Error('Signature count must match inputs');
  const pkh = addressToPkh(params.address);
  const derSigs = params.signaturesRaw64.map((s) => signatureToDER(s));
  const sigsWithType = derSigs.map((der) => concatBytes([der, new Uint8Array([0x01])]));

  const version = u32le(0x80000004);
  const vgid = u32le(0x892f2085);
  const inCount = varint(params.inputs.length);

  // Inputs buffer
  const inputsBuf = concatBytes(
    params.inputs.flatMap((u, i) => {
      const prev = reverseBytes(hexToBytes(u.txid));
      const vout = u32le(u.vout);
      const scriptSig = concatBytes([
        new Uint8Array([sigsWithType[i].length]), sigsWithType[i],
        new Uint8Array([params.pubKey.length]), params.pubKey,
      ]);
      const scriptLen = varint(scriptSig.length);
      const seq = u32le(0xfffffffd);
      return [prev, vout, scriptLen, scriptSig, seq];
    }) as Uint8Array[]
  );

  const outCount = varint(params.outputs.length);
  const outsBuf = concatBytes(params.outputs.map(o => concatBytes([u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey])));
  const lock = u32le(0), exp = u32le(0), valBal = new Uint8Array(8), nSS=new Uint8Array([0x00]), nSO=new Uint8Array([0x00]), nJS=new Uint8Array([0x00]);

  const raw = concatBytes([ version, vgid, inCount, inputsBuf, outCount, outsBuf, lock, exp, valBal, nSS, nSO, nJS ]);
  return bytesToHex(raw);
}
