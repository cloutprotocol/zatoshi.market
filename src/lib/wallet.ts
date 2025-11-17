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
export async function generateWallet(): Promise<Wallet> {
  // Generate 12-word mnemonic (128 bits entropy) using pure-JS libs
  const mnemonic = generateMnemonic(wordlist, 128);

  // Convert mnemonic to seed (Uint8Array)
  const seed = mnemonicToSeedSync(mnemonic);

  // Derive a private key from seed
  let priv = seed.subarray(0, 32);
  if (!secp.utils.isValidPrivateKey(priv)) {
    // fallback: hash the seed until valid
    let counter = 0;
    let bytes = seed;
    while (true) {
      bytes = sha256(Buffer.concat([Buffer.from(bytes), Buffer.from([counter++])]));
      priv = bytes.subarray(0, 32);
      if (secp.utils.isValidPrivateKey(priv)) break;
      if (counter > 5) throw new Error('Failed to derive a valid private key');
    }
  }

  // Get WIF private key (Zcash mainnet uses 0x80 prefix like Bitcoin)
  const privateKey = encodeWIF(priv, true);

  // Get public key
  const pub = secp.getPublicKey(priv, true);
  const publicKey = Buffer.from(pub).toString('hex');

  // Generate Zcash transparent address (t-address)
  const address = createZcashAddress(Buffer.from(pub));

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
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error('Invalid mnemonic phrase');
  }

  const seed = mnemonicToSeedSync(mnemonic);
  let priv = seed.subarray(0, 32);
  if (!secp.utils.isValidPrivateKey(priv)) {
    let counter = 0;
    let bytes = seed;
    while (true) {
      bytes = sha256(Buffer.concat([Buffer.from(bytes), Buffer.from([counter++])])) as any;
      priv = (bytes as Uint8Array).subarray(0, 32);
      if (secp.utils.isValidPrivateKey(priv)) break;
      if (counter > 5) throw new Error('Failed to derive a valid private key');
    }
  }

  const privateKey = encodeWIF(priv, true);
  const pub = secp.getPublicKey(priv, true);
  const publicKey = Buffer.from(pub).toString('hex');
  const address = createZcashAddress(Buffer.from(pub));

  return {
    address,
    privateKey,
    publicKey,
    mnemonic,
  };
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
