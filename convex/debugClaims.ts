import { query } from "./_generated/server";
import { v } from "convex/values";

export const getAllClaims = query({
  args: {
    collectionSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();

    const allClaims = await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) => q.eq("collectionSlug", slug))
      .collect();

    const allEvents = await ctx.db
      .query("collectionClaimEvents")
      .withIndex("by_collection", (q) => q.eq("collectionSlug", slug))
      .collect();

    const failedWithErrors = allClaims
      .filter(c => c.status === "failed" && c.lastError)
      .map(c => ({
        tokenId: c.tokenId,
        error: c.lastError,
      }));

    return {
      totalClaims: allClaims.length,
      byStatus: {
        reserved: allClaims.filter(c => c.status === "reserved").length,
        minted: allClaims.filter(c => c.status === "minted").length,
        failed: allClaims.filter(c => c.status === "failed").length,
      },
      failedWithErrors: failedWithErrors.slice(0, 10),
      allClaims: allClaims.map(c => ({
        tokenId: c.tokenId,
        status: c.status,
        address: c.address,
        inscriptionId: c.inscriptionId,
        lastError: c.lastError,
        createdAt: c.createdAt,
      })),
      totalEvents: allEvents.length,
      recentEvents: allEvents.slice(-10).map(e => ({
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
