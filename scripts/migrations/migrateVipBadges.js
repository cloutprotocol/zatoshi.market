#!/usr/bin/env node
/**
 * Migration script to move VIP flags from the local allowlist JSON into Convex userBadges.
 *
 * Usage:
 *   CONVEX_URL="https://your.convex.cloud" node scripts/migrations/migrateVipBadges.js [--file path]
 */

const fs = require("node:fs");
const path = require("node:path");
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

function loadAllowlist(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  return Object.entries(data)
    .filter(([, value]) => value && value.isVip)
    .map(([address]) => (address || "").toLowerCase());
}

async function main() {
  const file = getArgValue("--file") || path.join(process.cwd(), "convex", "whitelists", "zgods.json");
  const badgeSlug = process.env.VIP_BADGE_SLUG || "vip";
  const source = process.env.VIP_BADGE_SOURCE || "whitelist:zgods";
  const reason = process.env.VIP_BADGE_REASON || "ZGODS VIP allocation";
  const label = process.env.VIP_BADGE_LABEL || "VIP";
  const batchSize = parseInt(process.env.BATCH_SIZE || "200", 10);

  if (!fs.existsSync(file)) {
    console.error(`Allowlist file not found: ${file}`);
    process.exit(1);
  }

  const vipAddresses = [...new Set(loadAllowlist(file))];
  if (!vipAddresses.length) {
    console.log("No VIP addresses detected in allowlist.");
    return;
  }

  console.log(`Migrating ${vipAddresses.length} VIP entries from ${file}`);
  const client = new ConvexHttpClient(CONVEX_URL);

  for (let i = 0; i < vipAddresses.length; i += batchSize) {
    const chunk = vipAddresses.slice(i, i + batchSize);
    await Promise.all(
      chunk.map((address) =>
        client.mutation(api.badges.grantBadge, {
          address,
          badgeSlug,
          source,
          reason,
          label,
        })
      )
    );
    console.log(`Granted badges for ${Math.min(i + batchSize, vipAddresses.length)} / ${vipAddresses.length}`);
  }

  console.log("VIP migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
