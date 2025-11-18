"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
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
    const inscriptionAmount = p.inscriptionAmount ?? 60000;
    const fee = p.fee ?? 10000;
    const PLATFORM_FEE_ENABLED = (process.env.PLATFORM_FEE_ENABLED || '').toLowerCase() === 'true';
    const PLATFORM_FEE_ZATS = parseInt(process.env.PLATFORM_FEE_ZATS || '100000', 10);
    const PLATFORM_TREASURY = process.env.PLATFORM_TREASURY_ADDRESS || 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x';
    const waitMs = p.waitMs ?? 8000;
    const contentStr: string = p.contentJson ?? p.content ?? "hello world";
    const contentType: string = p.contentType ?? (p.contentJson ? "application/json" : "text/plain");

    // Mint once
    const utxos = await fetchUtxos(p.address);
    const platformFeeZats = PLATFORM_FEE_ENABLED ? PLATFORM_FEE_ZATS : 0;
    const required = inscriptionAmount + fee + platformFeeZats;
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
        inscriptionAmount,
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
        inscriptionAmount,
        fee,
        consensusBranchId: branchId,
        redeemScript,
        p2shScript: p2shFixed.script,
        platformFeeZats,
        platformTreasuryAddress: PLATFORM_TREASURY,
      });
      const commitTxid = await broadcastTransaction(commit.hex);
      await new Promise((r)=>setTimeout(r, waitMs));
      const inscriptionData = buildInscriptionDataBuffer(contentStr, contentType);
      const revealHex = await buildRevealTxHex({ commitTxid, address: p.address, wif: p.wif, inscriptionAmount, fee, consensusBranchId: branchId, redeemScript, inscriptionData });
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
        } catch {}
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
      await ctx.runMutation(api.jobs.addJobProgress, { jobId: args.jobId, inscriptionId, inscriptionDocId: docId });

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
      await ctx.runMutation(api.jobs.setJobStatus, { jobId: args.jobId, status: "failed", error: e?.message || String(e) });
      await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: utxo.txid, vout: utxo.vout });
      throw e;
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
