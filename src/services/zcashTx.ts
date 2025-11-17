"use client";

// Zcash transaction builder/signing via maintained bitcore-lib-zcash
// Pure JS, browser-compatible. Handles Sapling/Overwinter sighash.

import type { UTXO, InscriptionData } from '@/services/inscription';

let _bitcore: any | null = null;

async function loadBitcore(): Promise<any> {
  if (_bitcore) return _bitcore;
  try {
    // bitcore-lib-zcash is CJS; dynamic import returns module namespace
    const m: any = await import('bitcore-lib-zcash');
    _bitcore = m.default ?? m; // ESM/CJS interop
    return _bitcore;
  } catch (e) {
    throw new Error(
      'bitcore-lib-zcash not installed. Run: npm i bitcore-lib-zcash'
    );
  }
}

export async function buildInscriptionScript(data: InscriptionData): Promise<any> {
  const bitcore = await loadBitcore();
  const { Script, Opcode } = bitcore;
  const script = new Script()
    .add(Opcode.OP_FALSE)
    .add(Opcode.OP_IF)
    .add(Buffer.from('zrc', 'utf8'))
    .add(Buffer.from(data.contentType, 'utf8'))
    .add(Buffer.from(data.content, 'utf8'))
    .add(Opcode.OP_ENDIF);
  return script;
}

export async function buildAndSignInscriptionTx(
  privateKeyWIF: string,
  address: string,
  utxos: UTXO[],
  data: InscriptionData,
  inscriptionValueZat: number,
  feeZat: number,
  platformFeeZat: number,
  treasuryAddress?: string
): Promise<string> {
  const bitcore = await loadBitcore();
  const { Transaction, PrivateKey } = bitcore;

  const unspents = utxos.map((u) => {
    const scriptHex = u.scriptPubKey && u.scriptPubKey.length > 0
      ? u.scriptPubKey
      : bitcore.Script.buildPublicKeyHashOut(address).toHex();
    return new Transaction.UnspentOutput({
      txId: u.txid,
      outputIndex: u.vout,
      address,
      script: scriptHex,
      satoshis: u.value,
    });
  });

  const inscriptionScript = await buildInscriptionScript(data);

  const tx = new Transaction();
  tx.from(unspents);
  tx.addOutput(new Transaction.Output({ script: inscriptionScript, satoshis: inscriptionValueZat }));
  // Platform fee output
  if (platformFeeZat > 0 && treasuryAddress) {
    tx.to(treasuryAddress, platformFeeZat);
  }
  tx.change(address);
  tx.fee(feeZat);

  const pk = new PrivateKey(privateKeyWIF);
  tx.sign(pk);

  return tx.serialize();
}
