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
    // Filter safe only
    const candidates = utxos.filter(u => u.value >= required);

    // Retry loop: Try up to 3 candidates (or all if fewer) to handle race conditions/stale UTXOs
    let lastError: any = null;
    let success = false;

    // Sort candidates by value (ascending) to use smallest sufficient UTXOs first, 
    // or shuffle/randomize if we want to reduce collision probability further.
    // For now, just taking the first few valid ones.
    for (const utxoCandidate of candidates) {
      // Check inscription status
      const hasInsc = await checkInscriptionAt(`${utxoCandidate.txid}:${utxoCandidate.vout}`);
      if (hasInsc) continue;

      // Try lock
      const lockRes = await ctx.runMutation(internal.utxoLocks.lockUtxo, {
        txid: utxoCandidate.txid,
        vout: utxoCandidate.vout,
        address: p.address,
        lockedBy: String(args.jobId)
      });

      if (!lockRes.locked) {
        // If locked by someone else, just skip to next candidate
        continue;
      }

      // We have the lock, try to mint
      try {
        const branchId = await getConsensusBranchId();
        const chunks = buildInscriptionChunks(contentType, contentStr);
        // Provisional to get p2sh
        const redeemProvisional = createRevealScript(new Uint8Array(0), chunks);
        const p2sh = p2shFromRedeem(redeemProvisional);
        // Build commit (get pubkey)
        const commitBuilt = await buildCommitTxHex({
          utxo: utxoCandidate,
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
          utxo: utxoCandidate,
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

        // Broadcast Commit
        let commitTxid: string;
        try {
          commitTxid = await broadcastTransaction(commit.hex);
        } catch (broadcastErr: any) {
          const msg = String(broadcastErr?.message || broadcastErr);
          // If inputs are spent, this UTXO is bad. Unlock and try next.
          if (msg.includes('bad-txns-inputs-spent') || msg.includes('missing inputs') || msg.includes('txn-mempool-conflict')) {
            console.warn(`[runNextMint] UTXO ${utxoCandidate.txid}:${utxoCandidate.vout} spent/conflict, retrying next...`);
            await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: utxoCandidate.txid, vout: utxoCandidate.vout });
            lastError = broadcastErr;
            continue; // Try next candidate
          }
          throw broadcastErr; // Other errors are fatal for this attempt
        }

        // Wait for propagation
        await new Promise((r) => setTimeout(r, waitMs));

        const inscriptionData = buildInscriptionDataBuffer(contentStr, contentType);
        const revealHex = await buildRevealTxHex({
          commitTxid,
          address: p.address,
          wif: p.wif,
          inscriptionAmount: finalInscriptionAmount,
          fee,
          consensusBranchId: branchId,
          redeemScript,
          inscriptionData
        });

        const revealTxid = await broadcastTransaction(revealHex);
        const inscriptionId = `${revealTxid}i0`;
        const preview = contentStr.slice(0, 200);
        let zrc20Tick: string | undefined;
        let zrc20Op: string | undefined;
        let zrc20Amount: string | undefined;
        let inscriptionType = p.type ?? (contentType.startsWith("application/json") ? "zrc20" : "text");
        if (contentType.startsWith('application/json')) {
          try {
            const parsed = JSON.parse(contentStr);
            if (parsed?.p === 'zrc-20') {
              zrc20Tick = parsed.tick?.toString()?.toUpperCase();
              zrc20Op = parsed.op?.toString();
              zrc20Amount = parsed.amt?.toString();
              inscriptionType = "zrc20";
            } else if (parsed?.p?.toLowerCase?.() === 'zrc-721') {
              inscriptionType = "zrc-721";
            }
          } catch { }
        }

        const docId = await ctx.runMutation(api.inscriptions.createInscription, {
          txid: revealTxid,
          address: p.address,
          contentType,
          contentPreview: preview,
          contentSize: new TextEncoder().encode(contentStr).length,
          type: inscriptionType,
          platformFeeZat: platformFeeZats,
          treasuryAddress: PLATFORM_TREASURY,
          zrc20Tick,
          zrc20Op,
          zrc20Amount,
        } as any);

        // Actual on-chain cost calculation
        const change = utxoCandidate.value - finalInscriptionAmount - fee - platformFeeZats;
        const changeReturned = change > 546 ? change : 0;
        const revealDustReturned = 547;
        const actualCostZats = utxoCandidate.value - changeReturned - revealDustReturned;

        await ctx.runMutation(api.jobs.addJobProgress, {
          jobId: args.jobId,
          inscriptionId,
          inscriptionDocId: docId,
          costZats: actualCostZats,
        });

        const updated = await ctx.runQuery(api.jobs.getJob, { jobId: args.jobId });
        if (updated && updated.completedCount >= updated.totalCount) {
          await ctx.runMutation(api.jobs.setJobStatus, { jobId: args.jobId, status: "completed" });
          await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: utxoCandidate.txid, vout: utxoCandidate.vout });
          return { status: "completed" };
        }

        await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: utxoCandidate.txid, vout: utxoCandidate.vout });
        // Tail-chain next mint
        await ctx.runAction(api.jobsActions.runNextMint, { jobId: args.jobId });
        success = true;
        return { status: "running" };

      } catch (e: any) {
        // If we failed AFTER locking but BEFORE broadcasting commit (or during non-retryable broadcast error),
        // we must unlock and handle error.
        // If we are here, it means we either didn't 'continue' (fatal error) or something else broke.
        // We should try to unlock the current UTXO.
        await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: utxoCandidate.txid, vout: utxoCandidate.vout });

        // If it was a "spent" error that bubbled up (unlikely given the catch above, but possible if logic changes),
        // we might want to continue. But for now, treat other errors as fatal for this UTXO.
        // Actually, if we are here, it's likely a fatal error for this UTXO or a general error.
        // Let's capture it and try the next UTXO if it looks transient, otherwise throw.

        const msg = String(e?.message || e);
        if (msg.includes('bad-txns-inputs-spent') || msg.includes('missing inputs')) {
          lastError = e;
          continue;
        }

        // For other errors, we might want to abort the whole job or just this attempt?
        // Current logic: throw immediately for non-spent errors.
        throw e;
      }
    }

    // If we exit the loop without success, throw the last error or a generic one
    if (!success) {
      const e = lastError || new Error(
        `Not enough spendable funds. Need at least ${required} zats to proceed. ` +
        `Add funds and try again.`
      );

      // Sanitize error message before storing/throwing
      let errorMsg = e?.message ? String(e.message) : String(e);

      // Remove provider names and internal details
      errorMsg = errorMsg
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

      // Provide user-friendly messages
      if (errorMsg.toLowerCase().includes('decode failed')) {
        errorMsg = 'Transaction rejected: Invalid transaction format. This may be due to insufficient inscription amount.';
      } else if (errorMsg.toLowerCase().includes('unpaid action') || errorMsg.toLowerCase().includes('fee too low')) {
        errorMsg = 'Network rejected transaction: Fee too low. Please try again with a higher fee tier.';
      } else if (errorMsg.startsWith('[') || errorMsg.includes('{"error"')) {
        errorMsg = 'Transaction broadcast failed. Please try again.';
      }

      await ctx.runMutation(api.jobs.setJobStatus, { jobId: args.jobId, status: "failed", error: errorMsg });
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

// Helper action: create a single-mint job and immediately run it (client-friendly wrapper)
export const createMintJobAndRun = action({
  args: {
    address: v.string(),
    wif: v.string(),
    contentJson: v.string(),
    contentType: v.optional(v.string()),
    inscriptionAmount: v.optional(v.number()),
    fee: v.optional(v.number()),
    waitMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const params = {
      address: args.address,
      wif: args.wif,
      contentJson: args.contentJson,
      contentType: args.contentType ?? "application/json",
      inscriptionAmount: args.inscriptionAmount,
      fee: args.fee,
      waitMs: args.waitMs,
    };
    // Infer inscription type for downstream history
    let inscriptionType = params.contentType.startsWith("application/json") ? "zrc20" : "text";
    try {
      const parsed = JSON.parse(params.contentJson);
      if (parsed?.p?.toLowerCase?.() === "zrc-721") inscriptionType = "zrc-721";
    } catch { /* non-JSON payload, keep default */ }

    const jobId = await ctx.runMutation(internal.jobs.createJob, {
      type: "batch-mint",
      params: { ...params, type: inscriptionType },
      totalCount: 1,
    });
    try {
      await ctx.runAction(api.jobsActions.runNextMint, { jobId });
    } catch (e) {
      // Ignore error here, job status will be 'failed' and client can read it
      console.error(`[createMintJobAndRun] runNextMint failed for ${jobId}:`, e);
    }
    return { jobId };
  },
});
