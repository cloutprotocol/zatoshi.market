import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAllowlistEntry } from "./claimAllowlists";

const MAX_RESERVE_ATTEMPTS = 200;
const RESERVATION_TTL_MS = 15 * 60 * 1000; // 15 minutes

function normalizeAddress(address: string) {
  return (address || "").toLowerCase();
}

async function getClaimCountsForAddress(
  ctx: any,
  slug: string,
  address: string
): Promise<{ minted: number; reserved: number }> {
  const cutoff = Date.now() - RESERVATION_TTL_MS;
  const mintedDocs = await ctx.db
    .query("collectionClaims")
    .withIndex("by_collection_status", (q: any) => q.eq("collectionSlug", slug).eq("status", "minted"))
    .collect();
  const reservedDocs = await ctx.db
    .query("collectionClaims")
    .withIndex("by_collection_status", (q: any) => q.eq("collectionSlug", slug).eq("status", "reserved"))
    .collect();
  const minted = mintedDocs.filter((c: any) => (c.address || "").toLowerCase() === address).length;
  const reserved = reservedDocs.filter(
    (c: any) =>
      (c.address || "").toLowerCase() === address &&
      ((c.updatedAt ?? c.createdAt ?? 0) >= cutoff)
  ).length;
  return {
    minted,
    reserved,
  };
}

export const getClaimStats = query({
  args: {
    collectionSlug: v.string(),
    address: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();
    const cutoff = Date.now() - RESERVATION_TTL_MS;
    const minted = await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) => q.eq("collectionSlug", slug).eq("status", "minted"))
      .collect();
    const reserved = await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) => q.eq("collectionSlug", slug).eq("status", "reserved"))
      .collect();
    const activeReserved = reserved.filter((r) => (r.updatedAt ?? r.createdAt ?? 0) >= cutoff);

    const byAddress = args.address
      ? minted.filter((m) => m.address.toLowerCase() === args.address!.toLowerCase())
      : [];
    const reservedByAddress = args.address
      ? activeReserved.filter((m) => m.address.toLowerCase() === args.address!.toLowerCase())
      : [];

    return {
      mintedCount: minted.length,
      mintedIds: minted.map((m) => m.tokenId),
      mintedForAddress: {
        count: byAddress.length,
        ids: byAddress.map((m) => m.tokenId),
      },
      reservedCount: activeReserved.length,
      reservedForAddress: {
        count: reservedByAddress.length,
        ids: reservedByAddress.map((m) => m.tokenId),
      },
    };
  },
});

export const listMinted = query({
  args: {
    collectionSlug: v.string(),
    address: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();
    const limit = Math.max(1, Math.min(args.limit ?? 25, 200));

    // Pull minted entries for this collection and then filter by address (case-insensitive)
    const minted = await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) => q.eq("collectionSlug", slug).eq("status", "minted"))
      .order("desc")
      .collect();

    const filtered = args.address
      ? minted.filter((m) => m.address.toLowerCase() === args.address!.toLowerCase())
      : minted;

    return filtered.slice(0, limit);
  },
});

