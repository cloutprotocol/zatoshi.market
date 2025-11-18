/**
 * Zcash Inscription Service
 * Core service for creating Ordinals-style inscriptions on Zcash
 */

import { buildRevealScript, buildInscriptionData, buildP2SHScript, buildP2PKHScript, varint } from '../../scripts/inscribe/ordinals-builder';
import { getTransparentSignatureHashV4 } from '../../scripts/inscribe/zip243';
import { getSafeUTXOs, type UTXO } from './inscriptionProtection';
import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import bs58check from 'bs58check';

// Setup secp256k1
secp256k1.etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) =>
  hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));

interface InscriptionResult {
  commitTxid: string;
  revealTxid: string;
  inscriptionId: string;
  commitTxHex: string;
  revealTxHex: string;
}

export class InscriptionService {
  private tatum_api_key: string;

  constructor(tatumApiKey?: string) {
    this.tatum_api_key = tatumApiKey || process.env.TATUM_API_KEY || 't-691ab5fae2b53035df472a13-2ea27385c5964a15b092bdab';
  }

  /**
   * Create an inscription
   */
  async createInscription(
    privateKeyWIF: string,
    content: string,
    contentType: string = 'text/plain'
  ): Promise<InscriptionResult> {
    // 1. Decode private key
    const privateKeyBytes = this.decodeWIF(privateKeyWIF);
    const publicKey = await secp256k1.getPublicKey(privateKeyBytes, true);
    const address = this.getAddressFromPrivateKey(privateKeyWIF);

    console.log(`Creating inscription for address: ${address}`);

    // 2. Get safe UTXOs
    const { safeUtxos } = await getSafeUTXOs(address);
    if (safeUtxos.length === 0) {
      throw new Error('No safe UTXOs available. All UTXOs contain inscriptions.');
    }

    console.log(`Found ${safeUtxos.length} safe UTXO(s)`);

    // 3. Build reveal script and P2SH
    const revealScript = buildRevealScript(Buffer.from(publicKey));
    const p2shScript = buildP2SHScript(revealScript);
    const inscriptionData = buildInscriptionData(content, contentType);

    console.log(`Reveal script: ${revealScript.toString('hex')}`);
    console.log(`P2SH script: ${p2shScript.toString('hex')}`);

    // 4. Get consensus branch ID
    const consensusBranchId = await this.getConsensusBranchId();

    // 5. Build commit transaction
    const commitTxHex = await this.buildCommitTransaction(
      safeUtxos[0],
      p2shScript,
      privateKeyBytes,
      Buffer.from(publicKey),
      address,
      consensusBranchId
    );

    console.log(`Commit TX: ${commitTxHex.substring(0, 100)}...`);

    // 6. Broadcast commit
    const commitTxid = await this.broadcastTransaction(commitTxHex);
    console.log(`Commit TXID: ${commitTxid}`);

    // 7. Wait for propagation
    console.log('Waiting 10 seconds for network propagation...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // 8. Build reveal transaction
    const revealTxHex = await this.buildRevealTransaction(
      commitTxid,
      revealScript,
      inscriptionData,
      privateKeyBytes,
      Buffer.from(publicKey),
      address,
      consensusBranchId
    );

    console.log(`Reveal TX: ${revealTxHex.substring(0, 100)}...`);

    // 9. Broadcast reveal
    const revealTxid = await this.broadcastTransaction(revealTxHex);
    console.log(`Reveal TXID: ${revealTxid}`);

    return {
      commitTxid,
      revealTxid,
      inscriptionId: `${revealTxid}i0`,
      commitTxHex,
      revealTxHex
    };
  }

  /**
   * Build commit transaction
   */
  private async buildCommitTransaction(
    utxo: UTXO,
    p2shScript: Buffer,
    privateKeyBytes: Buffer,
    publicKey: Buffer,
    address: string,
    consensusBranchId: number
  ): Promise<string> {
    // Transaction header
    const version = Buffer.allocUnsafe(4);
    version.writeUInt32LE(0x80000004); // Overwintered v4

    const versionGroupId = Buffer.allocUnsafe(4);
    versionGroupId.writeUInt32LE(0x892f2085); // Sapling

    const inputCount = varint(1);

    // Input
    const prevTxId = Buffer.from(utxo.txid, 'hex').reverse();
    const prevOutIndex = Buffer.allocUnsafe(4);
    prevOutIndex.writeUInt32LE(utxo.vout);

    const sequence = Buffer.allocUnsafe(4);
    sequence.writeUInt32LE(0xfffffffd); // RBF-enabled

    // Outputs
    const outputCount = varint(2);

    // Output 1: P2SH (for reveal to spend)
    const p2shAmount = 60000;
    const output1Value = Buffer.allocUnsafe(8);
    output1Value.writeBigUInt64LE(BigInt(p2shAmount));
    const output1ScriptLen = varint(p2shScript.length);

    // Output 2: Change
    const fee = 50000; // ZIP-317 policy: raise min relay fee to avoid unpaid action limit
    const changeAmount = utxo.value - p2shAmount - fee;
    const output2Value = Buffer.allocUnsafe(8);
    output2Value.writeBigUInt64LE(BigInt(changeAmount));

    const pubKeyHash = this.decodeAddress(address);
    const changeScript = buildP2PKHScript(pubKeyHash);
    const output2ScriptLen = varint(changeScript.length);

    const lockTime = Buffer.allocUnsafe(4);
    lockTime.writeUInt32LE(0);

    const expiryHeight = Buffer.allocUnsafe(4);
    expiryHeight.writeUInt32LE(0);

    const valueBalance = Buffer.allocUnsafe(8);
    valueBalance.writeBigInt64LE(BigInt(0));

    const nShieldedSpend = varint(0);
    const nShieldedOutput = varint(0);
    const nJoinSplit = varint(0);

    // Get signature hash
    const txData = {
      version: 0x80000004,
      versionGroupId: 0x892f2085,
      consensusBranchId,
      lockTime: 0,
      expiryHeight: 0,
      inputs: [{
        txid: utxo.txid,
        vout: utxo.vout,
        sequence: 0xfffffffd,
        value: utxo.value,
        scriptPubKey: buildP2PKHScript(pubKeyHash)
      }],
      outputs: [
        { value: p2shAmount, scriptPubKey: p2shScript },
        { value: changeAmount, scriptPubKey: changeScript }
      ]
    };

    const sigHash = getTransparentSignatureHashV4(txData, 0);

    const signature = await secp256k1.sign(sigHash, privateKeyBytes);
    const compactSig = (signature as any).toCompactRawBytes();
    const signatureDER = this.signatureToDER(compactSig);
    const sigWithHashType = Buffer.concat([signatureDER, Buffer.from([0x01])]);

    // Build scriptSig
    const scriptSig = Buffer.concat([
      Buffer.from([sigWithHashType.length]),
      sigWithHashType,
      Buffer.from([publicKey.length]),
      publicKey
    ]);
    const scriptSigLength = varint(scriptSig.length);

    // Assemble transaction
    const tx = Buffer.concat([
      version, versionGroupId, inputCount,
      prevTxId, prevOutIndex, scriptSigLength, scriptSig, sequence,
      outputCount,
      output1Value, output1ScriptLen, p2shScript,
      output2Value, output2ScriptLen, changeScript,
      lockTime, expiryHeight, valueBalance,
      nShieldedSpend, nShieldedOutput, nJoinSplit
    ]);

    return tx.toString('hex');
  }

  /**
   * Build reveal transaction
   */
  private async buildRevealTransaction(
    commitTxid: string,
    revealScript: Buffer,
    inscriptionData: Buffer,
    privateKeyBytes: Buffer,
    publicKey: Buffer,
    address: string,
    consensusBranchId: number
  ): Promise<string> {
    // Transaction header
    const version = Buffer.allocUnsafe(4);
    version.writeUInt32LE(0x80000004);

    const versionGroupId = Buffer.allocUnsafe(4);
    versionGroupId.writeUInt32LE(0x892f2085);

    const inputCount = varint(1);

    // Input: Spend P2SH from commit
    const prevTxId = Buffer.from(commitTxid, 'hex').reverse();
    const prevOutIndex = Buffer.allocUnsafe(4);
    prevOutIndex.writeUInt32LE(0); // First output of commit tx

    const sequence = Buffer.allocUnsafe(4);
    sequence.writeUInt32LE(0xffffffff); // Final sequence for reveal

    // Output: Send to our address
    const outputCount = varint(1);

    const fee = 10000;
    const outputAmount = 60000 - fee; // P2SH amount minus fee
    const outputValue = Buffer.allocUnsafe(8);
    outputValue.writeBigUInt64LE(BigInt(outputAmount));

    const pubKeyHash = this.decodeAddress(address);
    const outputScript = buildP2PKHScript(pubKeyHash);
    const outputScriptLen = varint(outputScript.length);

    const lockTime = Buffer.allocUnsafe(4);
    lockTime.writeUInt32LE(0);

    const expiryHeight = Buffer.allocUnsafe(4);
    expiryHeight.writeUInt32LE(0);

    const valueBalance = Buffer.allocUnsafe(8);
    valueBalance.writeBigInt64LE(BigInt(0));

    const nShieldedSpend = varint(0);
    const nShieldedOutput = varint(0);
    const nJoinSplit = varint(0);

    // Get signature hash
    const p2shScript = buildP2SHScript(revealScript);
    const txData = {
      version: 0x80000004,
      versionGroupId: 0x892f2085,
      consensusBranchId,
      lockTime: 0,
      expiryHeight: 0,
      inputs: [{
        txid: commitTxid,
        vout: 0,
        sequence: 0xffffffff,
        value: 60000,
        // For P2SH spends, sign with the redeem script as scriptCode
        scriptPubKey: revealScript
      }],
      outputs: [
        { value: outputAmount, scriptPubKey: outputScript }
      ]
    };

    const sigHash = getTransparentSignatureHashV4(txData, 0);

    const signature = await secp256k1.sign(sigHash, privateKeyBytes);
    const compactSig = (signature as any).toCompactRawBytes();
    const signatureDER = this.signatureToDER(compactSig);
    const sigWithHashType = Buffer.concat([signatureDER, Buffer.from([0x01])]);

    // Build scriptSig: <inscription data> <signature> <reveal script>
    const scriptSig = Buffer.concat([
      inscriptionData,                      // Inscription data (ord marker + content)
      Buffer.from([sigWithHashType.length]), // Push signature
      sigWithHashType,
      Buffer.from([revealScript.length]),   // Push reveal script
      revealScript
    ]);
    const scriptSigLength = varint(scriptSig.length);

    // Assemble transaction
    const tx = Buffer.concat([
      version, versionGroupId, inputCount,
      prevTxId, prevOutIndex, scriptSigLength, scriptSig, sequence,
      outputCount,
      outputValue, outputScriptLen, outputScript,
      lockTime, expiryHeight, valueBalance,
      nShieldedSpend, nShieldedOutput, nJoinSplit
    ]);

    return tx.toString('hex');
  }

  /**
   * Convert signature to DER format (canonical)
   */
  private signatureToDER(signature: Uint8Array): Buffer {
    let r = signature.slice(0, 32);
    let s = signature.slice(32, 64);

    function toCanonicalBytes(bytes: Uint8Array): Buffer {
      let start = 0;
      while (start < bytes.length - 1 && bytes[start] === 0 && !(bytes[start + 1] & 0x80)) {
        start++;
      }
      if (bytes[start] & 0x80) {
        return Buffer.concat([Buffer.from([0x00]), Buffer.from(bytes.slice(start))]);
      }
      return Buffer.from(bytes.slice(start));
    }

    const rBytes = toCanonicalBytes(r);
    const sBytes = toCanonicalBytes(s);

    // Low-S enforcement
    const curveN = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    const halfN = curveN / 2n;
    const sValue = BigInt('0x' + Buffer.from(sBytes).toString('hex'));

    let finalS = sBytes;
    if (sValue > halfN) {
      const newS = curveN - sValue;
      finalS = toCanonicalBytes(Buffer.from(newS.toString(16).padStart(64, '0'), 'hex'));
    }

    const derR = Buffer.concat([Buffer.from([0x02, rBytes.length]), rBytes]);
    const derS = Buffer.concat([Buffer.from([0x02, finalS.length]), finalS]);

    const derSig = Buffer.concat([derR, derS]);
    return Buffer.concat([Buffer.from([0x30, derSig.length]), derSig]);
  }

  /**
   * Decode WIF private key
   */
  private decodeWIF(wif: string): Buffer {
    const decoded = bs58check.decode(wif);
    return decoded.slice(1, decoded.length === 34 ? 33 : undefined);
  }

  /**
   * Decode Zcash address to pubkey hash
   */
  private decodeAddress(address: string): Buffer {
    const decoded = bs58check.decode(address);
    return decoded.slice(2);
  }

  /**
   * Get address from private key WIF
   */
  private getAddressFromPrivateKey(wif: string): string {
    const privateKeyBytes = this.decodeWIF(wif);
    const publicKey = secp256k1.getPublicKey(privateKeyBytes, true);
    const pubKeyHash = this.hash160(Buffer.from(publicKey));

    // Zcash mainnet P2PKH prefix: [0x1c, 0xb8]
    const versionBytes = Buffer.from([0x1c, 0xb8]);
    const payload = Buffer.concat([versionBytes, pubKeyHash]);

    return bs58check.encode(payload);
  }

  /**
   * HASH160 (SHA256 then RIPEMD160)
   */
  private hash160(data: Buffer): Buffer {
    const { ripemd160 } = require('@noble/hashes/ripemd160');
    return Buffer.from(ripemd160(sha256(data)));
  }

  /**
   * Get consensus branch ID from network
   */
  private async getConsensusBranchId(): Promise<number> {
    const response = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.tatum_api_key
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getblockchaininfo',
        id: 1
      })
    });

    const result = await response.json();

    if (!result.result || !result.result.consensus || !result.result.consensus.nextblock) {
      console.error('Invalid API response:', JSON.stringify(result, null, 2));
      throw new Error('Failed to get consensus branch ID from network');
    }

    return parseInt(result.result.consensus.nextblock, 16);
  }

  /**
   * Broadcast transaction
   */
  private async broadcastTransaction(txHex: string): Promise<string> {
    // Try Zerdinals first
    try {
      const response = await fetch('https://utxos.zerdinals.com/api/send-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawTransaction: txHex })
      });

      const result = await response.json();
      if (response.ok && (result.result || result.txid)) {
        return result.result || result.txid;
      }
    } catch (e) {
      console.log('Zerdinals broadcast failed, trying Tatum...');
    }

    // Try Tatum
    const response = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.tatum_api_key
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'sendrawtransaction',
        params: [txHex],
        id: 1
      })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(JSON.stringify(result.error));
    }

    return result.result;
  }
}
