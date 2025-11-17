/**
 * Split a single funding UTXO into N clean UTXOs for batch inscriptions
 *
 * Env:
 *  - WALLET_ADDRESS, WALLET_WIF
 *  - SPLIT_COUNT (default 10)
 *  - TARGET_AMOUNT (per-output, default 70000)
 *  - TX_FEE (default 10000)
 *  - CONSENSUS_BRANCH_ID or fetched from Tatum
 */

const bs58check = require('bs58check').default;
const { blake2b } = require('@noble/hashes/blake2b');
const { sha256 } = require('@noble/hashes/sha256');
const { ripemd160 } = require('@noble/hashes/ripemd160');
const secp256k1 = require('@noble/secp256k1');
const { hmac } = require('@noble/hashes/hmac');
secp256k1.etc.hmacSha256Sync = (key, ...msgs) => hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));

const WALLET = {
  address: process.env.WALLET_ADDRESS || 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: process.env.WALLET_WIF || 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

const SPLIT_COUNT = Number(process.env.SPLIT_COUNT || 10);
const TARGET_AMOUNT = Number(process.env.TARGET_AMOUNT || 70000);
const TX_FEE = Number(process.env.TX_FEE || 10000);

function varint(n){ if(n<0xfd) return Buffer.from([n]); if(n<=0xffff){ const b=Buffer.allocUnsafe(3); b[0]=0xfd; b.writeUInt16LE(n,1); return b;} const b=Buffer.allocUnsafe(5); b[0]=0xfe; b.writeUInt32LE(n,1); return b; }
function u32le(n){ const b=Buffer.allocUnsafe(4); b.writeUInt32LE(n); return b; }
function u64le(n){ const b=Buffer.allocUnsafe(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function hash160(buf){ return Buffer.from(ripemd160(sha256(buf))); }
function buildP2PKHScript(pkh){ return Buffer.concat([Buffer.from([0x76,0xa9,0x14]), pkh, Buffer.from([0x88,0xac])]); }
function wifToPrivateKey(wif){ const d=bs58check.decode(wif); return d.slice(1, d.length===34?33:undefined); }
function addressToPubKeyHash(addr){ const d=bs58check.decode(addr); return d.slice(2); }
function blake(data, p){ return Buffer.from(blake2b(data,{dkLen:32, personalization: Buffer.from(p)})); }
function prevoutsHash(inputs){ const parts=[]; for(const i of inputs){ parts.push(Buffer.from(i.txid,'hex').reverse(), u32le(i.vout)); } return blake(Buffer.concat(parts),'ZcashPrevoutHash'); }
function sequenceHash(inputs){ const parts=inputs.map(i=>u32le(i.sequence)); return blake(Buffer.concat(parts),'ZcashSequencHash'); }
function outputsHash(outputs){ const parts=[]; for(const o of outputs){ parts.push(u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey); } return blake(Buffer.concat(parts),'ZcashOutputsHash'); }
function zip243SigHash(tx, idx){ const i=tx.inputs[idx]; const pre=Buffer.concat([ u32le(tx.version), u32le(tx.versionGroupId), prevoutsHash(tx.inputs), sequenceHash(tx.inputs), outputsHash(tx.outputs), Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(32), u32le(tx.lockTime), u32le(tx.expiryHeight), u64le(0), u32le(1), Buffer.from(i.txid,'hex').reverse(), u32le(i.vout), varint(i.scriptPubKey.length), i.scriptPubKey, u64le(i.value), u32le(i.sequence) ]); const pers=Buffer.alloc(16); Buffer.from('ZcashSigHash').copy(pers); u32le(tx.consensusBranchId).copy(pers,12); return Buffer.from(blake2b(pre,{dkLen:32, personalization:pers})); }
function sigDER(sig){ const r=sig.slice(0,32), s=sig.slice(32,64); const can=b=>{let i=0; while(i<b.length-1&&b[i]===0&&!(b[i+1]&0x80)) i++; return (b[i]&0x80)? Buffer.concat([Buffer.from([0x00]), Buffer.from(b.slice(i))]): Buffer.from(b.slice(i));}; const n=0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n,half=n/2n; const rB=can(r); let sB=can(s); const sV=BigInt('0x'+sB.toString('hex')); if(sV>half) sB=can(Buffer.from((n-sV).toString(16).padStart(64,'0'),'hex')); const body=Buffer.concat([Buffer.from([0x02,rB.length]), rB, Buffer.from([0x02,sB.length]), sB]); return Buffer.concat([Buffer.from([0x30,body.length]), body]); }

async function getConsensusBranchId(){ if(process.env.CONSENSUS_BRANCH_ID){ const v=process.env.CONSENSUS_BRANCH_ID.trim(); return v.startsWith('0x')?parseInt(v,16):parseInt(v,10);} const r=await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.TATUM_API_KEY||''},body:JSON.stringify({jsonrpc:'2.0',method:'getblockchaininfo',id:1})}); const j=await r.json(); return parseInt(j.result.consensus.nextblock,16); }
async function getUTXOs(addr){ const r=await fetch(`https://utxos.zerdinals.com/api/utxos/${addr}`); return r.json(); }
async function broadcast(txHex){ try{ const r=await fetch('https://utxos.zerdinals.com/api/send-transaction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rawTransaction:txHex})}); const j=await r.json(); if(r.ok&&(j.result||j.txid)) return j.result||j.txid; }catch(_){ } const r2=await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.TATUM_API_KEY||''},body:JSON.stringify({jsonrpc:'2.0',method:'sendrawtransaction',params:[txHex],id:1})}); const j2=await r2.json(); if(j2.error) throw new Error(j2.error?.message||JSON.stringify(j2.error)); return j2.result; }

(async()=>{
  console.log('=== Split UTXOs ===');
  console.log('Target outputs:', SPLIT_COUNT, 'x', TARGET_AMOUNT, 'zats');
  const priv = wifToPrivateKey(WALLET.privateKeyWIF);
  const pub = Buffer.from(await secp256k1.getPublicKey(priv, true));
  const pkh = addressToPubKeyHash(WALLET.address);
  const consensusBranchId = await getConsensusBranchId();
  const utxos = await getUTXOs(WALLET.address);

  const required = SPLIT_COUNT * TARGET_AMOUNT + TX_FEE;
  let u = undefined;
  for (const x of utxos) {
    if (x.value < required) continue;
    try {
      const r = await fetch(`https://indexer.zerdinals.com/location/${x.txid}:${x.vout}`);
      if (r.status === 404) { u = x; break; }
      const j = await r.json(); if (j?.code === 404) { u = x; break; }
    } catch (e) { throw new Error('Inscription check failed'); }
  }
  if(!u) throw new Error(`No safe UTXO large enough. Need >= ${required}`);
  console.log('Using UTXO:', `${u.txid}:${u.vout}`, 'value=', u.value);

  // Build outputs
  const outputs = [];
  for(let i=0;i<SPLIT_COUNT;i++) outputs.push({ value: TARGET_AMOUNT, scriptPubKey: buildP2PKHScript(pkh) });
  const change = u.value - (SPLIT_COUNT * TARGET_AMOUNT) - TX_FEE;
  if(change > 546) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });

  // Sign v4
  const inputs = [{ txid: u.txid, vout: u.vout, sequence: 0xfffffffd, value: u.value, scriptPubKey: buildP2PKHScript(pkh) }];
  const txData = { version: 0x80000004, versionGroupId: 0x892f2085, consensusBranchId, lockTime:0, expiryHeight:0, inputs, outputs };
  const sigHash = zip243SigHash(txData, 0);
  const sig = await secp256k1.sign(sigHash, priv);
  const der = sigDER(sig.toCompactRawBytes?sig.toCompactRawBytes():sig);
  const sigType = Buffer.concat([der, Buffer.from([0x01])]);
  const version= u32le(0x80000004), vgid=u32le(0x892f2085), inCount=varint(1), prev=Buffer.from(u.txid,'hex').reverse(), vout=u32le(u.vout), seq=u32le(0xfffffffd);
  const scriptSig = Buffer.concat([Buffer.from([sigType.length]), sigType, Buffer.from([pub.length]), pub]);
  const scriptLen = varint(scriptSig.length);
  const outCount= varint(outputs.length);
  const outsBuf= Buffer.concat(outputs.map(o=>Buffer.concat([u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey])));
  const lock=u32le(0), exp=u32le(0), valBal=Buffer.alloc(8), nSS=Buffer.from([0x00]), nSO=Buffer.from([0x00]), nJS=Buffer.from([0x00]);
  const raw = Buffer.concat([version, vgid, inCount, prev, vout, scriptLen, scriptSig, seq, outCount, outsBuf, lock, exp, valBal, nSS, nSO, nJS]);
  const hex = raw.toString('hex');
  console.log('Split tx hex (first 120):', hex.slice(0,120)+'...');
  const txid = await broadcast(hex);
  console.log('Split txid:', txid);
})();
