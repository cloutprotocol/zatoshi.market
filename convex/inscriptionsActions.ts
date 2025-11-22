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
  buildCommitSighashes,
  assembleCommitTxHexMulti,
  buildRevealSighash,
  assembleRevealTxHex,
  buildSplitSighash,
  assembleSplitTxHex,
  buildSplitSighashes,
  assembleSplitTxHexMulti,
  utf8,
  base64ToBytes,
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
      // ZIP 317 Fee Floor: We use 20,000 zats as a safe minimum
      // ZIP 317: fee = max(10,000, logical_actions × 5,000)
      // Most inscriptions have 3 outputs (Inscription + Platform Fee + Change) = 15,000 minimum
      // 20,000 provides a buffer and aligns with our "Low" tier
      const inscriptionAmount = args.inscriptionAmount ?? 50000;
      const FEE_FLOOR_ZATS = 20000;
      const fee = Math.max(args.fee ?? 10000, FEE_FLOOR_ZATS);
      const waitMs = args.waitMs ?? 10000;
      const contentStr = args.contentJson ?? args.content ?? "hello world";
      const contentType = args.contentType ?? (args.contentJson ? "application/json" : "text/plain");

      currentStep = "loading platform config";
      // Platform fee is hard-coded in treasury.config. We always add a second output
      // to the commit that pays 0.0002 ZEC (20,000 zats) to the treasury. Change is
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
      try {
        const maxVal = utxos.reduce((m: any, u: any) => Math.max(m, u?.value || 0), 0);
        const minVal = utxos.reduce((m: any, u: any) => Math.min(m, u?.value || 0), (utxos[0]?.value ?? 0) || 0);
        console.log(`[utxo][mint] ${args.address} total=${utxos.length} required=${required} max=${maxVal} min=${minVal}`);
      } catch { }
      // Optimization: Sort by value descending (greedy) and check inscriptions lazily
      // This avoids checking every single UTXO if we only need one or two.
      utxos.sort((a, b) => b.value - a.value);

      const safe: typeof utxos = [];
      currentStep = "selecting clean UTXOs";

      // We need to find enough clean UTXOs to cover 'required'
      // Since we are just looking for a single UTXO >= required (based on original logic),
      // we can just find the first one that works.
      // Original logic: const candidates = utxos.filter(u => u.value >= required);

      for (const u of utxos) {
        if (u.value < required) continue; // Skip if too small (since we want single input if possible)

        const hasInscription = await checkInscriptionAt(`${u.txid}:${u.vout}`);
        if (!hasInscription) {
          safe.push(u);
          break; // Found one!
        }
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
          `Inputs holding inscriptions are protected and won't be used. ` +
          `Deposit a fresh UTXO of ≥ ${required} zats, or use the Split UTXOs tool to prepare one.`
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
      } catch (e: any) {
        // unlock on failure
        await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: utxo.txid, vout: utxo.vout });
        const msg = e?.message ? String(e.message) : String(e);
        if (msg.toLowerCase().includes('unpaid action')) {
          throw new Error('Network rejected TX due to ZIP-317 fee policy. Increase fee to at least 50,000 zats and retry.');
        }
        if (msg.toLowerCase().includes('insufficient fee') || msg.toLowerCase().includes('min fee')) {
          throw new Error('Broadcast rejected for insufficient fee. Bump your fee (≥ 50,000 zats recommended) and retry.');
        }
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
      let revealTxid: string;
      try {
        revealTxid = await broadcastTransaction(revealHex);
      } catch (e: any) {
        // Always release lock on failure
        try { await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: utxo.txid, vout: utxo.vout }); } catch { }
        const msg = e?.message ? String(e.message) : String(e);
        if (msg.toLowerCase().includes('unpaid action')) {
          throw new Error('Network rejected TX due to ZIP-317 fee policy. Increase fee to at least 50,000 zats and retry.');
        }
        if (msg.toLowerCase().includes('insufficient fee') || msg.toLowerCase().includes('min fee')) {
          throw new Error('Broadcast rejected for insufficient fee. Bump your fee (≥ 50,000 zats recommended) and retry.');
        }
        throw e;
      }
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
        } catch { }
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

    // Build outputs first to calculate ZIP-317 fee
    const pkh = addressToPkh(address);
    const outputs: { value: number; scriptPubKey: Uint8Array }[] = [];
    for (let i = 0; i < splitCount; i++) outputs.push({ value: targetAmount, scriptPubKey: buildP2PKHScript(pkh) });

    // ZIP-317: logical_actions = max(inputs, outputs), fee = max(10000, actions * 5000)
    // Single input, multiple outputs
    const logicalActions = Math.max(1, outputs.length + 1); // +1 for potential change
    const zip317MinFee = Math.max(10000, logicalActions * 5000);
    const effectiveFee = Math.max(fee, zip317MinFee);

    const required = splitCount * targetAmount + effectiveFee;
    const src = utxos.find(u => u.value >= required);
    if (!src) {
      throw new Error(
        `Not enough spendable funds. Need at least ${required} zats (${effectiveFee} fee for ${logicalActions} actions). ` +
        `Add funds and try again.`
      );
    }

    const change = src.value - required;
    if (change > 546) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });

    // Sign v4 using lib helpers
    const consensusBranchId = await getConsensusBranchId(tatumKey);
    const inputs = [{ txid: src.txid, vout: src.vout, sequence: 0xfffffffd, value: src.value, scriptPubKey: buildP2PKHScript(pkh) }];
    const txData = { version: 0x80000004, versionGroupId: 0x892f2085, consensusBranchId, lockTime: 0, expiryHeight: 0, inputs, outputs };
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
    const scriptSig = concatBytes([new Uint8Array([sigType.length]), sigType, new Uint8Array([pub.length]), pub]);
    const scriptLen = varint(scriptSig.length);
    const seq = u32le(0xfffffffd);
    const outCount = varint(outputs.length);
    const outsBuf = concatBytes(outputs.map(o => concatBytes([u64le(o.value), varint(o.scriptPubKey.length), o.scriptPubKey])));
    const lock = u32le(0); const exp = u32le(0); const valBal = new Uint8Array(8);
    const nSS = new Uint8Array([0x00]), nSO = new Uint8Array([0x00]), nJS = new Uint8Array([0x00]);
    const raw = concatBytes([version, vgid, inCount, prev, voutBuf, scriptLen, scriptSig, seq, outCount, outsBuf, lock, exp, valBal, nSS, nSO, nJS]);
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
    try { await ctx.runMutation(internal.utxoLocks.pruneStaleLocks, {} as any); } catch { }

    let utxos;
    try { utxos = await fetchUtxos(args.address); }
    catch (_) { throw new Error('Unable to check your spendable funds right now. Please try again in a few seconds.'); }

    // ZIP-317 fee calculation: logical_actions = max(inputs, outputs)
    // We don't know input count yet, so estimate conservatively
    // Assume worst case: need multiple inputs, so use outputs as minimum
    // Each output needs ~5000 zats, with 10000 floor
    const estimatedOutputs = args.splitCount + 1; // split outputs + possible change
    const minSplitFee = Math.max(10000, estimatedOutputs * 5000);
    const effectiveFee = Math.max(args.fee, minSplitFee);
    const required = args.splitCount * args.targetAmount + effectiveFee;
    try {
      const maxVal = utxos.reduce((m: any, u: any) => Math.max(m, u?.value || 0), 0);
      console.log(`[utxo][split] ${args.address} total=${utxos.length} required=${required} max=${maxVal}`);
    } catch { }

    // Optimization: Sort first, then check inscriptions lazily until we have enough
    const sorted = utxos.slice().sort((a, b) => b.value - a.value);
    const selected: typeof utxos = [];
    let total = 0;

    for (const u of sorted) {
      if (total >= required) break;

      const hasInsc = await checkInscriptionAt(`${u.txid}:${u.vout}`);
      if (!hasInsc) {
        selected.push(u);
        total += u.value;
      }
    }

    if (total < required) {
      throw new Error(`Not enough spendable funds to split. Need ${required} zats total; found ${total} zats in clean UTXOs.`);
    }

    // Create a context id up front so we can tag locks and make retries idempotent
    const contextId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

    // Lock all selected inputs atomically, attributed to this context
    const lockRes = await ctx.runMutation(internal.utxoLocks.lockUtxos, { items: selected.map(s => ({ txid: s.txid, vout: s.vout })), address: args.address, lockedBy: contextId } as any);
    if (!lockRes?.success) throw new Error('UTXO lock failed; retry later');

    const pkh = addressToPkh(args.address);
    const outputs: { value: number; scriptPubKey: Uint8Array }[] = [];
    for (let i = 0; i < args.splitCount; i++) outputs.push({ value: args.targetAmount, scriptPubKey: buildP2PKHScript(pkh) });
    const change = total - required;
    if (change > 546) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });

    // Now we know actual input/output counts - recalculate ZIP-317 fee
    const logicalActions = Math.max(selected.length, outputs.length);
    const zip317MinFee = Math.max(10000, logicalActions * 5000);
    const finalFee = Math.max(effectiveFee, zip317MinFee);

    // If we need more fee, adjust required amount and re-check
    if (finalFee > effectiveFee) {
      const newRequired = args.splitCount * args.targetAmount + finalFee;
      if (total < newRequired) {
        await ctx.runMutation(internal.utxoLocks.unlockUtxos, { items: selected.map(s => ({ txid: s.txid, vout: s.vout })) });
        throw new Error(`Not enough funds for split with ZIP-317 fees. Need ${newRequired} zats (${finalFee} fee for ${logicalActions} actions), have ${total} zats.`);
      }
      // Adjust change with new fee
      const newChange = total - (args.splitCount * args.targetAmount) - finalFee;
      if (newChange > 546) {
        outputs[outputs.length - 1].value = newChange; // Update change output
      } else if (outputs.length > args.splitCount) {
        outputs.pop(); // Remove change output if too small
      }
    }
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
        fee: finalFee,
        platformFeeZats: 0,
        platformTreasuryAddress: undefined,
        pubKeyHex: args.pubKeyHex,
        redeemScriptHex: '',
        p2shScriptHex: '',
        inscriptionDataHex: bytesToHex(utf8(JSON.stringify({ splitCount: args.splitCount, targetAmount: args.targetAmount, inputs: selected.map(s => ({ txid: s.txid, vout: s.vout, value: s.value })) }))),
        contentType: 'split',
        contentStr: 'split',
        type: 'split',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        commitTxid: undefined,
      });
      console.log(`[split] prepared: ${selected.length} inputs → ${outputs.length} outputs, fee=${finalFee} (${logicalActions} actions)`);
      return { contextId, splitSigHashHexes: sighashes.map(bytesToHex) } as any;
    } catch (e) {
      // If anything fails after locking, release locks so we don't strand them
      try { await ctx.runMutation(internal.utxoLocks.unlockUtxos, { items: selected.map(s => ({ txid: s.txid, vout: s.vout })) }); } catch { }
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
    for (let i = 0; i < splitParams.splitCount; i++) outputs.push({ value: splitParams.targetAmount, scriptPubKey: buildP2PKHScript(pkh) });
    const totalIn = inputs.reduce((s, u) => s + u.value, 0);
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
      try { await ctx.runMutation(internal.utxoLocks.unlockUtxos, { items: inputs.map((i: any) => ({ txid: i.txid, vout: i.vout })) }); } catch { }
      const msg = e?.message ? String(e.message) : String(e);
      if (msg.toLowerCase().includes('unpaid action limit exceeded')) {
        throw new Error('Network rejected TX due to ZIP-317 fee policy. Increase fee to at least 50,000 zats and retry.');
      }
      throw e;
    }
    try { await ctx.runMutation(internal.utxoLocks.unlockUtxos, { items: inputs.map((i: any) => ({ txid: i.txid, vout: i.vout })) }); } catch { }
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
    feeTier: v.optional(v.string()),
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
    // ZIP 317 Fee Floor: Client-side signing path uses same floor as server
    // ZIP 317: fee = max(10,000, logical_actions × 5,000)
    // Most inscriptions have 3 outputs = 15,000 minimum
    // We use 20,000 as a safe buffer ("Low" tier)
    const FEE_FLOOR_ZATS = 20000;
    const DUST_LIMIT = 546;
    const fee = Math.max(args.fee ?? 10000, FEE_FLOOR_ZATS);
    // Default inscription amount to fee + 10k buffer
    const inscriptionAmount = args.inscriptionAmount ?? (fee + 10000);

    // Validation: Ensure we don't create a dust or negative output
    if (inscriptionAmount <= fee + DUST_LIMIT) {
      throw new Error(
        `Inscription amount (${inscriptionAmount}) must be greater than fee (${fee}) + dust limit (${DUST_LIMIT}). ` +
        `Please increase the inscription amount to at least ${fee + DUST_LIMIT + 1} zats.`
      );
    }
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
    try {
      const maxVal = utxos.reduce((m: any, u: any) => Math.max(m, u?.value || 0), 0);
      const minVal = utxos.reduce((m: any, u: any) => Math.min(m, u?.value || 0), (utxos[0]?.value ?? 0) || 0);
      console.log(`[utxo][unsigned-commit] ${args.address} total=${utxos.length} required=${required} max=${maxVal} min=${minVal}`);
    } catch { }
    // Optimization: Sort first, then check inscriptions lazily
    const sorted = utxos.slice().sort((a, b) => b.value - a.value);
    const selected: typeof utxos = [];
    let totalIn = 0;

    for (const u of sorted) {
      if (totalIn >= required) break;

      const hasInsc = await checkInscriptionAt(`${u.txid}:${u.vout}`);
      if (!hasInsc) {
        selected.push(u);
        totalIn += u.value;
      }
    }



    // ==================================================================================
    // ZIP-317 Dynamic Fee Calculation
    // ==================================================================================
    // ZIP 317 defines fees as: fee = max(10,000 zats, logical_actions × 5,000 zats)
    // where logical_actions = max(input_count, output_count)
    //
    // For typical inscriptions:
    // - Inputs: Usually 1 (we select the minimal set to cover required amount)
    // - Outputs: 3 (Inscription P2SH + Platform Treasury + Change)
    // - Therefore: logical_actions = max(1, 3) = 3
    // - Minimum fee = 3 × 5,000 = 15,000 zats
    //
    // We automatically bump the user's fee to meet this requirement if needed.
    // ==================================================================================
    const outputCount = 3; // P2SH, Treasury, Change
    const logicalActions = Math.max(selected.length, outputCount);
    const zip317MinFee = Math.max(10000, logicalActions * 5000);

    // Bump fee if user's selection is below ZIP 317 minimum
    const finalFee = Math.max(fee, zip317MinFee);
    if (fee < zip317MinFee) {
      console.log(`[fee-bump] User fee ${fee} too low for ${logicalActions} actions. Bumping to ${zip317MinFee}.`);
    }

    // ==================================================================================
    // Inscription Amount Adjustment
    // ==================================================================================
    // The commit tx locks `inscriptionAmount` into the P2SH output (vout 0).
    // The reveal tx spends this P2SH output and pays `finalFee`.
    // Therefore: inscriptionAmount must be > finalFee + DUST_LIMIT (546 zats)
    // to create a valid output in the reveal tx.
    //
    // If the user-provided inscriptionAmount is too small (which can happen when
    // we bump the fee), we automatically adjust it to meet the requirement.
    // ==================================================================================
    let finalInscriptionAmount = inscriptionAmount;
    const minInscriptionAmount = finalFee + DUST_LIMIT + 1;
    if (finalInscriptionAmount < minInscriptionAmount) {
      console.log(`[inscription-amount-bump] User inscriptionAmount ${finalInscriptionAmount} too low for fee ${finalFee}. Bumping to ${minInscriptionAmount}.`);
      finalInscriptionAmount = minInscriptionAmount;
    }


    const finalRequired = finalInscriptionAmount + finalFee + platformFeeZats;

    if (totalIn < finalRequired) {
      throw new Error(
        `Not enough spendable funds. Need ${finalRequired} zats (incl. ${finalFee} network fee); found ${totalIn} zats.`
      );
    }


    // Build scripts/data
    const pubKey = hexToBytes(args.pubKeyHex);
    // For images, decode base64 to bytes; for text/json, use string as-is
    let contentData: string | Uint8Array;
    if (args.type === 'image') {
      try {
        contentData = base64ToBytes(contentStr);
        console.log(`[image-inscription] decoded base64 to ${contentData.length} bytes, type=${contentType}`);
      } catch (e: any) {
        console.error('[image-inscription] base64 decode failed:', e?.message);
        throw new Error('Failed to decode image data. Please try re-uploading the file.');
      }
    } else {
      contentData = contentStr;
    }
    const chunks = buildInscriptionChunks(contentType, contentData);
    const redeemScript = createRevealScript(pubKey, chunks);
    const p2sh = p2shFromRedeem(redeemScript);
    console.log(`[inscription] redeemScript=${redeemScript.length} bytes, p2sh hash=${bytesToHex(p2sh.hash).slice(0, 16)}...`);
    let consensusBranchId: number;
    try {
      consensusBranchId = await getConsensusBranchId();
    } catch (_) {
      throw new Error('Network is busy; cannot fetch consensus parameters. Please retry shortly.');
    }

    // Compute commit sighashes
    const sigHashes = buildCommitSighashes({
      utxos: selected,
      address: args.address,
      inscriptionAmount: finalInscriptionAmount,
      fee: finalFee,
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
      utxos: selected.map(u => ({ txid: u.txid, vout: u.vout, value: u.value })),
      address: args.address,
      consensusBranchId,
      inscriptionAmount: finalInscriptionAmount,
      fee: finalFee,
      platformFeeZats,
      platformTreasuryAddress: PLATFORM_TREASURY,
      pubKeyHex: args.pubKeyHex,
      redeemScriptHex: bytesToHex(redeemScript),
      p2shScriptHex: bytesToHex(p2sh.script),
      inscriptionDataHex: bytesToHex(buildInscriptionDataBuffer(contentData, contentType)),
      contentType,
      contentStr,
      type: args.type,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      commitTxid: undefined,
    });

    // Lock UTXOs tied to this context
    await ctx.runMutation(internal.utxoLocks.lockUtxos, { items: selected.map(u => ({ txid: u.txid, vout: u.vout })), address: args.address, lockedBy: contextId });

    return { contextId, commitSigHashHexes: sigHashes.map(bytesToHex) };
  }
});

