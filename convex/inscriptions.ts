import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Inscription Queries and Mutations
 * Track inscriptions created through the platform
 */

// Create a new inscription record (called when user submits)
export const createInscription = mutation(async (ctx, args) => {
    const inscriptionId = `${args.txid}i0`; // Assume offset 0

    const id = await ctx.db.insert("inscriptions", {
      inscriptionId,
      txid: args.txid,
      address: args.address,
      contentType: args.contentType,
      contentPreview: args.contentPreview.substring(0, 200), // Limit preview
      contentSize: args.contentSize,
      type: args.type,
      status: "pending",
      createdAt: Date.now(),
      zrc20Tick: args.zrc20Tick,
      zrc20Op: args.zrc20Op,
      zrc20Amount: args.zrc20Amount,
      platformFeeZat: args.platformFeeZat,
      treasuryAddress: args.treasuryAddress,
    });

    // Also add to activity feed
    await ctx.db.insert("activityFeed", {
      type: args.type === "zrc20" ? "mint" : "inscription",
      address: args.address,
      txid: args.txid,
      timestamp: Date.now(),
      message:
        args.type === "zrc20"
          ? `Minted ${args.zrc20Amount} ${args.zrc20Tick}`
          : `Created ${args.contentType} inscription`,
    });

    return id;
});

// Update inscription status (called by indexer or manual verification)
export const updateInscriptionStatus = mutation({
  args: {
    txid: v.string(),
    status: v.string(),
    blockHeight: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const inscription = await ctx.db
      .query("inscriptions")
      .withIndex("by_txid", (q) => q.eq("txid", args.txid))
      .first();

    if (!inscription) {
      throw new Error("Inscription not found");
    }

    await ctx.db.patch(inscription._id, {
      status: args.status,
      confirmedAt: args.status === "confirmed" ? Date.now() : undefined,
      blockHeight: args.blockHeight,
    });

    return inscription._id;
  },
});

// Get inscription by ID
export const getInscriptionById = query({
  args: { inscriptionId: v.string() },
  handler: async (ctx, args) => {
    const inscription = await ctx.db
      .query("inscriptions")
      .withIndex("by_inscription_id", (q) =>
        q.eq("inscriptionId", args.inscriptionId)
      )
      .first();

    return inscription;
  },
});

// Get inscriptions by address
export const getInscriptionsByAddress = query({
  args: {
    address: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const inscriptions = await ctx.db
      .query("inscriptions")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .order("desc")
      .take(limit);

    return inscriptions;
  },
});

// Get recent inscriptions (for homepage/activity feed)
export const getRecentInscriptions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    const inscriptions = await ctx.db
      .query("inscriptions")
      .withIndex("by_created_at")
      .order("desc")
      .take(limit);

    return inscriptions;
  },
});

// Get inscriptions by type
export const getInscriptionsByType = query({
  args: {
    type: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const inscriptions = await ctx.db
      .query("inscriptions")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .order("desc")
      .take(limit);

    return inscriptions;
  },
});

// Get ZRC-20 mints by ticker
export const getZRC20MintsByTicker = query({
  args: {
    tick: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const inscriptions = await ctx.db
      .query("inscriptions")
      .filter((q) =>
        q.and(
          q.eq(q.field("type"), "zrc20"),
          q.eq(q.field("zrc20Tick"), args.tick.toUpperCase())
        )
      )
      .order("desc")
      .take(limit);

    return inscriptions;
  },
});

// Get inscription statistics
export const getInscriptionStats = query({
  handler: async (ctx) => {
    const all = await ctx.db.query("inscriptions").collect();

    const total = all.length;
    const pending = all.filter((i) => i.status === "pending").length;
    const confirmed = all.filter((i) => i.status === "confirmed").length;
    const failed = all.filter((i) => i.status === "failed").length;

    const byType = {
      text: all.filter((i) => i.type === "text").length,
      zrc20: all.filter((i) => i.type === "zrc20").length,
      image: all.filter((i) => i.type === "image").length,
      other: all.filter((i) => i.type === "other").length,
    };

    return {
      total,
      pending,
      confirmed,
      failed,
      byType,
    };
  },
});

// Real-time status check for specific inscription
export const checkInscriptionStatus = query({
  args: { txid: v.string() },
  handler: async (ctx, args) => {
    const inscription = await ctx.db
      .query("inscriptions")
      .withIndex("by_txid", (q) => q.eq("txid", args.txid))
      .first();

    if (!inscription) {
      return null;
    }

    return {
      status: inscription.status,
      inscriptionId: inscription.inscriptionId,
      createdAt: inscription.createdAt,
      confirmedAt: inscription.confirmedAt,
      blockHeight: inscription.blockHeight,
    };
  },
});
