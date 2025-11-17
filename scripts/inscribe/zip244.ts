/**
 * ZIP 244 - Transaction Signature Validation for v5+ Transactions
 * Implements BLAKE2b-256 signature hashing for NU5/NU6
 */

import { blake2b } from '@noble/hashes/blake2b';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';

interface TransactionData {
  version: number;
  versionGroupId: number;
  consensusBranchId: number;
  lockTime: number;
  expiryHeight: number;
  inputs: Array<{
    txid: string;
    vout: number;
    sequence: number;
    value: number;
    scriptPubKey: Buffer;
  }>;
  outputs: Array<{
    value: number;
    scriptPubKey: Buffer;
  }>;
}

/**
 * Helper to concatenate byte arrays
 */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Write uint32 little-endian
 */
function writeUInt32LE(value: number): Uint8Array {
  const buffer = new Uint8Array(4);
  buffer[0] = value & 0xff;
  buffer[1] = (value >> 8) & 0xff;
  buffer[2] = (value >> 16) & 0xff;
  buffer[3] = (value >> 24) & 0xff;
  return buffer;
}

/**
 * Write uint64 little-endian
 */
function writeUInt64LE(value: number): Uint8Array {
  const buffer = new Uint8Array(8);
  const low = value & 0xffffffff;
  const high = Math.floor(value / 0x100000000);
  buffer[0] = low & 0xff;
  buffer[1] = (low >> 8) & 0xff;
  buffer[2] = (low >> 16) & 0xff;
  buffer[3] = (low >> 24) & 0xff;
  buffer[4] = high & 0xff;
  buffer[5] = (high >> 8) & 0xff;
  buffer[6] = (high >> 16) & 0xff;
  buffer[7] = (high >> 24) & 0xff;
  return buffer;
}

/**
 * Calculate header digest (ZIP 244)
 */
function getHeaderDigest(tx: TransactionData): Uint8Array {
  const data = concat(
    writeUInt32LE(tx.version),
    writeUInt32LE(tx.versionGroupId),
    writeUInt32LE(tx.consensusBranchId),
    writeUInt32LE(tx.lockTime),
    writeUInt32LE(tx.expiryHeight)
  );

  return blake2b(data, {
    dkLen: 32,
    personalization: Buffer.from('ZTxIdHeadersHash', 'utf8')
  });
}

/**
 * Calculate transparent prevouts digest
 */
function getTransparentPrevoutsDigest(tx: TransactionData): Uint8Array {
  const parts: Uint8Array[] = [];

  for (const input of tx.inputs) {
    // Reverse txid for little-endian
    const txidBytes = Buffer.from(input.txid, 'hex').reverse();
    parts.push(txidBytes);
    parts.push(writeUInt32LE(input.vout));
  }

  const data = concat(...parts);

  return blake2b(data, {
    dkLen: 32,
    personalization: Buffer.from('ZTxIdPrevoutHash', 'utf8')
  });
}

/**
 * Calculate transparent sequence digest
 */
function getTransparentSequenceDigest(tx: TransactionData): Uint8Array {
  const parts: Uint8Array[] = [];

  for (const input of tx.inputs) {
    parts.push(writeUInt32LE(input.sequence));
  }

  const data = concat(...parts);

  return blake2b(data, {
    dkLen: 32,
    personalization: Buffer.from('ZTxIdSequencHash', 'utf8')
  });
}

/**
 * Calculate transparent outputs digest
 */
function getTransparentOutputsDigest(tx: TransactionData): Uint8Array {
  const parts: Uint8Array[] = [];

  for (const output of tx.outputs) {
    parts.push(writeUInt64LE(output.value));
    parts.push(new Uint8Array([output.scriptPubKey.length]));
    parts.push(output.scriptPubKey);
  }

  const data = concat(...parts);

  return blake2b(data, {
    dkLen: 32,
    personalization: Buffer.from('ZTxIdOutputsHash', 'utf8')
  });
}

/**
 * Get signature hash for a transparent input (ZIP 244)
 */
export function getTransparentSignatureHash(
  tx: TransactionData,
  inputIndex: number
): Uint8Array {
  const input = tx.inputs[inputIndex];

  // 1. Header digest
  const headerDigest = getHeaderDigest(tx);

  // 2. Transparent digests
  const prevoutsDigest = getTransparentPrevoutsDigest(tx);
  const sequenceDigest = getTransparentSequenceDigest(tx);
  const outputsDigest = getTransparentOutputsDigest(tx);

  // 3. Combine transparent digests
  const transparentData = concat(
    prevoutsDigest,
    sequenceDigest,
    outputsDigest
  );

  const transparentDigest = blake2b(transparentData, {
    dkLen: 32,
    personalization: Buffer.from('ZTxIdTranspaHash', 'utf8')
  });

  // 4. Build signature hash preimage
  const txidBytes = Buffer.from(input.txid, 'hex').reverse();

  const preimage = concat(
    headerDigest,
    transparentDigest,
    new Uint8Array(32), // saplingDigest (empty)
    new Uint8Array(32), // orchardDigest (empty)
    writeUInt32LE(1),   // SIGHASH_ALL
    txidBytes,
    writeUInt32LE(input.vout),
    new Uint8Array([input.scriptPubKey.length]),
    input.scriptPubKey,
    writeUInt64LE(input.value),
    writeUInt32LE(input.sequence)
  );

  // 5. Final signature hash
  return blake2b(preimage, {
    dkLen: 32,
    personalization: Buffer.from('ZTxIdSigHash\0\0\0\0', 'utf8')
  });
}

/**
 * HASH160 (SHA256 then RIPEMD160)
 */
export function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}
