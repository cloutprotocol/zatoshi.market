/**
 * Build and broadcast a v5 (ZIP-244) transparent-only commit transaction
 */

const bs58check = require('bs58check').default;
const { blake2b } = require('@noble/hashes/blake2b');
const { sha256 } = require('@noble/hashes/sha256');
const { ripemd160 } = require('@noble/hashes/ripemd160');
const secp256k1 = require('@noble/secp256k1');
const { hmac } = require('@noble/hashes/hmac');
secp256k1.etc.hmacSha256Sync = (key, ...msgs) => hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));

const WALLET = {
  address: 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

const INSCRIPTION_AMOUNT = Number(process.env.INSCRIPTION_AMOUNT || 60000);
const TX_FEE = Number(process.env.TX_FEE || 10000);

function varint(n){ if(n<0xfd)return Buffer.from([n]); if(n<=0xffff){const b=Buffer.allocUnsafe(3); b[0]=0xfd; b.writeUInt16LE(n,1); return b;} const b=Buffer.allocUnsafe(5); b[0]=0xfe; b.writeUInt32LE(n,1); return b; }
function u32le(n){ const b=Buffer.allocUnsafe(4); b.writeUInt32LE(n); return b; }
function u64le(n){ const b=Buffer.allocUnsafe(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function hash160(buf){ return Buffer.from(ripemd160(sha256(buf))); }

function buildP2PKHScript(pubKeyHash){ return Buffer.concat([Buffer.from([0x76,0xa9,0x14]), pubKeyHash, Buffer.from([0x88,0xac])]); }
function buildP2SHScriptFromRedeem(redeemScript){ const h=hash160(redeemScript); return Buffer.concat([Buffer.from([0xa9,0x14]), h, Buffer.from([0x87])]); }

function createInscriptionChunks(contentType, data){ return [Buffer.from('ord','utf8'), 0x51, Buffer.from(contentType,'utf8'), 0x00, Buffer.isBuffer(data)?data:Buffer.from(data,'utf8')]; }
function compilePush(data){ if(data.length<=75) return Buffer.concat([Buffer.from([data.length]), data]); if(data.length<=0xff) return Buffer.concat([Buffer.from([0x4c, data.length]), data]); const l=Buffer.allocUnsafe(2); l.writeUInt16LE(data.length); return Buffer.concat([Buffer.from([0x4d]), l, data]); }
function compileScript(elements){ const parts=[]; for(const el of elements){ if(Buffer.isBuffer(el)) parts.push(compilePush(el)); else if(typeof el==='number') parts.push(Buffer.from([el])); else throw new Error('bad el'); } return Buffer.concat(parts); }
function createRedeemScript(publicKey, inscriptionChunks){ const ops=[publicKey, 0xad]; for(let i=0;i<inscriptionChunks.length;i++) ops.push(0x75); ops.push(0x51); return compileScript(ops); }

function wifToPrivateKey(wif){ const d=bs58check.decode(wif); return d.slice(1, d.length===34?33:undefined); }
function addressToPubKeyHash(addr){ const d=bs58check.decode(addr); return d.slice(2); }

// ZIP-244 digests
function headerDigestV5(tx){ const data=Buffer.concat([u32le(tx.version), u32le(tx.versionGroupId), u32le(tx.consensusBranchId), u32le(tx.lockTime), u32le(tx.expiryHeight)]); return Buffer.from(blake2b(data,{dkLen:32, personalization: Buffer.from('ZTxIdHeadersHash','utf8')})); }
function prevoutsDigest(tx){ const parts=[]; for(const i of tx.inputs){ parts.push(Buffer.from(i.txid,'hex').reverse(), u32le(i.vout)); } return Buffer.from(blake2b(Buffer.concat(parts),{dkLen:32, personalization: Buffer.from('ZTxIdPrevoutHash','utf8')})); }
function sequenceDigest(tx){ const parts=tx.inputs.map(i=>u32le(i.sequence)); return Buffer.from(blake2b(Buffer.concat(parts),{dkLen:32, personalization: Buffer.from('ZTxIdSequencHash','utf8')})); }
function outputsDigest(tx){ const parts=[]; for(const o of tx.outputs){ parts.push(u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey); } return Buffer.from(blake2b(Buffer.concat(parts),{dkLen:32, personalization: Buffer.from('ZTxIdOutputsHash','utf8')})); }
function transparentDigest(tx){ const data=Buffer.concat([prevoutsDigest(tx), sequenceDigest(tx), outputsDigest(tx)]); return Buffer.from(blake2b(data,{dkLen:32, personalization: Buffer.from('ZTxIdTranspaHash','utf8')})); }
function sigHashV5(tx, idx){ const input=tx.inputs[idx]; const pre=Buffer.concat([ headerDigestV5(tx), transparentDigest(tx), Buffer.alloc(32), Buffer.alloc(32), u32le(1), Buffer.from(input.txid,'hex').reverse(), u32le(input.vout), varint(input.scriptPubKey.length), input.scriptPubKey, u64le(input.value), u32le(input.sequence) ]); const pers=Buffer.from('ZTxIdSigHash\0\0\0\0','utf8'); return Buffer.from(blake2b(pre,{dkLen:32, personalization: pers})); }
function signatureToDER(sig64){ const r=sig64.slice(0,32), s=sig64.slice(32,64); const canon=b=>{let i=0; while(i<b.length-1&&b[i]===0&&!(b[i+1]&0x80)) i++; return (b[i]&0x80)? Buffer.concat([Buffer.from([0x00]), Buffer.from(b.slice(i))]): Buffer.from(b.slice(i));}; const n=0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n, half=n/2n; const rB=canon(r); let sB=canon(s); const sVal=BigInt('0x'+sB.toString('hex')); if(sVal>half) sB=canon(Buffer.from((n-sVal).toString(16).padStart(64,'0'),'hex')); const body=Buffer.concat([Buffer.from([0x02,rB.length]), rB, Buffer.from([0x02,sB.length]), sB]); return Buffer.concat([Buffer.from([0x30,body.length]), body]); }

async function getConsensusBranchId(){ if(process.env.CONSENSUS_BRANCH_ID){ const v=process.env.CONSENSUS_BRANCH_ID.trim(); return v.startsWith('0x')?parseInt(v,16):parseInt(v,10);} const r=await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.TATUM_API_KEY||''},body:JSON.stringify({jsonrpc:'2.0',method:'getblockchaininfo',id:1})}); const j=await r.json(); return parseInt(j.result.consensus.nextblock,16); }
async function getUTXOs(addr){ const r=await fetch(`https://utxos.zerdinals.com/api/utxos/${addr}`); return r.json(); }
async function broadcast(txHex){ try{ const r=await fetch('https://utxos.zerdinals.com/api/send-transaction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rawTransaction:txHex})}); const j=await r.json(); if(r.ok&&(j.result||j.txid)) return j.result||j.txid; }catch(_){} const r2=await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.TATUM_API_KEY||''},body:JSON.stringify({jsonrpc:'2.0',method:'sendrawtransaction',params:[txHex],id:1})}); const j2=await r2.json(); if(j2.error) throw new Error(j2.error?.message||JSON.stringify(j2.error)); return j2.result; }

(async()=>{
  console.log('\n=== Build Commit v5 (ZIP-244) ===');
  const priv=wifToPrivateKey(WALLET.privateKeyWIF); const pub=Buffer.from(await secp256k1.getPublicKey(priv,true)); const pkh=addressToPubKeyHash(WALLET.address);
  const chunks=createInscriptionChunks('text/plain','hello world');
  const redeemScript=createRedeemScript(pub,chunks);
  const p2shScript=buildP2SHScriptFromRedeem(redeemScript);
  console.log('P2SH script:', p2shScript.toString('hex'));
  const utxos=await getUTXOs(WALLET.address); const u=utxos.find(x=>x.value>=INSCRIPTION_AMOUNT+TX_FEE)||utxos[0];
  if(!u) throw new Error('No suitable UTXO');
  console.log('UTXO:', `${u.txid}:${u.vout}`, 'value=', u.value);

  const change=u.value-INSCRIPTION_AMOUNT-TX_FEE; const outputs=[{value:INSCRIPTION_AMOUNT, scriptPubKey:p2shScript}]; if(change>546) outputs.push({value:change, scriptPubKey:buildP2PKHScript(pkh)});
  const consensusBranchId=await getConsensusBranchId();
  console.log('BranchID: 0x'+consensusBranchId.toString(16));
  const txData={ version:5, versionGroupId:0x26a7270a, consensusBranchId, lockTime:0, expiryHeight:0, inputs:[{txid:u.txid, vout:u.vout, sequence:0xfffffffd, value:u.value, scriptPubKey:buildP2PKHScript(pkh)}], outputs };
  const sigHash=sigHashV5(txData,0); const sig=await secp256k1.sign(sigHash,priv); const ok=await secp256k1.verify(sig,sigHash,pub); console.log('Local verify:', ok?'OK':'FAIL');
  const der=signatureToDER(sig.toCompactRawBytes?sig.toCompactRawBytes():sig); const sigWithType=Buffer.concat([der, Buffer.from([0x01])]);

  // Serialize (v5 wire tentative): header first, then vin/vout, then sapling placeholders
  const version=u32le(5); const vgid=u32le(0x26a7270a);
  const lock=u32le(0), exp=u32le(0);
  // Transparent bundle
  const inCount=varint(1);
  const prev=Buffer.from(u.txid,'hex').reverse(); const vout=u32le(u.vout); const seq=u32le(0xfffffffd);
  const scriptSig=Buffer.concat([Buffer.from([sigWithType.length]), sigWithType, Buffer.from([pub.length]), pub]); const scriptLen=varint(scriptSig.length);
  const outCount=varint(outputs.length); const outsBuf=Buffer.concat(outputs.map(o=>Buffer.concat([u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey])));
  // Empty shielded bundles per ZIP-225
  const nSpendsSapling = varint(0);
  const nOutputsSapling = varint(0);
  const orchardFlags = Buffer.from([0x00]);
  const nActionsOrchard = varint(0);
  const raw=Buffer.concat([
    version, vgid,
    lock, exp,
    // transparent bundle
    inCount,
    prev, vout, scriptLen, scriptSig, seq,
    outCount, outsBuf,
    // empty sapling/orchard bundles
    nSpendsSapling, nOutputsSapling,
    orchardFlags, nActionsOrchard
  ]);
  const hex=raw.toString('hex');
  console.log('Hex:', hex.slice(0,120)+'...');
  if(process.env.BROADCAST==='1'){ const txid=await broadcast(hex); console.log('Commit v5 txid:', txid); }
})().catch(e=>{ console.error('Error:', e.message||e); if(e.stack) console.error(e.stack); process.exit(1); });
