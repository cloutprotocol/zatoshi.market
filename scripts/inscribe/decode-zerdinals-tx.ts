/**
 * Decode Zerdinals transactions to understand exact format
 */

const COMMIT_TX = '0400008085202f8901061530f1c5bdcfdaf8a224622e409fa2bc745b623207da735b1328fbc1c610f0020000006b483045022100b64e465f2177bc7d368cab8f4a62d12ac66a5940e6416129e4c35851643544db022068359c293fe01e666e46ad8b332825c4536b75f5c1cd0f9da61d030e0315f822012102ae86217e8e275ba60cedbcace0d7a9a4029b5b3df9788aed70a579f5f8215362fdffffff0560ea00000000000017a9142e12c4f03d19dbda53fedc5521db7d177dac14d08721f30000000000001976a914554965aa597a93de0ea124b04d815d5486cdf81688ac21f30000000000001976a914a2d7ad3b122ce538e3c6667861d759b962322e0b88ac21f30000000000001976a9141a5bb0f7b52c20e81cb23b4b398bfd1ffe5370f388acac820900000000001976a914a1748be68ef48742bb38bc46957f9c512c3f15e088ac00000000000000000000000000000000000000';

const REVEAL_TX = '0400008085202f890182d2d9ac699b9c6c14274c9466f943422f9ee014ec9b0a8c67c26b2f9599c7150000000090036f7264510a746578742f706c61696e000b7a61746f7368692e7a6563483045022100e857a151a664b2c508ce3277b685e40517bb4c4178f054a075694ef61e56cd180220525812c00331a13359adcc626ed50f050cfed468c5a13bd41c3caf5c3ae082cb01292102ae86217e8e275ba60cedbcace0d7a9a4029b5b3df9788aed70a579f5f8215362ad757575757551ffffffff0110270000000000001976a914a1748be68ef48742bb38bc46957f9c512c3f15e088ac00000000000000000000000000000000000000';

function decodeCommitTx(hex: string) {
  const buf = Buffer.from(hex, 'hex');
  let pos = 0;

  console.log('COMMIT TRANSACTION ANALYSIS');
  console.log('═══════════════════════════════════════\n');

  const version = buf.readUInt32LE(pos);
  pos += 4;
  console.log(`Version: 0x${version.toString(16)}`);

  const versionGroupId = buf.readUInt32LE(pos);
  pos += 4;
  console.log(`Version Group ID: 0x${versionGroupId.toString(16)}\n`);

  // Inputs
  const inputCount = buf[pos];
  pos += 1;
  console.log(`Input Count: ${inputCount}\n`);

  for (let i = 0; i < inputCount; i++) {
    const txid = buf.subarray(pos, pos + 32).reverse().toString('hex');
    pos += 32;
    const vout = buf.readUInt32LE(pos);
    pos += 4;
    const scriptSigLen = buf[pos];
    pos += 1;
    const scriptSig = buf.subarray(pos, pos + scriptSigLen);
    pos += scriptSigLen;
    const sequence = buf.readUInt32LE(pos);
    pos += 4;

    console.log(`Input ${i}:`);
    console.log(`  TXID: ${txid}`);
    console.log(`  VOUT: ${vout}`);
    console.log(`  ScriptSig Length: ${scriptSigLen}`);
    console.log(`  ScriptSig: ${scriptSig.toString('hex')}`);
    console.log(`  Sequence: 0x${sequence.toString(16)}\n`);
  }

  // Outputs
  const outputCount = buf[pos];
  pos += 1;
  console.log(`Output Count: ${outputCount}\n`);

  for (let i = 0; i < outputCount; i++) {
    const value = buf.readBigUInt64LE(pos);
    pos += 8;
    const scriptPubKeyLen = buf[pos];
    pos += 1;
    const scriptPubKey = buf.subarray(pos, pos + scriptPubKeyLen);
    pos += scriptPubKeyLen;

    console.log(`Output ${i}:`);
    console.log(`  Value: ${value} zatoshis`);
    console.log(`  ScriptPubKey Length: ${scriptPubKeyLen}`);
    console.log(`  ScriptPubKey: ${scriptPubKey.toString('hex')}`);

    // Check if P2SH
    if (scriptPubKey[0] === 0xa9 && scriptPubKey[1] === 0x14 && scriptPubKey[22] === 0x87) {
      const scriptHash = scriptPubKey.subarray(2, 22);
      console.log(`  Type: P2SH`);
      console.log(`  Script Hash: ${scriptHash.toString('hex')}`);
    } else if (scriptPubKey[0] === 0x76 && scriptPubKey[1] === 0xa9) {
      console.log(`  Type: P2PKH`);
    }
    console.log();
  }
}

