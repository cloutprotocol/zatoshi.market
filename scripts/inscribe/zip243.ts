/**
 * ZIP 243 - Transaction Signature Verification for v4 Sapling Transactions
 * Uses BLAKE2b-256 with consensus branch ID in personalization
 */

import { blake2b } from '@noble/hashes/blake2b';

interface TransactionData {
  version: number;
  versionGroupId: number;
  consensusBranchId: number; // Required for signature hash
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

function writeUInt32LE(value: number): Uint8Array {
  const buffer = new Uint8Array(4);
  buffer[0] = value & 0xff;
  buffer[1] = (value >> 8) & 0xff;
  buffer[2] = (value >> 16) & 0xff;
  buffer[3] = (value >> 24) & 0xff;
  return buffer;
}

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

function varint(n: number): Uint8Array {
  if (n < 0xfd) {
    return new Uint8Array([n]);
  } else if (n <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    buf[1] = n & 0xff;
    buf[2] = (n >> 8) & 0xff;
    return buf;
  } else {
    const buf = new Uint8Array(5);
    buf[0] = 0xfe;
    buf[1] = n & 0xff;
    buf[2] = (n >> 8) & 0xff;
    buf[3] = (n >> 16) & 0xff;
    buf[4] = (n >> 24) & 0xff;
    return buf;
  }
}

/**
 * Get prevouts hash (ZIP 243 - uses BLAKE2b)
 */
function getPrevoutsHash(tx: TransactionData): Uint8Array {
  const parts: Uint8Array[] = [];

  for (const input of tx.inputs) {
    const txidBytes = Buffer.from(input.txid, 'hex').reverse();
    parts.push(txidBytes);
    parts.push(writeUInt32LE(input.vout));
  }

  const data = concat(...parts);
  return blake2b(data, { dkLen: 32 });
}

/**
 * Get sequence hash (ZIP 243 - uses BLAKE2b)
 */
function getSequenceHash(tx: TransactionData): Uint8Array {
  const parts: Uint8Array[] = [];

  for (const input of tx.inputs) {
    parts.push(writeUInt32LE(input.sequence));
  }

  const data = concat(...parts);
  return blake2b(data, { dkLen: 32 });
}

/**
 * Get outputs hash (ZIP 243 - uses BLAKE2b)
 */
function getOutputsHash(tx: TransactionData): Uint8Array {
  const parts: Uint8Array[] = [];

  for (const output of tx.outputs) {
    parts.push(writeUInt64LE(output.value));
    parts.push(varint(output.scriptPubKey.length));
    parts.push(output.scriptPubKey);
  }

  const data = concat(...parts);
  return blake2b(data, { dkLen: 32 });
}

/**
 * Get signature hash for a transparent input (ZIP 243)
 * This is for v4 Sapling transactions
 */
export function getTransparentSignatureHashV4(
  tx: TransactionData,
  inputIndex: number,
  hashType: number = 1 // SIGHASH_ALL
): Uint8Array {
  const input = tx.inputs[inputIndex];

  // Build preimage (ZIP 243)
  const preimage = concat(
    // 1. Header
    writeUInt32LE(tx.version),             // Version (with overwintered flag)
    writeUInt32LE(tx.versionGroupId),      // Version group ID

    // 2. Prevouts, sequence, outputs hashes
    getPrevoutsHash(tx),                   // hashPrevouts
    getSequenceHash(tx),                   // hashSequence
    getOutputsHash(tx),                    // hashOutputs

    // 3. JoinSplits (empty for transparent-only)
    new Uint8Array(32),                    // hashJoinSplits
    new Uint8Array(32),                    // hashShieldedSpends
    new Uint8Array(32),                    // hashShieldedOutputs

    // 4. Transaction fields
    writeUInt32LE(tx.lockTime),            // nLockTime
    writeUInt32LE(tx.expiryHeight),        // expiryHeight
    writeUInt64LE(0),                      // valueBalance

    // 5. Hash type
    writeUInt32LE(hashType),               // nHashType

    // 6. Input being signed
    Buffer.from(input.txid, 'hex').reverse(), // prevout hash
    writeUInt32LE(input.vout),             // prevout index
    varint(input.scriptPubKey.length),     // scriptCode length
    input.scriptPubKey,                    // scriptCode
    writeUInt64LE(input.value),            // value
    writeUInt32LE(input.sequence)          // nSequence
  );

  // Create personalization: "ZcashSigHash" + consensus branch ID (4 bytes LE)
  const personalization = new Uint8Array(16);
  const baseStr = 'ZcashSigHash';
  for (let i = 0; i < baseStr.length; i++) {
    personalization[i] = baseStr.charCodeAt(i);
  }
  // Add consensus branch ID as little-endian
  const branchIdBytes = writeUInt32LE(tx.consensusBranchId);
  personalization.set(branchIdBytes, 12);

  // BLAKE2b-256 with personalization
  return blake2b(preimage, {
    dkLen: 32,
    personalization: Buffer.from(personalization)
  });
}
