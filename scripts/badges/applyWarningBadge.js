#!/usr/bin/env node
/**
 * Apply warning badges to a list of wallet addresses.
 *
 * Usage:
 *   CONVEX_URL="https://your.convex.cloud" node scripts/badges/applyWarningBadge.js --level 1 --file temp/warnings.txt
 *
 * Optional args:
 *   --level <n>          Warning level (default 1)
 *   --reason "text"      Stored on userBadges.reason
 *   --file path          Text file with one address per line (additional columns ignored)
 *   --addresses "a,b,c"  Comma-separated addresses (overrides file)
 *   --dry-run            Print instead of mutating
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

function getArg(flag, defaultValue) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return defaultValue;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function parseAddresses({ file, inline }) {
  if (inline) {
    return inline
      .split(/[,\\s]+/)
      .map((addr) => addr.trim().toLowerCase())
      .filter((addr) => /^t1[a-z0-9]{10,}$/i.test(addr));
  }

  const resolved = file
    ? file
    : path.join(process.cwd(), "temp", "warning-addresses.txt");
  if (!fs.existsSync(resolved)) {
    console.error(`Address file not found: ${resolved}`);
    process.exit(1);
  }
  const text = fs.readFileSync(resolved, "utf8");
  const list = [];
  text.split(/\\r?\\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const match = trimmed.match(/t1[a-z0-9]{10,}/i);
    if (match) {
      list.push(match[0].toLowerCase());
    }
  });
  return [...new Set(list)];
}

async function main() {
  const level = parseInt(getArg("--level", "1"), 10) || 1;
  const reasonArg = getArg("--reason", `Warning - Level ${level}`);
  const addressList = parseAddresses({
    file: getArg("--file"),
    inline: getArg("--addresses"),
  });
  const dryRun = hasFlag("--dry-run");

  if (!addressList.length) {
    console.log("No addresses provided.");
    return;
  }

  console.log(`Preparing to grant Warning Level ${level} to ${addressList.length} addresses${dryRun ? " (dry run)" : ""}.`);

  if (dryRun) {
    console.log(addressList.join("\\n"));
    return;
  }

  const client = new ConvexHttpClient(CONVEX_URL);
  const slug = `warning-level-${level}`;
  const label = `Warning | Level ${level}`;
  const source = `abuse-monitor:l${level}`;

  for (const address of addressList) {
    try {
      await client.mutation(api.badges.grantBadge, {
        address,
        badgeSlug: slug,
        source,
        reason: reasonArg,
        label,
      });
      console.log(`Granted ${slug} to ${address}`);
    } catch (err) {
      console.error(`Failed for ${address}:`, err?.message || err);
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
