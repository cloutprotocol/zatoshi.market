/**
 * One-shot mint: commit + reveal for a Zcash inscription (v4/ZIP-243)
 * Supports text and JSON (ZRC-20) via CONTENT/CONTENT_JSON + CONTENT_TYPE
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

const INSCRIPTION_AMOUNT = Number(process.env.INSCRIPTION_AMOUNT || 60000);
const TX_FEE = Number(process.env.TX_FEE || 10000);
const CONTENT = process.env.CONTENT || '';
const CONTENT_JSON = process.env.CONTENT_JSON; // raw JSON string
const CONTENT_TYPE = process.env.CONTENT_TYPE || 'text/plain';
const WAIT_MS = Number(process.env.WAIT_MS || 10000);

function varint(n){ if(n<0xfd) return Buffer.from([n]); if(n<=0xffff){ const b=Buffer.allocUnsafe(3); b[0]=0xfd; b.writeUInt16LE(n,1); return b;} const b=Buffer.allocUnsafe(5); b[0]=0xfe; b.writeUInt32LE(n,1); return b; }
function u32le(n){ const b=Buffer.allocUnsafe(4); b.writeUInt32LE(n); return b; }
function u64le(n){ const b=Buffer.allocUnsafe(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function hash160(buf){ return Buffer.from(ripemd160(sha256(buf))); }
function buildP2PKHScript(pkh){ return Buffer.concat([Buffer.from([0x76,0xa9,0x14]), pkh, Buffer.from([0x88,0xac])]); }
function compilePush(data){ if(data.length<=75) return Buffer.concat([Buffer.from([data.length]), data]); if(data.length<=0xff) return Buffer.concat([Buffer.from([0x4c, data.length]), data]); const l=Buffer.allocUnsafe(2); l.writeUInt16LE(data.length); return Buffer.concat([Buffer.from([0x4d]), l, data]); }
function compileScript(elements){ const parts=[]; for(const el of elements){ if(Buffer.isBuffer(el)) parts.push(compilePush(el)); else if(typeof el==='number') parts.push(Buffer.from([el])); else throw new Error('bad el'); } return Buffer.concat(parts); }
function createInscriptionChunks(contentType, data){ return [Buffer.from('ord','utf8'), 0x51, Buffer.from(contentType,'utf8'), 0x00, Buffer.isBuffer(data)?data:Buffer.from(data,'utf8')]; }
function createRedeemScript(pub, inscriptionChunks){ const ops=[pub,0xad]; for(let i=0;i<inscriptionChunks.length;i++) ops.push(0x75); ops.push(0x51); return compileScript(ops); }
function buildP2SHScriptFromRedeem(redeem){ const h=hash160(redeem); return Buffer.concat([Buffer.from([0xa9,0x14]), h, Buffer.from([0x87])]); }
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
async function fetchZerdinalsId(revealTxid){ try{ const r=await fetch(`https://indexer.zerdinals.com/inscription/${revealTxid}i0`); if(!r.ok) return null; const j=await r.json(); return j?.id || j?.number || null; }catch(_){ return null; }
}

(async()=>{
  // Prepare content
  const contentData = CONTENT_JSON ? CONTENT_JSON : CONTENT || 'hello world';
  console.log('Content type:', CONTENT_TYPE);
  console.log('Content:', contentData);

  const priv = wifToPrivateKey(WALLET.privateKeyWIF);
  const pub = Buffer.from(await secp256k1.getPublicKey(priv, true));
  const pkh = addressToPubKeyHash(WALLET.address);
  const chunks = createInscriptionChunks(CONTENT_TYPE, contentData);
  const redeemScript = createRedeemScript(pub, chunks);
  const p2shScript = buildP2SHScriptFromRedeem(redeemScript);
  const consensusBranchId = await getConsensusBranchId();
  const utxos = await getUTXOs(WALLET.address);
  const u = utxos.find(x=>x.value >= INSCRIPTION_AMOUNT + TX_FEE) || utxos[0];
  if(!u) throw new Error('No suitable UTXO');

  // Build commit (v4)
  const commitInputs = [{ txid: u.txid, vout: u.vout, sequence: 0xfffffffd, value: u.value, scriptPubKey: buildP2PKHScript(pkh) }];
  const change = u.value - INSCRIPTION_AMOUNT - TX_FEE;
  const commitOutputs = [{ value: INSCRIPTION_AMOUNT, scriptPubKey: p2shScript }];
  if(change > 546) commitOutputs.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });
  const txDataCommit = { version: 0x80000004, versionGroupId: 0x892f2085, consensusBranchId, lockTime: 0, expiryHeight: 0, inputs: commitInputs, outputs: commitOutputs };
  const sigHashC = zip243SigHash(txDataCommit, 0);
  const sigC = await secp256k1.sign(sigHashC, priv);
  const derC = sigDER(sigC.toCompactRawBytes?sigC.toCompactRawBytes():sigC);
  const sigTypeC = Buffer.concat([derC, Buffer.from([0x01])]);
  const version= u32le(0x80000004), vgid=u32le(0x892f2085), inCount=varint(1), prev=Buffer.from(u.txid,'hex').reverse(), vout=u32le(u.vout), seq=u32le(0xfffffffd);
  const scriptSigC = Buffer.concat([Buffer.from([sigTypeC.length]), sigTypeC, Buffer.from([pub.length]), pub]);
  const scriptLenC = varint(scriptSigC.length);
  const outCount= varint(commitOutputs.length); const outsBuf= Buffer.concat(commitOutputs.map(o=>Buffer.concat([u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey])));
  const lock=u32le(0), exp=u32le(0), valBal=Buffer.alloc(8), nSS=Buffer.from([0x00]), nSO=Buffer.from([0x00]), nJS=Buffer.from([0x00]);
  const rawCommit = Buffer.concat([version, vgid, inCount, prev, vout, scriptLenC, scriptSigC, seq, outCount, outsBuf, lock, exp, valBal, nSS, nSO, nJS]);
  const commitHex = rawCommit.toString('hex');
  console.log('Commit hex:', commitHex.slice(0,120)+'...');
  const commitTxid = await broadcast(commitHex);
  console.log('Commit txid:', commitTxid);

  // Wait
  await new Promise(r=>setTimeout(r, WAIT_MS));

  // Build reveal
  const outValue = INSCRIPTION_AMOUNT - TX_FEE; if(outValue <= 0) throw new Error('Insufficient amount for reveal');
  const outputScript = buildP2PKHScript(pkh);
  const inputsR = [{ txid: commitTxid, vout: 0, sequence: 0xffffffff, value: INSCRIPTION_AMOUNT, scriptPubKey: redeemScript }];
  const outputsR = [{ value: outValue, scriptPubKey: outputScript }];
  const txDataReveal = { version: 0x80000004, versionGroupId: 0x892f2085, consensusBranchId, lockTime:0, expiryHeight:0, inputs: inputsR, outputs: outputsR };
  const sigHashR = zip243SigHash(txDataReveal, 0);
  const sigR = await secp256k1.sign(sigHashR, priv);
  const derR = sigDER(sigR.toCompactRawBytes?sigR.toCompactRawBytes():sigR);
  const sigTypeR = Buffer.concat([derR, Buffer.from([0x01])]);
  const inscriptionData = Buffer.concat([ compilePush(Buffer.from('ord')), Buffer.from([0x51]), compilePush(Buffer.from(CONTENT_TYPE,'utf8')), Buffer.from([0x00]), compilePush(Buffer.from(contentData,'utf8')) ]);
  const scriptSigR = Buffer.concat([ inscriptionData, Buffer.from([sigTypeR.length]), sigTypeR, Buffer.from([redeemScript.length]), redeemScript ]);
  const versionR= u32le(0x80000004), vgidR=u32le(0x892f2085), inCountR=varint(1), prevR=Buffer.from(commitTxid,'hex').reverse(), voutR=u32le(0), seqR=u32le(0xffffffff);
  const scriptLenR= varint(scriptSigR.length), outCountR= varint(1), outBufR= Buffer.concat([u64le(outValue), varint(outputScript.length), outputScript]);
  const lockR=u32le(0), expR=u32le(0), valBalR=Buffer.alloc(8), nSSR=Buffer.from([0x00]), nSOR=Buffer.from([0x00]), nJSR=Buffer.from([0x00]);
  const rawReveal = Buffer.concat([versionR, vgidR, inCountR, prevR, voutR, scriptLenR, scriptSigR, seqR, outCountR, outBufR, lockR, expR, valBalR, nSSR, nSOR, nJSR]);
  const revealHex = rawReveal.toString('hex');
  console.log('Reveal hex:', revealHex.slice(0,120)+'...');
  const revealTxid = await broadcast(revealHex);
  console.log('Reveal txid:', revealTxid);
  const inscriptionId = `${revealTxid}i0`;
  console.log('Inscription ID:', inscriptionId);
  const zid = await fetchZerdinalsId(revealTxid);
  if(zid){
    console.log('Zerdinals URL:', `https://zerdinals.com/zerdinals/${zid}`);
  } else {
    console.log('Zerdinals inscription URL:', `https://zerdinals.com/inscription/${inscriptionId}`);
  }
})();

