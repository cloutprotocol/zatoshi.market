"use node";

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
  checkInscriptionAt,
  p2shFromRedeem,
  getConsensusBranchId,
  broadcastTransaction,
  zip243Sighash,
  wifToPriv,
  signatureToDER,
  u32le,
  u64le,
  varint,
  hexToBytes,
  reverseBytes,
  bytesToHex,
  concatBytes,
  buildCommitSighash,
  assembleCommitTxHex,
  buildRevealSighash,
  assembleRevealTxHex,
  buildSplitSighash,
  assembleSplitTxHex,
  buildSplitSighashes,
  assembleSplitTxHexMulti,
  utf8,
} from "./zcashHelpers";
import { PLATFORM_FEE_ZATS, TREASURY_ADDRESS } from './treasury.config';
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";

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
    let currentStep = "initialization";
    try {
      currentStep = "parsing arguments";
      // Inputs & fees
      // - inscriptionAmount: value locked into the P2SH reveal output (vout 0 of commit)
      // - fee: ZIP-317 floor enforced to avoid "unpaid action limit" mempool rejections
      const inscriptionAmount = args.inscriptionAmount ?? 60000;
      const FEE_FLOOR_ZATS = 50000;
      const fee = Math.max(args.fee ?? 10000, FEE_FLOOR_ZATS);
      const waitMs = args.waitMs ?? 10000;
      const contentStr = args.contentJson ?? args.content ?? "hello world";
      const contentType = args.contentType ?? (args.contentJson ? "application/json" : "text/plain");

      currentStep = "loading platform config";
      // Platform fee is hard-coded in treasury.config. We always add a second output
      // to the commit that pays 0.001 ZEC (100,000 zats) to the treasury. Change is
      // computed after this fee so the commit has: [p2sh inscription, platform fee, change].
      const PLATFORM_TREASURY = TREASURY_ADDRESS;

      currentStep = "calling addressToPkh";
      const pkh = addressToPkh(args.address);

      // UTXO selection (simple: pick first confirmed >= needed)
      currentStep = "fetching UTXOs";
      let utxos;
      try {
        utxos = await fetchUtxos(args.address);
      } catch (_) {
        throw new Error('Unable to check your spendable funds right now. Please try again in a few seconds.');
      }

      currentStep = "selecting UTXO";
      const platformFeeZats = PLATFORM_FEE_ZATS; // Always apply platform fee
      const required = inscriptionAmount + fee + platformFeeZats;
      // Filter safe (non-inscribed) UTXOs first; if indexer fails, abort
      currentStep = "filtering UTXOs";
      const candidates = utxos.filter(u => u.value >= required);
      const safe: typeof candidates = [];

      currentStep = "checking inscriptions on UTXOs";
      for (const c of candidates) {
        const hasInscription = await checkInscriptionAt(`${c.txid}:${c.vout}`);
        if (!hasInscription) safe.push(c);
      }

      // Attempt to lock a suitable safe UTXO to avoid races
      currentStep = "locking UTXO";
      let utxo = safe[0];
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
        utxo = safe.find(u => (u.txid !== utxo!.txid || u.vout !== utxo!.vout));
      }
      if (!locked || !utxo) {
        throw new Error(
          `Not enough spendable funds for this inscription. ` +
          `You need at least ${required} zats available in a single input. ` +
          `Fresh deposits work best. Inputs holding inscriptions are protected and won't be used.`
        );
      }

      currentStep = "building inscription chunks";
      const chunks = buildInscriptionChunks(contentType, contentStr);

      currentStep = "getting consensus branch ID";
      const branchId = await getConsensusBranchId();
      currentStep = "creating reveal script";
      const redeemScript = createRevealScript(new Uint8Array(0), chunks); // temp key push adjusted at build stage

      // Build actual revealScript with real pubkey during commit builder (it returns pubKey)
      // Get P2SH script placeholder for now
      currentStep = "computing p2sh";
      const p2sh = p2shFromRedeem(redeemScript);

      // Commit (build with proper pubkey via helper)
      currentStep = "building initial commit tx";
      const commitBuilt = await buildCommitTxHex({
        utxo,
        address: args.address,
        wif: args.wif,
        inscriptionAmount,
        fee,
        consensusBranchId: branchId,
        redeemScript: new Uint8Array(0), // will be recomputed below
        p2shScript: p2sh.script,
      });

      // Recompute redeemScript with correct pubkey and p2sh
      currentStep = "recomputing scripts with pubkey";
      const redeemScriptFixed = createRevealScript(commitBuilt.pubKey, chunks);
      const p2shFixed = p2shFromRedeem(redeemScriptFixed);

      // Rebuild commit with corrected scripts
      currentStep = "rebuilding commit tx";
      const commitRebuilt = await buildCommitTxHex({
        utxo,
        address: args.address,
        wif: args.wif,
        inscriptionAmount,
        fee,
        consensusBranchId: branchId,
        redeemScript: redeemScriptFixed,
        p2shScript: p2shFixed.script,
        platformFeeZats,
        platformTreasuryAddress: PLATFORM_TREASURY,
      });

      let commitTxid: string | undefined;
      try {
        currentStep = "broadcasting commit tx";
        commitTxid = await broadcastTransaction(commitRebuilt.hex);
      } catch (e) {
        // unlock on failure
        await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: utxo.txid, vout: utxo.vout });
        throw e;
      }

      currentStep = "waiting for commit confirmation";
      await new Promise(r => setTimeout(r, waitMs));

      currentStep = "building reveal tx";
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

      currentStep = "broadcasting reveal tx";
      const revealTxid = await broadcastTransaction(revealHex);
      const inscriptionId = `${revealTxid}i0`;

      // Optionally release lock now, or leave to confirmation watchdog
      currentStep = "unlocking UTXO";
      await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: utxo.txid, vout: utxo.vout });

      // Log final inscription (optional: adapt to schema expectations)
      currentStep = "parsing inscription data";
      const preview = contentStr.slice(0, 200);
      // Derive ZRC-20 fields if JSON
      let zrc20Tick: string | undefined;
      let zrc20Op: string | undefined;
      let zrc20Amount: string | undefined;
      if (contentType.startsWith('application/json')) {
        try {
          const parsed = JSON.parse(contentStr);
          if (parsed?.p === 'zrc-20') {
            zrc20Tick = parsed.tick?.toString()?.toUpperCase();
            zrc20Op = parsed.op?.toString();
            zrc20Amount = parsed.amt?.toString();
          }
        } catch {}
      }

      currentStep = "saving inscription to database";
      await ctx.runMutation(api.inscriptions.createInscription, {
        txid: revealTxid,
        address: args.address,
        contentType,
        contentPreview: preview,
        contentSize: new TextEncoder().encode(contentStr).length,
        type: args.type ?? (contentType.startsWith("application/json") ? "zrc20" : "text"),
        platformFeeZat: platformFeeZats,
        treasuryAddress: PLATFORM_TREASURY,
        zrc20Tick,
        zrc20Op,
        zrc20Amount,
      } as any);

      return { commitTxid, revealTxid, inscriptionId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      throw new Error(`Inscription failed at step "${currentStep}": ${errorMessage}${errorStack ? '\nStack: ' + errorStack : ''}`);
    }
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
    let utxos;
    try { utxos = await fetchUtxos(address); }
    catch (_) { throw new Error('Unable to check your spendable funds right now. Please try again in a few seconds.'); }
    const required = splitCount * targetAmount + fee;
    const src = utxos.find(u => u.value >= required);
    if (!src) {
      throw new Error(
        `Not enough spendable funds. Need at least ${required} zats to proceed. ` +
        `Add funds and try again.`
      );
    }

    // Build outputs
    const pkh = addressToPkh(address);
    const outputs: { value: number; scriptPubKey: Uint8Array }[] = [];
    for (let i=0;i<splitCount;i++) outputs.push({ value: targetAmount, scriptPubKey: buildP2PKHScript(pkh) });
    const change = src.value - required;
    if (change > 546) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });

    // Sign v4 using lib helpers
    const consensusBranchId = await getConsensusBranchId(tatumKey);
    const inputs = [{ txid: src.txid, vout: src.vout, sequence: 0xfffffffd, value: src.value, scriptPubKey: buildP2PKHScript(pkh) }];
    const txData = { version: 0x80000004, versionGroupId: 0x892f2085, consensusBranchId, lockTime:0, expiryHeight:0, inputs, outputs };
    const priv = wifToPriv(wif);
    const sigHash = zip243Sighash(txData as any, 0);
    const secp = await import("@noble/secp256k1");
    if (!secp.etc.hmacSha256Sync) {
      secp.etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) => hmac(sha256, key, secp.etc.concatBytes(...msgs));
    }
    const pub = await secp.getPublicKey(priv, true);
    const sigAny = await secp.sign(sigHash, priv);
    const der = signatureToDER((sigAny as any).toCompactRawBytes ? (sigAny as any).toCompactRawBytes() : (sigAny as Uint8Array));
    const sigType = concatBytes([der, new Uint8Array([0x01])]);
    const version = u32le(0x80000004);
    const vgid = u32le(0x892f2085);
    const inCount = new Uint8Array([0x01]);
    const prev = reverseBytes(hexToBytes(src.txid));
    const voutBuf = u32le(src.vout);
    const scriptSig = concatBytes([ new Uint8Array([sigType.length]), sigType, new Uint8Array([pub.length]), pub ]);
    const scriptLen = varint(scriptSig.length);
    const seq = u32le(0xfffffffd);
    const outCount = varint(outputs.length);
    const outsBuf = concatBytes(outputs.map(o=>concatBytes([u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey])));
    const lock = u32le(0); const exp = u32le(0); const valBal = new Uint8Array(8);
    const nSS = new Uint8Array([0x00]), nSO = new Uint8Array([0x00]), nJS = new Uint8Array([0x00]);
    const raw = concatBytes([ version, vgid, inCount, prev, voutBuf, scriptLen, scriptSig, seq, outCount, outsBuf, lock, exp, valBal, nSS, nSO, nJS ]);
    const txid = await broadcastTransaction(bytesToHex(raw), tatumKey);
    return { txid };
  }
});

