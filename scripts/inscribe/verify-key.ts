import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import bs58check from 'bs58check';

const WIF = 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q';
const expectedAddress = 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x';

// Decode WIF
function decodeWIF(wif: string): Uint8Array {
  const decoded = bs58check.decode(wif);
  return decoded.slice(1, decoded.length === 34 ? 33 : undefined);
}

// Get address from private key
async function getAddress(privateKey: Uint8Array): Promise<string> {
  const publicKey = await secp256k1.getPublicKey(privateKey, true);
  const pubKeyHash = ripemd160(sha256(publicKey));

  // Zcash mainnet P2PKH version bytes: 0x1CB8
  const versionBytes = Buffer.from([0x1C, 0xB8]);
  const payload = Buffer.concat([versionBytes, Buffer.from(pubKeyHash)]);

  return bs58check.encode(payload);
}

(async () => {
  const privateKey = decodeWIF(WIF);
  const derivedAddress = await getAddress(privateKey);

  console.log('\n🔑 Key Verification\n');
  console.log('Private Key (WIF):', WIF);
  console.log('Expected Address:', expectedAddress);
  console.log('Derived Address:', derivedAddress);
  console.log('Match:', derivedAddress === expectedAddress ? '✅ YES' : '❌ NO');
  console.log();
})();
