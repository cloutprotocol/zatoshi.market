"use node";

import { action, internalAction } from "./_generated/server";
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
  utf8,
} from "./zcashHelpers";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";

function assertPublicAccessAllowed() {
  const disabled = (process.env.DISABLE_PUBLIC_INSCRIPTION_ACTIONS || '').toLowerCase() === 'true';
  if (disabled) {
    throw new Error('Public inscription actions are disabled. Please use the server gateway.');
  }
}

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
    assertPublicAccessAllowed();
    let currentStep = "initialization";
    try {
      currentStep = "parsing arguments";
      const inscriptionAmount = args.inscriptionAmount ?? 60000;
      const fee = args.fee ?? 10000;
      const waitMs = args.waitMs ?? 10000;
      const contentStr = args.contentJson ?? args.content ?? "hello world";
      const contentType = args.contentType ?? (args.contentJson ? "application/json" : "text/plain");

      // Basic input validation (server-side guardrails)
      if (!args.address || !args.address.startsWith('t1')) {
        throw new Error('Invalid address. Only transparent t-addresses (t1...) are supported.');
      }
      const contentBytes = new TextEncoder().encode(contentStr).length;
      if (contentBytes > 8192) {
        throw new Error(`Content too large (${contentBytes} bytes). Maximum allowed is 8192 bytes.`);
      }
      if (inscriptionAmount < 546 || inscriptionAmount > 1_000_000) {
        throw new Error('Invalid inscription amount. Choose between 546 and 1,000,000 zats.');
      }
      if (fee < 1_000 || fee > 500_000) {
        throw new Error('Invalid fee. Choose between 1,000 and 500,000 zats.');
      }
      if (waitMs < 0 || waitMs > 60_000) {
        throw new Error('Invalid wait time. Maximum 60 seconds.');
      }

      currentStep = "loading platform config";
      const PLATFORM_FEE_ENABLED = (process.env.PLATFORM_FEE_ENABLED || '').toLowerCase() === 'true';
      const PLATFORM_FEE_ZATS = parseInt(process.env.PLATFORM_FEE_ZATS || '100000', 10);
      const PLATFORM_TREASURY = process.env.PLATFORM_TREASURY_ADDRESS || 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x';

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
    assertPublicAccessAllowed();
    const { wif, address, splitCount, targetAmount, fee } = args;
    // Guardrails
    if (!address || !address.startsWith('t1')) throw new Error('Invalid address. Expected t1...');
    if (splitCount < 1 || splitCount > 25) throw new Error('Invalid split count. Choose between 1 and 25.');
    if (targetAmount < 546) throw new Error('Target amount too small. Must be at least 546 zats.');
    if (fee < 1_000 || fee > 500_000) throw new Error('Invalid fee. Choose between 1,000 and 500,000 zats.');
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
    assertPublicAccessAllowed();
    // Guardrails
    if (!args.address || !args.address.startsWith('t1')) throw new Error('Invalid address. Expected t1...');
    if (args.splitCount < 1 || args.splitCount > 25) throw new Error('Invalid split count. Choose between 1 and 25.');
    if (args.targetAmount < 546) throw new Error('Target amount too small. Must be at least 546 zats.');
    if (args.fee < 1_000 || args.fee > 500_000) throw new Error('Invalid fee. Choose between 1,000 and 500,000 zats.');
    let utxos;
    try { utxos = await fetchUtxos(args.address); }
    catch (_) { throw new Error('Unable to check your spendable funds right now. Please try again in a few seconds.'); }
    const required = args.splitCount * args.targetAmount + args.fee;
    const src = utxos.find(u => u.value >= required);
    if (!src) throw new Error(`Not enough spendable funds. Need at least ${required} zats to proceed. Add funds and try again.`);
    // lock
    const lock = await ctx.runMutation(internal.utxoLocks.lockUtxo, { txid: src.txid, vout: src.vout, address: args.address });
    if (!lock.locked) throw new Error('UTXO lock failed; retry later');

    const pkh = addressToPkh(args.address);
    const outputs: { value: number; scriptPubKey: Uint8Array }[] = [];
    for (let i=0;i<args.splitCount;i++) outputs.push({ value: args.targetAmount, scriptPubKey: buildP2PKHScript(pkh) });
    const change = src.value - required;
    if (change > 546) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });
    const consensusBranchId = await getConsensusBranchId();
    const sigHash = buildSplitSighash({ utxo: src, address: args.address, outputs, consensusBranchId });

    const contextId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    await ctx.runMutation(internal.txContexts.create, {
      contextId,
      status: 'split_prepared',
      utxoTxid: src.txid,
      utxoVout: src.vout,
      utxoValue: src.value,
      address: args.address,
      consensusBranchId,
      inscriptionAmount: 0,
      fee: args.fee,
      platformFeeZats: 0,
      platformTreasuryAddress: undefined,
      pubKeyHex: args.pubKeyHex,
      redeemScriptHex: '',
      p2shScriptHex: '',
      inscriptionDataHex: bytesToHex(utf8(JSON.stringify({ splitCount: args.splitCount, targetAmount: args.targetAmount }))),
      contentType: 'split',
      contentStr: 'split',
      type: 'split',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      commitTxid: undefined,
    });
    return { contextId, splitSigHashHex: bytesToHex(sigHash) };
  }
});

