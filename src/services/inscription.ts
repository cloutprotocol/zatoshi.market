"use client";
/**
 * Zerdinals Inscription Service
 * Client-side inscription creation following the Zerdinals protocol
 */

import * as bitcoin from 'bitcoinjs-lib';

// Note: Zcash signing (ZIP-243/244) requires a dedicated signer.
// We do not use ECPair here to avoid tiny-secp256k1 interface issues in browser.

// Zcash network parameters (similar to Bitcoin mainnet)
const ZCASH_NETWORK = {
  messagePrefix: '\x18Zcash Signed Message:\n',
  bech32: 'zc',
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  pubKeyHash: 0x1cb8,
  scriptHash: 0x1cbd,
  wif: 0x80,
};

export interface UTXO {
  txid: string;
  vout: number;
  value: number;
  scriptPubKey: string;
}

export interface InscriptionData {
  contentType: string;
  content: string;
}

/**
 * Fetch raw transaction hex (for signing inputs)
 */
export async function getRawTransaction(txid: string): Promise<string> {
  const res = await fetch(`/api/zcash/tx/${txid}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch raw tx for ${txid}: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (!json?.raw || typeof json.raw !== 'string') {
    throw new Error('Provider did not return raw tx');
  }
  return json.raw as string;
}

/**
 * Fetch UTXOs for a given address from Zerdinals API
 */
export async function getUTXOs(address: string): Promise<UTXO[]> {
  try {
    // Use Next.js API proxy to avoid CORS
    const response = await fetch(`/api/zerdinals-utxos/utxos/${address}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch UTXOs: ${response.statusText}`);
    }

    const utxos = await response.json();
    return utxos;
  } catch (error) {
    console.error('Error fetching UTXOs:', error);
    throw error;
  }
}

/**
 * Select UTXOs that cover the required amount
 */
function selectUTXOs(utxos: UTXO[], requiredAmount: number): UTXO[] {
  const selected: UTXO[] = [];
  let total = 0;

  // Sort by value descending to minimize number of inputs
  const sorted = [...utxos].sort((a, b) => b.value - a.value);

  for (const utxo of sorted) {
    selected.push(utxo);
    total += utxo.value;

    if (total >= requiredAmount) {
      break;
    }
  }

  if (total < requiredAmount) {
    throw new Error(`Insufficient funds. Need ${requiredAmount} zatoshis, have ${total}`);
  }

  return selected;
}

/**
 * Create inscription script following Zerdinals protocol
 * Format:
 * OP_FALSE
 * OP_IF
 *   "zrc"
 *   <contentType>
 *   <content>
 * OP_ENDIF
 */
function createInscriptionScript(data: InscriptionData): Buffer {
  const chunks: (number | Buffer)[] = [
    bitcoin.opcodes.OP_FALSE,
    bitcoin.opcodes.OP_IF,
    Buffer.from('zrc', 'utf8'),
    Buffer.from(data.contentType, 'utf8'),
    Buffer.from(data.content, 'utf8'),
    bitcoin.opcodes.OP_ENDIF,
  ];

  return bitcoin.script.compile(chunks) as Buffer;
}

/**
 * Create a Zcash inscription transaction
 */
export async function createInscriptionTransaction(
  privateKeyWIF: string,
  address: string,
  inscriptionData: InscriptionData
): Promise<string> {
  // Constants
  const INSCRIPTION_OUTPUT_VALUE = BigInt(10000); // 10,000 zatoshis for inscription
  const TRANSACTION_FEE = BigInt(10000); // 10,000 zatoshis fee
  const REQUIRED_AMOUNT = INSCRIPTION_OUTPUT_VALUE + TRANSACTION_FEE;

  // 1. Get UTXOs
  const utxos = await getUTXOs(address);

  if (utxos.length === 0) {
    throw new Error('No UTXOs found. Your wallet needs to have some ZEC.');
  }

  // 2. Select UTXOs
  const selectedUTXOs = selectUTXOs(utxos, Number(REQUIRED_AMOUNT));
  const totalInput = BigInt(selectedUTXOs.reduce((sum, utxo) => sum + utxo.value, 0));

  // 3. Parse WIF (signing not implemented in this function yet)

  // 4. Build transaction
  const psbt = new bitcoin.Psbt({ network: ZCASH_NETWORK as any });

  // 4.1 Fetch previous transactions for inputs (required for non-witness signing)
  const prevMap = new Map<string, Buffer>();
  for (const utxo of selectedUTXOs) {
    const raw = await getRawTransaction(utxo.txid);
    prevMap.set(utxo.txid, Buffer.from(raw, 'hex'));
  }

  // 5. Add inputs
  for (const utxo of selectedUTXOs) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: prevMap.get(utxo.txid)!,
    });
  }

  // 6. Create inscription script and add inscription output
  const inscriptionScript = createInscriptionScript(inscriptionData);
  psbt.addOutput({
    script: inscriptionScript,
    value: Number(INSCRIPTION_OUTPUT_VALUE),
  });

  // 7. Calculate change and add change output
  const change = totalInput - INSCRIPTION_OUTPUT_VALUE - TRANSACTION_FEE;
  if (change > BigInt(0)) {
    // Decode address to get script
    const decoded = bitcoin.address.fromBase58Check(address);
    const changeScript = bitcoin.script.compile([
      bitcoin.opcodes.OP_DUP,
      bitcoin.opcodes.OP_HASH160,
      decoded.hash,
      bitcoin.opcodes.OP_EQUALVERIFY,
      bitcoin.opcodes.OP_CHECKSIG,
    ]);

    psbt.addOutput({
      script: changeScript,
      value: Number(change),
    });
  }

  // 8. Sign all inputs (Zcash ZIP-243/244 signing required)
  throw new Error('Zcash transaction signing not yet implemented in client.');

  // 9. Finalize and extract
  // Unreachable for now
  // const tx = psbt.extractTransaction();
  // return tx.toHex();
}

/**
 * Broadcast transaction to Zerdinals network
 */
export async function broadcastTransaction(rawTx: string): Promise<string> {
  try {
    // Use Next.js API proxy to avoid CORS
    const response = await fetch('/api/zerdinals-utxos/send-transaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rawTransaction: rawTx }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to broadcast transaction: ${error}`);
    }

    const result = await response.json();
    return result.txid;
  } catch (error) {
    console.error('Error broadcasting transaction:', error);
    throw error;
  }
}

