"use client";
import { Buffer } from 'buffer';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import bs58check from 'bs58check';
import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { randomBytes } from '@noble/hashes/utils';

// WIF helpers (Zcash t-addresses use Bitcoin WIF format with 0x80 version)
const WIF_VERSION = 0x80;
function encodeWIF(priv: Uint8Array, compressed = true, version = WIF_VERSION): string {
  const payload = Buffer.concat([
    Buffer.from([version]),
    Buffer.from(priv),
    ...(compressed ? [Buffer.from([0x01])] : []),
  ]);
  return bs58check.encode(payload);
}

function decodeWIF(wif: string): { privateKey: Uint8Array; compressed: boolean; version: number } {
  const payload = bs58check.decode(wif);
  if (payload[0] !== WIF_VERSION) throw new Error('Invalid WIF version');
  if (payload.length !== 33 && payload.length !== 34) throw new Error('Invalid WIF length');
  const compressed = payload.length === 34 && payload[payload.length - 1] === 0x01;
  const pk = payload.slice(1, 33);
  if (!secp.utils.isValidPrivateKey(pk)) throw new Error('Invalid private key');
  return { privateKey: pk, compressed, version: payload[0] };
}

export interface Wallet {
  address: string;
  privateKey: string;
  publicKey: string;
  mnemonic: string;
}

/**
 * Create Zcash t-address from public key hash
 * Zcash t-addresses use version bytes [0x1C, 0xB8] which produce 't1' prefix
 */
function createZcashAddress(publicKey: Buffer): string {
  // Browser-safe hashing using noble-hashes
  const h = sha256(publicKey);
  const r = ripemd160(h);

  // Zcash t-address version bytes: 0x1CB8 (produces 't1' prefix)
  const versionBytes = Buffer.from([0x1c, 0xb8]);
  const payload = Buffer.concat([versionBytes, Buffer.from(r)]);

  return bs58check.encode(payload);
}

/**
 * Generate a new Zcash wallet with mnemonic seed phrase
 */


// @ts-ignore
const bitcore = require('bitcore-lib-zcash');


/**
 * Generate a new Zcash wallet with mnemonic seed phrase
 * Uses BIP-44 standard derivation path for Zcash: m/44'/133'/0'/0/0
 */
export async function generateWallet(): Promise<Wallet> {
  // Generate 12-word mnemonic (128 bits entropy)
  const mnemonic = generateMnemonic(wordlist, 128);

  // Convert mnemonic to seed
  const seed = mnemonicToSeedSync(mnemonic);

  // Use bitcore-lib-zcash for HD derivation
  // Ensure seed is a Buffer
  const seedBuffer = Buffer.from(seed);
  const root = bitcore.HDPrivateKey.fromSeed(seedBuffer, bitcore.Networks.livenet);

  // Derive Zcash path: m/44'/133'/0'/0/0
  const child = root.derive("m/44'/133'/0'/0/0");

  // Get private key from the derived child
  const privKey = child.privateKey;

  // Get WIF (Wallet Import Format)
  const privateKey = privKey.toWIF();

  // Get public key
  const publicKey = privKey.publicKey.toString();

  // Generate Zcash transparent address
  const address = privKey.toAddress().toString();

  return {
    address,
    privateKey,
    publicKey,
    mnemonic,
  };
}

/**
 * Import wallet from mnemonic
 */
export async function importFromMnemonic(mnemonic: string): Promise<Wallet> {
  try {
    if (!validateMnemonic(mnemonic, wordlist)) {
      throw new Error('Invalid mnemonic phrase');
    }

    const seed = mnemonicToSeedSync(mnemonic);

    // Use bitcore-lib-zcash for HD derivation
    // Ensure seed is a Buffer
    const seedBuffer = Buffer.from(seed);
    const root = bitcore.HDPrivateKey.fromSeed(seedBuffer, bitcore.Networks.livenet);

    // Derive Zcash path: m/44'/133'/0'/0/0
    const child = root.derive("m/44'/133'/0'/0/0");

    // Get private key from the derived child
    const privKey = child.privateKey;

    // Get WIF (Wallet Import Format)
    const privateKey = privKey.toWIF();

    // Get public key
    const publicKey = privKey.publicKey.toString();

    // Generate Zcash transparent address
    const address = privKey.toAddress().toString();

    return {
      address,
      privateKey,
      publicKey,
      mnemonic,
    };
  } catch (error) {
    // Log only the message to avoid leaking sensitive data
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Wallet import failed:', msg);
    throw new Error('Failed to import wallet. Please check your seed phrase.');
  }
}

/**
 * Import wallet from private key (WIF)
 */
export async function importFromPrivateKey(privateKeyWIF: string): Promise<Omit<Wallet, 'mnemonic'>> {
  const { privateKey: pk, compressed } = decodeWIF(privateKeyWIF);
  const pub = secp.getPublicKey(pk, compressed !== false);
  const publicKey = Buffer.from(pub).toString('hex');
  const address = createZcashAddress(Buffer.from(pub));

  return {
    address,
    privateKey: privateKeyWIF,
    publicKey,
  };
}