export const broadcastSignedSplitAction = action({
  args: { contextId: v.string(), splitSignatureRawHex: v.string() },
  handler: async (ctx, args) => {
    assertPublicAccessAllowed();
    const rec = await ctx.runQuery(internal.txContexts.getByContextId, { contextId: args.contextId });
    if (!rec) throw new Error('Context not found');
    if (rec.status !== 'split_prepared') throw new Error(`Invalid context status: ${rec.status}`);
    const splitParams = JSON.parse(new TextDecoder().decode(hexToBytes(rec.inscriptionDataHex)));
    const pkh = addressToPkh(rec.address);
    const outputs: { value: number; scriptPubKey: Uint8Array }[] = [];
    for (let i=0;i<splitParams.splitCount;i++) outputs.push({ value: splitParams.targetAmount, scriptPubKey: buildP2PKHScript(pkh) });
    const change = rec.utxoValue - (splitParams.splitCount * splitParams.targetAmount) - rec.fee;
    if (change > 546) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });
    const txHex = assembleSplitTxHex({
      utxo: { txid: rec.utxoTxid, vout: rec.utxoVout, value: rec.utxoValue },
      address: rec.address,
      pubKey: hexToBytes(rec.pubKeyHex),
      outputs,
      signatureRaw64: hexToBytes(args.splitSignatureRawHex),
      consensusBranchId: rec.consensusBranchId,
    });
    const txid = await broadcastTransaction(txHex);
    await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: rec.utxoTxid, vout: rec.utxoVout });
    await ctx.runMutation(internal.txContexts.patch, { _id: rec._id, status: 'completed', updatedAt: Date.now() });
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
    assertPublicAccessAllowed();
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
    assertPublicAccessAllowed();
    const inscriptionAmount = args.inscriptionAmount ?? 60000;
    const fee = args.fee ?? 10000;
    const contentStr = args.contentJson ?? args.content ?? "hello world";
    const contentType = args.contentType ?? (args.contentJson ? "application/json" : "text/plain");
    // Guardrails
    if (!args.address || !args.address.startsWith('t1')) {
      throw new Error('Invalid address. Only transparent t-addresses (t1...) are supported.');
    }
    const contentBytes = new TextEncoder().encode(contentStr).length;
    if (contentBytes > 8192) {
      throw new Error(`Content too large (${contentBytes} bytes). Maximum allowed is 8192 bytes.`);
    }
    if (inscriptionAmount < 546 || inscriptionAmount > 1_000_000) {
      throw new Error('Invalid inscription amount. Choose between 546 and 1,000,000 zats.');
    }
    if (fee < 1_000 || fee > 500_000) {
      throw new Error('Invalid fee. Choose between 1,000 and 500,000 zats.');
    }
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
    assertPublicAccessAllowed();
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
    assertPublicAccessAllowed();
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

