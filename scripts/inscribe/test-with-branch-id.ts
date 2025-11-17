/**
 * Test signature with consensus branch ID included
 * ZIP 243 requires this for Sapling transactions
 */

import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import bs58check from 'bs58check';

// Set up secp256k1
secp256k1.etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) =>
  hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));

const WALLET = {
  address: 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

// Consensus branch IDs for Zcash network upgrades
// Sapling: 0x76b809bb
// Blossom: 0x2bb40e60
// Heartwood: 0xf5b9230b
// Canopy: 0xe9ff75a6
// NU5: 0xc2d6d0b4 (current as of 2024)

const BRANCH_IDS = {
  sapling: 0x76b809bb,
  blossom: 0x2bb40e60,
  heartwood: 0xf5b9230b,
  canopy: 0xe9ff75a6,
  nu5: 0xc2d6d0b4
};

console.log('\n🔍 Zcash Consensus Branch IDs\n');
console.log('Sapling:   0x' + BRANCH_IDS.sapling.toString(16));
console.log('Blossom:   0x' + BRANCH_IDS.blossom.toString(16));
console.log('Heartwood: 0x' + BRANCH_IDS.heartwood.toString(16));
console.log('Canopy:    0x' + BRANCH_IDS.canopy.toString(16));
console.log('NU5:       0x' + BRANCH_IDS.nu5.toString(16));
console.log('\nNeed to determine which one is active at current block height\n');
