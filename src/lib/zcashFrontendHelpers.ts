import { Buffer } from 'buffer';
import { blake2b } from "@noble/hashes/blake2b";
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import * as secp256k1 from "@noble/secp256k1";
import { hmac } from "@noble/hashes/hmac";
import bs58check from 'bs58check';

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
export function reverseBytes(b: Uint8Array): Uint8Array { const c = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) c[i] = b[b.length - 1 - i]; return c; }
export function u32le(n: number): Uint8Array { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; }
export function u64le(n: number): Uint8Array { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; }
export function varint(n: number): Uint8Array {
    if (n < 0xfd) return new Uint8Array([n]);
    if (n <= 0xffff) { const b = new Uint8Array(3); b[0] = 0xfd; new DataView(b.buffer).setUint16(1, n, true); return b; }
    const b = new Uint8Array(5); b[0] = 0xfe; new DataView(b.buffer).setUint32(1, n, true); return b;
}

export function hash160(buf: Uint8Array): Uint8Array { return ripemd160(sha256(buf)); }

export function buildP2PKHScript(pkh: Uint8Array): Uint8Array {
    return concatBytes([new Uint8Array([0x76, 0xa9, 0x14]), pkh, new Uint8Array([0x88, 0xac])]);
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
function prevoutsHash(inputs: { txid: string; vout: number; sequence: number }[]): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const i of inputs) { parts.push(reverseBytes(hexToBytes(i.txid)), u32le(i.vout)); }
    return blake(concatBytes(parts), 'ZcashPrevoutHash');
}
function sequenceHash(inputs: { txid: string; vout: number; sequence: number }[]): Uint8Array {
    const parts: Uint8Array[] = inputs.map(i => u32le(i.sequence));
    return blake(concatBytes(parts), 'ZcashSequencHash');
}
function outputsHash(outputs: { value: number; scriptPubKey: Uint8Array }[]): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const o of outputs) { parts.push(u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey); }
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

// Build sighashes for multiple inputs (SIGHASH_ALL)
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

// Assemble a transaction from pre-built scriptSigs
export function assembleFinalTx(params: {
    inputs: { txid: string; vout: number; scriptSig: Uint8Array; sequence?: number }[];
    outputs: { value: number; scriptPubKey: Uint8Array }[];
    consensusBranchId: number;
    lockTime?: number;
}): string {
    const version = u32le(0x80000004);
    const vgid = u32le(0x892f2085);
    const inCount = varint(params.inputs.length);

    const inputsBuf = concatBytes(
        params.inputs.map((i) => {
            const prev = reverseBytes(hexToBytes(i.txid));
            const vout = u32le(i.vout);
            const scriptLen = varint(i.scriptSig.length);
            const seq = u32le(i.sequence ?? 0xfffffffd);
            return concatBytes([prev, vout, scriptLen, i.scriptSig, seq]);
        })
    );

    const outCount = varint(params.outputs.length);
    const outsBuf = concatBytes(
        params.outputs.map((o) =>
            concatBytes([u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey])
        )
    );

    const lock = u32le(params.lockTime ?? 0);
    const exp = u32le(0);
    const valBal = new Uint8Array(8);
    const nSS = new Uint8Array([0x00]);
    const nSO = new Uint8Array([0x00]);
    const nJS = new Uint8Array([0x00]);

    const raw = concatBytes([
        version,
        vgid,
        inCount,
        inputsBuf,
        outCount,
        outsBuf,
        lock,
        exp,
        valBal,
        nSS,
        nSO,
        nJS,
    ]);
    return bytesToHex(raw);
}
