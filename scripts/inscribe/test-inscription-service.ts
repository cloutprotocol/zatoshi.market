/**
 * Test the InscriptionService
 */

import { InscriptionService } from '../../src/services/InscriptionService';

const WALLET = {
  address: 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

async function testInscription() {
  console.log('\n🧪 Testing InscriptionService\n');
  console.log('═══════════════════════════════════════\n');

  try {
    const service = new InscriptionService();

    console.log('Creating "hello world" inscription...\n');

    const result = await service.createInscription(
      WALLET.privateKeyWIF,
      'hello world',
      'text/plain'
    );

    console.log('\n✅ SUCCESS!');
    console.log('═══════════════════════════════════════\n');
    console.log(`Commit TXID:      ${result.commitTxid}`);
    console.log(`Reveal TXID:      ${result.revealTxid}`);
    console.log(`Inscription ID:   ${result.inscriptionId}\n`);
    console.log(`Explorer:         https://zcashblockexplorer.com/transactions/${result.revealTxid}`);
    console.log(`Zerdinals:        https://zerdinals.com/inscription/${result.inscriptionId}\n`);

  } catch (error: any) {
    console.error('\n❌ FAILED\n');
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

testInscription();
