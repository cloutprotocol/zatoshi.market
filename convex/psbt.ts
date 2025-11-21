import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Create a new PSBT listing
export const createListing = mutation({
    args: {
        psbtBase64: v.string(),
        sellerAddress: v.string(),
        price: v.number(),
        tokenTicker: v.string(),
        tokenAmount: v.number(),
    },
    handler: async (ctx, args) => {
        const listingId = await ctx.db.insert("psbtListings", {
            psbtBase64: args.psbtBase64,
            sellerAddress: args.sellerAddress,
            price: args.price,
            tokenTicker: args.tokenTicker,
            tokenAmount: args.tokenAmount,
            status: "active",
            createdAt: Date.now(),
        });
        return listingId;
    },
});

// List all active listings
export const listListings = query({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit || 20;
        const listings = await ctx.db
            .query("psbtListings")
            .withIndex("by_status", (q) => q.eq("status", "active"))
            .order("desc")
            .take(limit);
        return listings;
    },
});

// List active listings by ticker
export const listListingsByTicker = query({
    args: {
        ticker: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit || 50;
        // Note: We need a compound index for status + ticker to be efficient, 
        // or we filter in memory if volume is low. 
        // Schema has .index("by_ticker", ["tokenTicker"]) and .index("by_status", ["status"]).
        // A compound index ["tokenTicker", "status"] would be better.
        // For now, let's use by_ticker and filter by status.

        const listings = await ctx.db
            .query("psbtListings")
            .withIndex("by_ticker", (q) => q.eq("tokenTicker", args.ticker))
            .filter((q) => q.eq(q.field("status"), "active"))
            .order("desc")
            .take(limit);

        return listings;
    },
});

// Get a specific listing by ID
export const getListing = query({
    args: { listingId: v.id("psbtListings") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.listingId);
    },
});

// Update listing status (e.g., after purchase or cancellation)
export const updateStatus = mutation({
    args: {
        listingId: v.id("psbtListings"),
        status: v.string(), // "completed" | "cancelled"
        txid: v.optional(v.string()),
        buyerAddress: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { listingId, status, txid, buyerAddress } = args;

        // Validate status transition
        const listing = await ctx.db.get(listingId);
        if (!listing) throw new Error("Listing not found");
        if (listing.status !== "active") throw new Error("Listing is not active");

        await ctx.db.patch(listingId, {
            status,
            txid,
            buyerAddress,
        });
    },
});
