import bs58check from 'bs58check';

const WIF = 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q';

const decoded = bs58check.decode(WIF);
console.log('\n🔍 WIF Analysis\n');
console.log('WIF:', WIF);
console.log('Decoded bytes:', decoded.toString('hex'));
console.log('Version byte:', '0x' + decoded[0].toString(16));
console.log('Length:', decoded.length);

// Bitcoin mainnet compressed: 0x80 (128)
// Bitcoin testnet compressed: 0xef (239)
const versionByte = decoded[0];
if (versionByte === 0x80) {
  console.log('Network: ✅ Bitcoin/Zcash mainnet');
} else if (versionByte === 0xef) {
  console.log('Network: ⚠️  Testnet');
} else {
  console.log('Network: ❌ Unknown');
}

if (decoded.length === 34) {
  console.log('Compression: ✅ Compressed');
} else if (decoded.length === 33) {
  console.log('Compression: ❌ Uncompressed');
}

const privateKeyHex = decoded.slice(1, 33).toString('hex');
console.log('\nPrivate Key (hex):', privateKeyHex);
console.log();
