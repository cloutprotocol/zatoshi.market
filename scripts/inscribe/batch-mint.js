/**
 * Batch mint inscriptions safely using safe UTXO selection and v4 commit/reveal
 *
 * Env:
 *  - COUNT (default 10)
 *  - WALLET_ADDRESS, WALLET_WIF
 *  - CONTENT_TYPE (application/json), CONTENT_JSON or CONTENT
 *  - INSCRIPTION_AMOUNT (default 60000), TX_FEE (default 10000)
 *  - CONSENSUS_BRANCH_ID or fetched
 *  - WAIT_MS (default 10000)
 */

const bs58check = require('bs58check').default;
const { blake2b } = require('@noble/hashes/blake2b');
const { sha256 } = require('@noble/hashes/sha256');
const { ripemd160 } = require('@noble/hashes/ripemd160');
const secp256k1 = require('@noble/secp256k1');
const { hmac } = require('@noble/hashes/hmac');
secp256k1.etc.hmacSha256Sync = (key, ...msgs) => hmac(sha256, key, secp256k1.etc.concatBytes(...msgs));

const COUNT = Number(process.env.COUNT || 10);
const WALLET = {
  address: process.env.WALLET_ADDRESS || 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x',
  privateKeyWIF: process.env.WALLET_WIF || 'L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q'
};
const INSCRIPTION_AMOUNT = Number(process.env.INSCRIPTION_AMOUNT || 60000);
const TX_FEE = Number(process.env.TX_FEE || 10000);
const CONTENT_TYPE = process.env.CONTENT_TYPE || 'application/json';
const CONTENT = process.env.CONTENT || '';
const CONTENT_JSON = process.env.CONTENT_JSON;
const WAIT_MS = Number(process.env.WAIT_MS || 10000);

