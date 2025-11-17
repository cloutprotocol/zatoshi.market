/**
 * Ordinals Script Builder for Zcash Inscriptions
 * Implements Bitcoin Ordinals-style commit/reveal pattern
 */

import { hash160 } from './zip244';

/**
 * Variable-length integer encoding
 */
export function varint(n: number): Buffer {
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
 * Build Ordinals reveal script (Zerdinals format)
 * The actual script is: <pubkey> OP_CHECKSIGVERIFY OP_DROP(x5) OP_1
 * The inscription data goes in the scriptSig, not the script itself
 */
export function buildRevealScript(publicKey: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([publicKey.length]), // Push pubkey
    publicKey,
    Buffer.from([0xad]),             // OP_CHECKSIGVERIFY
    Buffer.from([0x75]),             // OP_DROP
    Buffer.from([0x75]),             // OP_DROP
    Buffer.from([0x75]),             // OP_DROP
    Buffer.from([0x75]),             // OP_DROP
    Buffer.from([0x75]),             // OP_DROP
    Buffer.from([0x51])              // OP_1 (OP_TRUE)
  ]);
}

/**
 * Build inscription data for scriptSig
 * Format: <ord> OP_1 <mime> OP_0 <content>
 */
export function buildInscriptionData(
  content: string,
  mimeType: string = 'text/plain'
): Buffer {
  const contentBytes = Buffer.from(content, 'utf8');
  const mimeBytes = Buffer.from(mimeType, 'utf8');

  return Buffer.concat([
    Buffer.from([0x03]),           // Push 3 bytes
    Buffer.from('ord', 'utf8'),    // "ord" marker
    Buffer.from([0x51]),           // OP_1 (content type tag)
    Buffer.from([mimeBytes.length]),
    mimeBytes,
    Buffer.from([0x00]),           // OP_0 (body separator)
    Buffer.from([contentBytes.length]),
    contentBytes
  ]);
}

/**
 * Build P2SH script from reveal script
 * Format: OP_HASH160 <20-byte-hash> OP_EQUAL
 */
export function buildP2SHScript(revealScript: Buffer): Buffer {
  const scriptHash = hash160(revealScript);

  return Buffer.concat([
    Buffer.from([0xa9]),           // OP_HASH160
    Buffer.from([0x14]),           // Push 20 bytes
    Buffer.from(scriptHash),
    Buffer.from([0x87])            // OP_EQUAL
  ]);
}

/**
 * Build P2PKH script
 * Format: OP_DUP OP_HASH160 <20-byte-hash> OP_EQUALVERIFY OP_CHECKSIG
 */
export function buildP2PKHScript(pubKeyHash: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0x76]),           // OP_DUP
    Buffer.from([0xa9]),           // OP_HASH160
    Buffer.from([0x14]),           // Push 20 bytes
    pubKeyHash,
    Buffer.from([0x88]),           // OP_EQUALVERIFY
    Buffer.from([0xac])            // OP_CHECKSIG
  ]);
}

/**
 * Build OP_RETURN script
 */
export function buildOpReturnScript(data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0x6a]),           // OP_RETURN
    Buffer.from([data.length]),
    data
  ]);
}
