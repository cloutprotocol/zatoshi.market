import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * User Queries and Mutations
 */

// Get user by address
export const getUserByAddress = query({
  args: { address: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .first();

    return user;
  },
});

// Create or update user
export const upsertUser = mutation({
  args: {
    address: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .first();

    if (existing) {
      // Update last seen
      await ctx.db.patch(existing._id, {
        lastSeen: Date.now(),
      });
      return existing._id;
    } else {
      // Create new user
      const id = await ctx.db.insert("users", {
        address: args.address,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        totalMinted: 0,
        totalZore: 0,
        zmapIds: [],
        reservedZmaps: [],
      });
      return id;
    }
  },
});

// Update user stats after mint
export const updateUserAfterMint = mutation({
  args: {
    address: v.string(),
    mapNumber: v.number(),
    zoreAmount: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(user._id, {
      totalMinted: user.totalMinted + 1,
      totalZore: user.totalZore + args.zoreAmount,
      zmapIds: [...user.zmapIds, args.mapNumber],
      // Remove from reserved if it was there
      reservedZmaps: user.reservedZmaps.filter((id) => id !== args.mapNumber),
    });

    return user._id;
  },
});

// Get top holders (leaderboard)
export const getTopHolders = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;

    const users = await ctx.db
      .query("users")
      .withIndex("by_total_minted")
      .order("desc")
      .take(limit);

    return users;
  },
});