// Internal versions (bypass public gating; intended for HTTP gate only)

export const i_buildUnsignedSplitAction = internalAction({
  args: {
    address: v.string(),
    pubKeyHex: v.string(),
    splitCount: v.number(),
    targetAmount: v.number(),
    fee: v.number(),
  },
  handler: async (ctx, args) => {
    // copy of buildUnsignedSplitAction handler (without assertPublicAccessAllowed)
    if (!args.address || !args.address.startsWith('t1')) throw new Error('Invalid address. Expected t1...');
    if (args.splitCount < 1 || args.splitCount > 25) throw new Error('Invalid split count. Choose between 1 and 25.');
    if (args.targetAmount < 546) throw new Error('Target amount too small. Must be at least 546 zats.');
    if (args.fee < 1_000 || args.fee > 500_000) throw new Error('Invalid fee. Choose between 1,000 and 500,000 zats.');
    let utxos;
    try { utxos = await fetchUtxos(args.address); }
    catch (_) { throw new Error('Unable to check your spendable funds right now. Please try again in a few seconds.'); }
    const required = args.splitCount * args.targetAmount + args.fee;
    const src = utxos.find(u => u.value >= required);
    if (!src) throw new Error(`Not enough spendable funds. Need at least ${required} zats to proceed. Add funds and try again.`);
    const lock = await ctx.runMutation(internal.utxoLocks.lockUtxo, { txid: src.txid, vout: src.vout, address: args.address });
    if (!lock.locked) throw new Error('UTXO lock failed; retry later');

    const pkh = addressToPkh(args.address);
    const outputs: { value: number; scriptPubKey: Uint8Array }[] = [];
    for (let i=0;i<args.splitCount;i++) outputs.push({ value: args.targetAmount, scriptPubKey: buildP2PKHScript(pkh) });
    const change = src.value - required;
    if (change > 546) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });
    const consensusBranchId = await getConsensusBranchId();
    const sigHash = buildSplitSighash({ utxo: src, address: args.address, outputs, consensusBranchId });

    const contextId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    await ctx.runMutation(internal.txContexts.create, {
      contextId,
      status: 'split_prepared',
      utxoTxid: src.txid,
      utxoVout: src.vout,
      utxoValue: src.value,
      address: args.address,
      consensusBranchId,
      inscriptionAmount: 0,
      fee: args.fee,
      platformFeeZats: 0,
      platformTreasuryAddress: undefined,
      pubKeyHex: args.pubKeyHex,
      redeemScriptHex: '',
      p2shScriptHex: '',
      inscriptionDataHex: bytesToHex(utf8(JSON.stringify({ splitCount: args.splitCount, targetAmount: args.targetAmount }))),
      contentType: 'split',
      contentStr: 'split',
      type: 'split',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      commitTxid: undefined,
    });
    return { contextId, splitSigHashHex: bytesToHex(sigHash) };
  }
});