function varint(n){ if(n<0xfd) return Buffer.from([n]); if(n<=0xffff){ const b=Buffer.allocUnsafe(3); b[0]=0xfd; b.writeUInt16LE(n,1); return b;} const b=Buffer.allocUnsafe(5); b[0]=0xfe; b.writeUInt32LE(n,1); return b; }
function u32le(n){ const b=Buffer.allocUnsafe(4); b.writeUInt32LE(n); return b; }
function u64le(n){ const b=Buffer.allocUnsafe(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function hash160(buf){ return Buffer.from(ripemd160(sha256(buf))); }
function buildP2PKHScript(pkh){ return Buffer.concat([Buffer.from([0x76,0xa9,0x14]), pkh, Buffer.from([0x88,0xac])]); }
function compilePush(data){ if(data.length<=75) return Buffer.concat([Buffer.from([data.length]), data]); if(data.length<=0xff) return Buffer.concat([Buffer.from([0x4c, data.length]), data]); const l=Buffer.allocUnsafe(2); l.writeUInt16LE(data.length); return Buffer.concat([Buffer.from([0x4d]), l, data]); }
function createInscriptionChunks(contentType, data){ return [Buffer.from('ord','utf8'), 0x51, Buffer.from(contentType,'utf8'), 0x00, Buffer.isBuffer(data)?data:Buffer.from(data,'utf8')]; }
function createRedeemScript(pub, chunks){ const ops=[pub,0xad]; for(let i=0;i<chunks.length;i++) ops.push(0x75); ops.push(0x51); return Buffer.concat(ops.map(e=> Buffer.isBuffer(e)? compilePush(e): Buffer.from([e]))); }
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
async function fetchUTXOs(addr){ const r=await fetch(`https://utxos.zerdinals.com/api/utxos/${addr}`); return r.json(); }
async function checkUTXO(location){ try{ const r=await fetch(`https://indexer.zerdinals.com/location/${location}`); if(r.status===404) return false; const j=await r.json(); if(j && j.code===404) return false; return true; }catch(_){ throw new Error(`Cannot verify ${location} safe status`);} }
async function getSafeUtxo(required){ const utxos = await fetchUTXOs(WALLET.address); for(const u of utxos){ const loc = `${u.txid}:${u.vout}`; const hasInscr = await checkUTXO(loc); if(!hasInscr && u.value >= required) return u; } return null; }
async function broadcast(txHex){ try{ const r=await fetch('https://utxos.zerdinals.com/api/send-transaction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rawTransaction:txHex})}); const j=await r.json(); if(r.ok&&(j.result||j.txid)) return j.result||j.txid; }catch(_){ } const r2=await fetch('https://api.tatum.io/v3/blockchain/node/zcash-mainnet',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.TATUM_API_KEY||''},body:JSON.stringify({jsonrpc:'2.0',method:'sendrawtransaction',params:[txHex],id:1})}); const j2=await r2.json(); if(j2.error) throw new Error(j2.error?.message||JSON.stringify(j2.error)); return j2.result; }

(async()=>{
  console.log('=== Batch Mint ===');
  const contentData = CONTENT_JSON ? CONTENT_JSON : CONTENT || JSON.stringify({p:'zrc-20', op:'mint', tick:'PEPE', amt:'1000'});
  console.log('Content type:', CONTENT_TYPE);
  console.log('Content:', contentData);
  const priv = wifToPrivateKey(WALLET.privateKeyWIF);
  const pub = Buffer.from(await secp256k1.getPublicKey(priv, true));
  const pkh = addressToPubKeyHash(WALLET.address);
  const consensusBranchId = await getConsensusBranchId();

  const minted = [];
  for(let i=0;i<COUNT;i++){
    console.log(`\n--- Mint ${i+1}/${COUNT} ---`);
    const required = INSCRIPTION_AMOUNT + TX_FEE;
    const u = await getSafeUtxo(required);
    if(!u) throw new Error('No safe UTXO available with sufficient value');
    console.log('Using UTXO:', `${u.txid}:${u.vout}`, 'value=', u.value);

    // Build inscription artifacts
    const chunks = createInscriptionChunks(CONTENT_TYPE, contentData);
    const redeemScript = createRedeemScript(pub, chunks);
    const p2shScript = buildP2SHScriptFromRedeem(redeemScript);

    // Commit
    const inputsC = [{ txid: u.txid, vout: u.vout, sequence: 0xfffffffd, value: u.value, scriptPubKey: buildP2PKHScript(pkh) }];
    const change = u.value - required;
    const outputsC = [{ value: INSCRIPTION_AMOUNT, scriptPubKey: p2shScript }];
    if(change > 546) outputsC.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });
    const txC = { version: 0x80000004, versionGroupId: 0x892f2085, consensusBranchId, lockTime:0, expiryHeight:0, inputs: inputsC, outputs: outputsC };
    const sHC = zip243SigHash(txC, 0);
    const sigC = await secp256k1.sign(sHC, priv);
    const derC = sigDER(sigC.toCompactRawBytes?sigC.toCompactRawBytes():sigC);
    const sigTypeC = Buffer.concat([derC, Buffer.from([0x01])]);
    const version= u32le(0x80000004), vgid=u32le(0x892f2085), inCount=varint(1), prev=Buffer.from(u.txid,'hex').reverse(), vout=u32le(u.vout), seq=u32le(0xfffffffd);
    const scriptSigC = Buffer.concat([Buffer.from([sigTypeC.length]), sigTypeC, Buffer.from([pub.length]), pub]);
    const scriptLenC = varint(scriptSigC.length);
    const outCount= varint(outputsC.length); const outsBuf= Buffer.concat(outputsC.map(o=>Buffer.concat([u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey])));
    const lock=u32le(0), exp=u32le(0), valBal=Buffer.alloc(8), nSS=Buffer.from([0x00]), nSO=Buffer.from([0x00]), nJS=Buffer.from([0x00]);
    const rawC = Buffer.concat([version, vgid, inCount, prev, vout, scriptLenC, scriptSigC, seq, outCount, outsBuf, lock, exp, valBal, nSS, nSO, nJS]);
    const commitTxid = await broadcast(rawC.toString('hex'));
    console.log('Commit txid:', commitTxid);

    await new Promise(r=>setTimeout(r, WAIT_MS));

    // Reveal
    const outValue = INSCRIPTION_AMOUNT - TX_FEE;
    if(outValue <= 0) throw new Error('Inscription amount too small for fee');
    const outputScript = buildP2PKHScript(pkh);
    const inputsR = [{ txid: commitTxid, vout: 0, sequence: 0xffffffff, value: INSCRIPTION_AMOUNT, scriptPubKey: redeemScript }];
    const outputsR = [{ value: outValue, scriptPubKey: outputScript }];
    const txR = { version: 0x80000004, versionGroupId: 0x892f2085, consensusBranchId, lockTime:0, expiryHeight:0, inputs: inputsR, outputs: outputsR };
    const sHR = zip243SigHash(txR, 0);
    const sigR = await secp256k1.sign(sHR, priv);
    const derR = sigDER(sigR.toCompactRawBytes?sigR.toCompactRawBytes():sigR);
    const sigTypeR = Buffer.concat([derR, Buffer.from([0x01])]);
    const inscriptionData = Buffer.concat([ compilePush(Buffer.from('ord')), Buffer.from([0x51]), compilePush(Buffer.from(CONTENT_TYPE,'utf8')), Buffer.from([0x00]), compilePush(Buffer.from(contentData,'utf8')) ]);
    const scriptSigR = Buffer.concat([ inscriptionData, Buffer.from([sigTypeR.length]), sigTypeR, Buffer.from([redeemScript.length]), redeemScript ]);
    const versionR= u32le(0x80000004), vgidR=u32le(0x892f2085), inCountR=varint(1), prevR=Buffer.from(commitTxid,'hex').reverse(), voutR=u32le(0), seqR=u32le(0xffffffff);
    const scriptLenR= varint(scriptSigR.length), outCountR= varint(1), outBufR= Buffer.concat([u64le(outValue), varint(outputScript.length), outputScript]);
    const lockR=u32le(0), expR=u32le(0), valBalR=Buffer.alloc(8), nSSR=Buffer.from([0x00]), nSOR=Buffer.from([0x00]), nJSR=Buffer.from([0x00]);
    const rawR = Buffer.concat([versionR, vgidR, inCountR, prevR, voutR, scriptLenR, scriptSigR, seqR, outCountR, outBufR, lockR, expR, valBalR, nSSR, nSOR, nJSR]);
    const revealTxid = await broadcast(rawR.toString('hex'));
    console.log('Reveal txid:', revealTxid);
    console.log('Inscription ID:', `${revealTxid}i0`);
    minted.push(revealTxid);
  }

  console.log('\nCompleted mints:', minted.length);
  minted.forEach((txid,idx)=> console.log(`${idx+1}. https://zerdinals.com/inscription/${txid}i0`));
})();

