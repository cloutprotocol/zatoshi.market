const bs58check = require('bs58check').default;
const { blake2b } = require('@noble/hashes/blake2b');
const { sha256 } = require('@noble/hashes/sha256');
const secp256k1 = require('@noble/secp256k1');
const { hmac } = require('@noble/hashes/hmac');
secp256k1.etc.hmacSha256Sync = (key, ...msgs) => hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));

const WALLET = {
  address: 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};

const TX_FEE = Number(process.env.TX_FEE || 10000);

function varint(n) { if (n < 0xfd) return Buffer.from([n]); if (n <= 0xffff){ const b=Buffer.allocUnsafe(3); b[0]=0xfd; b.writeUInt16LE(n,1); return b;} const b=Buffer.allocUnsafe(5); b[0]=0xfe; b.writeUInt32LE(n,1); return b; }
function u32le(n){ const b=Buffer.allocUnsafe(4); b.writeUInt32LE(n); return b;}
function u64le(n){ const b=Buffer.allocUnsafe(8); b.writeBigUInt64LE(BigInt(n)); return b;}

function buildP2PKHScript(pubKeyHash){ return Buffer.concat([Buffer.from([0x76,0xa9,0x14]), pubKeyHash, Buffer.from([0x88,0xac])]); }
function addressToPubKeyHash(addr){ const d=bs58check.decode(addr); return d.slice(2); }
function wifToPrivateKey(wif){ const d=bs58check.decode(wif); return d.slice(1, d.length===34?33:undefined); }

function sha256d(b){ return Buffer.from(sha256(sha256(b))); }
function getPrevoutsHash(inputs){ const parts=[]; for(const i of inputs){ parts.push(Buffer.from(i.txid,'hex').reverse(), u32le(i.vout)); } return sha256d(Buffer.concat(parts)); }
function getSequenceHash(inputs){ const parts=inputs.map(i=>u32le(i.sequence)); return sha256d(Buffer.concat(parts)); }
function getOutputsHash(outputs){ const parts=[]; for(const o of outputs){ parts.push(u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey); } return sha256d(Buffer.concat(parts)); }
function getTransparentSignatureHashV4(tx, idx){ const input=tx.inputs[idx]; const pre=Buffer.concat([u32le(tx.version),u32le(tx.versionGroupId),getPrevoutsHash(tx.inputs),getSequenceHash(tx.inputs),getOutputsHash(tx.outputs),Buffer.alloc(32),Buffer.alloc(32),Buffer.alloc(32),u32le(tx.lockTime),u32le(tx.expiryHeight),u64le(0),u32le(1),Buffer.from(input.txid,'hex').reverse(),u32le(input.vout),varint(input.scriptPubKey.length),input.scriptPubKey,u64le(input.value),u32le(input.sequence)]); const pers=Buffer.alloc(16); Buffer.from('ZcashSigHash').copy(pers); u32le(tx.consensusBranchId).copy(pers,12); return Buffer.from(blake2b(pre,{dkLen:32, personalization:pers})); }
function signatureToDER(sig64){ const r=sig64.slice(0,32), s=sig64.slice(32,64); const can=b=>{ let i=0; while(i<b.length-1&&b[i]===0&&!(b[i+1]&0x80))i++; return (b[i]&0x80)? Buffer.concat([Buffer.from([0x00]), Buffer.from(b.slice(i))]): Buffer.from(b.slice(i));}; const n=0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n,half=n/2n; const rB=can(r); let sB=can(s); const sVal=BigInt('0x'+sB.toString('hex')); if(sVal>half) sB=can(Buffer.from((n-sVal).toString(16).padStart(64,'0'),'hex')); const body=Buffer.concat([Buffer.from([0x02,rB.length]),rB,Buffer.from([0x02,sB.length]),sB]); return Buffer.concat([Buffer.from([0x30,body.length]),body]); }

async function getConsensusBranchId(){ if(process.env.CONSENSUS_BRANCH_ID){ const v=process.env.CONSENSUS_BRANCH_ID.trim(); return v.startsWith('0x')?parseInt(v,16):parseInt(v,10);} const r=await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.TATUM_API_KEY||''},body:JSON.stringify({jsonrpc:'2.0',method:'getblockchaininfo',id:1})}); const j=await r.json(); return parseInt(j.result.consensus.nextblock,16); }
async function getUTXOs(addr){ const r=await fetch(`https://utxos.zerdinals.com/api/utxos/${addr}`); return r.json(); }
async function broadcast(txHex){ const r=await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.TATUM_API_KEY||''},body:JSON.stringify({jsonrpc:'2.0',method:'sendrawtransaction',params:[txHex],id:1})}); const j=await r.json(); if(j.error) throw new Error(j.error?.message||JSON.stringify(j.error)); return j.result; }

(async()=>{
  const priv=wifToPrivateKey(WALLET.privateKeyWIF); const pub=Buffer.from(await secp256k1.getPublicKey(priv,true)); const pkh=addressToPubKeyHash(WALLET.address);
  const utxos=await getUTXOs(WALLET.address); const u=utxos[0];
  const outValue=u.value - TX_FEE; const outScript=buildP2PKHScript(pkh);
  const consensusBranchId=await getConsensusBranchId();
  const txData={version:0x00000004, versionGroupId:0x892f2085, consensusBranchId, lockTime:0, expiryHeight:0, inputs:[{txid:u.txid, vout:u.vout, sequence:0xffffffff, value:u.value, scriptPubKey:buildP2PKHScript(pkh)}], outputs:[{value:outValue, scriptPubKey:outScript}]};
  const sigHash=getTransparentSignatureHashV4(txData,0); const sig=await secp256k1.sign(sigHash,priv); const ok=await secp256k1.verify(sig,sigHash,pub); console.log('Local verify:', ok);
  const der=signatureToDER(sig.toCompactRawBytes?sig.toCompactRawBytes():sig); const sigType=Buffer.concat([der,Buffer.from([0x01])]);
  const version=u32le(0x80000004), vgid=u32le(0x892f2085), inCount=varint(1), prev=Buffer.from(u.txid,'hex').reverse(), vout=u32le(u.vout), seq=u32le(0xffffffff);
  const scriptSig=Buffer.concat([Buffer.from([sigType.length]),sigType,Buffer.from([pub.length]),pub]); const scriptLen=varint(scriptSig.length);
  const outCount=varint(1); const outBuf=Buffer.concat([u64le(outValue), varint(outScript.length), outScript]);
  const lock=u32le(0), exp=u32le(0), valBal=Buffer.alloc(8), nSS=Buffer.from([0x00]), nSO=Buffer.from([0x00]), nJS=Buffer.from([0x00]);
  const raw=Buffer.concat([version,vgid,inCount,prev,vout,scriptLen,scriptSig,seq,outCount,outBuf,lock,exp,valBal,nSS,nSO,nJS]);
  const hex=raw.toString('hex'); console.log('Hex:', hex.slice(0,120)+'...');
  if(process.env.BROADCAST==='1'){ const txid=await broadcast(hex); console.log('TXID:', txid);} else { console.log('Set BROADCAST=1 to send'); }
})().catch(e=>{console.error(e);process.exit(1)});
