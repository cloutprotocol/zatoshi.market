import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAllowlistEntry } from "./claimAllowlists";

const MAX_RESERVE_ATTEMPTS = 200;

function normalizeAddress(address: string) {
  return (address || "").toLowerCase();
}

async function getClaimCountsForAddress(
  ctx: any,
  slug: string,
  address: string
): Promise<{ minted: number; reserved: number }> {
  const allClaims = await ctx.db
    .query("collectionClaims")
    .withIndex("by_collection_status", (q: any) => q.eq("collectionSlug", slug))
    .collect();
  const byAddress = allClaims.filter(
    (c: any) => (c.address || "").toLowerCase() === address
  );

  return {
    minted: byAddress.filter((c: any) => c.status === "minted").length,
    reserved: 0, // Reserved tokens don't block allocation - enforcement happens in finalizeToken
  };
}

export const getClaimStats = query({
  args: {
    collectionSlug: v.string(),
    address: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();
    const minted = await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) => q.eq("collectionSlug", slug).eq("status", "minted"))
      .collect();

    const byAddress = args.address
      ? minted.filter((m) => m.address.toLowerCase() === args.address!.toLowerCase())
      : [];

    return {
      mintedCount: minted.length,
      mintedIds: minted.map((m) => m.tokenId),
      mintedForAddress: {
        count: byAddress.length,
        ids: byAddress.map((m) => m.tokenId),
      },
      reservedCount: 0,
      reservedForAddress: {
        count: 0,
        ids: [],
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
    const allowlist = getAllowlistEntry(slug, address);
    if (!allowlist || allowlist.max <= 0) {
      throw new Error("Wallet is not whitelisted for this collection");
    }

    const { minted } = await getClaimCountsForAddress(ctx, slug, address);
    const remaining = allowlist.max - minted;
    if (remaining <= 0) {
      throw new Error("Allocation exhausted for this wallet");
    }

    const maxCount = Math.min(5, Math.max(1, args.count));
    if (maxCount > remaining) {
      throw new Error(`Allocation exceeded. You can claim ${remaining} more.`);
    }

    const reserved: number[] = [];
    const now = Date.now();

    // Fetch existing tokenIds to avoid duplicates
    const existingDocs = await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) => q.eq("collectionSlug", slug).eq("status", "minted"))
      .collect();
    const reservedDocs = await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) => q.eq("collectionSlug", slug).eq("status", "reserved"))
      .collect();
    const taken = new Set<number>([...existingDocs, ...reservedDocs].map((d) => d.tokenId));

    let attempts = 0;
    while (reserved.length < maxCount && attempts < MAX_RESERVE_ATTEMPTS) {
      attempts += 1;
      const candidate = Math.floor(Math.random() * args.supply);
      if (taken.has(candidate) || reserved.includes(candidate)) continue;
      taken.add(candidate);
      reserved.push(candidate);
    }

    if (!reserved.length) {
      throw new Error("No tokens available to reserve. Supply may be exhausted.");
    }

    for (const id of reserved) {
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