export const i_broadcastSignedSplitAction = internalAction({
  args: { contextId: v.string(), splitSignatureRawHex: v.string() },
  handler: async (ctx, args) => {
    const rec = await ctx.runQuery(internal.txContexts.getByContextId, { contextId: args.contextId });
    if (!rec) throw new Error('Context not found');
    if (rec.status !== 'split_prepared') throw new Error(`Invalid context status: ${rec.status}`);
    const splitParams = JSON.parse(new TextDecoder().decode(hexToBytes(rec.inscriptionDataHex)));
    const pkh = addressToPkh(rec.address);
    const outputs: { value: number; scriptPubKey: Uint8Array }[] = [];
    for (let i=0;i<splitParams.splitCount;i++) outputs.push({ value: splitParams.targetAmount, scriptPubKey: buildP2PKHScript(pkh) });
    const change = rec.utxoValue - (splitParams.splitCount * splitParams.targetAmount) - rec.fee;
    if (change > 546) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(pkh) });
    const txHex = assembleSplitTxHex({
      utxo: { txid: rec.utxoTxid, vout: rec.utxoVout, value: rec.utxoValue },
      address: rec.address,
      pubKey: hexToBytes(rec.pubKeyHex),
      outputs,
      signatureRaw64: hexToBytes(args.splitSignatureRawHex),
      consensusBranchId: rec.consensusBranchId,
    });
    const txid = await broadcastTransaction(txHex);
    await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: rec.utxoTxid, vout: rec.utxoVout });
    await ctx.runMutation(internal.txContexts.patch, { _id: rec._id, status: 'completed', updatedAt: Date.now() });
    return { txid };
  }
});

export const i_batchMintAction = internalAction({
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
    const jobId = await ctx.runMutation(api.jobs.createJob, {
      type: "batch-mint",
      params: args,
      totalCount: args.count,
    });
    await ctx.runAction(api.jobsActions.runNextMint, { jobId });
    return { jobId };
  }
});

export const i_buildUnsignedCommitAction = internalAction({
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
    if (!args.address || !args.address.startsWith('t1')) throw new Error('Invalid address. Only transparent t-addresses (t1...) are supported.');
    const contentBytes = new TextEncoder().encode(contentStr).length;
    if (contentBytes > 8192) throw new Error(`Content too large (${contentBytes} bytes). Maximum allowed is 8192 bytes.`);
    if (inscriptionAmount < 546 || inscriptionAmount > 1_000_000) throw new Error('Invalid inscription amount. Choose between 546 and 1,000,000 zats.');
    if (fee < 1_000 || fee > 500_000) throw new Error('Invalid fee. Choose between 1,000 and 500,000 zats.');

    const PLATFORM_FEE_ENABLED = (process.env.PLATFORM_FEE_ENABLED || '').toLowerCase() === 'true';
    const PLATFORM_FEE_ZATS = parseInt(process.env.PLATFORM_FEE_ZATS || '100000', 10);
    const PLATFORM_TREASURY = process.env.PLATFORM_TREASURY_ADDRESS || 't1ZemSSmv1kcqapcCReZJGH4driYmbALX1x';
    const platformFeeZats = PLATFORM_FEE_ENABLED ? PLATFORM_FEE_ZATS : 0;

    const utxos = await fetchUtxos(args.address);
    const required = inscriptionAmount + fee + platformFeeZats;
    const candidates = utxos.filter(u => u.value >= required);
    let utxo = undefined as any;
    for (const c of candidates) { const hasInsc = await checkInscriptionAt(`${c.txid}:${c.vout}`); if (!hasInsc) { utxo = c; break; } }
    if (!utxo) throw new Error(`Not enough spendable funds for this inscription. You need at least ${required} zats available in a single input. Fresh deposits work best. Inputs holding inscriptions are protected and won't be used.`);

    const pubKey = hexToBytes(args.pubKeyHex);
    const chunks = buildInscriptionChunks(contentType, contentStr);
    const redeemScript = createRevealScript(pubKey, chunks);
    const p2sh = p2shFromRedeem(redeemScript);
    const consensusBranchId = await getConsensusBranchId();
    const sigHash = buildCommitSighash({ utxo, address: args.address, inscriptionAmount, fee, consensusBranchId, p2shScript: p2sh.script, platformFeeZats, platformTreasuryAddress: PLATFORM_TREASURY });

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
    await ctx.runMutation(internal.utxoLocks.lockUtxo, { txid: utxo.txid, vout: utxo.vout, address: args.address, lockedBy: contextId });
    return { contextId, commitSigHashHex: bytesToHex(sigHash) };
  }
});