/**
 * Complete inscription workflow
 */
export async function inscribe(
  privateKeyWIF: string,
  address: string,
  contentType: string,
  content: string
): Promise<{ txid: string; inscriptionId: string }> {
  // 1. Create inscription transaction
  const rawTx = await createInscriptionTransaction(privateKeyWIF, address, {
    contentType,
    content,
  });

  // 2. Broadcast transaction
  const txid = await broadcastTransaction(rawTx);

  // 3. Return inscription ID (txid + output index)
  const inscriptionId = `${txid}i0`; // Inscription is in first output

  return { txid, inscriptionId };
}

/**
 * Helper to create ZRC-20 token mint inscription
 */
export async function mintZRC20Token(
  privateKeyWIF: string,
  address: string,
  tick: string,
  amount: string
): Promise<{ txid: string; inscriptionId: string }> {
  const inscriptionData = {
    p: 'zrc-20',
    op: 'mint',
    tick: tick.toUpperCase(),
    amt: amount,
  };

  return inscribe(
    privateKeyWIF,
    address,
    'application/json',
    JSON.stringify(inscriptionData)
  );
}

/**
 * Helper to register a Zcash name (.zec or .zcash)
 */
export async function registerZcashName(
  privateKeyWIF: string,
  address: string,
  name: string
): Promise<{ txid: string; inscriptionId: string }> {
  // Create name registration inscription
  const inscriptionData = {
    p: 'zns', // Zcash Name Service
    op: 'register',
    name: name.toLowerCase(),
    owner: address,
    timestamp: Date.now(),
  };

  return inscribe(
    privateKeyWIF,
    address,
    'application/json',
    JSON.stringify(inscriptionData)
  );
}
