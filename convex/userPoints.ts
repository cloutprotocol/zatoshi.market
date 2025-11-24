import { mutation, query } from "./_generated/server";
import type { DatabaseWriter } from "./_generated/server";
import { v } from "convex/values";

const POINTS_PER_MINT = 10;

const normalizeAddress = (address: string) => (address || "").toLowerCase();

const clampNonNegative = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);

async function getPointsDoc(db: DatabaseWriter, address: string) {
  return await db
    .query("userPoints")
    .withIndex("by_address", (q) => q.eq("address", address))
    .first();
}

export async function applyPointsDelta(
  db: DatabaseWriter,
  rawAddress: string,
  totalDelta: number,
  mintedDelta = 0
) {
  const address = normalizeAddress(rawAddress);
  const now = Date.now();
  const doc = await getPointsDoc(db, address);
  const safeTotalDelta = Number.isFinite(totalDelta) ? totalDelta : 0;
  const safeMintedDelta = Number.isFinite(mintedDelta) ? mintedDelta : 0;

  if (!doc) {
    const totalPoints = clampNonNegative(safeTotalDelta);
    const mintedPoints = clampNonNegative(safeMintedDelta);
    const _id = await db.insert("userPoints", {
      address,
      totalPoints,
      mintedPoints,
      createdAt: now,
      updatedAt: now,
    });
    return { _id, address, totalPoints, mintedPoints, createdAt: now, updatedAt: now };
  }

  const totalPoints = Math.max(0, doc.totalPoints + safeTotalDelta);
  const mintedPoints = Math.max(0, doc.mintedPoints + safeMintedDelta);
  await db.patch(doc._id, {
    totalPoints,
    mintedPoints,
    updatedAt: now,
  });
  return { ...doc, totalPoints, mintedPoints, updatedAt: now };
}

export async function awardMintPoints(db: DatabaseWriter, rawAddress: string, amount = POINTS_PER_MINT) {
  const delta = Number.isFinite(amount) ? amount : POINTS_PER_MINT;
  if (delta === 0) return null;
  return applyPointsDelta(db, rawAddress, delta, delta);
}

export const getPoints = query({
  args: { address: v.string() },
  handler: async (ctx, args) => {
    const address = normalizeAddress(args.address);
    const doc = await ctx.db
      .query("userPoints")
      .withIndex("by_address", (q) => q.eq("address", address))
      .first();

    return {
      address,
      totalPoints: doc?.totalPoints ?? 0,
      mintedPoints: doc?.mintedPoints ?? 0,
      updatedAt: doc?.updatedAt ?? 0,
    };
  },
});

export const awardPoints = mutation({
  args: {
    address: v.string(),
    delta: v.number(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const mintedDelta = args.category === "minted" ? args.delta : 0;
    return await applyPointsDelta(ctx.db, args.address, args.delta, mintedDelta);
  },
});

export const listTop = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 25, 100));
    const docs = await ctx.db
      .query("userPoints")
      .withIndex("by_total_points", (q) => q.gte("totalPoints", 0))
      .order("desc")
      .take(limit);
    return docs;
  },
});

export { POINTS_PER_MINT };
