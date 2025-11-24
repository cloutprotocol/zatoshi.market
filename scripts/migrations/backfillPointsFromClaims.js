#!/usr/bin/env node
/**
 * Backfill minted points for a collection by replaying minted collectionClaims rows.
 *
 * Usage:
 *   CONVEX_URL="https://your.convex.cloud" node scripts/migrations/backfillPointsFromClaims.js --slug zgods
 *
 * Optional flags:
 *   --batch 200            Number of minted docs to process per call (default 200)
 *   --start <timestamp>    Resume cursor (ms since epoch, defaults to 0)
 *   --once                 Run a single batch instead of looping until completion
 */

const { ConvexHttpClient } = require("convex/browser");
const { api } = require("../../convex/_generated/api");

const CONVEX_URL =
  process.env.CONVEX_URL ||
  process.env.NEXT_PUBLIC_CONVEX_URL ||
  process.env.NEXT_PUBLIC_CONVEX_URL_DEV ||
  process.env.NEXT_PUBLIC_CONVEX_URL_PROD;

if (!CONVEX_URL) {
  console.error("Missing CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL[_DEV|PROD]) env var.");
  process.exit(1);
}

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function main() {
  const slug = getArgValue("--slug") || process.env.COLLECTION_SLUG;
  if (!slug) {
    console.error("--slug or COLLECTION_SLUG env var is required");
    process.exit(1);
  }

  const batchSize = parseInt(getArgValue("--batch") || process.env.BATCH_SIZE || "200", 10);
  let cursor = parseInt(getArgValue("--start") || process.env.START_CURSOR || "0", 10) || 0;
  const once = hasFlag("--once");

  const client = new ConvexHttpClient(CONVEX_URL);
  console.log(
    `Backfilling points for ${slug} with batchSize=${batchSize}, starting cursor=${cursor || 0}${once ? " (single run)" : ""}`
  );

  while (true) {
    const result = await client.mutation(api.adminReconcile.awardPointsForMintHistory, {
      collectionSlug: slug,
      afterUpdatedAt: cursor || undefined,
      batchSize,
    });

    console.log(
      `Processed=${result.processed} awarded=${result.awarded} nextCursor=${result.nextCursor} done=${result.done}`
    );

    if (!result.processed || result.done || once) {
      break;
    }

    cursor = result.nextCursor || cursor;
  }

  console.log("Backfill complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
