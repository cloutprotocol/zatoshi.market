"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

// Clean up old UTXO locks (default: >10 minutes)
export const cleanupUtxoLocks = action({
  args: { olderThanMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const maxAge = args.olderThanMs ?? 10 * 60 * 1000;
    const cutoff = Date.now() - maxAge;
    const locks = await ctx.db.query("utxoLocks").collect();
    let deleted = 0;
    for (const l of locks) {
      if (l.lockedAt < cutoff) {
        await ctx.db.delete(l._id);
        deleted++;
      }
    }
    return { deleted, cutoff };
  }
});

// Clean up old tx contexts (default: >24 hours)
export const cleanupTxContexts = action({
  args: { olderThanMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const maxAge = args.olderThanMs ?? 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAge;
    const contexts = await ctx.db.query("txContexts").collect();
    let deleted = 0;
    for (const c of contexts) {
      if (c.createdAt < cutoff) {
        await ctx.db.delete(c._id);
        deleted++;
      }
    }
    return { deleted, cutoff };
  }
});

