/**
 * Generate a new Zcash wallet for testing inscriptions
 */

import * as bitcore from 'bitcore-lib-zcash';

// Generate new private key
const privateKey = new bitcore.PrivateKey();
const address = privateKey.toAddress().toString();
const wif = privateKey.toWIF();

console.log('\n🔑 New Zcash Wallet Generated\n');
console.log('═══════════════════════════════════════');
console.log(`Address:     ${address}`);
console.log(`Private Key: ${wif}`);
console.log('═══════════════════════════════════════\n');

console.log('⚠️  IMPORTANT:');
console.log('  1. Save this private key securely');
console.log('  2. Send some ZEC to the address (>0.001 ZEC)');
console.log('  3. Wait for 1 confirmation');
console.log('  4. Use for inscription testing\n');

console.log('💰 Fund this wallet:');
console.log(`   Send 0.01 ZEC to: ${address}\n`);

console.log('📝 To create inscription:');
console.log(`   ./run-with-env.sh inscribe.ts "${address}" "hello world" "${wif}"\n`);
