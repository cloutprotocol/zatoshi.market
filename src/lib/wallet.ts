import * as bip39 from 'bip39';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import bs58check from 'bs58check';

const ECPair = ECPairFactory(ecc);

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
  const hash160 = require('crypto').createHash('sha256').update(publicKey).digest();
  const ripemd160 = require('crypto').createHash('ripemd160').update(hash160).digest();

  // Zcash t-address version bytes: 0x1CB8 (produces 't1' prefix)
  const versionBytes = Buffer.from([0x1C, 0xB8]);
  const payload = Buffer.concat([versionBytes, ripemd160]);

  return bs58check.encode(payload);
}

/**
 * Generate a new Zcash wallet with mnemonic seed phrase
 */
export function generateWallet(): Wallet {
  // Generate 12-word mnemonic
  const mnemonic = bip39.generateMnemonic();

  // Convert mnemonic to seed
  const seed = bip39.mnemonicToSeedSync(mnemonic);

  // Create keypair (Zcash uses secp256k1 like Bitcoin)
  const keyPair = ECPair.fromPrivateKey(seed.slice(0, 32));

  // Get WIF private key (Zcash mainnet uses 0x80 prefix like Bitcoin)
  const privateKey = keyPair.toWIF();

  // Get public key
  const publicKey = Buffer.from(keyPair.publicKey).toString('hex');

  // Generate Zcash transparent address (t-address)
  const address = createZcashAddress(keyPair.publicKey);

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
export function importFromMnemonic(mnemonic: string): Wallet {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const keyPair = ECPair.fromPrivateKey(seed.slice(0, 32));

  const privateKey = keyPair.toWIF();
  const publicKey = Buffer.from(keyPair.publicKey).toString('hex');
  const address = createZcashAddress(keyPair.publicKey);

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
export function importFromPrivateKey(privateKeyWIF: string): Omit<Wallet, 'mnemonic'> {
  const keyPair = ECPair.fromWIF(privateKeyWIF);
  const publicKey = Buffer.from(keyPair.publicKey).toString('hex');
  const address = createZcashAddress(keyPair.publicKey);

  return {
    address,
    privateKey: privateKeyWIF,
    publicKey,
  };
}
