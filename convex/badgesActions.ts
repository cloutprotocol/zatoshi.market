"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

const MAX_BATCH = 1000;

export const grantBadgesFromList = action({
  args: {
    badgeSlug: v.string(),
    addresses: v.array(v.string()),
    source: v.optional(v.string()),
    reason: v.optional(v.string()),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.addresses.length > MAX_BATCH) {
      throw new Error(`Too many addresses; send at most ${MAX_BATCH} per call`);
    }
    const unique = [...new Set(args.addresses.map((a) => a.trim()).filter(Boolean))];

    const results = [];
    for (const address of unique) {
      const res = await ctx.runMutation(api.badges.grantBadge, {
        address,
        badgeSlug: args.badgeSlug,
        source: args.source,
        reason: args.reason,
        label: args.label,
      });
      results.push(res);
    }
    return { granted: results.length };
  },
});
