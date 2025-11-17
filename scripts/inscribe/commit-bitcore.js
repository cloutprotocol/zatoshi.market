/**
 * Build + broadcast commit transaction using bitcore-lib-zcash
 * Avoids hashing mismatches by delegating signing to bitcore
 */

// Patch bitcore's bundled lodash before loading bitcore
const lodashInternal = require('bitcore-lib-zcash/node_modules/lodash');
lodashInternal.sumBy = lodashInternal.sumBy || ((arr, it) => arr.reduce((s, x) => s + (typeof it === 'function' ? it(x) : x[it] || 0), 0));
global._ = lodashInternal;
const bitcore = require('bitcore-lib-zcash');
const { ripemd160 } = require('@noble/hashes/ripemd160');
const { sha256 } = require('@noble/hashes/sha256');

// lodash patched above

function hash160(u8) { return Buffer.from(ripemd160(sha256(u8))); }

const WALLET = {
  address: 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

const INSCRIPTION_AMOUNT = Number(process.env.INSCRIPTION_AMOUNT || 60000);
const TX_FEE = Number(process.env.TX_FEE || 10000);

function buildRevealScript(publicKey) {
  const pkBuf = Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey);
  // <pubkey> OP_CHECKSIGVERIFY OP_DROP x5 OP_1
  return Buffer.concat([
    Buffer.from([pkBuf.length]), pkBuf,
    Buffer.from([0xad]),
    Buffer.from([0x75, 0x75, 0x75, 0x75, 0x75]),
    Buffer.from([0x51])
  ]);
}

function buildP2SHScriptFromRedeem(redeemScript) {
  const scriptHash = hash160(redeemScript);
  return Buffer.concat([Buffer.from([0xa9, 0x14]), scriptHash, Buffer.from([0x87])]);
}

async function getUTXOs(address) {
  const r = await fetch(`https://utxos.zerdinals.com/api/utxos/${address}`);
  if (!r.ok) throw new Error('UTXO fetch failed');
  return r.json();
}

async function broadcast(txHex) {
  try {
    const r = await fetch('https://utxos.zerdinals.com/api/send-transaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawTransaction: txHex }) });
    const j = await r.json(); if (r.ok && (j.result || j.txid)) return j.result || j.txid;
  } catch (_) {}
  const r2 = await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.TATUM_API_KEY || '' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'sendrawtransaction', params: [txHex], id: 1 }) });
  const j2 = await r2.json(); if (j2.error) throw new Error(j2.error?.message || JSON.stringify(j2.error)); return j2.result;
}

async function main() {
  console.log('\n=== Commit with bitcore-lib-zcash ===');
  const priv = bitcore.PrivateKey.fromWIF(WALLET.privateKeyWIF);
  const pub = priv.toPublicKey();
  const addr = priv.toAddress();
  console.log('Address:', addr.toString());
  const revealScript = buildRevealScript(pub.toBuffer());
  const p2shScript = buildP2SHScriptFromRedeem(revealScript);
  const p2shAddress = bitcore.Script.fromBuffer(p2shScript).toScriptHashOut().toAddress();
  console.log('P2SH address:', p2shAddress.toString());

  const utxos = await getUTXOs(addr.toString());
  if (!utxos.length) throw new Error('No UTXOs');
  const u = utxos.find(x => x.value >= INSCRIPTION_AMOUNT + TX_FEE) || utxos[0];
  console.log('Using UTXO:', `${u.txid}:${u.vout}`, 'value=', u.value);

  const tx = new bitcore.Transaction()
    .from({ txId: u.txid, outputIndex: u.vout, address: addr.toString(), script: bitcore.Script.buildPublicKeyHashOut(addr).toString(), satoshis: u.value })
    .to(p2shAddress, INSCRIPTION_AMOUNT)
    .change(addr)
    .fee(TX_FEE)
    .sign(priv);

  const hex = tx.uncheckedSerialize();
  console.log('Hex:', hex.slice(0, 120) + '...');
  console.log('Size:', hex.length / 2, 'bytes');

  if (process.env.BROADCAST === '1') {
    console.log('Broadcasting...');
    const txid = await broadcast(hex);
    console.log('Commit txid:', txid);
  }
}

main().catch(e => { console.error('Error:', e.message || e); if (e.stack) console.error(e.stack); process.exit(1); });
