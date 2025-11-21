/**
 * Seed VIP badges from whitelist.csv.
 *
 * Usage:
 *   CONVEX_URL="https://your.convex.cloud" node scripts/badges/seedVipFromWhitelist.js
 *
 * Optional args:
 *   --file /path/to/whitelist.csv (defaults to public/collections/zgods/claim/whitelist.csv)
 *
 * Notes:
 * - Sends addresses where the 4th CSV column is "true" to the Convex action
 *   `badgesActions.grantBadgesFromList` in batches of 1000.
 * - Requires badgesActions.grantBadgesFromList to be deployed.
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
  console.error("Missing CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL[_DEV|_PROD]) env var.");
  process.exit(1);
}

function parseArgs() {
  const fileFlagIndex = process.argv.indexOf("--file");
  const file =
    fileFlagIndex !== -1 && process.argv[fileFlagIndex + 1]
      ? process.argv[fileFlagIndex + 1]
      : path.join(process.cwd(), "public", "collections", "zgods", "claim", "whitelist.csv");
  return { file };
}

function readWhitelist(filePath) {
  const csv = fs.readFileSync(filePath, "utf8");
  const lines = csv.trim().split("\n");
  // Expect: address,valid_mints,overflow_zec,zero_holder
  const addresses = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 4) continue;
    const address = cols[0]?.trim();
    const vipFlag = cols[3]?.trim().toLowerCase();
    if (address && vipFlag === "true") {
      addresses.push(address);
    }
  }
  return addresses;
}

async function main() {
  const { file } = parseArgs();
  if (!fs.existsSync(file)) {
    console.error(`Whitelist file not found: ${file}`);
    process.exit(1);
  }

  const addresses = readWhitelist(file);
  const unique = [...new Set(addresses)];
  if (!unique.length) {
    console.log("No VIP addresses found.");
    return;
  }

  console.log(`Found ${unique.length} VIP addresses. Sending to Convex...`);
  const client = new ConvexHttpClient(CONVEX_URL);
  const BATCH = 1000;
  let sent = 0;

  for (let i = 0; i < unique.length; i += BATCH) {
    const slice = unique.slice(i, i + BATCH);
    await client.action(api.badgesActions.grantBadgesFromList, {
      badgeSlug: "vip",
      addresses: slice,
      source: "whitelist:zgods",
      reason: "VIP whitelist flag",
      label: "VIP",
    });
    sent += slice.length;
    console.log(`Granted batch ${i / BATCH + 1} (${sent}/${unique.length})`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
