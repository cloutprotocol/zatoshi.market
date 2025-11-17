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
} from "./zcashHelpers";
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
      const inscriptionAmount = args.inscriptionAmount ?? 60000;
      const fee = args.fee ?? 10000;
      const waitMs = args.waitMs ?? 10000;
      const contentStr = args.contentJson ?? args.content ?? "hello world";
      const contentType = args.contentType ?? (args.contentJson ? "application/json" : "text/plain");

      currentStep = "loading platform config";
      const PLATFORM_FEE_ENABLED = (process.env.PLATFORM_FEE_ENABLED || '').toLowerCase() === 'true';
      const PLATFORM_FEE_ZATS = parseInt(process.env.PLATFORM_FEE_ZATS || '100000', 10);
      const PLATFORM_TREASURY = process.env.PLATFORM_TREASURY_ADDRESS || 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x';

      currentStep = "calling addressToPkh";
      const pkh = addressToPkh(args.address);

      // UTXO selection (simple: pick first confirmed >= needed)
      currentStep = "fetching UTXOs";
      const utxos = await fetchUtxos(args.address);

      currentStep = "selecting UTXO";
      const platformFeeZats = PLATFORM_FEE_ENABLED ? PLATFORM_FEE_ZATS : 0;
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
    const utxos = await fetchUtxos(address);
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
    const inscriptionAmount = args.inscriptionAmount ?? 60000;
    const fee = args.fee ?? 10000;
    const contentStr = args.contentJson ?? args.content ?? "hello world";
    const contentType = args.contentType ?? (args.contentJson ? "application/json" : "text/plain");
    const PLATFORM_FEE_ENABLED = (process.env.PLATFORM_FEE_ENABLED || '').toLowerCase() === 'true';
    const PLATFORM_FEE_ZATS = parseInt(process.env.PLATFORM_FEE_ZATS || '100000', 10);
    const PLATFORM_TREASURY = process.env.PLATFORM_TREASURY_ADDRESS || 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x';
    const platformFeeZats = PLATFORM_FEE_ENABLED ? PLATFORM_FEE_ZATS : 0;

    // UTXO selection with protection
    const utxos = await fetchUtxos(args.address);
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
    const consensusBranchId = await getConsensusBranchId();

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
    const commitTxid = await broadcastTransaction(commitHex);
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
    const revealTxid = await broadcastTransaction(revealHex);
    const inscriptionId = `${revealTxid}i0`;

    // unlock UTXO
    await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: rec.utxoTxid, vout: rec.utxoVout });

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
