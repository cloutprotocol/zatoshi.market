import { action, mutation, query } from "./_generated/server";
import { v } from "convex/values";

const normalize = (s: string) => (s || "").trim().toLowerCase();
const prefix2 = (s: string) => normalize(s).slice(0, 2) || "";

export const upsertName = mutation({
  args: {
    name: v.string(),
    owner: v.string(),
    inscriptionId: v.string(),
    txid: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const name = normalize(args.name);
    const owner = normalize(args.owner);
    const when = args.createdAt ?? Date.now();

    const existing = await ctx.db
      .query("names")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();

    if (existing) {
      // Only update if newer (or owner changed)
      if ((existing.updatedAt ?? 0) <= when || existing.owner !== owner) {
        await ctx.db.patch(existing._id, {
          owner,
          inscriptionId: args.inscriptionId,
          txid: args.txid,
          updatedAt: when,
          status: "active",
        });
      }
      return existing._id;
    }

    return await ctx.db.insert("names", {
      name,
      owner,
      inscriptionId: args.inscriptionId,
      txid: args.txid,
      createdAt: when,
      updatedAt: when,
      status: "active",
      prefix2: prefix2(name),
    });
  },
});

export const listNames = query({
  args: {
    q: v.optional(v.string()),
    page: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const page = Math.max(0, Math.floor(args.page ?? 0));
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
    const q = normalize(args.q ?? "");

    let base;
    if (q.length >= 2) {
      base = ctx.db
        .query("names")
        .withIndex("by_prefix2", (qq) => qq.eq("prefix2", q.slice(0, 2)));
    } else {
      base = ctx.db.query("names").withIndex("by_createdAt");
    }

    // Collect a bit more and then filter by contains to approximate search
    const rows = await base.order("desc").take(limit * 2);
    const filtered = q
      ? rows.filter((r) => r.name.includes(q))
      : rows;
    const items = filtered.slice(page * limit, page * limit + limit);
    return {
      page,
      limit,
      total: filtered.length,
      items,
      has_more: filtered.length > (page + 1) * limit,
    };
  },
});

export const listNamesRecent = query({
  args: { limit: v.optional(v.number()), before: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
    const before = args.before ?? Number.MAX_SAFE_INTEGER;
    // Keyset pagination by createdAt desc
    const rows = await ctx.db
      .query("names")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", before))
      .order("desc")
      .take(limit);
    const nextBefore = rows.length > 0 ? rows[rows.length - 1].createdAt : null;
    return { items: rows, nextBefore };
  },
});

export const listNamesAlphabetical = query({
  args: { limit: v.optional(v.number()), after: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
    const after = normalize(args.after ?? "");
    const base = after
      ? ctx.db.query("names").withIndex("by_name", (q) => q.gt("name", after))
      : ctx.db.query("names").withIndex("by_name");
    const rows = await base.order("asc").take(limit);
    const nextAfter = rows.length > 0 ? rows[rows.length - 1].name : null;
    return { items: rows, nextAfter };
  },
});

export const listNamesByOwner = query({
  args: { owner: v.string(), limit: v.optional(v.number()), before: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const owner = normalize(args.owner);
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
    const before = args.before ?? Number.MAX_SAFE_INTEGER;
    const rows = await ctx.db
      .query("names")
      .withIndex("by_owner", (q) => q.eq("owner", owner))
      .filter((q) => q.lt(q.field("createdAt"), before))
      .order("desc")
      .take(limit);
    const nextBefore = rows.length > 0 ? rows[rows.length - 1].createdAt : null;
    return { items: rows, nextBefore };
  },
});

export const getName = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const name = normalize(args.name);
    const row = await ctx.db
      .query("names")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();
    if (!row) return null;

    const listing = await ctx.db
      .query("nameListings")
      .withIndex("by_name", (q) => q.eq("name", name))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    return { name: row, listing: listing || null };
  },
});

export const listNameListings = query({
  args: { limit: v.optional(v.number()), q: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
    const q = normalize(args.q ?? "");
    let base = ctx.db
      .query("nameListings")
      .withIndex("by_status", (qq) => qq.eq("status", "active"))
      .order("desc");
    const rows = await base.take(limit * 2);
    const filtered = q ? rows.filter((r) => r.name.includes(q)) : rows;
    return filtered.slice(0, limit);
  },
});

export const createNameListing = mutation({
  args: {
    name: v.string(),
    priceZec: v.number(),
    sellerAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const name = normalize(args.name);
    const ownerRow = await ctx.db
      .query("names")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();
    if (!ownerRow) throw new Error("Name not found");
    if (normalize(ownerRow.owner) !== normalize(args.sellerAddress)) {
      throw new Error("Only the owner can list this name");
    }
    const existingActive = await ctx.db
      .query("nameListings")
      .withIndex("by_name", (q) => q.eq("name", name))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    if (existingActive) return existingActive._id;
    return await ctx.db.insert("nameListings", {
      name,
      sellerAddress: normalize(args.sellerAddress),
      priceZec: args.priceZec,
      status: "active",
      createdAt: Date.now(),
    });
  },
});

