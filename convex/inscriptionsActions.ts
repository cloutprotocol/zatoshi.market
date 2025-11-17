import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import {
  addressToPkh,
  buildP2PKHScript,
  buildCommitTxHex,
  buildInscriptionChunks,
  buildInscriptionDataBuffer,
  buildRevealTxHex,
  createRevealScript,
  fetchUtxos,
  p2shFromRedeem,
  getConsensusBranchId,
  broadcastTransaction,
  zip243Sighash,
  wifToPriv,
  signatureToDER,
} from "@/lib/zcash/inscriptions";

export const mintInscriptionAction = action({
  args: {
    wif: v.string(),
    address: v.string(),
    content: v.optional(v.string()),
    contentJson: v.optional(v.string()),
    contentType: v.optional(v.string()),
    type: v.optional(v.string()),
    inscriptionAmount: v.optional(v.number()),
    fee: v.optional(v.number()),
    waitMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const inscriptionAmount = args.inscriptionAmount ?? 60000;
    const fee = args.fee ?? 10000;
    const waitMs = args.waitMs ?? 10000;
    const contentStr = args.contentJson ?? args.content ?? "hello world";
    const contentType = args.contentType ?? (args.contentJson ? "application/json" : "text/plain");

    const pkh = addressToPkh(args.address);

    // UTXO selection (simple: pick first confirmed >= needed)
    const utxos = await fetchUtxos(args.address);
    const required = inscriptionAmount + fee;
    // Attempt to lock a suitable UTXO to avoid races
    let utxo = utxos.find(u => u.value >= required);
    let locked = false;
    while (utxo) {
      const res = await ctx.runMutation(internal.utxoLocks.lockUtxo, {
        txid: utxo.txid,
        vout: utxo.vout,
        address: args.address,
        lockedBy: undefined,
      });
      if (res.locked) { locked = true; break; }
      // pick next candidate if lock failed
      utxo = utxos.find(u => u.value >= required && (u.txid !== utxo!.txid || u.vout !== utxo!.vout));
    }
    if (!locked || !utxo) throw new Error(`No safe unlocked UTXO >= ${required}`);

    const chunks = buildInscriptionChunks(contentType, contentStr);
    const branchId = await getConsensusBranchId();
    const redeemScript = createRevealScript(Buffer.from([]), chunks); // temp key push adjusted at build stage

    // Build actual revealScript with real pubkey during commit builder (it returns pubKey)
    // Get P2SH script placeholder for now
    const p2sh = p2shFromRedeem(redeemScript);

    // Commit (build with proper pubkey via helper)
    const commitBuilt = await buildCommitTxHex({
      utxo,
      address: args.address,
      wif: args.wif,
      inscriptionAmount,
      fee,
      consensusBranchId: branchId,
      redeemScript: Buffer.alloc(0), // will be recomputed below
      p2shScript: p2sh.script,
    });

    // Recompute redeemScript with correct pubkey and p2sh
    const redeemScriptFixed = createRevealScript(commitBuilt.pubKey, chunks);
    const p2shFixed = p2shFromRedeem(redeemScriptFixed);

    // Rebuild commit with corrected scripts
    const commitRebuilt = await buildCommitTxHex({
      utxo,
      address: args.address,
      wif: args.wif,
      inscriptionAmount,
      fee,
      consensusBranchId: branchId,
      redeemScript: redeemScriptFixed,
      p2shScript: p2shFixed.script,
    });

    let commitTxid: string | undefined;
    try {
      commitTxid = await broadcastTransaction(commitRebuilt.hex);
    } catch (e) {
      // unlock on failure
      await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: utxo.txid, vout: utxo.vout });
      throw e;
    }

    await new Promise(r => setTimeout(r, waitMs));

    const inscriptionData = buildInscriptionDataBuffer(contentStr, contentType);
    const revealHex = await buildRevealTxHex({
      commitTxid,
      address: args.address,
      wif: args.wif,
      inscriptionAmount,
      fee,
      consensusBranchId: branchId,
      redeemScript: redeemScriptFixed,
      inscriptionData,
    });
    const revealTxid = await broadcastTransaction(revealHex);
    const inscriptionId = `${revealTxid}i0`;
    // Optionally release lock now, or leave to confirmation watchdog
    await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: utxo.txid, vout: utxo.vout });

    // Log final inscription (optional: adapt to schema expectations)
    const preview = contentStr.slice(0, 200);
    await ctx.runMutation(api.inscriptions.createInscription, {
      txid: revealTxid,
      address: args.address,
      contentType,
      contentPreview: preview,
      contentSize: Buffer.byteLength(contentStr),
      type: args.type ?? (contentType.startsWith("application/json") ? "zrc20" : "text"),
      platformFeeZat: 0,
      treasuryAddress: args.address,
      zrc20Tick: undefined,
      zrc20Op: undefined,
      zrc20Amount: undefined,
    } as any);

    return { commitTxid, revealTxid, inscriptionId };
  }
});

