import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Sales Queries and Mutations
 * Track marketplace sales of inscriptions
 */

// Create a new sale record
export const createSale = mutation({
  args: {
    inscriptionId: v.string(),
    sellerAddress: v.string(),
    buyerAddress: v.string(),
    priceZec: v.number(),
    txid: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("sales", {
      inscriptionId: args.inscriptionId,
      sellerAddress: args.sellerAddress,
      buyerAddress: args.buyerAddress,
      priceZec: args.priceZec,
      txid: args.txid,
      timestamp: Date.now(),
      status: "pending",
    });

    // Add to activity feed
    await ctx.db.insert("activityFeed", {
      type: "transfer",
      address: args.buyerAddress,
      txid: args.txid,
      amount: args.priceZec,
      timestamp: Date.now(),
      message: `Purchased inscription for ${args.priceZec} ZEC`,
    });

    return id;
  },
});

// Update sale status
export const updateSaleStatus = mutation({
  args: {
    txid: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const sale = await ctx.db
      .query("sales")
      .withIndex("by_timestamp")
      .filter((q) => q.eq(q.field("txid"), args.txid))
      .first();

    if (!sale) {
      throw new Error("Sale not found");
    }

    await ctx.db.patch(sale._id, {
      status: args.status,
    });

    return sale._id;
  },
});

// Get sales for an inscription
export const getSalesByInscription = query({
  args: { inscriptionId: v.string() },
  handler: async (ctx, args) => {
    const sales = await ctx.db
      .query("sales")
      .withIndex("by_inscription_id", (q) =>
        q.eq("inscriptionId", args.inscriptionId)
      )
      .order("desc")
      .collect();

    return sales;
  },
});

// Get sales by seller
export const getSalesBySeller = query({
  args: {
    sellerAddress: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const sales = await ctx.db
      .query("sales")
      .withIndex("by_seller", (q) => q.eq("sellerAddress", args.sellerAddress))
      .order("desc")
      .take(limit);

    return sales;
  },
});

// Get sales by buyer
export const getSalesByBuyer = query({
  args: {
    buyerAddress: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const sales = await ctx.db
      .query("sales")
      .withIndex("by_buyer", (q) => q.eq("buyerAddress", args.buyerAddress))
      .order("desc")
      .take(limit);

    return sales;
  },
});

// Get recent sales
export const getRecentSales = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    const sales = await ctx.db
      .query("sales")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);

    return sales;
  },
});

// Get sales statistics
export const getSalesStats = query({
  handler: async (ctx) => {
    const all = await ctx.db.query("sales").collect();

    const total = all.length;
    const completed = all.filter((s) => s.status === "completed").length;
    const pending = all.filter((s) => s.status === "pending").length;
    const totalVolume = all
      .filter((s) => s.status === "completed")
      .reduce((sum, s) => sum + s.priceZec, 0);

    return {
      total,
      completed,
      pending,
      totalVolume,
      averagePrice: completed > 0 ? totalVolume / completed : 0,
    };
  },
});
