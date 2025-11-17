// Loader that prefers pure-JS noble backend and falls back to tiny-secp256k1 if installed
export async function loadECC(): Promise<any> {
  try {
    const nobleName = '@noble/secp256k1';
    const secp = await import(nobleName as any);
    const n: bigint = (secp as any).CURVE.n;

    const utils = (secp as any).utils;
    const hexToBytes = utils.hexToBytes as (hex: string) => Uint8Array;
    const isValidPrivateKey = utils.isValidPrivateKey as (d: Uint8Array) => boolean;

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
      let hex = i.toString(16);
      if (hex.length % 2) hex = '0' + hex;
      const len = hex.length / 2;
      const arr = new Uint8Array(32);
      const bytes = hexToBytes(hex);
      arr.set(bytes, 32 - len);
      return arr;
    };

    const isPrivate = (d: Uint8Array): boolean => {
      try { return isValidPrivateKey(d); } catch { return false; }
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
      privateAdd,
      privateSub,
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
