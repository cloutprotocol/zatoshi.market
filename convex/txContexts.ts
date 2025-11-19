import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const create = internalMutation({
  args: {
    contextId: v.string(),
    status: v.string(),
    // Single UTXO fields (optional now to support multi-input)
    utxoTxid: v.optional(v.string()),
    utxoVout: v.optional(v.number()),
    utxoValue: v.optional(v.number()),
    // Multi-input support
    utxos: v.optional(
      v.array(
        v.object({
          txid: v.string(),
          vout: v.number(),
          value: v.number(),
        })
      )
    ),
    address: v.string(),
    consensusBranchId: v.number(),
    inscriptionAmount: v.number(),
    fee: v.number(),
    platformFeeZats: v.number(),
    platformTreasuryAddress: v.optional(v.string()),
    pubKeyHex: v.string(),
    redeemScriptHex: v.string(),
    p2shScriptHex: v.string(),
    inscriptionDataHex: v.string(),
    contentType: v.string(),
    contentStr: v.string(),
    type: v.optional(v.string()),
    commitTxid: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("txContexts", args);
  }
});

export const getByContextId = internalQuery({
  args: { contextId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("txContexts").withIndex("by_context_id", q => q.eq("contextId", args.contextId)).first();
  }
});

export const patch = internalMutation({
  args: {
    _id: v.id("txContexts"),
    status: v.optional(v.string()),
    commitTxid: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const {_id, ...rest} = args;
    await ctx.db.patch(_id, rest);
  }
});