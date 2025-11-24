import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const normalize = (address: string) => (address || "").toLowerCase();

export const getSummary = query({
  args: {
    address: v.string(),
    follower: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const address = normalize(args.address);
    const follower = args.follower ? normalize(args.follower) : undefined;

    const countPromise = ctx.db
      .query("userFollowers")
      .withIndex("by_address", (q) => q.eq("address", address))
      .collect();

    const [allFollowers, existing] = await Promise.all([
      countPromise,
      follower
        ? ctx.db
            .query("userFollowers")
            .withIndex("by_address_follower", (q) => q.eq("address", address).eq("follower", follower))
            .first()
        : Promise.resolve(null),
    ]);

    return {
      followers: allFollowers.length,
      isFollowing: Boolean(existing),
    };
  },
});

export const follow = mutation({
  args: {
    address: v.string(),
    follower: v.string(),
  },
  handler: async (ctx, args) => {
    const address = normalize(args.address);
    const follower = normalize(args.follower);
    if (!address || !follower) throw new Error("Address and follower required");
    if (address === follower) throw new Error("Cannot follow yourself");

    const existing = await ctx.db
      .query("userFollowers")
      .withIndex("by_address_follower", (q) => q.eq("address", address).eq("follower", follower))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("userFollowers", {
      address,
      follower,
      createdAt: Date.now(),
    });
  },
});

export const unfollow = mutation({
  args: {
    address: v.string(),
    follower: v.string(),
  },
  handler: async (ctx, args) => {
    const address = normalize(args.address);
    const follower = normalize(args.follower);
    const existing = await ctx.db
      .query("userFollowers")
      .withIndex("by_address_follower", (q) => q.eq("address", address).eq("follower", follower))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
      return true;
    }
    return false;
  },
});

export const listFollowers = query({
  args: { address: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const address = normalize(args.address);
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
    return await ctx.db
      .query("userFollowers")
      .withIndex("by_address", (q) => q.eq("address", address))
      .order("desc")
      .take(limit);
  },
});
