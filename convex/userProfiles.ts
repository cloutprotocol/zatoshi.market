import { mutation, query } from "./_generated/server";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import { v } from "convex/values";

const USERNAME_REGEX = /^[a-z0-9-]{3,32}$/;
const MAX_DISPLAY_NAME = 80;
const MAX_BIO = 640;

const normalizeAddress = (value: string) => (value || "").toLowerCase();
const normalizeUsername = (value: string) => (value || "").trim().toLowerCase();

type SocialLinksInput = {
  twitter?: string;
  discord?: string;
  website?: string;
};

const sanitizeText = (value: string | undefined | null, maxLen: number) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
};

const sanitizeSocialLinks = (links?: SocialLinksInput | null) => {
  if (!links) return undefined;
  const entries: SocialLinksInput = {};
  if (links.twitter) entries.twitter = links.twitter.trim().replace(/^@/, "").slice(0, 64);
  if (links.discord) entries.discord = links.discord.trim().slice(0, 64);
  if (links.website) entries.website = links.website.trim().slice(0, 256);
  return Object.keys(entries).length ? entries : undefined;
};

async function assertInscriptionOwnership(
  db: DatabaseReader | DatabaseWriter,
  address: string,
  inscriptionId: string
) {
  const normalizedId = inscriptionId.trim();
  if (!normalizedId) {
    throw new Error("Invalid inscription id provided");
  }
  const claim = await db
    .query("collectionClaims")
    .withIndex("by_inscription", (q) => q.eq("inscriptionId", normalizedId))
    .first();
  if (!claim) {
    throw new Error(`Inscription ${normalizedId} is not indexed`);
  }
  if (claim.status !== "minted" || normalizeAddress(claim.address) !== address) {
    throw new Error(`Inscription ${normalizedId} is not owned by this wallet`);
  }
  return claim;
}

async function getProfileByAddress(db: DatabaseReader | DatabaseWriter, address: string) {
  return await db
    .query("userProfiles")
    .withIndex("by_address", (q) => q.eq("address", address))
    .first();
}

export const getProfileByHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const handle = args.handle.trim().toLowerCase();
    let profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_username", (q) => q.eq("username", handle))
      .first();

    if (!profile) {
      const address = normalizeAddress(handle);
      profile = await getProfileByAddress(ctx.db, address);
    }

    return profile ?? null;
  },
});

export const saveProfile = mutation({
  args: {
    address: v.string(),
    username: v.optional(v.string()),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    socialLinks: v.optional(
      v.object({
        twitter: v.optional(v.string()),
        discord: v.optional(v.string()),
        website: v.optional(v.string()),
      })
    ),
    pfpInscriptionId: v.optional(v.string()),
    pinnedTokenIds: v.optional(v.array(v.string())),
    isPrivate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const address = normalizeAddress(args.address);
    const now = Date.now();
    const username = args.username ? normalizeUsername(args.username) : undefined;

    if (username) {
      if (!USERNAME_REGEX.test(username)) {
        throw new Error("Username must be 3-32 characters (lowercase letters, numbers, hyphen)");
      }
      const existing = await ctx.db
        .query("userProfiles")
        .withIndex("by_username", (q) => q.eq("username", username))
        .first();
      if (existing && existing.address !== address) {
        throw new Error("Username already taken");
      }
    }

    const profile = await getProfileByAddress(ctx.db, address);
    const update: any = { updatedAt: now };

    if (args.username !== undefined) {
      update.username = username;
    }

    if (args.displayName !== undefined) {
      update.displayName = sanitizeText(args.displayName, MAX_DISPLAY_NAME);
    }

    if (args.bio !== undefined) {
      update.bio = sanitizeText(args.bio, MAX_BIO);
    }

    if (args.socialLinks !== undefined) {
      update.socialLinks = sanitizeSocialLinks(args.socialLinks);
    }

    if (args.pfpInscriptionId !== undefined) {
      if (args.pfpInscriptionId) {
        await assertInscriptionOwnership(ctx.db, address, args.pfpInscriptionId);
        update.pfpInscriptionId = args.pfpInscriptionId.trim();
      } else {
        update.pfpInscriptionId = undefined;
      }
    }

    if (args.pinnedTokenIds !== undefined) {
      const pinned = Array.from(new Set(args.pinnedTokenIds ?? [])).filter(Boolean);
      for (const inscriptionId of pinned) {
        await assertInscriptionOwnership(ctx.db, address, inscriptionId);
      }
      update.pinnedTokenIds = pinned;
    }

    if (args.isPrivate !== undefined) {
      update.isPrivate = args.isPrivate;
    }

    if (!profile) {
      const doc = {
        address,
        username: update.username,
        displayName: update.displayName,
        bio: update.bio,
        socialLinks: update.socialLinks,
        pfpInscriptionId: update.pfpInscriptionId,
        pinnedTokenIds: update.pinnedTokenIds ?? [],
        isPrivate: update.isPrivate ?? true,
        createdAt: now,
        updatedAt: now,
      };
      const _id = await ctx.db.insert("userProfiles", doc);
      return { _id, ...doc };
    }

    await ctx.db.patch(profile._id, update);
    return { ...profile, ...update };
  },
});

export const listPinnedTokens = query({
  args: { address: v.string() },
  handler: async (ctx, args) => {
    const address = normalizeAddress(args.address);
    const profile = await getProfileByAddress(ctx.db, address);
    if (!profile || !profile.pinnedTokenIds?.length) return [];

    const records = [] as Array<{ inscriptionId?: string; tokenId: number; collectionSlug: string }>;
    for (const inscriptionId of profile.pinnedTokenIds) {
      const claim = await ctx.db
        .query("collectionClaims")
        .withIndex("by_inscription", (q) => q.eq("inscriptionId", inscriptionId))
        .first();
      if (!claim) continue;
      if (claim.status !== "minted") continue;
      if (normalizeAddress(claim.address) !== address) continue;
      records.push({ inscriptionId: claim.inscriptionId, tokenId: claim.tokenId, collectionSlug: claim.collectionSlug });
    }
    return records;
  },
});