// Non-custodial split flow (client signing)
export const buildUnsignedSplitAction = action({
  args: {
    address: v.string(),
    pubKeyHex: v.string(),
    splitCount: v.number(),
    targetAmount: v.number(),
    fee: v.number(),
  },
  handler: async (ctx, args) => {
    // Prune stale locks first to avoid deadlocks from old contexts
    try { await ctx.runMutation(internal.utxoLocks.pruneStaleLocks, {} as any); } catch {}

    let utxos;
    try { utxos = await fetchUtxos(args.address); }
    catch (_) { throw new Error('Unable to check your spendable funds right now. Please try again in a few seconds.'); }
    const minSplitFee = 50000; // fixed floor to satisfy mempool policy
    const effectiveFee = Math.max(args.fee, minSplitFee);
    const required = args.splitCount * args.targetAmount + effectiveFee;

    // SIMPLE SPLIT: pick a single, sufficiently large, non-inscribed UTXO from Blockchair data
    const spendable: typeof utxos = [];
    for (const u of utxos) {
      const hasInsc = await checkInscriptionAt(`${u.txid}:${u.vout}`);
      if (!hasInsc) spendable.push(u);
    }
    if (spendable.length === 0) {
      throw new Error('Not enough spendable funds. All available UTXOs are inscribed.');
    }
    // Choose the smallest UTXO that still meets the requirement to minimize change
    const single = spendable
      .filter(u => u.value >= required)
      .sort((a,b) => a.value - b.value)[0];
    if (!single) {
      throw new Error(`Need a single UTXO with at least ${required} zats. Consolidate or add funds.`);
    }
    const selected: typeof spendable = [single];
    const total = single.value;

    // Create a context id up front so we can tag locks and make retries idempotent
    const contextId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

    // Lock all selected inputs atomically, attributed to this context
    const lockRes = await ctx.runMutation(internal.utxoLocks.lockUtxos, { items: selected.map(s=>({txid:s.txid, vout:s.vout})), address: args.address, lockedBy: contextId } as any);
    if (!lockRes?.success) throw new Error('UTXO lock failed; retry later');

    const pkh = addressToPkh(args.address);
    const outputs: { value: number; scriptPubKey: Uint8Array }[] = [];
    for (let i=0;i<args.splitCount;i++) outputs.push({ value: args.targetAmount, scriptPubKey: buildP2PKHScript(pkh) });
    const change = total - required;
    if (change > 546) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });
    try {
      const consensusBranchId = await getConsensusBranchId();
      const sighashes = buildSplitSighashes({ inputs: selected, address: args.address, outputs, consensusBranchId });

      await ctx.runMutation(internal.txContexts.create, {
        contextId,
        status: 'split_prepared',
        utxoTxid: selected[0].txid,
        utxoVout: selected[0].vout,
        utxoValue: selected[0].value,
        address: args.address,
        consensusBranchId,
        inscriptionAmount: 0,
        fee: effectiveFee,
        platformFeeZats: 0,
        platformTreasuryAddress: undefined,
        pubKeyHex: args.pubKeyHex,
        redeemScriptHex: '',
        p2shScriptHex: '',
        inscriptionDataHex: bytesToHex(utf8(JSON.stringify({ splitCount: args.splitCount, targetAmount: args.targetAmount, inputs: selected.map(s=>({ txid: s.txid, vout: s.vout, value: s.value })) }))),
        contentType: 'split',
        contentStr: 'split',
        type: 'split',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        commitTxid: undefined,
      });
      return { contextId, splitSigHashHexes: sighashes.map(bytesToHex) } as any;
    } catch (e) {
      // If anything fails after locking, release locks so we don't strand them
      try { await ctx.runMutation(internal.utxoLocks.unlockUtxos, { items: selected.map(s=>({txid:s.txid, vout:s.vout})) }); } catch {}
      throw e;
    }
  }
});

