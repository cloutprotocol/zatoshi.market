import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

export const lockUtxo = internalMutation({
  args: {
    txid: v.string(),
    vout: v.number(),
    address: v.string(),
    lockedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check existing lock
    const existing = await ctx.db
      .query("utxoLocks")
      .withIndex("by_txid_vout", (q) => q.eq("txid", args.txid).eq("vout", args.vout))
      .first();
    if (existing) {
      return { locked: false, _id: existing._id };
    }
    const _id = await ctx.db.insert("utxoLocks", {
      txid: args.txid,
      vout: args.vout,
      address: args.address,
      lockedBy: args.lockedBy,
      lockedAt: Date.now(),
    });
    return { locked: true, _id };
  },
});

export const unlockUtxo = internalMutation({
  args: {
    txid: v.string(),
    vout: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("utxoLocks")
      .withIndex("by_txid_vout", (q) => q.eq("txid", args.txid).eq("vout", args.vout))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
      return true;
    }
    return false;
  },
});

export const isLocked = query({
  args: { txid: v.string(), vout: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("utxoLocks")
      .withIndex("by_txid_vout", (q) => q.eq("txid", args.txid).eq("vout", args.vout))
      .first();
    return !!existing;
  },
});

