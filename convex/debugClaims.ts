import { query } from "./_generated/server";
import { v } from "convex/values";

export const getAllClaims = query({
  args: {
    collectionSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();

    // Limit to recent 500 claims to avoid hitting 32k document read limit
    const recentClaims = await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) => q.eq("collectionSlug", slug))
      .order("desc")
      .take(500);

    const recentEvents = await ctx.db
      .query("collectionClaimEvents")
      .withIndex("by_collection", (q) => q.eq("collectionSlug", slug))
      .order("desc")
      .take(100);

    const failedWithErrors = recentClaims
      .filter(c => c.status === "failed" && c.lastError)
      .map(c => ({
        tokenId: c.tokenId,
        error: c.lastError,
      }));

    return {
      totalClaims: recentClaims.length,
      byStatus: {
        reserved: recentClaims.filter(c => c.status === "reserved").length,
        minted: recentClaims.filter(c => c.status === "minted").length,
        failed: recentClaims.filter(c => c.status === "failed").length,
      },
      failedWithErrors: failedWithErrors.slice(0, 10),
      allClaims: recentClaims.map(c => ({
        tokenId: c.tokenId,
        status: c.status,
        address: c.address,
        inscriptionId: c.inscriptionId,
        lastError: c.lastError,
        createdAt: c.createdAt,
      })),
      totalEvents: recentEvents.length,
      recentEvents: recentEvents.slice(0, 10).map(e => ({
        tokenId: e.tokenId,
        status: e.status,
        address: e.address,
        message: e.message,
        inscriptionId: e.inscriptionId,
        createdAt: e.createdAt,
      })),
    };
  },
});