function decodeRevealTx(hex: string) {
  const buf = Buffer.from(hex, 'hex');
  let pos = 0;

  console.log('\nREVEAL TRANSACTION ANALYSIS');
  console.log('═══════════════════════════════════════\n');

  const version = buf.readUInt32LE(pos);
  pos += 4;
  console.log(`Version: 0x${version.toString(16)}`);

  const versionGroupId = buf.readUInt32LE(pos);
  pos += 4;
  console.log(`Version Group ID: 0x${versionGroupId.toString(16)}\n`);

  // Inputs
  const inputCount = buf[pos];
  pos += 1;
  console.log(`Input Count: ${inputCount}\n`);

  for (let i = 0; i < inputCount; i++) {
    const txid = buf.subarray(pos, pos + 32).reverse().toString('hex');
    pos += 32;
    const vout = buf.readUInt32LE(pos);
    pos += 4;
    const scriptSigLen = buf[pos];
    pos += 1;
    const scriptSig = buf.subarray(pos, pos + scriptSigLen);
    pos += scriptSigLen;
    const sequence = buf.readUInt32LE(pos);
    pos += 4;

    console.log(`Input ${i}:`);
    console.log(`  TXID: ${txid}`);
    console.log(`  VOUT: ${vout}`);
    console.log(`  ScriptSig Length: ${scriptSigLen}`);
    console.log(`  ScriptSig (hex): ${scriptSig.toString('hex')}\n`);

    // Decode scriptSig components
    let sigPos = 0;

    console.log('  ScriptSig Breakdown:');
    while (sigPos < scriptSig.length) {
      const opcode = scriptSig[sigPos];
      console.log(`    [${sigPos}] 0x${opcode.toString(16).padStart(2, '0')}`);

      if (opcode > 0 && opcode <= 75) {
        // Push data
        const data = scriptSig.subarray(sigPos + 1, sigPos + 1 + opcode);
        console.log(`      Push ${opcode} bytes: ${data.toString('hex')}`);

        // Try to decode as text
        try {
          const text = data.toString('utf8');
          if (/^[a-zA-Z0-9\/.]+$/.test(text)) {
            console.log(`      As text: "${text}"`);
          }
        } catch (e) {}

        sigPos += 1 + opcode;
      } else {
        // Opcode
        const opcodes: Record<number, string> = {
          0x00: 'OP_0',
          0x51: 'OP_1',
          0x75: 'OP_DROP',
          0xad: 'OP_CHECKSIGVERIFY'
        };
        if (opcodes[opcode]) {
          console.log(`      Opcode: ${opcodes[opcode]}`);
        }
        sigPos += 1;
      }
    }

    console.log(`  Sequence: 0x${sequence.toString(16)}\n`);
  }

  // Outputs
  const outputCount = buf[pos];
  pos += 1;
  console.log(`Output Count: ${outputCount}\n`);

  for (let i = 0; i < outputCount; i++) {
    const value = buf.readBigUInt64LE(pos);
    pos += 8;
    const scriptPubKeyLen = buf[pos];
    pos += 1;
    const scriptPubKey = buf.subarray(pos, pos + scriptPubKeyLen);
    pos += scriptPubKeyLen;

    console.log(`Output ${i}:`);
    console.log(`  Value: ${value} zatoshis`);
    console.log(`  ScriptPubKey: ${scriptPubKey.toString('hex')}\n`);
  }
}

console.log('');
decodeCommitTx(COMMIT_TX);
decodeRevealTx(REVEAL_TX);

// Calculate script hash from reveal script
console.log('\n═══════════════════════════════════════');
console.log('SCRIPT HASH VERIFICATION');
console.log('═══════════════════════════════════════\n');

// Extract the reveal script from scriptSig
const revealScriptSig = Buffer.from('036f7264510a746578742f706c61696e000b7a61746f7368692e7a6563483045022100e857a151a664b2c508ce3277b685e40517bb4c4178f054a075694ef61e56cd180220525812c00331a13359adcc626ed50f050cfed468c5a13bd41c3caf5c3ae082cb01292102ae86217e8e275ba60cedbcace0d7a9a4029b5b3df9788aed70a579f5f8215362ad757575757551', 'hex');

// Find where the reveal script starts (after signature)
let scriptStart = 0;
const firstPush = revealScriptSig[scriptStart];
scriptStart += 1 + firstPush; // Skip "ord" push

const secondPush = revealScriptSig[scriptStart];
scriptStart += 1; // OP_1 or similar

// The reveal script should be everything after the signature
// Looking at the structure, the signature starts at byte 0x48 (72 bytes)
const sigLen = revealScriptSig[24]; // Should be 0x48
console.log(`Signature starts at position with length: 0x${sigLen.toString(16)}`);

// The actual reveal script needs to be reconstructed