export const i_finalizeCommitAndGetRevealPreimageAction = internalAction({
  args: { contextId: v.string(), commitSignatureRawHex: v.string() },
  handler: async (ctx, args) => {
    const rec = await ctx.runQuery(internal.txContexts.getByContextId, { contextId: args.contextId });
    if (!rec) throw new Error("Context not found");
    if (rec.status !== 'commit_prepared') throw new Error(`Invalid context status: ${rec.status}`);
    const commitHex = assembleCommitTxHex({ utxo: { txid: rec.utxoTxid, vout: rec.utxoVout, value: rec.utxoValue }, address: rec.address, pubKey: hexToBytes(rec.pubKeyHex), signatureRaw64: hexToBytes(args.commitSignatureRawHex), inscriptionAmount: rec.inscriptionAmount, fee: rec.fee, consensusBranchId: rec.consensusBranchId, p2shScript: hexToBytes(rec.p2shScriptHex), platformFeeZats: rec.platformFeeZats, platformTreasuryAddress: rec.platformTreasuryAddress });
    const commitTxid = await broadcastTransaction(commitHex);
    const revealSigHash = buildRevealSighash({ commitTxid, address: rec.address, inscriptionAmount: rec.inscriptionAmount, fee: rec.fee, consensusBranchId: rec.consensusBranchId, redeemScript: hexToBytes(rec.redeemScriptHex) });
    await ctx.runMutation(internal.txContexts.patch, { _id: rec._id, status: 'commit_broadcast', commitTxid, updatedAt: Date.now() });
    return { commitTxid, revealSigHashHex: bytesToHex(revealSigHash) };
  }
});

export const i_broadcastSignedRevealAction = internalAction({
  args: { contextId: v.string(), revealSignatureRawHex: v.string() },
  handler: async (ctx, args) => {
    const rec = await ctx.runQuery(internal.txContexts.getByContextId, { contextId: args.contextId });
    if (!rec) throw new Error("Context not found");
    if (!rec.commitTxid) throw new Error("Commit not broadcast yet");
    const revealHex = assembleRevealTxHex({ commitTxid: rec.commitTxid, address: rec.address, redeemScript: hexToBytes(rec.redeemScriptHex), inscriptionAmount: rec.inscriptionAmount, fee: rec.fee, inscriptionData: hexToBytes(rec.inscriptionDataHex), signatureRaw64: hexToBytes(args.revealSignatureRawHex), consensusBranchId: rec.consensusBranchId });
    const revealTxid = await broadcastTransaction(revealHex);
    const inscriptionId = `${revealTxid}i0`;
    await ctx.runMutation(internal.utxoLocks.unlockUtxo, { txid: rec.utxoTxid, vout: rec.utxoVout });
    const preview = rec.contentStr.slice(0, 200);
    let zrc20Tick: string | undefined; let zrc20Op: string | undefined; let zrc20Amount: string | undefined;
    if (rec.contentType.startsWith('application/json')) { try { const parsed = JSON.parse(rec.contentStr); if (parsed?.p === 'zrc-20') { zrc20Tick = parsed.tick?.toString()?.toUpperCase(); zrc20Op = parsed.op?.toString(); zrc20Amount = parsed.amt?.toString(); } } catch {} }
    await ctx.runMutation(api.inscriptions.createInscription, { txid: revealTxid, address: rec.address, contentType: rec.contentType, contentPreview: preview, contentSize: new TextEncoder().encode(rec.contentStr).length, type: rec.type ?? (rec.contentType.startsWith("application/json") ? "zrc20" : "text"), platformFeeZat: rec.platformFeeZats, treasuryAddress: rec.platformTreasuryAddress, zrc20Tick, zrc20Op, zrc20Amount } as any);
    await ctx.runMutation(internal.txContexts.patch, { _id: rec._id, status: 'completed', updatedAt: Date.now() });
    return { revealTxid, inscriptionId };
  }
});
