import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

export const createJob = internalMutation({
  args: {
    type: v.string(),
    params: v.any(),
    totalCount: v.number(),
  },
  handler: async (ctx, args) => {
    const _id = await ctx.db.insert("jobs", {
      type: args.type,
      status: "pending",
      params: args.params,
      totalCount: args.totalCount,
      completedCount: 0,
      inscriptionIds: [],
      inscriptions: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return _id;
  },
});

export const setJobStatus = internalMutation({
  args: { jobId: v.id("jobs"), status: v.string(), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, { status: args.status, error: args.error, updatedAt: Date.now() });
  },
});

export const addJobProgress = internalMutation({
  args: { jobId: v.id("jobs"), inscriptionId: v.string(), inscriptionDocId: v.id("inscriptions") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    await ctx.db.patch(args.jobId, {
      completedCount: job.completedCount + 1,
      inscriptionIds: [...job.inscriptionIds, args.inscriptionId],
      inscriptions: [...job.inscriptions, args.inscriptionDocId],
      updatedAt: Date.now(),
    });
  },
});

export const getJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    return job;
  },
});

export const listJobs = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db.query("jobs").order("desc").collect();
    return jobs;
  },
});
