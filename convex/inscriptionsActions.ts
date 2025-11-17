import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import {
  addressToPkh,
  buildCommitTxHex,
  buildInscriptionChunks,
  buildInscriptionDataBuffer,
  buildRevealTxHex,
  createRevealScript,
  fetchUtxos,
  p2shFromRedeem,
  getConsensusBranchId,
  broadcastTransaction,
} from "@/lib/zcash/inscriptions";

export const mintInscriptionAction = action({
  args: {
    wif: v.string(),
    address: v.string(),
    content: v.optional(v.string()),
    contentJson: v.optional(v.string()),
    contentType: v.optional(v.string()),
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
    const utxo = utxos.find(u => u.value >= required);
    if (!utxo) throw new Error(`No UTXO >= ${required}`);

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

    const commitTxid = await broadcastTransaction(commitRebuilt.hex);

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

    // Log final inscription (optional: adapt to schema expectations)
    const preview = contentStr.slice(0, 200);
    await ctx.runMutation(api.inscriptions.createInscription, {
      txid: revealTxid,
      address: args.address,
      contentType,
      contentPreview: preview,
      contentSize: Buffer.byteLength(contentStr),
      type: contentType.startsWith("application/json") ? "zrc20" : "text",
      platformFeeZat: 0,
      treasuryAddress: args.address,
      zrc20Tick: undefined,
      zrc20Op: undefined,
      zrc20Amount: undefined,
    } as any);

    return { commitTxid, revealTxid, inscriptionId };
  }
});
