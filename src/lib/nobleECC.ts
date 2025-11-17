"use client";
// Loader that prefers pure-JS noble backend and falls back to tiny-secp256k1 if installed
export async function loadECC(): Promise<any> {
  try {
    // Prefer a literal dynamic import to help Next.js bundler include it
    const secp = await import('@noble/secp256k1');
    const n: bigint = (secp as any).CURVE.n;

    const bytesToBigInt = (b: Uint8Array): bigint => {
      let result = BigInt(0);
      const BASE = BigInt(256);
      for (let i = 0; i < b.length; i++) {
        const byte = b[i];
        result = result * BASE + BigInt(byte);
      }
      return result;
    };

    const bigIntTo32Bytes = (i: bigint): Uint8Array => {
      const arr = new Uint8Array(32);
      let x = i;
      for (let idx = 31; idx >= 0; idx--) {
        arr[idx] = Number(x & BigInt(0xff));
        x >>= BigInt(8);
      }
      return arr;
    };

    const isPrivate = (d: Uint8Array): boolean => {
      if (!(d instanceof Uint8Array) || d.length !== 32) return false;
      const x = bytesToBigInt(d);
      return x > BigInt(0) && x < n;
    };

    const isPoint = (p: Uint8Array): boolean => {
      try { (secp as any).Point.fromHex(p); return true; } catch { return false; }
    };

    const pointFromScalar = (d: Uint8Array, compressed = true): Uint8Array | null => {
      if (!isPrivate(d)) return null;
      return (secp as any).getPublicKey(d, compressed);
    };

    const pointAddScalar = (Q: Uint8Array, tweak: Uint8Array, compressed = true): Uint8Array | null => {
      try {
        const P = (secp as any).Point.fromHex(Q);
        const T = (secp as any).Point.fromPrivateKey(tweak);
        const R = P.add(T);
        return R.toRawBytes(compressed);
      } catch { return null; }
    };

    const pointCompress = (Q: Uint8Array, compressed = true): Uint8Array | null => {
      try {
        const P = (secp as any).Point.fromHex(Q);
        return P.toRawBytes(compressed);
      } catch { return null; }
    };

    const privateAdd = (d: Uint8Array, tweak: Uint8Array): Uint8Array | null => {
      try {
        const a = bytesToBigInt(d);
        const t = bytesToBigInt(tweak);
        const sum = (a + t) % n;
        if (sum === BigInt(0)) return null;
        return bigIntTo32Bytes(sum);
      } catch { return null; }
    };

    const privateSub = (d: Uint8Array, tweak: Uint8Array): Uint8Array | null => {
      try {
        const a = bytesToBigInt(d);
        const t = bytesToBigInt(tweak);
        let diff = a - t;
        while (diff < BigInt(0)) diff += n;
        diff = diff % n;
        if (diff === BigInt(0)) return null;
        return bigIntTo32Bytes(diff);
      } catch { return null; }
    };

    const privateNegate = (d: Uint8Array): Uint8Array | null => {
      try {
        const a = bytesToBigInt(d);
        if (a <= BigInt(0) || a >= n) return null;
        const neg = (n - a) % n;
        if (neg === BigInt(0)) return null;
        return bigIntTo32Bytes(neg);
      } catch { return null; }
    };

    const sign = (h: Uint8Array, d: Uint8Array, extraEntropy?: Uint8Array): Uint8Array => {
      return (secp as any).signSync(h, d, { der: false, extraEntropy });
    };

    const verify = (sig: Uint8Array, h: Uint8Array, Q: Uint8Array): boolean => {
      try { return (secp as any).verify(sig, h, Q); } catch { return false; }
    };

    return {
      isPoint,
      isPrivate,
      pointFromScalar,
      pointAddScalar,
      pointCompress,
      privateAdd,
      privateSub,
      privateNegate,
      sign,
      verify,
    } as any;
  } catch {
    try {
      const tinyName = 'tiny-secp256k1';
      const tiny = await import(tinyName as any);
      return tiny as any;
    } catch {
      throw new Error('No ECC backend available. Install @noble/secp256k1 or tiny-secp256k1');
    }
  }
}
