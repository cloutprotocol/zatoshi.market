import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";

export const lockUtxo = internalMutation({
  args: {
    txid: v.string(),
    vout: v.number(),
    address: v.string(),
    lockedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const existingAll = await ctx.db
      .query("utxoLocks")
      .withIndex("by_txid_vout", (q) => q.eq("txid", args.txid).eq("vout", args.vout))
      .collect();

    // If this exact lock already exists (same tx/vout + same lockedBy), treat as idempotent success
    const sameLock = existingAll.find((l) => l.lockedBy === args.lockedBy && l.address === args.address);
    if (sameLock) {
      return { locked: true, _id: sameLock._id };
    }

    // Any other existing lock (different job/address or previous spend) blocks this attempt
    if (existingAll.length > 0) {
      return { locked: false, _id: existingAll[0]._id };
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
    const existingAll = await ctx.db
      .query("utxoLocks")
      .withIndex("by_txid_vout", (q) => q.eq("txid", args.txid).eq("vout", args.vout))
      .collect();
    let deleted = 0;
    for (const lock of existingAll) {
      await ctx.db.delete(lock._id);
      deleted++;
    }
    return deleted > 0;
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

// Prune locks older than a threshold to avoid stale-lock deadlocks
const STALE_LOCK_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

export const pruneStaleLocks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_LOCK_THRESHOLD_MS;
    // Filter by lockedAt timestamp
    const stale = await ctx.db
      .query("utxoLocks")
      .filter((q) => q.lt(q.field("lockedAt"), cutoff))
      .collect();
    for (const lock of stale) {
      await ctx.db.delete(lock._id);
    }
    return { pruned: stale.length };
  },
});

// List locks by address (internal helper for admin operations)
export const getLocksForAddress = internalQuery({
  args: { address: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("utxoLocks")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .collect();
  },
});

// Force-unlock a specific lock by id (admin)
export const forceUnlockUtxo = internalMutation({
  args: { lockId: v.id("utxoLocks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.lockId);
    return true;
  },
});

// Atomically lock multiple UTXOs. If any are already locked, none are locked.
export const lockUtxos = internalMutation({
  args: {
    items: v.array(v.object({ txid: v.string(), vout: v.number() })),
    address: v.string(),
    lockedBy: v.string(),
  },
  handler: async (ctx, args) => {
    let lockedCount = 0;
    for (const it of args.items) {
      const existingAll = await ctx.db
        .query("utxoLocks")
        .withIndex("by_txid_vout", (q) => q.eq("txid", it.txid).eq("vout", it.vout))
        .collect();

      const sameLock = existingAll.find((l) => l.lockedBy === args.lockedBy && l.address === args.address);
      if (sameLock) {
        lockedCount++;
        continue;
      }

      if (existingAll.length > 0) {
        return { success: false, lockedCount: 0 };
      }

      await ctx.db.insert("utxoLocks", {
        txid: it.txid,
        vout: it.vout,
        address: args.address,
        lockedBy: args.lockedBy,
        lockedAt: Date.now(),
      });
      lockedCount++;
    }
    return { success: true, lockedCount };
  },
});

// Unlock a set of UTXOs
export const unlockUtxos = internalMutation({
  args: {
    items: v.array(v.object({ txid: v.string(), vout: v.number() })),
  },
  handler: async (ctx, args) => {
    let count = 0;
    for (const it of args.items) {
      const existingAll = await ctx.db
        .query("utxoLocks")
        .withIndex("by_txid_vout", (q) => q.eq("txid", it.txid).eq("vout", it.vout))
        .collect();
      for (const l of existingAll) { await ctx.db.delete(l._id); count++; }
    }
    return { unlockedCount: count };
  },
});

// Convenience: unlock all locks for a given `lockedBy` token
export const unlockByLockedBy = internalMutation({
  args: { lockedBy: v.string() },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("utxoLocks")
      .filter((q) => q.eq(q.field("lockedBy"), args.lockedBy))
      .collect();
    for (const l of all) await ctx.db.delete(l._id);
    return { unlockedCount: all.length };
  },
});
