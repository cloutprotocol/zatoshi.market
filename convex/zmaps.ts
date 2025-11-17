import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * ZMAP Queries and Mutations
 */

// Get all ZMAPs with their status
export const getAllZmaps = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const offset = args.offset ?? 0;

    const zmaps = await ctx.db
      .query("zmapParcels")
      .order("asc")
      .collect();

    return zmaps.slice(offset, offset + limit);
  },
});

// Get ZMAP by map number
export const getZmapByNumber = query({
  args: { mapNumber: v.number() },
  handler: async (ctx, args) => {
    const zmap = await ctx.db
      .query("zmapParcels")
      .withIndex("by_map_number", (q) => q.eq("mapNumber", args.mapNumber))
      .first();

    return zmap;
  },
});

// Get ZMAPs by status
export const getZmapsByStatus = query({
  args: { status: v.string() },
  handler: async (ctx, args) => {
    const zmaps = await ctx.db
      .query("zmapParcels")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();

    return zmaps;
  },
});

// Get ZMAPs owned by address
export const getZmapsByAddress = query({
  args: { address: v.string() },
  handler: async (ctx, args) => {
    const zmaps = await ctx.db
      .query("zmapParcels")
      .withIndex("by_reserved_by", (q) => q.eq("reservedBy", args.address))
      .collect();

    return zmaps;
  },
});

// Reserve a ZMAP
export const reserveZmap = mutation({
  args: {
    mapNumber: v.number(),
    address: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if ZMAP exists
    const existing = await ctx.db
      .query("zmapParcels")
      .withIndex("by_map_number", (q) => q.eq("mapNumber", args.mapNumber))
      .first();

    if (existing) {
      // Check if already reserved or minted
      if (existing.status !== "available") {
        throw new Error("ZMAP is not available");
      }

      // Update existing
      await ctx.db.patch(existing._id, {
        status: "reserved",
        reservedBy: args.address,
        reservedAt: Date.now(),
        reservationExpiry: Date.now() + 15 * 60 * 1000, // 15 minutes
      });

      return existing._id;
    } else {
      // Create new ZMAP parcel
      const blockStart = args.mapNumber * 100 + 1;
      const blockEnd = (args.mapNumber + 1) * 100;

      const id = await ctx.db.insert("zmapParcels", {
        mapNumber: args.mapNumber,
        blockStart,
        blockEnd,
        status: "reserved",
        reservedBy: args.address,
        reservedAt: Date.now(),
        reservationExpiry: Date.now() + 15 * 60 * 1000, // 15 minutes
      });

      return id;
    }
  },
});

// Mark ZMAP as minted
export const mintZmap = mutation({
  args: {
    mapNumber: v.number(),
    txid: v.string(),
    address: v.string(),
    inscriptionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const zmap = await ctx.db
      .query("zmapParcels")
      .withIndex("by_map_number", (q) => q.eq("mapNumber", args.mapNumber))
      .first();

    if (!zmap) {
      throw new Error("ZMAP not found");
    }

    await ctx.db.patch(zmap._id, {
      status: "minted",
      reservedBy: args.address,
      txid: args.txid,
      mintedAt: Date.now(),
      inscriptionId: args.inscriptionId,
    });

    return zmap._id;
  },
});

// Cancel reservation (if expired or user cancels)
export const cancelReservation = mutation({
  args: {
    mapNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const zmap = await ctx.db
      .query("zmapParcels")
      .withIndex("by_map_number", (q) => q.eq("mapNumber", args.mapNumber))
      .first();

    if (!zmap) {
      throw new Error("ZMAP not found");
    }

    if (zmap.status !== "reserved") {
      throw new Error("ZMAP is not reserved");
    }

    await ctx.db.patch(zmap._id, {
      status: "available",
      reservedBy: undefined,
      reservedAt: undefined,
      reservationExpiry: undefined,
    });

    return zmap._id;
  },
});

// Get ZMAP statistics
export const getZmapStats = query({
  handler: async (ctx) => {
    const allZmaps = await ctx.db.query("zmapParcels").collect();

    const available = allZmaps.filter((z) => z.status === "available").length;
    const reserved = allZmaps.filter((z) => z.status === "reserved").length;
    const minted = allZmaps.filter((z) => z.status === "minted").length;

    return {
      total: allZmaps.length,
      available,
      reserved,
      minted,
    };
  },
});
