import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const normalizeSlug = (slug: string) => slug.trim().toLowerCase();

export const upsertBadgeDefinition = mutation({
  args: {
    slug: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    level: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const slug = normalizeSlug(args.slug);
    const existing = await ctx.db
      .query("badgeDefinitions")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        label: args.label,
        description: args.description,
        icon: args.icon,
        level: args.level,
      });
      return existing._id;
    }

    return await ctx.db.insert("badgeDefinitions", {
      slug,
      label: args.label,
      description: args.description,
      icon: args.icon,
      level: args.level,
      createdAt: Date.now(),
    });
  },
});

export const listBadgeDefinitions = query({
  args: {},
  handler: async (ctx) => {
    const defs = await ctx.db.query("badgeDefinitions").collect();
    return defs.sort((a, b) => {
      const aLevel = a.level ?? 0;
      const bLevel = b.level ?? 0;
      if (aLevel !== bLevel) return bLevel - aLevel;
      return a.slug.localeCompare(b.slug);
    });
  },
});

export const getUserBadges = query({
  args: { address: v.string() },
  handler: async (ctx, args) => {
    const badges = await ctx.db
      .query("userBadges")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .collect();

    if (!badges.length) return [];

    const uniqueSlugs = [...new Set(badges.map((b) => normalizeSlug(b.badgeSlug)))];
    const defs = await Promise.all(
      uniqueSlugs.map((slug) =>
        ctx.db
          .query("badgeDefinitions")
          .withIndex("by_slug", (q) => q.eq("slug", slug))
          .first()
      )
    );
    const defMap = new Map(defs.filter(Boolean).map((d) => [d!.slug, d!]));

    return badges.map((b) => {
      const def = defMap.get(normalizeSlug(b.badgeSlug));
      return {
        address: b.address,
        badgeSlug: normalizeSlug(b.badgeSlug),
        source: b.source,
        reason: b.reason,
        createdAt: b.createdAt,
        label: def?.label ?? b.badgeSlug,
        description: def?.description,
        icon: def?.icon,
        level: def?.level,
      };
    });
  },
});

export const grantBadge = mutation({
  args: {
    address: v.string(),
    badgeSlug: v.string(),
    source: v.optional(v.string()),
    reason: v.optional(v.string()),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = normalizeSlug(args.badgeSlug);

    // Ensure definition exists (best-effort)
    const def = await ctx.db
      .query("badgeDefinitions")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!def) {
      await ctx.db.insert("badgeDefinitions", {
        slug,
        label: args.label || slug.toUpperCase(),
        createdAt: Date.now(),
      });
    }

    const existing = await ctx.db
      .query("userBadges")
      .withIndex("by_address_badge", (q) => q.eq("address", args.address).eq("badgeSlug", slug))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("userBadges", {
      address: args.address,
      badgeSlug: slug,
      source: args.source,
      reason: args.reason,
      createdAt: Date.now(),
    });
  },
});

export const revokeBadge = mutation({
  args: { address: v.string(), badgeSlug: v.string() },
  handler: async (ctx, args) => {
    const slug = normalizeSlug(args.badgeSlug);
    const existing = await ctx.db
      .query("userBadges")
      .withIndex("by_address_badge", (q) => q.eq("address", args.address).eq("badgeSlug", slug))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
      return true;
    }
    return false;
  },
});
