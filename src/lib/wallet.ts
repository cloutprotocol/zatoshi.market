"use client";
import * as bip39 from 'bip39';
import ECPairFactory from 'ecpair';
import bs58check from 'bs58check';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';

// Lazy-load ECC using noble adapter (pure JS)
async function getECPair() {
  const noble = await import('@/lib/nobleECC');
  const ecc = await (noble as any).loadECC();
  return ECPairFactory(ecc);
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
  // Generate 12-word mnemonic
  const mnemonic = bip39.generateMnemonic();

  // Convert mnemonic to seed
  const seed = bip39.mnemonicToSeedSync(mnemonic);

  // Create keypair (Zcash uses secp256k1 like Bitcoin)
  const ECPair = await getECPair();
  const keyPair = ECPair.fromPrivateKey(seed.slice(0, 32));

  // Get WIF private key (Zcash mainnet uses 0x80 prefix like Bitcoin)
  const privateKey = keyPair.toWIF();

  // Get public key
  const publicKey = Buffer.from(keyPair.publicKey).toString('hex');

  // Generate Zcash transparent address (t-address)
  const address = createZcashAddress(Buffer.from(keyPair.publicKey));

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
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const ECPair = await getECPair();
  const keyPair = ECPair.fromPrivateKey(seed.slice(0, 32));

  const privateKey = keyPair.toWIF();
  const publicKey = Buffer.from(keyPair.publicKey).toString('hex');
  const address = createZcashAddress(Buffer.from(keyPair.publicKey));

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
  const ECPair = await getECPair();
  const keyPair = ECPair.fromWIF(privateKeyWIF);
  const publicKey = Buffer.from(keyPair.publicKey).toString('hex');
  const address = createZcashAddress(Buffer.from(keyPair.publicKey));

  return {
    address,
    privateKey: privateKeyWIF,
    publicKey,
  };
}