// Admin: force unlock all locks for an address (temporary utility; remove or protect in production)
export const adminUnlockAddressAction = action({
  args: { address: v.string() },
  handler: async (ctx, args) => {
    const locks = await ctx.runQuery(internal.utxoLocks.getLocksForAddress, { address: args.address });
    for (const l of locks) {
      await ctx.runMutation(internal.utxoLocks.forceUnlockUtxo, { lockId: l._id });
    }
    return { success: true, unlocked: locks.length };
  }
});

export const broadcastSignedSplitAction = action({
  args: { contextId: v.string(), splitSignaturesRawHex: v.array(v.string()) },
  handler: async (ctx, args) => {
    const rec = await ctx.runQuery(internal.txContexts.getByContextId, { contextId: args.contextId });
    if (!rec) throw new Error('Context not found');
    if (rec.status !== 'split_prepared') throw new Error(`Invalid context status: ${rec.status}`);
    const splitParams = JSON.parse(new TextDecoder().decode(hexToBytes(rec.inscriptionDataHex)));
    const inputs = (splitParams.inputs || []) as { txid: string; vout: number; value: number }[];
    if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('Split context missing inputs');
    if (args.splitSignaturesRawHex.length !== inputs.length) throw new Error('Signature count mismatch for split inputs');

    const pkh = addressToPkh(rec.address);
    const outputs: { value: number; scriptPubKey: Uint8Array }[] = [];
    for (let i=0;i<splitParams.splitCount;i++) outputs.push({ value: splitParams.targetAmount, scriptPubKey: buildP2PKHScript(pkh) });
    const totalIn = inputs.reduce((s,u)=>s+u.value,0);
    const change = totalIn - (splitParams.splitCount * splitParams.targetAmount) - rec.fee;
    if (change > 546) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });
    const txHex = assembleSplitTxHexMulti({
      inputs,
      address: rec.address,
      pubKey: hexToBytes(rec.pubKeyHex),
      outputs,
      signaturesRaw64: args.splitSignaturesRawHex.map(hexToBytes),
      consensusBranchId: rec.consensusBranchId,
    });
    let txid: string;
    try {
      txid = await broadcastTransaction(txHex);
    } catch (e: any) {
      // ensure we unlock any locked inputs (strip extra fields for validator)
      try { await ctx.runMutation(internal.utxoLocks.unlockUtxos, { items: inputs.map((i:any)=>({ txid: i.txid, vout: i.vout })) }); } catch {}
      const msg = e?.message ? String(e.message) : String(e);
      if (msg.toLowerCase().includes('unpaid action limit exceeded')) {
        throw new Error('Network rejected TX due to ZIP-317 fee policy. Increase fee to at least 50,000 zats and retry.');
      }
      throw e;
    }
    try { await ctx.runMutation(internal.utxoLocks.unlockUtxos, { items: inputs.map((i:any)=>({ txid: i.txid, vout: i.vout })) }); } catch {}
    await ctx.runMutation(internal.txContexts.patch, { _id: rec._id, status: 'completed', updatedAt: Date.now() });
    return {
      txid,
      splitCount: splitParams.splitCount,
      targetAmount: splitParams.targetAmount,
      fee: rec.fee,
      change: Math.max(0, change),
      inputCount: inputs.length,
    } as any;
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
    // Create job and start tail-chained internal action
    const jobId = await ctx.runMutation(api.jobs.createJob, {
      type: "batch-mint",
      params: args,
      totalCount: args.count,
    });
    await ctx.runAction(api.jobsActions.runNextMint, { jobId });
    return { jobId };
  }
});

