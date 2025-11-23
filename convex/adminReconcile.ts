import { mutation, action, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

function normalizeAddress(address: string | null | undefined) {
  return (address || "").toLowerCase();
}

export const applyInscribedMints = mutation({
  args: {
    collectionSlug: v.string(),
    updates: v.array(
      v.object({
        tokenId: v.number(),
        address: v.string(),
        inscriptionId: v.string(),
        txid: v.optional(v.string()),
        batchId: v.optional(v.string()),
      })
    ),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();
    const now = Date.now();
    const force = args.force ?? false;
    const results: Array<{
      tokenId: number;
      action: string;
      message?: string;
    }> = [];

    for (const update of args.updates) {
      const address = normalizeAddress(update.address);
      const docs = await ctx.db
        .query("collectionClaims")
        .withIndex("by_collection_token", (q) => q.eq("collectionSlug", slug).eq("tokenId", update.tokenId))
        .collect();

      let target = docs.find((doc) => normalizeAddress(doc.address) === address);
      if (!target) {
        target = docs.sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))[0];
      }

      if (!target) {
        const _id = await ctx.db.insert("collectionClaims", {
          collectionSlug: slug,
          tokenId: update.tokenId,
          status: "minted",
          address,
          inscriptionId: update.inscriptionId,
          txid: update.txid,
          batchId: update.batchId,
          attempts: 1,
          lastError: undefined,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("collectionClaimEvents", {
          collectionSlug: slug,
          tokenId: update.tokenId,
          address,
          batchId: update.batchId,
          status: "minted",
          message: "admin-reconciled",
          txid: update.txid,
          inscriptionId: update.inscriptionId,
          createdAt: now,
        });
        results.push({ tokenId: update.tokenId, action: "inserted", message: `Created new mint record (${_id}).` });
        continue;
      }

      if (
        target.status === "minted" &&
        normalizeAddress(target.address) === address &&
        target.inscriptionId === update.inscriptionId &&
        !force
      ) {
        results.push({ tokenId: update.tokenId, action: "skipped", message: "Already minted" });
        continue;
      }

      await ctx.db.patch(target._id, {
        status: "minted",
        address,
        inscriptionId: update.inscriptionId,
        txid: update.txid ?? target.txid,
        batchId: update.batchId ?? target.batchId,
        attempts: (target.attempts ?? 0) + 1,
        lastError: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("collectionClaimEvents", {
        collectionSlug: slug,
        tokenId: update.tokenId,
        address,
        batchId: update.batchId ?? target.batchId,
        status: "minted",
        message: "admin-reconciled",
        txid: update.txid ?? target.txid,
        inscriptionId: update.inscriptionId,
        createdAt: now,
      });
      results.push({ tokenId: update.tokenId, action: "patched" });
    }

    return results;
  },
});

export const listCollectionSlugs = action({
  args: {},
  handler: async (ctx) => {
    let cursor = null;
    const slugSet = new Set<string>();
    let totalCount = 0;

    while (true) {
      const result = await ctx.runMutation(internal.adminReconcile.queryAllEventsBatch, {
        cursor,
        numItems: 1000,
      });

      totalCount += result.events.length;
      result.events.forEach((e: any) => slugSet.add(e.collectionSlug));

      if (result.isDone) break;
      cursor = result.continueCursor;
    }

    return {
      slugs: Array.from(slugSet),
      totalEvents: totalCount,
    };
  },
});

export const queryAllEventsBatch = mutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("collectionClaimEvents")
      .paginate({ cursor: args.cursor as any, numItems: args.numItems });

    return {
      events: result.page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const debugFailedEvents = action({
  args: {},
  handler: async (ctx) => {
    // Get deployment info to confirm which deployment we're querying
    const deploymentInfo = await ctx.runMutation(internal.adminReconcile.getDeploymentInfo, {});

    let cursor = null;
    let totalEvents = 0;
    let totalFailed = 0;
    let addressMismatchCount = 0;
    let addressMismatchWithInscriptionCount = 0;
    const samples: any[] = [];

    while (true) {
      const batch = await ctx.runMutation(internal.adminReconcile.queryAllEventsBatch, {
        cursor,
        numItems: 1000,
      });

      totalEvents += batch.events.length;

      const failed = batch.events.filter((e: any) => e.status === "failed");
      totalFailed += failed.length;

      const addressMismatch = batch.events.filter((e: any) => e.message === "Address mismatch for reserved token");
      addressMismatchCount += addressMismatch.length;

      const addressMismatchWithInscription = addressMismatch.filter((e: any) => e.inscriptionId && e.inscriptionId.length > 10);
      addressMismatchWithInscriptionCount += addressMismatchWithInscription.length;

      if (samples.length < 10) {
        samples.push(...addressMismatchWithInscription.slice(0, 10 - samples.length).map((e: any) => ({
          tokenId: e.tokenId,
          status: e.status,
          inscriptionId: e.inscriptionId,
          message: e.message,
        })));
      }

      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }

    return {
      deployment: deploymentInfo,
      totalEvents,
      totalFailed,
      addressMismatchEvents: addressMismatchCount,
      addressMismatchWithInscriptionId: addressMismatchWithInscriptionCount,
      samples,
    };
  },
});

export const getDeploymentInfo = mutation({
  args: {},
  handler: async (ctx) => {
    // Get a sample event to see creation time
    const sample = await ctx.db.query("collectionClaimEvents").first();
    return {
      sampleEventId: sample?._id,
      sampleCreationTime: sample?._creationTime,
    };
  },
});

export const countAllEvents = action({
  args: {
    useIndex: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let cursor = null;
    let totalCount = 0;
    let iterations = 0;
    const maxIterations = 50; // Limit to 50k events
    const useIndex = args.useIndex ?? false;

    while (iterations < maxIterations) {
      iterations++;
      const batch = useIndex
        ? await ctx.runMutation(internal.adminReconcile.queryEventsBatch, {
            collectionSlug: "zgods",
            cursor,
            numItems: 1000,
          })
        : await ctx.runMutation(internal.adminReconcile.queryAllEventsBatch, {
            cursor,
            numItems: 1000,
          });

      totalCount += batch.events.length;
      console.log(`Iteration ${iterations}: fetched ${batch.events.length}, total so far: ${totalCount}, isDone: ${batch.isDone}`);

      if (batch.isDone) {
        console.log("Pagination completed");
        break;
      }
      cursor = batch.continueCursor;
    }

    return {
      totalCount,
      iterations,
      completed: iterations < maxIterations,
      method: useIndex ? "by_collection index" : "table scan",
    };
  },
});

const fixMintedEventStatusBatch = mutation({
  args: {
    eventIds: v.array(v.id("collectionClaimEvents")),
  },
  handler: async (ctx, args) => {
    for (const id of args.eventIds) {
      await ctx.db.patch(id, { status: "minted" });
    }
    return { fixed: args.eventIds.length };
  },
});

export const fixMintedEventStatus = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const batchSize = args.batchSize ?? 1000;

    let cursor = null;
    let totalEvents = 0;
    let totalFixed = 0;
    let iterations = 0;
    const samples: any[] = [];
    const toFixIds: any[] = [];

    // Paginate through ALL events (not filtered by collection)
    while (true) {
      iterations++;
      const batch = await ctx.runMutation(internal.adminReconcile.queryAllEventsBatch, {
        cursor,
        numItems: batchSize,
      });

      console.log(`Iteration ${iterations}: fetched ${batch.events.length}, isDone: ${batch.isDone}`);
      totalEvents += batch.events.length;

      const failed = batch.events.filter((e: any) => e.status === "failed");
      const toFix = batch.events.filter(
        (event: any) =>
          event.status === "failed" &&
          event.inscriptionId &&
          event.inscriptionId.length > 10 &&
          event.inscriptionId !== "unset"
      );

      if (iterations === 1 && failed.length > 0) {
        console.log("Sample failed event:", JSON.stringify(failed[0], null, 2));
      }

      totalFixed += toFix.length;

      if (samples.length < 10) {
        samples.push(...toFix.slice(0, 10 - samples.length).map((e: any) => ({
          tokenId: e.tokenId,
          status: e.status,
          inscriptionId: e.inscriptionId,
          message: e.message,
        })));
      }

      if (!dryRun) {
        toFixIds.push(...toFix.map((e: any) => e._id));
      }

      if (batch.isDone) break;
      cursor = batch.continueCursor;

      // Safety limit
      if (iterations > 100) {
        console.log("Hit iteration limit");
        break;
      }
    }

    // Apply fixes in batches
    if (!dryRun && toFixIds.length > 0) {
      const PATCH_BATCH_SIZE = 100;
      for (let i = 0; i < toFixIds.length; i += PATCH_BATCH_SIZE) {
        const batchIds = toFixIds.slice(i, i + PATCH_BATCH_SIZE);
        await ctx.runMutation(internal.adminReconcile.fixMintedEventStatusBatch, {
          eventIds: batchIds,
        });
      }
    }

    return {
      totalEvents,
      totalFixed,
      iterations,
      samples: dryRun ? samples : undefined,
    };
  },
});

export const queryEventsBatch = mutation({
  args: {
    collectionSlug: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("collectionClaimEvents")
      .withIndex("by_collection", (q) => q.eq("collectionSlug", args.collectionSlug))
      .paginate({ cursor: args.cursor as any, numItems: args.numItems });

    return {
      events: result.page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const verifyNoConflicts = action({
  args: {
    collectionSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug || "zgods";

    // Step 1: Collect all events at once
    let cursor = null;
    const failedWithInscription: Array<{
      _id: string;
      tokenId: number;
      inscriptionId: string;
      address: string;
    }> = [];
    const mintedEvents: Array<{
      tokenId: number;
      inscriptionId: string;
      address: string;
    }> = [];

    while (true) {
      const batch = await ctx.runMutation(internal.adminReconcile.queryAllEventsBatch, {
        cursor,
        numItems: 1000,
      });

      for (const e of batch.events) {
        if (e.collectionSlug !== slug) continue;

        if (
          e.status === "failed" &&
          e.inscriptionId &&
          e.inscriptionId.length > 10 &&
          e.inscriptionId !== "unset"
        ) {
          failedWithInscription.push({
            _id: e._id,
            tokenId: e.tokenId,
            inscriptionId: e.inscriptionId,
            address: e.address,
          });
        } else if (e.status === "minted" && e.inscriptionId) {
          mintedEvents.push({
            tokenId: e.tokenId,
            inscriptionId: e.inscriptionId,
            address: e.address,
          });
        }
      }

      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }

    console.log(`Found ${failedWithInscription.length} failed events with valid inscriptionIds`);
    console.log(`Found ${mintedEvents.length} minted events`);

    // Step 2: Build lookup maps from minted events
    const mintedByTokenId = new Map<number, { inscriptionId: string; address: string }>();
    const mintedByInscriptionId = new Set<string>();

    for (const minted of mintedEvents) {
      mintedByTokenId.set(minted.tokenId, {
        inscriptionId: minted.inscriptionId,
        address: minted.address,
      });
      mintedByInscriptionId.add(minted.inscriptionId);
    }

    // Step 3: Check for conflicts in failed events
    const conflicts: Array<{
      tokenId: number;
      failedInscriptionId: string;
      conflictType: string;
      conflictDetails: any;
    }> = [];

    const failedInscriptionMap = new Map<string, number>();
    const failedTokenMap = new Map<number, string>();

    for (const failed of failedWithInscription) {
      // Check if this inscriptionId already exists in our failed list (duplicates in failed)
      if (failedInscriptionMap.has(failed.inscriptionId)) {
        conflicts.push({
          tokenId: failed.tokenId,
          failedInscriptionId: failed.inscriptionId,
          conflictType: "duplicate_inscription_in_failed",
          conflictDetails: {
            otherTokenId: failedInscriptionMap.get(failed.inscriptionId),
          },
        });
      }
      failedInscriptionMap.set(failed.inscriptionId, failed.tokenId);

      // Check if this tokenId already has a different inscriptionId in our failed list
      if (failedTokenMap.has(failed.tokenId) && failedTokenMap.get(failed.tokenId) !== failed.inscriptionId) {
        conflicts.push({
          tokenId: failed.tokenId,
          failedInscriptionId: failed.inscriptionId,
          conflictType: "duplicate_token_different_inscription_in_failed",
          conflictDetails: {
            otherInscriptionId: failedTokenMap.get(failed.tokenId),
          },
        });
      }
      failedTokenMap.set(failed.tokenId, failed.inscriptionId);

      // Check if there's already a minted event for this tokenId with a different inscriptionId
      const mintedData = mintedByTokenId.get(failed.tokenId);
      if (mintedData && mintedData.inscriptionId !== failed.inscriptionId) {
        conflicts.push({
          tokenId: failed.tokenId,
          failedInscriptionId: failed.inscriptionId,
          conflictType: "token_already_minted_different_inscription",
          conflictDetails: {
            mintedInscriptionId: mintedData.inscriptionId,
            mintedAddress: mintedData.address,
            failedAddress: failed.address,
          },
        });
      }

      // Check if this inscriptionId is already marked as minted (should be same tokenId if so)
      if (mintedByInscriptionId.has(failed.inscriptionId)) {
        const existingMinted = mintedEvents.find((m) => m.inscriptionId === failed.inscriptionId);
        if (existingMinted && existingMinted.tokenId !== failed.tokenId) {
          conflicts.push({
            tokenId: failed.tokenId,
            failedInscriptionId: failed.inscriptionId,
            conflictType: "inscription_already_minted_different_token",
            conflictDetails: {
              mintedTokenId: existingMinted.tokenId,
              mintedAddress: existingMinted.address,
              failedAddress: failed.address,
            },
          });
        }
      }
    }

    return {
      totalFailedWithInscription: failedWithInscription.length,
      totalMintedEvents: mintedEvents.length,
      totalConflicts: conflicts.length,
      conflicts: conflicts.slice(0, 100), // Return first 100 conflicts
      safe: conflicts.length === 0,
      summary: {
        duplicateInscriptionInFailed: conflicts.filter((c) => c.conflictType === "duplicate_inscription_in_failed").length,
        duplicateTokenDifferentInscriptionInFailed: conflicts.filter((c) => c.conflictType === "duplicate_token_different_inscription_in_failed").length,
        tokenAlreadyMintedDifferent: conflicts.filter((c) => c.conflictType === "token_already_minted_different_inscription").length,
        inscriptionAlreadyMintedDifferent: conflicts.filter((c) => c.conflictType === "inscription_already_minted_different_token").length,
      },
    };
  },
});

export const prepareSmartFix = action({
  args: {
    collectionSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug || "zgods";

    // Step 1: Collect all events
    let cursor = null;
    const failedWithInscription: Array<{
      _id: string;
      tokenId: number;
      inscriptionId: string;
      address: string;
      createdAt: number;
    }> = [];
    const allEvents: Array<{
      tokenId: number;
      inscriptionId: string;
      address: string;
      status: string;
      createdAt: number;
    }> = [];

    while (true) {
      const batch = await ctx.runMutation(internal.adminReconcile.queryAllEventsBatch, {
        cursor,
        numItems: 1000,
      });

      for (const e of batch.events) {
        if (e.collectionSlug !== slug) continue;

        allEvents.push({
          tokenId: e.tokenId,
          inscriptionId: e.inscriptionId,
          address: normalizeAddress(e.address),
          status: e.status,
          createdAt: e.createdAt,
        });

        if (
          e.status === "failed" &&
          e.inscriptionId &&
          e.inscriptionId.length > 10 &&
          e.inscriptionId !== "unset"
        ) {
          failedWithInscription.push({
            _id: e._id,
            tokenId: e.tokenId,
            inscriptionId: e.inscriptionId,
            address: normalizeAddress(e.address),
            createdAt: e.createdAt,
          });
        }
      }

      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }

    console.log(`Found ${failedWithInscription.length} failed events with valid inscriptionIds`);
    console.log(`Found ${allEvents.length} total events for ${slug}`);

    // Step 2: Build maps
    // Map of tokenId -> minted inscription (if exists)
    const mintedByTokenId = new Map<number, { inscriptionId: string; address: string }>();
    // Map of address -> list of minted tokenIds
    const mintedByAddress = new Map<string, number[]>();

    for (const event of allEvents) {
      if (event.status === "minted" && event.inscriptionId) {
        mintedByTokenId.set(event.tokenId, {
          inscriptionId: event.inscriptionId,
          address: event.address,
        });

        const existing = mintedByAddress.get(event.address) || [];
        if (!existing.includes(event.tokenId)) {
          existing.push(event.tokenId);
          mintedByAddress.set(event.address, existing);
        }
      }
    }

    // Step 3: Group failed events by tokenId to handle duplicates
    const failedByTokenId = new Map<number, Array<{
      _id: string;
      inscriptionId: string;
      address: string;
      createdAt: number;
    }>>();

    for (const failed of failedWithInscription) {
      const existing = failedByTokenId.get(failed.tokenId) || [];
      existing.push({
        _id: failed._id,
        inscriptionId: failed.inscriptionId,
        address: failed.address,
        createdAt: failed.createdAt,
      });
      failedByTokenId.set(failed.tokenId, existing);
    }

    // Step 4: Categorize each token
    const safeToFix: Array<{
      tokenId: number;
      inscriptionId: string;
      address: string;
      reason: string;
    }> = [];
    const needsManualReview: Array<{
      tokenId: number;
      reason: string;
      details: any;
    }> = [];

    for (const [tokenId, failedEvents] of failedByTokenId.entries()) {
      // Check if already minted with a different inscription
      const minted = mintedByTokenId.get(tokenId);

      if (minted) {
        // Token is already minted - skip all failed events for this token
        needsManualReview.push({
          tokenId,
          reason: "token_already_minted",
          details: {
            mintedInscriptionId: minted.inscriptionId,
            mintedAddress: minted.address,
            failedInscriptions: failedEvents.map(f => ({
              inscriptionId: f.inscriptionId,
              address: f.address,
            })),
          },
        });
        continue;
      }

      // If multiple failed inscriptions for same token, needs manual review
      if (failedEvents.length > 1) {
        needsManualReview.push({
          tokenId,
          reason: "multiple_failed_inscriptions",
          details: {
            count: failedEvents.length,
            inscriptions: failedEvents.map(f => ({
              inscriptionId: f.inscriptionId,
              address: f.address,
              createdAt: f.createdAt,
            })).sort((a, b) => a.createdAt - b.createdAt),
          },
        });
        continue;
      }

      // Single failed inscription for this token
      const failed = failedEvents[0];

      // Check if this user already has other minted tokens
      const userMintedTokens = mintedByAddress.get(failed.address) || [];

      // Mark as safe to fix (allocation check will be done separately)
      safeToFix.push({
        tokenId,
        inscriptionId: failed.inscriptionId,
        address: failed.address,
        reason: `single_failed_inscription, user_has_${userMintedTokens.length}_minted`,
      });
    }

    return {
      summary: {
        totalFailedWithInscription: failedWithInscription.length,
        totalUniqueTokensAffected: failedByTokenId.size,
        safeToFixCount: safeToFix.length,
        needsManualReviewCount: needsManualReview.length,
      },
      safeToFix: safeToFix.slice(0, 100),
      needsManualReview: needsManualReview.slice(0, 50),
      allSafeToFixCount: safeToFix.length,
    };
  },
});

export const applySmartFixBatch = mutation({
  args: {
    eventIds: v.array(v.id("collectionClaimEvents")),
  },
  handler: async (ctx, args) => {
    let fixed = 0;
    for (const id of args.eventIds) {
      await ctx.db.patch(id, { status: "minted" });
      fixed++;
    }
    return { fixed };
  },
});

export const applySmartFixClaimsBatch = mutation({
  args: {
    updates: v.array(v.object({
      collectionSlug: v.string(),
      tokenId: v.number(),
      inscriptionId: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    let fixed = 0;
    const now = Date.now();

    for (const update of args.updates) {
      const existing = await ctx.db
        .query("collectionClaims")
        .withIndex("by_collection_token", (q) =>
          q.eq("collectionSlug", update.collectionSlug).eq("tokenId", update.tokenId)
        )
        .first();

      if (existing && existing.status !== "minted") {
        await ctx.db.patch(existing._id, {
          status: "minted",
          inscriptionId: update.inscriptionId,
          updatedAt: now,
        });
        fixed++;
      }
    }

    return { fixed };
  },
});

export const syncClaimsFromEvents = action({
  args: {
    collectionSlug: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug || "zgods";
    const dryRun = args.dryRun ?? true;

    console.log(`Syncing collectionClaims from collectionClaimEvents for ${slug}, dryRun=${dryRun}`);

    // Find all minted events with valid inscription IDs
    let cursor = null;
    const mintedEvents: Array<{
      tokenId: number;
      inscriptionId: string;
      address: string;
    }> = [];

    while (true) {
      const batch = await ctx.runMutation(internal.adminReconcile.queryAllEventsBatch, {
        cursor,
        numItems: 1000,
      });

      for (const e of batch.events) {
        if (
          e.collectionSlug === slug &&
          e.status === "minted" &&
          e.inscriptionId &&
          e.inscriptionId.length > 10 &&
          e.inscriptionId !== "unset"
        ) {
          mintedEvents.push({
            tokenId: e.tokenId,
            inscriptionId: e.inscriptionId,
            address: normalizeAddress(e.address),
          });
        }
      }

      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }

    console.log(`Found ${mintedEvents.length} minted events with valid inscriptionIds`);

    // Group by tokenId (take the earliest inscription per token)
    const uniqueByToken = new Map<number, { inscriptionId: string; address: string }>();
    for (const event of mintedEvents) {
      if (!uniqueByToken.has(event.tokenId)) {
        uniqueByToken.set(event.tokenId, {
          inscriptionId: event.inscriptionId,
          address: event.address,
        });
      }
    }

    console.log(`Found ${uniqueByToken.size} unique tokens to sync`);

    if (dryRun) {
      return {
        dryRun: true,
        tokensToSync: uniqueByToken.size,
        message: "Dry run complete. Set dryRun=false to apply changes.",
      };
    }

    // Update collectionClaims in batches
    const updates = Array.from(uniqueByToken.entries()).map(([tokenId, data]) => ({
      collectionSlug: slug,
      tokenId,
      inscriptionId: data.inscriptionId,
    }));

    let totalFixed = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      const result = await ctx.runMutation(internal.adminReconcile.applySmartFixClaimsBatch, {
        updates: batch,
      });
      totalFixed += result.fixed;
      console.log(`Synced batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.fixed} claims (total: ${totalFixed}/${updates.length})`);
    }

    return {
      dryRun: false,
      totalSynced: totalFixed,
      message: `Successfully synced ${totalFixed} claims from events`,
    };
  },
});

export const revokeOverAllocatedMints = action({
  args: {
    collectionSlug: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug || "zgods";
    const dryRun = args.dryRun ?? true;

    console.log(`Finding over-allocated users for ${slug}, dryRun=${dryRun}`);

    // Import allowlist to get allocations
    const { getAllowlistEntry } = await import("./claimAllowlists");

    // Step 1: Get all minted claims from collectionClaims (source of truth)
    const allClaims = await ctx.runQuery(internal.adminReconcile.getAllMintedClaims, {
      collectionSlug: slug,
    });

    const mintedTokens = allClaims.map(claim => ({
      _id: claim._id,
      tokenId: claim.tokenId,
      address: normalizeAddress(claim.address),
      inscriptionId: claim.inscriptionId || "",
      createdAt: claim.createdAt || 0,
    }));

    console.log(`Found ${mintedTokens.length} total minted tokens`);

    // Step 2: Group by address and sort by timestamp
    const tokensByAddress = new Map<string, Array<{
      _id: string;
      tokenId: number;
      inscriptionId: string;
      createdAt: number;
    }>>();

    for (const token of mintedTokens) {
      const existing = tokensByAddress.get(token.address) || [];
      existing.push({
        _id: token._id,
        tokenId: token.tokenId,
        inscriptionId: token.inscriptionId,
        createdAt: token.createdAt,
      });
      tokensByAddress.set(token.address, existing);
    }

    // Step 3: Identify over-allocated users and tokens to revoke
    const overAllocatedUsers: Array<{
      address: string;
      allocation: number;
      claimed: number;
      overBy: number;
      tokensToRevoke: Array<{
        _id: string;
        tokenId: number;
        inscriptionId: string;
        createdAt: number;
      }>;
    }> = [];

    for (const [address, tokens] of tokensByAddress.entries()) {
      const allowlist = getAllowlistEntry(slug, address);
      const allocation = allowlist?.max || 0;
      const claimed = tokens.length;

      if (claimed > allocation) {
        // Sort by timestamp (oldest first)
        const sortedTokens = tokens.sort((a, b) => a.createdAt - b.createdAt);

        // The last N tokens (where N = over-allocation) should be revoked
        const overBy = claimed - allocation;
        const tokensToRevoke = sortedTokens.slice(allocation); // Take everything after allocation limit

        overAllocatedUsers.push({
          address,
          allocation,
          claimed,
          overBy,
          tokensToRevoke: tokensToRevoke.map(t => ({
            _id: t._id,
            tokenId: t.tokenId,
            inscriptionId: t.inscriptionId,
            createdAt: t.createdAt,
          })),
        });
      }
    }

    console.log(`Found ${overAllocatedUsers.length} over-allocated users`);

    if (dryRun) {
      const summary = overAllocatedUsers.map(user => ({
        address: user.address,
        allocation: user.allocation,
        claimed: user.claimed,
        overBy: user.overBy,
        tokensToRevoke: user.tokensToRevoke.length,
        tokenIds: user.tokensToRevoke.map(t => t.tokenId),
      }));

      return {
        dryRun: true,
        totalOverAllocatedUsers: overAllocatedUsers.length,
        totalTokensToRevoke: overAllocatedUsers.reduce((sum, u) => sum + u.tokensToRevoke.length, 0),
        users: summary,
        message: "Dry run complete. Set dryRun=false to revoke these mints.",
      };
    }

    // Step 4: Revoke the over-allocated tokens
    let totalRevoked = 0;
    const now = Date.now();

    for (const user of overAllocatedUsers) {
      for (const token of user.tokensToRevoke) {
        // Update status to failed in collectionClaims using the _id we already have
        await ctx.runMutation(internal.adminReconcile.updateClaimStatus, {
          claimId: token._id,
          status: "failed",
          lastError: "Revoked: Exceeded allocation limit",
        });

        // Add event to collectionClaimEvents
        await ctx.runMutation(internal.adminReconcile.addClaimEvent, {
          collectionSlug: slug,
          tokenId: token.tokenId,
          address: user.address,
          status: "failed",
          message: "Revoked: Exceeded allocation limit",
          inscriptionId: token.inscriptionId,
        });

        totalRevoked++;
        console.log(`Revoked token ${token.tokenId} from ${user.address} (${totalRevoked} total)`);
      }
    }

    return {
      dryRun: false,
      totalRevoked,
      usersProcessed: overAllocatedUsers.length,
      message: `Successfully revoked ${totalRevoked} over-allocated tokens from ${overAllocatedUsers.length} users`,
    };
  },
});

export const findClaimByToken = mutation({
  args: {
    collectionSlug: v.string(),
    tokenId: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_token", (q) =>
        q.eq("collectionSlug", args.collectionSlug).eq("tokenId", args.tokenId)
      )
      .first();
  },
});

export const updateClaimStatus = mutation({
  args: {
    claimId: v.id("collectionClaims"),
    status: v.string(),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.claimId, {
      status: args.status as any,
      lastError: args.lastError,
      updatedAt: now,
    });
  },
});

export const addClaimEvent = mutation({
  args: {
    collectionSlug: v.string(),
    tokenId: v.number(),
    address: v.string(),
    status: v.string(),
    message: v.optional(v.string()),
    inscriptionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("collectionClaimEvents", {
      collectionSlug: args.collectionSlug,
      tokenId: args.tokenId,
      address: args.address,
      status: args.status as any,
      message: args.message,
      inscriptionId: args.inscriptionId,
      createdAt: Date.now(),
    });
  },
});

export const generateEdgeCaseReport = action({
  args: {
    collectionSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug || "zgods";

    console.log(`Generating edge case report for ${slug}`);

    // Step 1: Collect all events
    let cursor = null;
    const failedWithInscription: Array<{
      _id: string;
      tokenId: number;
      inscriptionId: string;
      address: string;
      createdAt: number;
    }> = [];
    const allEvents: Array<{
      tokenId: number;
      inscriptionId: string;
      address: string;
      status: string;
    }> = [];

    while (true) {
      const batch = await ctx.runMutation(internal.adminReconcile.queryAllEventsBatch, {
        cursor,
        numItems: 1000,
      });

      for (const e of batch.events) {
        if (e.collectionSlug !== slug) continue;

        allEvents.push({
          tokenId: e.tokenId,
          inscriptionId: e.inscriptionId,
          address: normalizeAddress(e.address),
          status: e.status,
        });

        if (
          e.status === "failed" &&
          e.inscriptionId &&
          e.inscriptionId.length > 10 &&
          e.inscriptionId !== "unset"
        ) {
          failedWithInscription.push({
            _id: e._id,
            tokenId: e.tokenId,
            inscriptionId: e.inscriptionId,
            address: normalizeAddress(e.address),
            createdAt: e.createdAt,
          });
        }
      }

      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }

    console.log(`Found ${failedWithInscription.length} failed events with valid inscriptionIds`);

    // Step 2: Build maps
    const mintedByTokenId = new Map<number, { inscriptionId: string; address: string }>();
    const mintedByAddress = new Map<string, number[]>();

    for (const event of allEvents) {
      if (event.status === "minted" && event.inscriptionId) {
        mintedByTokenId.set(event.tokenId, {
          inscriptionId: event.inscriptionId,
          address: event.address,
        });

        const existing = mintedByAddress.get(event.address) || [];
        if (!existing.includes(event.tokenId)) {
          existing.push(event.tokenId);
          mintedByAddress.set(event.address, existing);
        }
      }
    }

    // Step 3: Group failed events by tokenId
    const failedByTokenId = new Map<number, Array<{
      _id: string;
      inscriptionId: string;
      address: string;
      createdAt: number;
    }>>();

    for (const failed of failedWithInscription) {
      const existing = failedByTokenId.get(failed.tokenId) || [];
      existing.push({
        _id: failed._id,
        inscriptionId: failed.inscriptionId,
        address: failed.address,
        createdAt: failed.createdAt,
      });
      failedByTokenId.set(failed.tokenId, existing);
    }

    // Step 4: Identify edge cases and collect user info
    const edgeCases: Array<{
      tokenId: number;
      reason: string;
      addresses: string[];
      inscriptionIds: string[];
      attemptCount: number;
    }> = [];

    for (const [tokenId, failedEvents] of failedByTokenId.entries()) {
      const minted = mintedByTokenId.get(tokenId);

      if (minted) {
        // Token already minted
        const addresses = Array.from(new Set([minted.address, ...failedEvents.map(f => f.address)]));
        edgeCases.push({
          tokenId,
          reason: "token_already_minted",
          addresses,
          inscriptionIds: [minted.inscriptionId, ...failedEvents.map(f => f.inscriptionId)],
          attemptCount: failedEvents.length + 1,
        });
        continue;
      }

      if (failedEvents.length > 1) {
        // Multiple failed inscriptions
        const addresses = Array.from(new Set(failedEvents.map(f => f.address)));
        edgeCases.push({
          tokenId,
          reason: "multiple_failed_inscriptions",
          addresses,
          inscriptionIds: failedEvents.map(f => f.inscriptionId),
          attemptCount: failedEvents.length,
        });
      }
    }

    console.log(`Found ${edgeCases.length} edge cases`);

    // Step 5: Get allocation and claimed info for each affected address
    const addressStats = new Map<string, {
      allocation: number;
      claimed: number;
      tokens: number[];
    }>();

    // Import allowlist to get allocations
    const { getAllowlistEntry } = await import("./claimAllowlists");

    for (const edgeCase of edgeCases) {
      for (const address of edgeCase.addresses) {
        if (!addressStats.has(address)) {
          const allowlist = getAllowlistEntry(slug, address);
          const mintedTokens = mintedByAddress.get(address) || [];

          addressStats.set(address, {
            allocation: allowlist?.max || 0,
            claimed: mintedTokens.length,
            tokens: mintedTokens,
          });
        }
      }
    }

    // Step 6: Format report
    const report = edgeCases.map(edgeCase => ({
      tokenId: edgeCase.tokenId,
      reason: edgeCase.reason,
      attemptCount: edgeCase.attemptCount,
      inscriptionIds: edgeCase.inscriptionIds,
      affectedUsers: edgeCase.addresses.map(addr => {
        const stats = addressStats.get(addr);
        return {
          address: addr,
          allocation: stats?.allocation || 0,
          claimed: stats?.claimed || 0,
          remainingAllocation: (stats?.allocation || 0) - (stats?.claimed || 0),
          claimedTokens: stats?.tokens || [],
        };
      }),
    }));

    // Step 7: Summary stats
    const uniqueAddresses = new Set<string>();
    const tokensMinted = new Map<string, number>();
    const tokensAllocated = new Map<string, number>();

    for (const edgeCase of edgeCases) {
      for (const address of edgeCase.addresses) {
        uniqueAddresses.add(address);
        const stats = addressStats.get(address);
        tokensMinted.set(address, stats?.claimed || 0);
        tokensAllocated.set(address, stats?.allocation || 0);
      }
    }

    const summary = {
      totalEdgeCases: edgeCases.length,
      uniqueUsersAffected: uniqueAddresses.size,
      reasonBreakdown: {
        tokenAlreadyMinted: edgeCases.filter(e => e.reason === "token_already_minted").length,
        multipleFailedInscriptions: edgeCases.filter(e => e.reason === "multiple_failed_inscriptions").length,
      },
      usersByAllocationStatus: {
        fullyAllocated: Array.from(addressStats.values()).filter(s => s.claimed >= s.allocation).length,
        partiallyAllocated: Array.from(addressStats.values()).filter(s => s.claimed > 0 && s.claimed < s.allocation).length,
        noneAllocated: Array.from(addressStats.values()).filter(s => s.claimed === 0).length,
      },
    };

    return {
      summary,
      edgeCases: report,
    };
  },
});

export const applySmartFix = action({
  args: {
    collectionSlug: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug || "zgods";
    const dryRun = args.dryRun ?? true; // Default to dry run for safety

    console.log(`Starting smart fix for ${slug}, dryRun=${dryRun}`);

    // Step 1: Collect all events (same as prepareSmartFix)
    let cursor = null;
    const failedWithInscription: Array<{
      _id: string;
      tokenId: number;
      inscriptionId: string;
      address: string;
      createdAt: number;
    }> = [];
    const allEvents: Array<{
      tokenId: number;
      inscriptionId: string;
      address: string;
      status: string;
    }> = [];

    while (true) {
      const batch = await ctx.runMutation(internal.adminReconcile.queryAllEventsBatch, {
        cursor,
        numItems: 1000,
      });

      for (const e of batch.events) {
        if (e.collectionSlug !== slug) continue;

        allEvents.push({
          tokenId: e.tokenId,
          inscriptionId: e.inscriptionId,
          address: normalizeAddress(e.address),
          status: e.status,
        });

        if (
          e.status === "failed" &&
          e.inscriptionId &&
          e.inscriptionId.length > 10 &&
          e.inscriptionId !== "unset"
        ) {
          failedWithInscription.push({
            _id: e._id,
            tokenId: e.tokenId,
            inscriptionId: e.inscriptionId,
            address: normalizeAddress(e.address),
            createdAt: e.createdAt,
          });
        }
      }

      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }

    console.log(`Found ${failedWithInscription.length} failed events with valid inscriptionIds`);

    // Step 2: Build maps
    const mintedByTokenId = new Map<number, { inscriptionId: string; address: string }>();

    for (const event of allEvents) {
      if (event.status === "minted" && event.inscriptionId) {
        mintedByTokenId.set(event.tokenId, {
          inscriptionId: event.inscriptionId,
          address: event.address,
        });
      }
    }

    // Step 3: Group failed events by tokenId
    const failedByTokenId = new Map<number, Array<{
      _id: string;
      inscriptionId: string;
      address: string;
      createdAt: number;
    }>>();

    for (const failed of failedWithInscription) {
      const existing = failedByTokenId.get(failed.tokenId) || [];
      existing.push({
        _id: failed._id,
        inscriptionId: failed.inscriptionId,
        address: failed.address,
        createdAt: failed.createdAt,
      });
      failedByTokenId.set(failed.tokenId, existing);
    }

    // Step 4: Identify safe-to-fix event IDs and claims
    const safeToFixIds: string[] = [];
    const safeToFixClaims: Array<{
      collectionSlug: string;
      tokenId: number;
      inscriptionId: string;
    }> = [];
    const skipped: Array<{ tokenId: number; reason: string }> = [];

    for (const [tokenId, failedEvents] of failedByTokenId.entries()) {
      const minted = mintedByTokenId.get(tokenId);

      if (minted) {
        skipped.push({ tokenId, reason: "already_minted" });
        continue;
      }

      if (failedEvents.length > 1) {
        skipped.push({ tokenId, reason: "multiple_failed_inscriptions" });
        continue;
      }

      // Safe to fix - single failed inscription, not already minted
      const failedEvent = failedEvents[0];
      safeToFixIds.push(failedEvent._id);
      safeToFixClaims.push({
        collectionSlug: slug,
        tokenId,
        inscriptionId: failedEvent.inscriptionId,
      });
    }

    console.log(`Safe to fix: ${safeToFixIds.length}, Skipped: ${skipped.length}`);

    if (dryRun) {
      return {
        dryRun: true,
        safeToFixCount: safeToFixIds.length,
        skippedCount: skipped.length,
        message: "Dry run complete. Set dryRun=false to apply changes.",
        skippedSample: skipped.slice(0, 20),
      };
    }

    // Step 5: Apply fixes to events in batches
    let totalEventsFixed = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < safeToFixIds.length; i += BATCH_SIZE) {
      const batchIds = safeToFixIds.slice(i, i + BATCH_SIZE);
      const result = await ctx.runMutation(internal.adminReconcile.applySmartFixBatch, {
        eventIds: batchIds as any,
      });
      totalEventsFixed += result.fixed;
      console.log(`Fixed events batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.fixed} events (total: ${totalEventsFixed}/${safeToFixIds.length})`);
    }

    // Step 6: Apply fixes to collectionClaims in batches
    let totalClaimsFixed = 0;

    for (let i = 0; i < safeToFixClaims.length; i += BATCH_SIZE) {
      const batchClaims = safeToFixClaims.slice(i, i + BATCH_SIZE);
      const result = await ctx.runMutation(internal.adminReconcile.applySmartFixClaimsBatch, {
        updates: batchClaims,
      });
      totalClaimsFixed += result.fixed;
      console.log(`Fixed claims batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.fixed} claims (total: ${totalClaimsFixed}/${safeToFixClaims.length})`);
    }

    return {
      dryRun: false,
      totalEventsFixed,
      totalClaimsFixed,
      skippedCount: skipped.length,
      message: `Successfully fixed ${totalEventsFixed} events and ${totalClaimsFixed} claims`,
    };
  },
});

// Final verification after cleanup
export const verifyCleanup = action({
  args: {
    collectionSlug: v.optional(v.string()),
    supply: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug || "zgods";
    const supply = args.supply || 10000;

    console.log(`Starting cleanup verification for ${slug}...`);

    // Import allowlist functions
    const { getAllowlistEntries } = await import("./claimAllowlists");

    // Get all allowlist entries
    const allowlist = getAllowlistEntries(slug);
    const allowlistMap = new Map(allowlist.map(e => [e.address.toLowerCase(), e.max]));

    console.log(`Found ${allowlist.length} allowlist entries`);

    // Get all minted claims
    const allClaims = await ctx.runQuery(internal.adminReconcile.getAllMintedClaims, {
      collectionSlug: slug,
    });

    console.log(`Found ${allClaims.length} minted claims`);

    // Group by address and check for over-allocations
    const claimsByAddress = new Map<string, Array<{ tokenId: number; createdAt: number }>>();
    const allTokenIds = new Set<number>();
    const duplicateTokenIds = new Set<number>();

    for (const claim of allClaims) {
      const addr = claim.address.toLowerCase();
      if (!claimsByAddress.has(addr)) {
        claimsByAddress.set(addr, []);
      }
      claimsByAddress.get(addr)!.push({
        tokenId: claim.tokenId,
        createdAt: claim.createdAt || 0,
      });

      // Check for duplicates
      if (allTokenIds.has(claim.tokenId)) {
        duplicateTokenIds.add(claim.tokenId);
      }
      allTokenIds.add(claim.tokenId);
    }

    // Check for over-allocations
    const overAllocated: Array<{
      address: string;
      allocation: number;
      claimed: number;
      overBy: number;
    }> = [];

    for (const [address, claims] of claimsByAddress.entries()) {
      const allocation = allowlistMap.get(address) || 0;
      const claimed = claims.length;
      if (claimed > allocation) {
        overAllocated.push({
          address,
          allocation,
          claimed,
          overBy: claimed - allocation,
        });
      }
    }

    // Get available IDs (IDs from 0 to supply-1 that are not claimed)
    const availableIds: number[] = [];
    for (let i = 0; i < supply; i++) {
      if (!allTokenIds.has(i)) {
        availableIds.push(i);
      }
    }

    const totalClaimed = allTokenIds.size;
    const totalAvailable = availableIds.length;
    const totalAccounted = totalClaimed + totalAvailable;
    const isComplete = totalAccounted === supply;

    console.log(`Claimed: ${totalClaimed}, Available: ${totalAvailable}, Total: ${totalAccounted}`);
    console.log(`Over-allocated users: ${overAllocated.length}`);
    console.log(`Duplicate token IDs: ${duplicateTokenIds.size}`);
    console.log(`Cleanup complete: ${isComplete ? 'YES ✅' : 'NO ❌'}`);

    return {
      summary: {
        totalSupply: supply,
        claimedCount: totalClaimed,
        availableCount: totalAvailable,
        totalAccounted,
        isComplete,
        overAllocatedUsers: overAllocated.length,
        duplicateTokens: duplicateTokenIds.size,
      },
      overAllocated: overAllocated.slice(0, 20),
      duplicates: Array.from(duplicateTokenIds).slice(0, 50),
      availableIds: availableIds.slice(0, 100),
      message: isComplete && overAllocated.length === 0 && duplicateTokenIds.size === 0
        ? "✅ Cleanup verification PASSED! All tokens accounted for, no over-allocations, no duplicates."
        : "⚠️ Issues found - see details above",
    };
  },
});

export const getAllMintedClaims = query({
  args: {
    collectionSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();
    return await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) =>
        q.eq("collectionSlug", slug).eq("status", "minted")
      )
      .collect();
  },
});

export const getStatusCounts = query({
  args: {
    collectionSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();
    const all = await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) => q.eq("collectionSlug", slug))
      .collect();

    const counts = {
      minted: 0,
      reserved: 0,
      failed: 0,
      total: all.length,
    };

    const reserved: any[] = [];
    for (const claim of all) {
      if (claim.status === "minted") counts.minted++;
      else if (claim.status === "reserved") {
        counts.reserved++;
        reserved.push(claim);
      }
      else if (claim.status === "failed") counts.failed++;
    }

    return { ...counts, reservedTokens: reserved };
  },
});

export const analyzeFailedClaims = query({
  args: {
    collectionSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const slug = args.collectionSlug.toLowerCase();
    const failed = await ctx.db
      .query("collectionClaims")
      .withIndex("by_collection_status", (q) =>
        q.eq("collectionSlug", slug).eq("status", "failed")
      )
      .collect();

    const errorCounts = new Map<string, number>();
    const errorSamples = new Map<string, any[]>();

    for (const claim of failed) {
      const error = claim.lastError || "No error message";
      errorCounts.set(error, (errorCounts.get(error) || 0) + 1);

      const samples = errorSamples.get(error) || [];
      if (samples.length < 3) {
        samples.push({
          tokenId: claim.tokenId,
          address: claim.address,
          createdAt: claim.createdAt,
          attempts: claim.attempts,
        });
        errorSamples.set(error, samples);
      }
    }

    const breakdown = Array.from(errorCounts.entries()).map(([error, count]) => ({
      error,
      count,
      samples: errorSamples.get(error) || [],
    })).sort((a, b) => b.count - a.count);

    return {
      totalFailed: failed.length,
      uniqueErrorTypes: errorCounts.size,
      breakdown,
    };
  },
});

