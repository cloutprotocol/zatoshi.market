import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";

export const lockUtxo = internalMutation({
  args: {
    txid: v.string(),
    vout: v.number(),
    address: v.string(),
    lockedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check for any existing locks on this outpoint
    const existingAll = await ctx.db
      .query("utxoLocks")
      .withIndex("by_txid_vout", (q) => q.eq("txid", args.txid).eq("vout", args.vout))
      .collect();

    // If any lock exists owned by another address, we cannot acquire
    const conflict = existingAll.find((l) => l.address !== args.address);
    if (conflict) return { locked: false, _id: conflict._id };

    // If a lock already exists and it's ours, treat as success (idempotent)
    const owned = existingAll.find((l) => l.address === args.address);
    if (owned) {
      // Optionally update lockedBy for bookkeeping if provided
      if (args.lockedBy && owned.lockedBy !== args.lockedBy) {
        await ctx.db.patch(owned._id, { lockedBy: args.lockedBy });
      }
      // Clean up accidental duplicates (keep the first one)
      for (const dup of existingAll) {
        if (dup._id !== owned._id && dup.address === args.address) {
          await ctx.db.delete(dup._id);
        }
      }
      return { locked: true, _id: owned._id };
    }

    // No existing lock -> create one
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
    lockedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // First, detect conflicts: any lock by another address means we cannot proceed
    for (const it of args.items) {
      const existingAll = await ctx.db
        .query("utxoLocks")
        .withIndex("by_txid_vout", (q) => q.eq("txid", it.txid).eq("vout", it.vout))
        .collect();
      const conflict = existingAll.find((l) => l.address !== args.address);
      if (conflict) return { success: false, lockedCount: 0 };
    }

    // No conflicts: ensure we hold a single lock for each item (idempotent)
    let lockedCount = 0;
    for (const it of args.items) {
      const existingAll = await ctx.db
        .query("utxoLocks")
        .withIndex("by_txid_vout", (q) => q.eq("txid", it.txid).eq("vout", it.vout))
        .collect();
      // If one exists owned by us, update lockedBy if provided; delete any dupes owned by us
      const owned = existingAll.find((l) => l.address === args.address);
      if (owned) {
        if (args.lockedBy && owned.lockedBy !== args.lockedBy) {
          await ctx.db.patch(owned._id, { lockedBy: args.lockedBy });
        }
        for (const dup of existingAll) {
          if (dup._id !== owned._id && dup.address === args.address) {
            await ctx.db.delete(dup._id);
          }
        }
        lockedCount++;
        continue;
      }
      // Otherwise create a new lock owned by us
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
