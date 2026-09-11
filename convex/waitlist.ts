/**
 * Access requests from the coming-soon landing page.
 *
 * `join` is called server-side by src/app/api/waitlist, never from the browser, so the email is
 * validated and rate limited before it reaches the database. Convex mutations are publicly
 * callable, so `join` re-validates rather than trusting its caller.
 *
 * Privacy: no raw IP address is stored. The route passes a salted SHA-256 of the IP, used only
 * to count recent signups from the same source.
 */

import { mutation, query, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;

// RFC 5322 is not worth implementing; this rejects the mistakes people actually make.
const EMAIL_RE = /^[^\s@]+@[^\s@,]+\.[a-z]{2,}$/i;

export const join = mutation({
  args: {
    email: v.string(),
    source: v.optional(v.string()),
    referer: v.optional(v.string()),
    country: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    ipHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) {
      throw new Error("invalid-email");
    }

    if (args.ipHash) {
      const since = Date.now() - RATE_WINDOW_MS;
      const recent = await ctx.db
        .query("waitlist")
        .withIndex("by_ipHash", (q) => q.eq("ipHash", args.ipHash))
        .collect();
      if (recent.filter((r) => r.createdAt > since).length >= MAX_PER_WINDOW) {
        throw new Error("rate-limited");
      }
    }

    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    // Keep the original signup time so position in the queue is stable.
    if (existing) return { already: true };

    await ctx.db.insert("waitlist", {
      email,
      createdAt: Date.now(),
      source: args.source ?? "coming-soon",
      referer: args.referer,
      country: args.country,
      userAgent: args.userAgent?.slice(0, 300),
      ipHash: args.ipHash,
    });
    return { already: false };
  },
});

/** Public signup count. Safe to expose; reveals no addresses. */
export const count = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("waitlist").collect()).length,
});

/** Full list for export. Internal only — never callable from a browser. */
export const listAll = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("waitlist").withIndex("by_createdAt").order("asc").collect()).map((r) => ({
      email: r.email,
      createdAt: r.createdAt,
      source: r.source,
      country: r.country ?? "",
      invitedAt: r.invitedAt ?? null,
    })),
});
