#!/usr/bin/env node
/**
 * Read-only claim audit from Convex table exports + whitelist CSV.
 *
 * Usage:
 *   node scripts/audit/audit-from-export.js \
 *     --slug zgods \
 *     --claims temp/collectionClaims.json \
 *     --events temp/collectionClaimEvents.json \
 *     --whitelist public/collections/zgods/claim/whitelist.csv \
 *     [--supply 10000]
 *
 * Notes:
 * - This script does not contact Convex. Export tables from the Convex Dashboard:
 *   Data -> collectionClaims -> Export JSON
 *   Data -> collectionClaimEvents -> Export JSON
 * - Whitelist is a CSV with headers: address,max,...,isVip
 */
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text);
}

function readWhitelistCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  // Expect header: address,max,...,isVip
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw) continue;
    const cols = raw.split(',').map(s => s.trim());
    if (cols.length < 2) continue;
    const address = cols[0]?.toLowerCase();
    const max = Number(cols[1]) || 0;
    const isVip = (cols[3] || '').toLowerCase() === 'true';
    if (address) map.set(address, { max, isVip });
  }
  return map;
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const it of arr) {
    const k = keyFn(it);
    m.set(k, (m.get(k) || []).concat([it]));
  }
  return m;
}

function topCounts(strings, topN = 10) {
  const m = new Map();
  for (const s of strings) {
    if (!s) continue;
    m.set(s, (m.get(s) || 0) + 1);
  }
  return Array.from(m.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([value, count]) => ({ value, count }));
}

function main() {
  const args = parseArgs();
  const slug = String(args.slug || '').toLowerCase();
  if (!slug) {
    console.error('Missing --slug');
    process.exit(1);
  }
  if (!args.claims || !args.events || !args.whitelist) {
    console.error('Usage: --slug <slug> --claims <claims.json> --events <events.json> --whitelist <whitelist.csv> [--supply <n>]');
    process.exit(1);
  }
  const supply = args.supply ? Number(args.supply) : undefined;

  const claims = readJson(args.claims).filter(c => (c.collectionSlug || '').toLowerCase() === slug);
  const events = readJson(args.events).filter(e => (e.collectionSlug || '').toLowerCase() === slug);
  const whitelist = readWhitelistCsv(args.whitelist);

  const minted = claims.filter(c => c.status === 'minted');
  const reserved = claims.filter(c => c.status === 'reserved');
  const failed = claims.filter(c => c.status === 'failed');

  // Per address minted counts
  const mintedByAddr = groupBy(minted, (c) => (c.address || '').toLowerCase());
  const mintedCounts = Array.from(mintedByAddr.entries()).map(([addr, list]) => ({ address: addr, count: list.length }));
  mintedCounts.sort((a, b) => b.count - a.count);

  // Over-allocation and not-in-whitelist
  const overAllocated = [];
  const notWhitelisted = [];
  for (const { address, count } of mintedCounts) {
    const wl = whitelist.get(address);
    if (!wl) {
      notWhitelisted.push({ address, minted: count });
      continue;
    }
    if (count > wl.max) {
      overAllocated.push({ address, minted: count, allocation: wl.max, vip: wl.isVip });
    }
  }

  // Duplicate minted tokenIds (should not happen)
  const tokenIdMap = new Map();
  const duplicateMintedTokenIds = [];
  for (const m of minted) {
    const key = String(m.tokenId);
    if (tokenIdMap.has(key)) duplicateMintedTokenIds.push({ tokenId: m.tokenId, addresses: [tokenIdMap.get(key), m.address] });
    else tokenIdMap.set(key, m.address);
  }

  // Stale reservations: older than 15 minutes and not minted
  const now = Date.now();
  const FIFTEEN_MIN = 15 * 60 * 1000;
  const reservedStale = reserved.filter(r => (now - (r.updatedAt || r.createdAt || 0)) > FIFTEEN_MIN);

  // Top errors (claims.lastError and events.message)
  const topClaimErrors = topCounts(failed.map(f => (f.lastError || '').trim()), 10);
  const topEventMessages = topCounts(events.map(e => (e.message || '').trim()), 10);

  const summary = {
    collection: slug,
    supply: supply ?? null,
    totals: {
      claims: claims.length,
      minted: minted.length,
      reserved: reserved.length,
      failed: failed.length,
    },
    mintedProgress: supply ? `${minted.length} / ${supply} (${((minted.length / supply) * 100).toFixed(2)}%)` : `${minted.length}`,
    overAllocated,
    notWhitelisted,
    duplicateMintedTokenIds,
    reservedStale: reservedStale.slice(0, 50).map(r => ({ tokenId: r.tokenId, address: r.address, updatedAt: r.updatedAt })),
    topClaimErrors,
    topEventMessages,
    topMinters: mintedCounts.slice(0, 20),
  };

  const outDir = path.join(process.cwd(), 'docs', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `claim-audit-${slug}-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

  console.log('=== Claim Audit Summary ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nSaved report: ${outPath}`);
}

main();