export const finalizeCommitAndGetRevealPreimageAction = action({
  args: {
    contextId: v.string(),
    commitSignaturesRawHex: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const rec = await ctx.runQuery(internal.txContexts.getByContextId, { contextId: args.contextId });
    if (!rec) throw new Error("Context not found");
    if (rec.status !== 'commit_prepared') throw new Error(`Invalid context status: ${rec.status}`);
    if (!rec.utxos) throw new Error("UTXOs not found in context");

    const commitHex = assembleCommitTxHexMulti({
      utxos: rec.utxos,
      address: rec.address,
      pubKey: hexToBytes(rec.pubKeyHex),
      signaturesRaw64: args.commitSignaturesRawHex.map(hexToBytes),
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
      try { await ctx.runMutation(internal.utxoLocks.unlockUtxos, { items: rec.utxos.map(u => ({ txid: u.txid, vout: u.vout })) }); } catch { }
      try { await ctx.runMutation(internal.txContexts.patch, { _id: rec._id, status: 'failed', updatedAt: Date.now() }); } catch { }
      const msg = e?.message ? String(e.message) : String(e);

      // Provide user-friendly error messages
      if (msg.toLowerCase().includes('unpaid action') || msg.toLowerCase().includes('fee too low')) {
        throw new Error('Network rejected transaction: Fee too low. Please increase the fee and try again.');
      }
      if (msg.toLowerCase().includes('scriptsig-not-pushonly') || msg.toLowerCase().includes('invalid script')) {
        throw new Error('Transaction rejected: Invalid script format. Please try again or contact support.');
      }
      if (msg.toLowerCase().includes('missing inputs') || msg.toLowerCase().includes('inputs unavailable')) {
        throw new Error('Transaction inputs not ready. Please wait a moment and try again.');
      }
      if (msg.toLowerCase().includes('broadcast failed')) {
        throw new Error(`Unable to broadcast commit transaction. ${msg.includes('Network response') ? msg.split('Network response:')[1]?.trim() || 'Please try again.' : 'Please try again or contact support.'}`);
      }

      // Generic fallback with sanitized message
      const sanitized = msg.replace(/convex/gi, '').replace(/inscriptionsActions/gi, '').replace(/\.ts:\d+/g, '').trim();
      throw new Error(`Commit transaction failed: ${sanitized || 'An unexpected error occurred. Please try again.'}`);
    }
    // Small propagation delay to restore previous reliability: give broadcasters time to
    // see the commit before we ask the client to sign/broadcast the reveal. Historically
    // our server-signed flow used 8-10s. We replicate that here and optionally poll Tatum
    // if an API key is present (best-effort; we proceed even if polling fails).
    try {
      const tatumKey = process.env.TATUM_API_KEY || '';
      const waitUntil = Date.now() + 8000; // 8s minimum wait
      while (Date.now() < waitUntil) {
        await new Promise(r => setTimeout(r, 250));
      }
      if (tatumKey) {
        const rpc = 'https://api.tatum.io/v3/blockchain/node/zcash-mainnet';
        const maxPolls = 5;
        for (let i = 0; i < maxPolls; i++) {
          try {
            const r = await fetch(rpc, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': tatumKey },
              body: JSON.stringify({ jsonrpc: '2.0', method: 'getrawtransaction', params: [commitTxid, 1], id: 1 })
            });
            if (r.ok) { const j: any = await r.json(); if (j?.result) break; }
          } catch { }
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    } catch { }
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

    const inscriptionData = hexToBytes(rec.inscriptionDataHex);
    const redeemScript = hexToBytes(rec.redeemScriptHex);
    console.log(`[reveal] inscriptionData=${inscriptionData.length} bytes, redeemScript=${redeemScript.length} bytes, type=${rec.type}, contentType=${rec.contentType}`);
    console.log(`[reveal] inscriptionData hex (first 200 chars): ${rec.inscriptionDataHex.slice(0, 200)}`);

    const revealHex = assembleRevealTxHex({
      commitTxid: rec.commitTxid,
      address: rec.address,
      redeemScript,
      inscriptionAmount: rec.inscriptionAmount,
      fee: rec.fee,
      inscriptionData,
      signatureRaw64: hexToBytes(args.revealSignatureRawHex),
      consensusBranchId: rec.consensusBranchId,
    });
    console.log(`[reveal] assembled tx hex length: ${revealHex.length} chars (${revealHex.length / 2} bytes)`);
    console.log(`[reveal] tx hex (first 500 chars): ${revealHex.slice(0, 500)}`);
    // Broadcast reveal with minimal retries to handle transient propagation races even after the
    // above delay. We keep this gentle (3 attempts) to avoid hammering providers.
    let revealTxid: string | undefined;
    try {
      const attempts = 3;
      for (let i = 0; i < attempts; i++) {
        try {
          revealTxid = await broadcastTransaction(revealHex);
          break;
        } catch (err: any) {
          if (i === attempts - 1) throw err;
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      if (!revealTxid) throw new Error('Broadcast failed: reveal did not return txid');
    } catch (e: any) {
      // Always release lock on failure
      try { await ctx.runMutation(internal.utxoLocks.unlockUtxos, { items: rec.utxos.map(u => ({ txid: u.txid, vout: u.vout })) }); } catch { }
      const msg = e?.message ? String(e.message) : String(e);

      // Provide user-friendly error messages
      if (msg.toLowerCase().includes('unpaid action') || msg.toLowerCase().includes('fee too low')) {
        throw new Error('Network rejected transaction: Fee too low. Please increase the fee and try again.');
      }
      if (msg.toLowerCase().includes('decode failed')) {
        throw new Error('Transaction rejected: Invalid transaction format. Please try again or contact support.');
      }
      if (msg.toLowerCase().includes('scriptsig-size')) {
        throw new Error(`Image file too large. Zcash enforces a 10KB limit on scriptSig size. Please reduce your image to under 9.5KB (current: ${Math.round(inscriptionData.length / 1024 * 10) / 10}KB). Try compressing or resizing the image.`);
      }
      if (msg.toLowerCase().includes('scriptsig-not-pushonly') || msg.toLowerCase().includes('invalid script')) {
        throw new Error('Transaction rejected: Invalid script format. Please try again or contact support.');
      }
      if (msg.toLowerCase().includes('missing inputs') || msg.toLowerCase().includes('inputs unavailable')) {
        throw new Error('Transaction inputs not ready. Please wait a moment and try again.');
      }

      // Generic fallback: Sanitize message by removing provider names and internal details
      // Sanitize error message before storing/throwing
      let sanitized = e?.message ? String(e.message) : String(e);

      // Remove provider names and internal details
      sanitized = sanitized
        .replace(/convex/gi, '')
        .replace(/inscriptionsActions/gi, '')
        .replace(/\\.ts:\\d+/g, '')
        .replace(/tatum:\s*/gi, '')
        .replace(/blockchair\(\d+\):\s*/gi, '')
        .replace(/\[broadcast\]\s*All providers failed:\s*\[/gi, '')
        .replace(/'[^']*tatum[^']*'/gi, '')
        .replace(/'[^']*blockchair[^']*'/gi, '')
        .replace(/,\s*,/g, ',')
        .replace(/\[,/g, '[')
        .replace(/,\]/g, ']')
        .replace(/\[\]/g, '')
        .trim();

      if (sanitized.startsWith('[') || sanitized.includes('{"error"')) {
        sanitized = 'Transaction broadcast failed';
      }

      throw new Error(`Unable to broadcast transaction. ${sanitized || 'Please try again or contact support.'}`);
    }
    const inscriptionId = `${revealTxid}i0`;
    // Unlock after success, too
    try { await ctx.runMutation(internal.utxoLocks.unlockUtxos, { items: rec.utxos.map(u => ({ txid: u.txid, vout: u.vout })) }); } catch { }

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
      } catch { }
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
