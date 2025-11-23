import { query } from "./_generated/server";
import { v } from "convex/values";
import { getAllowlistEntries } from "./claimAllowlists";
import { RESERVATION_TTL_MS } from "./collectionClaims";

/**
 * Lean claim stats queries designed to avoid 32K document read limits
 * These queries use iteration, pagination, and targeted indexed queries
 */

// LEAN QUERY 1: Count-only aggregation (no full document collection)
export const getCollectionCounts = query({
  args: { collectionSlug: v.string() },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();

    let mintedCount = 0;
    let reservedCount = 0;
    let failedCount = 0;

    // Iterate without collecting all docs in memory
    const allClaims = ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) => q.eq("collectionSlug", slug));

    for await (const claim of allClaims) {
      if (claim.status === "minted") mintedCount++;
      else if (claim.status === "reserved") reservedCount++;
      else if (claim.status === "failed") failedCount++;
    }

    return {
      mintedCount,
      reservedCount,
      failedCount,
      total: mintedCount + reservedCount + failedCount
    };
  }
});

// LEAN QUERY 2: Address-specific stats (batched, indexed)
export const getAddressStats = query({
  args: {
    collectionSlug: v.string(),
    addresses: v.array(v.string()) // Query specific addresses from whitelist
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();
    const results: Array<{
      address: string;
      minted: number;
      reserved: number;
      failed: number;
      tokenIds: number[];
    }> = [];

    // Limit to 100 addresses per query to avoid timeouts
    const addressBatch = args.addresses.slice(0, 100);

    for (const addr of addressBatch) {
      const normalized = addr.toLowerCase();

      // Use indexed query by address
      const claims = await ctx.db
        .query("collectionClaims")
        .withIndex("by_collection_address", (q) =>
          q.eq("collectionSlug", slug).eq("address", normalized))
        .collect();

      if (claims.length === 0) continue;

      const minted = claims.filter(c => c.status === "minted");
      const reserved = claims.filter(c => c.status === "reserved");
      const failed = claims.filter(c => c.status === "failed");

      results.push({
        address: addr,
        minted: minted.length,
        reserved: reserved.length,
        failed: failed.length,
        tokenIds: minted.map(m => m.tokenId).sort((a, b) => a - b)
      });
    }

    return results;
  }
});

// LEAN QUERY 3: Recent activity (paginated)
export const getRecentMints = query({
  args: {
    collectionSlug: v.string(),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();
    const limit = Math.min(args.limit ?? 20, 100);

    const recent = await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) =>
        q.eq("collectionSlug", slug).eq("status", "minted"))
      .order("desc")
      .take(limit);

    return recent.map(r => ({
      address: r.address,
      tokenId: r.tokenId,
      inscriptionId: r.inscriptionId,
      txid: r.txid,
      createdAt: r.createdAt
    }));
  }
});

// LEAN QUERY 4: Top minters (aggregated)
export const getTopMinters = query({
  args: {
    collectionSlug: v.string(),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();
    const limit = Math.min(args.limit ?? 20, 50);

    const mintCounts = new Map<string, number>();

    // Iterate through minted claims and count by address
    const minted = ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) =>
        q.eq("collectionSlug", slug).eq("status", "minted"));

    for await (const claim of minted) {
      const addr = claim.address.toLowerCase();
      mintCounts.set(addr, (mintCounts.get(addr) || 0) + 1);
    }

    // Convert to array and sort
    return Array.from(mintCounts.entries())
      .map(([address, count]) => ({ address, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
});

// LEAN QUERY 5: Error summary (for debugging)
export const getErrorSummary = query({
  args: {
    collectionSlug: v.string(),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();
    const limit = Math.min(args.limit ?? 10, 20);

    const errorCounts = new Map<string, number>();

    const failed = ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) =>
        q.eq("collectionSlug", slug).eq("status", "failed"));

    for await (const claim of failed) {
      if (!claim.lastError) continue;
      const error = claim.lastError.trim();
      errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
    }

    return Array.from(errorCounts.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
});

export const getAllocationStatus = query({
  args: {
    collectionSlug: v.string(),
    start: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();
    const allowlist = getAllowlistEntries(slug);
    const total = allowlist.length;
    const start = Math.max(args.start ?? 0, 0);
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const slice = allowlist.slice(start, start + limit);
    const cutoff = Date.now() - RESERVATION_TTL_MS;

    const entries = [] as Array<{
      address: string;
      max: number;
      isVip: boolean;
      mintedCount: number;
      reservedCount: number;
      reservedExpiredCount: number;
      failedCount: number;
      remaining: number;
      mintedTokenIds: number[];
      reservedTokenIds: number[];
      duplicateTokenIds: number[];
      issues: string[];
    }>;

    for (const entry of slice) {
      const normalized = entry.address.toLowerCase();
      const claims = await ctx.db
        .query("collectionClaims")
        .withIndex("by_collection_address", (q) =>
          q.eq("collectionSlug", slug).eq("address", normalized)
        )
        .collect();

      const minted = [] as number[];
      const reservedActive = [] as number[];
      const reservedExpired = [] as number[];
      let failedCount = 0;

      for (const claim of claims) {
        const updatedAt = claim.updatedAt ?? claim.createdAt ?? 0;
        if (claim.status === "minted") {
          minted.push(claim.tokenId);
        } else if (claim.status === "reserved") {
          if (updatedAt >= cutoff) reservedActive.push(claim.tokenId);
          else reservedExpired.push(claim.tokenId);
        } else if (claim.status === "failed") {
          failedCount += 1;
        }
      }

      const seen = new Map<number, number>();
      for (const tokenId of [...minted, ...reservedActive]) {
        seen.set(tokenId, (seen.get(tokenId) || 0) + 1);
      }
      const duplicateTokenIds = Array.from(seen.entries())
        .filter(([, count]) => count > 1)
        .map(([tokenId]) => tokenId)
        .sort((a, b) => a - b);

      const mintedCount = minted.length;
      const reservedCount = reservedActive.length;
      const remaining = Math.max(entry.max - mintedCount - reservedCount, 0);
      const issues: string[] = [];
      if (mintedCount > entry.max) issues.push("over_minted");
      if (mintedCount + reservedCount > entry.max) issues.push("over_reserved");
      if (reservedExpired.length) issues.push("expired_reservations");
      if (failedCount > 0) issues.push("failed_claims");
      if (duplicateTokenIds.length) issues.push("duplicate_tokens");

      entries.push({
        address: entry.address,
        max: entry.max,
        isVip: !!entry.isVip,
        mintedCount,
        reservedCount,
        reservedExpiredCount: reservedExpired.length,
        failedCount,
        remaining,
        mintedTokenIds: minted.sort((a, b) => a - b),
        reservedTokenIds: reservedActive.sort((a, b) => a - b),
        duplicateTokenIds,
        issues,
      });
    }

    const allowlistTotal = allowlist.reduce((sum, entry) => sum + entry.max, 0);

    return {
      total,
      start,
      limit,
      pageSize: entries.length,
      nextStart: start + slice.length < total ? start + slice.length : null,
      allowlistTotal,
      entries,
    };
  },
});