export const cancelNameListing = mutation({
  args: { id: v.id("nameListings"), sellerAddress: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return false;
    if (row.sellerAddress !== normalize(args.sellerAddress)) {
      throw new Error("Not your listing");
    }
    if (row.status !== "active") return false;
    await ctx.db.patch(args.id, { status: "cancelled" });
    return true;
  },
});

export const finalizeNameSale = mutation({
  args: { id: v.id("nameListings"), buyerAddress: v.string(), txid: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Listing not found");
    if (row.status !== "active") throw new Error("Listing is not active");
    await ctx.db.patch(args.id, {
      status: "sold",
      buyerAddress: args.buyerAddress.toLowerCase(),
      txid: args.txid,
    });
    return true;
  },
});

// Ingest recent inscriptions and extract ZNS registrations
export const refreshNamesRecent = action({
  args: { pages: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const base =
      process.env.ORDINAL_INDEX_API_BASE?.replace(/\/$/, "") ||
      process.env.NEXT_PUBLIC_ORDINAL_INDEX_API?.replace(/\/$/, "") ||
      "http://135.181.6.234:3333";
    const pages = Math.max(1, Math.min(args.pages ?? 5, 50));
    const limit = Math.max(10, Math.min(args.limit ?? 100, 200));

    async function fetchJson(url: string) {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    }

    async function fetchMaybeJson(url: string): Promise<string | null> {
      const res = await fetch(url);
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json') && !ct.includes('text/')) return null;
      // always text; we'll JSON.parse later
      try { return await res.text(); } catch { return null; }
    }

    function parseZnsFromText(text: string | null): { name?: string; owner?: string } | null {
      if (!text) return null;
      // Fast path: JSON
      try {
        const parsed = JSON.parse(text);
        if (parsed?.p === 'zns' && parsed?.op === 'register') {
          const name = (parsed.name || parsed.domain || '').toString().toLowerCase();
          const owner = (parsed.owner || parsed.address || parsed.addr || '').toString().toLowerCase();
          if (name && owner) return { name, owner };
        }
      } catch {}
      // Fallback regex search
      try {
        if (text.includes('"p"') && text.includes('"zns"') && text.includes('register')) {
          const nameMatch = text.match(/\"(name|domain)\"\s*:\s*\"([a-z0-9-]{3,32})\"/i);
          const ownerMatch = text.match(/\"(owner|address|addr)\"\s*:\s*\"([^\"]{10,})\"/i);
          const name = nameMatch?.[2]?.toLowerCase();
          const owner = ownerMatch?.[2]?.toLowerCase();
          if (name && owner) return { name, owner };
        }
      } catch {}
      return null;
    }

    const entries: Array<{ name: string; owner: string; inscriptionId: string; txid?: string; createdAt?: number }> = [];

    for (let p = 0; p < pages; p++) {
      const listUrl = `${base}/api/v1/inscriptions?page=${p}&limit=${limit}`;
      let list: any;
      try {
        list = await fetchJson(listUrl);
      } catch (e) {
        console.warn("names: failed to fetch inscriptions page", p, e);
        break;
      }

      const items: any[] = Array.isArray(list) ? list : (list?.items ?? list?.inscriptions ?? []);
      if (!items.length) break;

      // Concurrency limit for content fetch
      const batchSize = 8;
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (item: any) => {
            const id = item?.inscription_id || item?.id || item?.inscriptionId || item?.inscriptionid;
            if (!id) return null;
            try {
              // Prefer content endpoint; fallback to preview for text/json
              const contentUrl = `${base}/content/${id}`;
              const previewUrl = `${base}/preview/${id}`;
              const text = (await fetchMaybeJson(contentUrl)) ?? (await fetchMaybeJson(previewUrl));
              const parsed = parseZnsFromText(text);
              if (parsed?.name && parsed?.owner) {
                return {
                  name: normalize(parsed.name),
                  owner: normalize(parsed.owner),
                  inscriptionId: id as string,
                  txid: (item?.txid || item?.tx_id || item?.transaction_id || "") as string,
                  createdAt: (item?.timestamp || item?.time || item?.created_at || Date.now()) as number,
                };
              }
            } catch (e) {
              // ignore single failures
            }
            return null;
          })
        );
        for (const r of results) if (r) entries.push(r);
      }
    }

    // Upsert all
    for (const e of entries) {
      await ctx.runMutation("names:upsertName", e);
    }

    return { imported: entries.length };
  },
});