// Phase 2: Client-side signing flow
/**
 * Build unsigned commit transaction (client-side signing flow).
 *
 * Resilience notes:
 * - Wraps UTXO fetch with a friendly error for upstream outages.
 * - Wraps consensus branch ID fetch and suggests retry; supports env fallback.
 * - Filters out inscribed UTXOs via indexer before selection.
 */
export const buildUnsignedCommitAction = action({
  args: {
    address: v.string(),
    pubKeyHex: v.string(),
    content: v.optional(v.string()),
    contentJson: v.optional(v.string()),
    contentType: v.optional(v.string()),
    type: v.optional(v.string()),
    inscriptionAmount: v.optional(v.number()),
    fee: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Client-signing path: same ZIP-317 fee floor
    const inscriptionAmount = args.inscriptionAmount ?? 60000;
    const FEE_FLOOR_ZATS = 50000;
    const fee = Math.max(args.fee ?? 10000, FEE_FLOOR_ZATS);
    const contentStr = args.contentJson ?? args.content ?? "hello world";
    const contentType = args.contentType ?? (args.contentJson ? "application/json" : "text/plain");
    const PLATFORM_TREASURY = TREASURY_ADDRESS;
    const platformFeeZats = PLATFORM_FEE_ZATS; // Always apply platform fee

    // UTXO selection with protection
    let utxos;
    try {
      utxos = await fetchUtxos(args.address);
    } catch (_) {
      throw new Error('Unable to check your spendable funds right now. Please try again in a few seconds.');
    }
    const required = inscriptionAmount + fee + platformFeeZats;
    const candidates = utxos.filter(u => u.value >= required);
    let utxo = undefined as undefined | typeof candidates[number];
    for (const c of candidates) {
      const hasInsc = await checkInscriptionAt(`${c.txid}:${c.vout}`);
      if (!hasInsc) { utxo = c; break; }
    }
    if (!utxo) {
      throw new Error(
        `Not enough spendable funds for this inscription. ` +
        `You need at least ${required} zats available in a single input. ` +
        `Fresh deposits work best. Inputs holding inscriptions are protected and won't be used.`
      );
    }

    // Build scripts/data
    const pubKey = hexToBytes(args.pubKeyHex);
    const chunks = buildInscriptionChunks(contentType, contentStr);
    const redeemScript = createRevealScript(pubKey, chunks);
    const p2sh = p2shFromRedeem(redeemScript);
    let consensusBranchId: number;
    try {
      consensusBranchId = await getConsensusBranchId();
    } catch (_) {
      throw new Error('Network is busy; cannot fetch consensus parameters. Please retry shortly.');
    }

    // Compute commit sighash
    const sigHash = buildCommitSighash({
      utxo,
      address: args.address,
      inscriptionAmount,
      fee,
      consensusBranchId,
      p2shScript: p2sh.script,
      platformFeeZats,
      platformTreasuryAddress: PLATFORM_TREASURY,
    });

    // Persist context
    const contextId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    await ctx.runMutation(internal.txContexts.create, {
      contextId,
      status: "commit_prepared",
      utxoTxid: utxo.txid,
      utxoVout: utxo.vout,
      utxoValue: utxo.value,
      address: args.address,
      consensusBranchId,
      inscriptionAmount,
      fee,
      platformFeeZats,
      platformTreasuryAddress: PLATFORM_TREASURY,
      pubKeyHex: args.pubKeyHex,
      redeemScriptHex: bytesToHex(redeemScript),
      p2shScriptHex: bytesToHex(p2sh.script),
      inscriptionDataHex: bytesToHex(buildInscriptionDataBuffer(contentStr, contentType)),
      contentType,
      contentStr,
      type: args.type,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      commitTxid: undefined,
    });

    // Lock UTXO tied to this context
    await ctx.runMutation(internal.utxoLocks.lockUtxo, { txid: utxo.txid, vout: utxo.vout, address: args.address, lockedBy: contextId });

    return { contextId, commitSigHashHex: bytesToHex(sigHash) };
  }
});

