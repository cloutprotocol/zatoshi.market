import { action, mutation, query } from "./_generated/server";
import { v } from "convex/values";

const normalizeTick = (tick: string) => (tick || "").toLowerCase();

export const getLatestHolderCounts = query({
  args: { ticks: v.array(v.string()) },
  handler: async (ctx, args) => {
    const ticks = Array.from(new Set(args.ticks.map(normalizeTick)));
    const entries: { tick: string; holders: number; updatedAt: number }[] = [];

    // Resolve per tick using the index for quick lookup
    await Promise.all(
      ticks.map(async (t) => {
        const row = await ctx.db
          .query("tokenHolderLatest")
          .withIndex("by_tick", (q) => q.eq("tick", t))
          .first();
        if (row) {
          entries.push({ tick: t, holders: row.holders, updatedAt: row.updatedAt });
        }
      })
    );

    return entries;
  },
});

export const recordHolderCounts = mutation({
  args: {
    entries: v.array(
      v.object({
        tick: v.string(),
        holders: v.number(),
        source: v.optional(v.string()),
        capturedAt: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const entry of args.entries) {
      const tick = normalizeTick(entry.tick);
      const holders = entry.holders;
      const source = entry.source;
      const capturedAt = entry.capturedAt ?? now;

      // Upsert latest
      const existing = await ctx.db
        .query("tokenHolderLatest")
        .withIndex("by_tick", (q) => q.eq("tick", tick))
        .first();
      if (existing) {
        if ((existing.updatedAt ?? 0) <= capturedAt) {
          await ctx.db.patch(existing._id, {
            holders,
            source,
            updatedAt: capturedAt,
          });
        }
      } else {
        await ctx.db.insert("tokenHolderLatest", {
          tick,
          holders,
          source,
          updatedAt: capturedAt,
        });
      }

      // Append snapshot for history
      await ctx.db.insert("tokenHolderSnapshots", {
        tick,
        holders,
        capturedAt,
        source,
      });
    }
    return true;
  },
});

type TokenSummary = {
  holders?: number;
  holders_total?: number;
  transfers_completed?: number;
  tick: string;
};

type TokenIntegrity = {
  consistent: boolean;
  total_holders?: number;
  holders_positive?: number;
  supply_base_units?: string;
  sum_overall_base_units?: string;
  sum_available_base_units?: string;
  burned_base_units?: string;
  tick: string;
};

export const refreshHolderCounts = action({
  args: { ticks: v.array(v.string()) },
  handler: async (ctx, args) => {
    const base =
      process.env.ORDINAL_INDEX_API_BASE?.replace(/\/$/, "") ||
      process.env.NEXT_PUBLIC_ORDINAL_INDEX_API?.replace(/\/$/, "") ||
      "http://135.181.6.234:3333";

    const ticks = Array.from(new Set(args.ticks.map(normalizeTick)));
    if (ticks.length === 0) return [] as Array<{
      tick: string;
      holders?: number;
      summary?: TokenSummary;
      integrity?: TokenIntegrity;
      updatedAt: number;
    }>;

    const results: Array<{
      tick: string;
      holders?: number;
      summary?: TokenSummary;
      integrity?: TokenIntegrity;
      updatedAt: number;
    }> = [];

    // Small concurrency limit to avoid hammering the indexer
    const limit = 5;
    let i = 0;
    const now = Date.now();

    async function fetchOne(t: string) {
      const urlSummary = `${base}/api/v1/zrc20/token/${t}/summary`;
      const urlIntegrity = `${base}/api/v1/zrc20/token/${t}/integrity`;

      const [summaryRes, integrityRes] = await Promise.all([
        fetch(urlSummary, { headers: { "Content-Type": "application/json" } }),
        fetch(urlIntegrity, { headers: { "Content-Type": "application/json" } }),
      ]);

      let summary: TokenSummary | undefined;
      let integrity: TokenIntegrity | undefined;

      if (summaryRes.ok) {
        summary = (await summaryRes.json()) as TokenSummary;
      }
      if (integrityRes.ok) {
        integrity = (await integrityRes.json()) as TokenIntegrity;
      }

      const holders = summary?.holders ?? integrity?.total_holders ?? 0;
      const source = summary?.holders !== undefined ? "summary" : "integrity";

      results.push({ tick: t, holders, summary, integrity, updatedAt: now });
      return { tick: t, holders, source, capturedAt: now };
    }

    while (i < ticks.length) {
      const slice = ticks.slice(i, i + limit);
      const entries = await Promise.all(slice.map((t) => fetchOne(t)));
      // Persist in Convex
      await ctx.runMutation("tokenStats:recordHolderCounts", { entries });
      i += limit;
    }

    return results;
  },
});

export const getHolderSnapshots = query({
  args: {
    tick: v.string(),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tick = normalizeTick(args.tick);
    const since = args.since ?? Date.now() - 7 * 24 * 60 * 60 * 1000; // default 7d
    const limit = Math.max(10, Math.min(args.limit ?? 200, 1000));

    const rows = await ctx.db
      .query("tokenHolderSnapshots")
      .withIndex("by_tick_capturedAt", (q) => q.eq("tick", tick))
      .order("desc")
      .take(limit * 4);

    const filtered = rows.filter((r) => (r.capturedAt ?? 0) >= since);
    // Downsample to ~limit points
    if (filtered.length <= limit) return filtered.reverse();
    const step = Math.ceil(filtered.length / limit);
    const sampled: typeof filtered = [] as any;
    for (let i = 0; i < filtered.length; i += step) sampled.push(filtered[i]);
    return sampled.reverse();
  },
});

// Convenience action to refresh many tokens at once from indexer (first N pages)
export const refreshTopTokens = action({
  args: { pages: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const base =
      process.env.ORDINAL_INDEX_API_BASE?.replace(/\/$/, "") ||
      process.env.NEXT_PUBLIC_ORDINAL_INDEX_API?.replace(/\/$/, "") ||
      "http://135.181.6.234:3333";
    const pages = Math.max(1, Math.min(args.pages ?? 5, 50));
    const limit = Math.max(10, Math.min(args.limit ?? 100, 200));

    const ticks: string[] = [];
    for (let p = 0; p < pages; p++) {
      const url = `${base}/api/v1/tokens?page=${p}&limit=${limit}`;
      try {
        const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
        if (!res.ok) break;
        const json = (await res.json()) as { items?: Array<{ ticker: string }> };
        for (const item of json.items ?? []) ticks.push(normalizeTick(item.ticker));
      } catch {
        break;
      }
    }

    // Refresh in batches
    const batchSize = 10;
    for (let i = 0; i < ticks.length; i += batchSize) {
      const slice = ticks.slice(i, i + batchSize);
      await ctx.runAction("tokenStats:refreshHolderCounts", { ticks: slice });
    }
    return { refreshed: ticks.length };
  },
});

export const searchTokens = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const q = normalizeTick(args.query);
    if (!q) return [];

    // Simple prefix search using the index
    // Note: Convex doesn't support direct "startsWith" in filter easily without range queries
    // But we can scan a reasonable amount or use a range if we had a string range index.
    // Since 'by_tick' is an index on 'tick', we can use range queries.

    // Range query for prefix:
    // .withIndex("by_tick", q => q.gte("tick", query).lt("tick", query + "\uffff"))

    const results = await ctx.db
      .query("tokenHolderLatest")
      .withIndex("by_tick", (idx) => idx.gte("tick", q).lt("tick", q + "\uffff"))
      .take(10);

    return results.map((r) => r.tick);
  },
});

export const getTopHolders = query({
  args: { limit: v.optional(v.number()), minHolders: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 100);
    const minHolders = args.minHolders ?? 0;

    let q = ctx.db.query("tokenHolderLatest").withIndex("by_holders").order("desc");

    // If we could filter by minHolders efficiently we would, but for now we'll fetch and filter
    // or just rely on the order. Since we want "top holders", ordering by desc holders is primary.
    // We can filter in memory if needed, but usually top N is what we want.

    const results = await q.take(limit);

    // Filter if minHolders is specified (though usually top N implies high holders)
    return results.filter(r => r.holders >= minHolders).map(r => ({
      tick: r.tick,
      holders: r.holders,
      updatedAt: r.updatedAt
    }));
  },
});