export const reserveTokens = mutation({
  args: {
    collectionSlug: v.string(),
    address: v.string(),
    count: v.number(),
    supply: v.number(),
    batchId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();
    const address = normalizeAddress(args.address);
    if (!address) throw new Error("Wallet address required");

    if (!Number.isFinite(args.count)) {
      throw new Error('Invalid claim quantity provided');
    }
    const requestedCount = Math.floor(args.count);
    if (requestedCount < 1) {
      throw new Error('Claim quantity must be at least 1');
    }
    if (requestedCount > 5) {
      throw new Error('Batch limit exceeded. Maximum 5 per request.');
    }
    const allowlist = getAllowlistEntry(slug, address);
    if (!allowlist || allowlist.max <= 0) {
      throw new Error("Wallet is not whitelisted for this collection");
    }

    const now = Date.now();
    const cutoff = now - RESERVATION_TTL_MS;
    const maxCount = Math.min(5, requestedCount);
    const reserved: number[] = [];
    const reusedDocs: any[] = [];
    const newAllocations: number[] = [];

    // Fetch existing tokenIds and active reservations to avoid duplicates
    const mintedDocs = await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) => q.eq("collectionSlug", slug).eq("status", "minted"))
      .collect();
    const reservedDocsRaw = await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) => q.eq("collectionSlug", slug).eq("status", "reserved"))
      .collect();

    // Expire stale reservations globally to free supply
    const expired = reservedDocsRaw.filter((doc) => (doc.updatedAt ?? doc.createdAt ?? 0) < cutoff);
    for (const doc of expired) {
      await ctx.db.patch(doc._id, {
        status: "failed",
        lastError: "Reservation expired",
        updatedAt: now,
      });
      await ctx.db.insert("collectionClaimEvents", {
        collectionSlug: slug,
        tokenId: doc.tokenId,
        address: doc.address,
        batchId: doc.batchId,
        status: "failed",
        message: "Reservation expired",
        createdAt: now,
      });
    }

    let reservedDocs = reservedDocsRaw.filter(
      (doc) => (doc.updatedAt ?? doc.createdAt ?? 0) >= cutoff && doc.status === "reserved"
    );
    const mintedForAddress = mintedDocs.filter((m) => (m.address || "").toLowerCase() === address);
    let reservedForAddress = reservedDocs
      .filter((doc) => (doc.address || "").toLowerCase() === address)
      .sort((a, b) => a.createdAt - b.createdAt);

    // Trim any over-allocation from lingering reservations (keep oldest first)
    const maxReservedAllowed = Math.max(allowlist.max - mintedForAddress.length, 0);
    if (reservedForAddress.length > maxReservedAllowed) {
      const overflow = reservedForAddress.slice(maxReservedAllowed);
      const overflowIds = new Set(overflow.map((d) => d._id));
      reservedForAddress = reservedForAddress.slice(0, maxReservedAllowed);
      reservedDocs = reservedDocs.filter((doc) => !overflowIds.has(doc._id));
      for (const doc of overflow) {
        await ctx.db.patch(doc._id, {
          status: "failed",
          lastError: "Reservation exceeds allocation",
          updatedAt: now,
        });
        await ctx.db.insert("collectionClaimEvents", {
          collectionSlug: slug,
          tokenId: doc.tokenId,
          address: doc.address,
          batchId: doc.batchId,
          status: "failed",
          message: "Reservation exceeds allocation",
          createdAt: now,
        });
      }
    }

    const mintedCount = mintedForAddress.length;
    const remainingCapacity = Math.max(allowlist.max - mintedCount, 0);
    if (remainingCapacity <= 0 && reservedForAddress.length === 0) {
      throw new Error("Allocation exhausted for this wallet");
    }
    if (maxCount > remainingCapacity) {
      throw new Error(`Allocation exceeded. You can claim ${remainingCapacity} more.`);
    }

    const targetCount = Math.max(1, Math.min(maxCount, remainingCapacity));
    const taken = new Set<number>([...mintedDocs, ...reservedDocs].map((d) => d.tokenId));

    // Reuse any previously reserved tokens for this address before allocating new ones
    for (const doc of reservedForAddress) {
      if (reserved.length >= targetCount) break;
      reserved.push(doc.tokenId);
      reusedDocs.push(doc);
    }

    if (reusedDocs.length) {
      for (const doc of reusedDocs) {
        const patch: Record<string, any> = { updatedAt: now };
        if (args.batchId) patch.batchId = args.batchId;
        await ctx.db.patch(doc._id, patch);
        await ctx.db.insert("collectionClaimEvents", {
          collectionSlug: slug,
          tokenId: doc.tokenId,
          address,
          batchId: args.batchId ?? doc.batchId,
          status: "reserved",
          message: "Reservation reused",
          createdAt: now,
        });
      }
    }

    let attempts = 0;
    while (reserved.length < targetCount && attempts < MAX_RESERVE_ATTEMPTS) {
      attempts += 1;
      const candidate = Math.floor(Math.random() * args.supply);
      if (taken.has(candidate) || reserved.includes(candidate)) continue;
      taken.add(candidate);
      reserved.push(candidate);
      newAllocations.push(candidate);
    }

    if (!reserved.length) {
      throw new Error("No tokens available to reserve. Supply may be exhausted.");
    }

    for (const id of newAllocations) {
      await ctx.db.insert("collectionClaims", {
        collectionSlug: slug,
        tokenId: id,
        status: "reserved",
        address,
        batchId: args.batchId,
        createdAt: now,
        updatedAt: now,
        attempts: 0,
      });
      await ctx.db.insert("collectionClaimEvents", {
        collectionSlug: slug,
        tokenId: id,
        address,
        batchId: args.batchId,
        status: "reserved",
        createdAt: now,
      });
    }

    return { tokenIds: reserved };
  },
});