export const finalizeCommitAndGetRevealPreimageAction = action({
  args: {
    contextId: v.string(),
    commitSignatureRawHex: v.string(),
  },
  handler: async (ctx, args) => {
    const rec = await ctx.runQuery(internal.txContexts.getByContextId, { contextId: args.contextId });
    if (!rec) throw new Error("Context not found");
    if (rec.status !== 'commit_prepared') throw new Error(`Invalid context status: ${rec.status}`);

    const commitHex = assembleCommitTxHex({
      utxo: { txid: rec.utxoTxid, vout: rec.utxoVout, value: rec.utxoValue },
      address: rec.address,
      pubKey: hexToBytes(rec.pubKeyHex),
      signatureRaw64: hexToBytes(args.commitSignatureRawHex),
      inscriptionAmount: rec.inscriptionAmount,
      fee: rec.fee,
      consensusBranchId: rec.consensusBranchId,
      p2shScript: hexToBytes(rec.p2shScriptHex),
      platformFeeZats: rec.platformFeeZats,
      platformTreasuryAddress: rec.platformTreasuryAddress,
    });
    let commitTxid: string;
    try {
      commitTxid = await broadcastTransaction(commitHex);
    } catch (e: any) {
      try { await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: rec.utxoTxid, vout: rec.utxoVout }); } catch {}
      try { await ctx.runMutation(internal.txContexts.patch, { _id: rec._id, status: 'failed', updatedAt: Date.now() }); } catch {}
      const msg = e?.message ? String(e.message) : String(e);
      if (msg.toLowerCase().includes('unpaid action')) {
        throw new Error('Network rejected TX due to ZIP-317 fee policy. Increase fee to at least 50,000 zats and retry.');
      }
      throw e;
    }
    const revealSigHash = buildRevealSighash({
      commitTxid,
      address: rec.address,
      inscriptionAmount: rec.inscriptionAmount,
      fee: rec.fee,
      consensusBranchId: rec.consensusBranchId,
      redeemScript: hexToBytes(rec.redeemScriptHex),
    });

    await ctx.runMutation(internal.txContexts.patch, { _id: rec._id, status: 'commit_broadcast', commitTxid, updatedAt: Date.now() });
    return { commitTxid, revealSigHashHex: bytesToHex(revealSigHash) };
  }
});

