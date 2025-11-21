"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { PLATFORM_FEE_ZATS, TREASURY_ADDRESS } from './treasury.config';
import {
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
} from "./zcashHelpers";

export const runNextMint = action({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(api.jobs.getJob, { jobId: args.jobId });
    if (!job) throw new Error("Job not found");
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") return job;
    if (job.status === "pending") await ctx.runMutation(api.jobs.setJobStatus, { jobId: args.jobId, status: "running" });

    const p = job.params as any;
    // ZIP 317 Fee Floor: Batch mint uses same floor as regular mints
    // ZIP 317: fee = max(10,000, logical_actions × 5,000)
    // Typical inscription has 3 outputs = 15,000 minimum
    // We use 20,000 as a safe buffer
    const inscriptionAmount = p.inscriptionAmount ?? 60000;
    const FEE_FLOOR_ZATS = 20000;
    const baseFee = Math.max(p.fee ?? 10000, FEE_FLOOR_ZATS);
    const PLATFORM_TREASURY = TREASURY_ADDRESS;
    const waitMs = p.waitMs ?? 8000;
    const contentStr: string = p.contentJson ?? p.content ?? "hello world";
    const contentType: string = p.contentType ?? (p.contentJson ? "application/json" : "text/plain");

    // Mint once
    const utxos = await fetchUtxos(p.address);
    const platformFeeZats = PLATFORM_FEE_ZATS; // Always apply

    // ZIP-317: Calculate minimum fee for 3 outputs (P2SH + Treasury + Change)
    // logical_actions = max(inputs, outputs) = max(1, 3) = 3
    // min_fee = 3 × 5,000 = 15,000 zats
    const outputCount = 3;
    const logicalActions = Math.max(1, outputCount); // 1 input (we select single UTXO)
    const zip317MinFee = Math.max(10000, logicalActions * 5000);
    const fee = Math.max(baseFee, zip317MinFee);

    // Adjust inscriptionAmount if needed (same logic as buildUnsignedCommitAction)
    const DUST_LIMIT = 546;
    let finalInscriptionAmount = inscriptionAmount;
    const minInscriptionAmount = fee + DUST_LIMIT + 1;
    if (finalInscriptionAmount < minInscriptionAmount) {
      finalInscriptionAmount = minInscriptionAmount;
    }

    const required = finalInscriptionAmount + fee + platformFeeZats;
    // Filter safe only
    const candidates = utxos.filter(u => u.value >= required);
    let utxo = undefined as undefined | typeof candidates[number];
    for (const c of candidates) {
      const hasInsc = await checkInscriptionAt(`${c.txid}:${c.vout}`);
      if (!hasInsc) { utxo = c; break; }
    }
    if (!utxo) {
      throw new Error(
        `Not enough spendable funds. Need at least ${required} zats to proceed. ` +
        `Add funds and try again.`
      );
    }
    // Try lock
    const lockRes = await ctx.runMutation(internal.utxoLocks.lockUtxo, { txid: utxo.txid, vout: utxo.vout, address: p.address, lockedBy: String(args.jobId) });
    if (!lockRes.locked) throw new Error("UTXO lock failed; retry later");

    try {
      const branchId = await getConsensusBranchId();
      const chunks = buildInscriptionChunks(contentType, contentStr);
      // Provisional to get p2sh
      const redeemProvisional = createRevealScript(new Uint8Array(0), chunks);
      const p2sh = p2shFromRedeem(redeemProvisional);
      // Build commit (get pubkey)
      const commitBuilt = await buildCommitTxHex({
        utxo,
        address: p.address,
        wif: p.wif,
        inscriptionAmount: finalInscriptionAmount,
        fee,
        consensusBranchId: branchId,
        redeemScript: new Uint8Array(0),
        p2shScript: p2sh.script,
      });
      const redeemScript = createRevealScript(commitBuilt.pubKey, chunks);
      const p2shFixed = p2shFromRedeem(redeemScript);
      const commit = await buildCommitTxHex({
        utxo,
        address: p.address,
        wif: p.wif,
        inscriptionAmount: finalInscriptionAmount,
        fee,
        consensusBranchId: branchId,
        redeemScript,
        p2shScript: p2shFixed.script,
        platformFeeZats,
        platformTreasuryAddress: PLATFORM_TREASURY,
      });
      const commitTxid = await broadcastTransaction(commit.hex);
      await new Promise((r) => setTimeout(r, waitMs));
      const inscriptionData = buildInscriptionDataBuffer(contentStr, contentType);
      const revealHex = await buildRevealTxHex({ commitTxid, address: p.address, wif: p.wif, inscriptionAmount: finalInscriptionAmount, fee, consensusBranchId: branchId, redeemScript, inscriptionData });
      const revealTxid = await broadcastTransaction(revealHex);
      const inscriptionId = `${revealTxid}i0`;
      const preview = contentStr.slice(0, 200);
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
      const docId = await ctx.runMutation(api.inscriptions.createInscription, {
        txid: revealTxid,
        address: p.address,
        contentType,
        contentPreview: preview,
        contentSize: new TextEncoder().encode(contentStr).length,
        type: p.type ?? (contentType.startsWith("application/json") ? "zrc20" : "text"),
        platformFeeZat: platformFeeZats,
        treasuryAddress: PLATFORM_TREASURY,
        zrc20Tick,
        zrc20Op,
        zrc20Amount,
      } as any);
      // Actual on-chain cost calculation:
      // Total spent = UTXO input - what we got back (change + reveal dust)
      // 
      // Commit tx: utxo.value -> inscriptionAmount (P2SH) + platformFee (treasury) + change + commitFee
      // Reveal tx: inscriptionAmount -> 547 (dust) + revealFee
      //
      // What we got back:
      // - Change from commit (if > dust limit)
      // - Dust output from reveal (547 zats)
      const change = utxo.value - finalInscriptionAmount - fee - platformFeeZats;
      const changeReturned = change > 546 ? change : 0; // Change only returned if above dust limit
      const revealDustReturned = 547;

      // Everything else was consumed (platform fee + both transaction fees)
      const actualCostZats = utxo.value - changeReturned - revealDustReturned;

      await ctx.runMutation(api.jobs.addJobProgress, {
        jobId: args.jobId,
        inscriptionId,
        inscriptionDocId: docId,
        costZats: actualCostZats,
      });

      const updated = await ctx.runQuery(api.jobs.getJob, { jobId: args.jobId });
      if (updated && updated.completedCount >= updated.totalCount) {
        await ctx.runMutation(api.jobs.setJobStatus, { jobId: args.jobId, status: "completed" });
        await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: utxo.txid, vout: utxo.vout });
        return { status: "completed" };
      }
      await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: utxo.txid, vout: utxo.vout });
      // Tail-chain next mint
      await ctx.runAction(api.jobsActions.runNextMint, { jobId: args.jobId });
      return { status: "running" };
    } catch (e: any) {
      // Sanitize error message before storing/throwing
      let errorMsg = e?.message ? String(e.message) : String(e);

      // Remove provider names and internal details
      errorMsg = errorMsg
        .replace(/zerdinals\(\d+\):\s*/gi, '')
        .replace(/tatum:\s*/gi, '')
        .replace(/blockchair\(\d+\):\s*/gi, '')
        .replace(/\[broadcast\]\s*All providers failed:\s*\[/gi, '')
        .replace(/'[^']*zerdinals[^']*'/gi, '')
        .replace(/'[^']*tatum[^']*'/gi, '')
        .replace(/'[^']*blockchair[^']*'/gi, '')
        .replace(/,\s*,/g, ',')
        .replace(/\[,/g, '[')
        .replace(/,\]/g, ']')
        .replace(/\[\]/g, '')
        .trim();

      // Provide user-friendly messages
      if (errorMsg.toLowerCase().includes('decode failed')) {
        errorMsg = 'Transaction rejected: Invalid transaction format. This may be due to insufficient inscription amount.';
      } else if (errorMsg.toLowerCase().includes('unpaid action') || errorMsg.toLowerCase().includes('fee too low')) {
        errorMsg = 'Network rejected transaction: Fee too low. Please try again with a higher fee tier.';
      } else if (errorMsg.startsWith('[') || errorMsg.includes('{"error"')) {
        errorMsg = 'Transaction broadcast failed. Please try again.';
      }

      await ctx.runMutation(api.jobs.setJobStatus, { jobId: args.jobId, status: "failed", error: errorMsg });
      await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: utxo.txid, vout: utxo.vout });
      throw new Error(errorMsg);
    }
  }
});

export const retryJob = action({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(api.jobs.getJob, { jobId: args.jobId });
    if (!job) throw new Error('Job not found');
    if (job.status === 'completed') return job;
    await ctx.runMutation(api.jobs.setJobStatus, { jobId: args.jobId, status: 'pending' });
    await ctx.runAction(api.jobsActions.runNextMint, { jobId: args.jobId });
    return { status: 'running' };
  }
});

export const cancelJob = action({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    await ctx.runMutation(api.jobs.setJobStatus, { jobId: args.jobId, status: 'failed', error: 'Cancelled by operator' });
    return { status: 'failed' };
  }
});