export const finalizeToken = mutation({
  args: {
    collectionSlug: v.string(),
    tokenId: v.number(),
    address: v.string(),
    inscriptionId: v.optional(v.string()),
    txid: v.optional(v.string()),
    success: v.boolean(),
    batchId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();
    const address = normalizeAddress(args.address);
    const allowlist = getAllowlistEntry(slug, address);
    const existing = await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_token", (q) => q.eq("collectionSlug", slug).eq("tokenId", args.tokenId))
      .first();

    if (!existing) {
      // If something somehow minted without reservation, create record
      if (args.success) {
        if (!allowlist || allowlist.max <= 0) {
          throw new Error("Wallet is not whitelisted for this collection");
        }
        const { minted } = await getClaimCountsForAddress(ctx, slug, address);
        if (minted >= allowlist.max) {
          throw new Error("Allocation exhausted for this wallet");
        }
        await ctx.db.insert("collectionClaims", {
          collectionSlug: slug,
          tokenId: args.tokenId,
          status: "minted",
          address,
          inscriptionId: args.inscriptionId,
          txid: args.txid,
          batchId: args.batchId,
          attempts: 1,
          lastError: args.error,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      return;
    }

    if ((existing.address || "").toLowerCase() !== address) {
      // If somehow a different address tries to finalize, log and ignore to avoid client-visible errors
      await ctx.db.insert("collectionClaimEvents", {
        collectionSlug: slug,
        tokenId: args.tokenId,
        address,
        batchId: args.batchId ?? existing.batchId,
        status: "failed",
        message: "Address mismatch for reserved token",
        txid: args.txid,
        inscriptionId: args.inscriptionId,
        createdAt: Date.now(),
      });
      return;
    }

    // If already minted, skip double-finalization
    if (existing.status === "minted" && args.success) {
      return;
    }

    if (args.success) {
      if (!allowlist || allowlist.max <= 0) {
        await ctx.db.patch(existing._id, {
          status: "failed",
          batchId: args.batchId ?? existing.batchId,
          attempts: (existing.attempts ?? 0) + 1,
          lastError: "Wallet not in allowlist",
          updatedAt: Date.now(),
        });
        await ctx.db.insert("collectionClaimEvents", {
          collectionSlug: slug,
          tokenId: args.tokenId,
          address,
          batchId: args.batchId ?? existing.batchId,
          status: "failed",
          message: "Wallet not in allowlist",
          txid: args.txid,
          inscriptionId: args.inscriptionId,
          createdAt: Date.now(),
        });
        return;
      }

      const { minted } = await getClaimCountsForAddress(ctx, slug, address);
      if (minted >= allowlist.max) {
        await ctx.db.patch(existing._id, {
          status: "failed",
          batchId: args.batchId ?? existing.batchId,
          attempts: (existing.attempts ?? 0) + 1,
          lastError: "Allocation exhausted",
          updatedAt: Date.now(),
        });
        await ctx.db.insert("collectionClaimEvents", {
          collectionSlug: slug,
          tokenId: args.tokenId,
          address,
          batchId: args.batchId ?? existing.batchId,
          status: "failed",
          message: "Allocation exhausted",
          txid: args.txid,
          inscriptionId: args.inscriptionId,
          createdAt: Date.now(),
        });
        return;
      }
    }

    await ctx.db.patch(existing._id, {
      status: args.success ? "minted" : "failed",
      inscriptionId: args.inscriptionId,
      txid: args.txid,
      batchId: args.batchId ?? existing.batchId,
      attempts: (existing.attempts ?? 0) + 1,
      lastError: args.error,
      updatedAt: Date.now(),
    });

    await ctx.db.insert("collectionClaimEvents", {
      collectionSlug: slug,
      tokenId: args.tokenId,
      address,
      batchId: args.batchId ?? existing.batchId,
      status: args.success ? "minted" : "failed",
      message: args.error,
      txid: args.txid,
      inscriptionId: args.inscriptionId,
      createdAt: Date.now(),
    });
  },
});

export const getByInscriptionId = query({
  args: {
    inscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("collectionClaims")
      .withIndex("by_inscription", (q) => q.eq("inscriptionId", args.inscriptionId))
      .first();
  },
});