export const splitUtxosAction = action({
  args: {
    wif: v.string(),
    address: v.string(),
    splitCount: v.number(),
    targetAmount: v.number(),
    fee: v.number(),
  },
  handler: async (ctx, args) => {
    const { wif, address, splitCount, targetAmount, fee } = args;
    const tatumKey = process.env.TATUM_API_KEY || '';
    const utxos = await fetchUtxos(address);
    const required = splitCount * targetAmount + fee;
    const src = utxos.find(u => u.value >= required);
    if (!src) throw new Error(`No UTXO >= ${required}`);

    // Helpers
    const u32le = (n: number) => { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(n); return b; };
    const u64le = (n: number) => { const b = Buffer.allocUnsafe(8); b.writeBigUInt64LE(BigInt(n)); return b; };
    const varint = (n: number) => n < 0xfd ? Buffer.from([n]) : (()=>{ const b=Buffer.allocUnsafe(3); b[0]=0xfd; b.writeUInt16LE(n,1); return b; })();

    // Build outputs
    const pkh = addressToPkh(address);
    const outputs: { value: number; scriptPubKey: Buffer }[] = [];
    for (let i=0;i<splitCount;i++) outputs.push({ value: targetAmount, scriptPubKey: buildP2PKHScript(pkh) });
    const change = src.value - required;
    if (change > 546) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });

    // Sign v4 using lib helpers
    const consensusBranchId = await getConsensusBranchId(tatumKey);
    const inputs = [{ txid: src.txid, vout: src.vout, sequence: 0xfffffffd, value: src.value, scriptPubKey: buildP2PKHScript(pkh) }];
    const txData = { version: 0x80000004, versionGroupId: 0x892f2085, consensusBranchId, lockTime:0, expiryHeight:0, inputs, outputs };
    const priv = wifToPriv(wif);
    const sigHash = zip243Sighash(txData as any, 0);
    const pub = Buffer.from(await (await import("@noble/secp256k1")).getPublicKey(priv, true));
    const sig = await (await import("@noble/secp256k1")).sign(sigHash, priv);
    const der = signatureToDER(sig.toCompactRawBytes?sig.toCompactRawBytes():sig);
    const sigType = Buffer.concat([der, Buffer.from([0x01])]);
    const version = u32le(0x80000004);
    const vgid = u32le(0x892f2085);
    const inCount = Buffer.from([0x01]);
    const prev = Buffer.from(src.txid,'hex').reverse();
    const voutBuf = u32le(src.vout);
    const scriptSig = Buffer.concat([ Buffer.from([sigType.length]), sigType, Buffer.from([pub.length]), pub ]);
    const scriptLen = varint(scriptSig.length);
    const seq = u32le(0xfffffffd);
    const outCount = varint(outputs.length);
    const outsBuf = Buffer.concat(outputs.map(o=>Buffer.concat([u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey])));
    const lock = u32le(0); const exp = u32le(0); const valBal = Buffer.alloc(8);
    const nSS = Buffer.from([0x00]), nSO = Buffer.from([0x00]), nJS = Buffer.from([0x00]);
    const raw = Buffer.concat([ version, vgid, inCount, prev, voutBuf, scriptLen, scriptSig, seq, outCount, outsBuf, lock, exp, valBal, nSS, nSO, nJS ]);
    const txid = await broadcastTransaction(raw.toString('hex'), tatumKey);
    return { txid };
  }
});

export const batchMintAction = action({
  args: {
    wif: v.string(),
    address: v.string(),
    count: v.number(),
    content: v.optional(v.string()),
    contentJson: v.optional(v.string()),
    contentType: v.optional(v.string()),
    inscriptionAmount: v.optional(v.number()),
    fee: v.optional(v.number()),
    waitMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const results: { commitTxid: string; revealTxid: string; inscriptionId: string }[] = [];
    for (let i=0;i<args.count;i++) {
      const res = await mintInscriptionAction.handler(ctx as any, args as any);
      results.push(res as any);
    }
    return { count: results.length, results };
  }
});