export const broadcastSignedRevealAction = action({
  args: {
    contextId: v.string(),
    revealSignatureRawHex: v.string(),
  },
  handler: async (ctx, args) => {
    const rec = await ctx.runQuery(internal.txContexts.getByContextId, { contextId: args.contextId });
    if (!rec) throw new Error("Context not found");
    if (!rec.commitTxid) throw new Error("Commit not broadcast yet");

    const revealHex = assembleRevealTxHex({
      commitTxid: rec.commitTxid,
      address: rec.address,
      redeemScript: hexToBytes(rec.redeemScriptHex),
      inscriptionAmount: rec.inscriptionAmount,
      fee: rec.fee,
      inscriptionData: hexToBytes(rec.inscriptionDataHex),
      signatureRaw64: hexToBytes(args.revealSignatureRawHex),
      consensusBranchId: rec.consensusBranchId,
    });
    let revealTxid: string;
    try {
      revealTxid = await broadcastTransaction(revealHex);
    } catch (e: any) {
      // Always release lock on failure
      try { await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: rec.utxoTxid, vout: rec.utxoVout }); } catch {}
      const msg = e?.message ? String(e.message) : String(e);
      if (msg.toLowerCase().includes('unpaid action')) {
        throw new Error('Network rejected TX due to ZIP-317 fee policy. Increase fee to at least 50,000 zats and retry.');
      }
      throw e;
    }
    const inscriptionId = `${revealTxid}i0`;
    // Unlock after success, too
    try { await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: rec.utxoTxid, vout: rec.utxoVout }); } catch {}

    // Parse preview + zrc20 details
    const preview = rec.contentStr.slice(0, 200);
    let zrc20Tick: string | undefined;
    let zrc20Op: string | undefined;
    let zrc20Amount: string | undefined;
    if (rec.contentType.startsWith('application/json')) {
      try {
        const parsed = JSON.parse(rec.contentStr);
        if (parsed?.p === 'zrc-20') {
          zrc20Tick = parsed.tick?.toString()?.toUpperCase();
          zrc20Op = parsed.op?.toString();
          zrc20Amount = parsed.amt?.toString();
        }
      } catch {}
    }

    await ctx.runMutation(api.inscriptions.createInscription, {
      txid: revealTxid,
      address: rec.address,
      contentType: rec.contentType,
      contentPreview: preview,
      contentSize: new TextEncoder().encode(rec.contentStr).length,
      type: rec.type ?? (rec.contentType.startsWith("application/json") ? "zrc20" : "text"),
      platformFeeZat: rec.platformFeeZats,
      treasuryAddress: rec.platformTreasuryAddress,
      zrc20Tick,
      zrc20Op,
      zrc20Amount,
    } as any);

    await ctx.runMutation(internal.txContexts.patch, { _id: rec._id, status: 'completed', updatedAt: Date.now() });
    return { revealTxid, inscriptionId };
  }
});
