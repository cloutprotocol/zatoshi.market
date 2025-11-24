import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const normalizeSlug = (slug: string) => slug.trim().toLowerCase();
const normalizeAddress = (address: string) => (address || "").toLowerCase();

async function loadUserBadges(ctx: any, address: string) {
  const badges = await ctx.db
    .query("userBadges")
    .withIndex("by_address", (q: any) => q.eq("address", address))
    .collect();

  if (!badges.length) return [];

  const uniqueSlugs = [...new Set(badges.map((b: any) => normalizeSlug(b.badgeSlug)))];
  const defs = await Promise.all(
    uniqueSlugs.map((slug) =>
      ctx.db
        .query("badgeDefinitions")
        .withIndex("by_slug", (q: any) => q.eq("slug", slug))
        .first()
    )
  );
  const defMap = new Map(defs.filter(Boolean).map((d) => [d!.slug, d!]));

  return badges.map((b: any) => {
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
}

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
    const address = normalizeAddress(args.address);
    return loadUserBadges(ctx, address);
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
    const address = normalizeAddress(args.address);

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
      .withIndex("by_address_badge", (q) => q.eq("address", address).eq("badgeSlug", slug))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("userBadges", {
      address,
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
    const address = normalizeAddress(args.address);
    const existing = await ctx.db
      .query("userBadges")
      .withIndex("by_address_badge", (q) => q.eq("address", address).eq("badgeSlug", slug))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
      return true;
    }
    return false;
  },
});

export const getUserStatus = query({
  args: { address: v.string() },
  handler: async (ctx, args) => {
    const address = normalizeAddress(args.address);
    const [badges, points] = await Promise.all([
      loadUserBadges(ctx, address),
      ctx.db
        .query("userPoints")
        .withIndex("by_address", (q) => q.eq("address", address))
        .first(),
    ]);

    return {
      address,
      badges,
      points: {
        total: points?.totalPoints ?? 0,
        minted: points?.mintedPoints ?? 0,
        updatedAt: points?.updatedAt ?? 0,
      },
    };
  },
});
