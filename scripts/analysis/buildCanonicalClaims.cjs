const fs = require('fs');
const path = require('path');
const readline = require('readline');

const COLLECTION = 'zgods';
const RESERVATION_TTL_MS = 15 * 60 * 1000;
const CSV_PATH = path.join('temp', 'analysis', 'zgods_address_claims.csv');
const CLAIMS_PATH = path.join('temp', 'snapshots', 'collectionClaims', 'documents.jsonl');
const MINTED_PATH = path.join('temp', 'reports', 'zgods-minted-with-inscriptions.json');
const OUTPUT_CANONICAL = path.join('temp', 'reports', 'zgods-canonical-claims.json');
const OUTPUT_STATS = path.join('temp', 'reports', 'zgods-claim-stats.json');

if (!fs.existsSync(CSV_PATH)) {
  console.error('Missing CSV input:', CSV_PATH);
  process.exit(1);
}
if (!fs.existsSync(CLAIMS_PATH)) {
  console.error('Missing claims snapshot:', CLAIMS_PATH);
  process.exit(1);
}
if (!fs.existsSync(MINTED_PATH)) {
  console.error('Missing minted report:', MINTED_PATH);
  process.exit(1);
}

function parseCsv(content) {
  const rows = [];
  const headers = [];
  let currentValue = '';
  let currentRow = [];
  let inQuotes = false;
  const pushValue = () => {
    currentRow.push(currentValue);
    currentValue = '';
  };
  const pushRow = () => {
    if (!currentRow.length || (currentRow.length === 1 && currentRow[0] === '')) return;
    if (!headers.length) {
      headers.push(...currentRow);
    } else {
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = currentRow[idx] ?? '';
      });
      rows.push(row);
    }
  };

  const input = content.replace(/\r/g, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (inQuotes && input[i + 1] === '"') {
        currentValue += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      pushValue();
    } else if (char === '\n' && !inQuotes) {
      pushValue();
      pushRow();
      currentRow = [];
    } else {
      currentValue += char;
    }
  }
  if (currentValue.length || currentRow.length) {
    pushValue();
    pushRow();
  }
  return rows;
}

function parseTokenList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
}

function normalizeAddress(address) {
  return (address || '').toLowerCase();
}

async function loadClaimsSnapshot() {
  const map = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(CLAIMS_PATH),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const doc = JSON.parse(line);
    if (doc.collectionSlug !== COLLECTION) continue;
    if (!map.has(doc.tokenId)) {
      map.set(doc.tokenId, []);
    }
    map.get(doc.tokenId).push(doc);
  }
  return map;
}

function pickLatestDoc(docs, predicate = () => true) {
  if (!docs || !docs.length) return null;
  const filtered = docs.filter(predicate);
  if (!filtered.length) return null;
  return filtered.sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))[0];
}

function fromDoc(doc) {
  if (!doc) return null;
  const status = doc.status;
  const reservedAt = status === 'reserved' ? doc.updatedAt ?? doc.createdAt ?? null : null;
  const reservationExpiresAt = reservedAt ? reservedAt + RESERVATION_TTL_MS : null;
  const mintedAt = status === 'minted' ? doc.updatedAt ?? doc.createdAt ?? null : null;
  return {
    collectionSlug: doc.collectionSlug,
    tokenId: doc.tokenId,
    status,
    address: normalizeAddress(doc.address),
    batchId: doc.batchId ?? null,
    reservedAt,
    reservationExpiresAt,
    mintedAt,
    inscriptionId: doc.inscriptionId ?? null,
    txid: doc.txid ?? null,
    attempts: doc.attempts ?? 0,
    lastError: doc.lastError ?? null,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}

function fromMintedEntry(entry, fallbackDoc) {
  const base = fallbackDoc ? fromDoc(fallbackDoc) : null;
  const mintedAt = entry.updatedAt ?? base?.mintedAt ?? null;
  return {
    collectionSlug: COLLECTION,
    tokenId: entry.tokenId,
    status: 'minted',
    address: normalizeAddress(entry.address),
    batchId: entry.batchId ?? base?.batchId ?? null,
    reservedAt: base?.reservedAt ?? null,
    reservationExpiresAt: null,
    mintedAt,
    inscriptionId: entry.inscriptionId ?? base?.inscriptionId ?? null,
    txid: entry.txid ?? base?.txid ?? null,
    attempts: base?.attempts ?? 0,
    lastError: base?.lastError ?? null,
    createdAt: base?.createdAt ?? entry.updatedAt ?? null,
    updatedAt: Math.max(base?.updatedAt ?? 0, entry.updatedAt ?? 0) || entry.updatedAt || base?.updatedAt || null,
  };
}

(async () => {
  const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
  const csvRows = parseCsv(csvContent);
  const mintedRaw = JSON.parse(fs.readFileSync(MINTED_PATH, 'utf8'));
  const claimsByToken = await loadClaimsSnapshot();

  const mintedByToken = new Map();
  mintedRaw.forEach((entry) => {
    const tokenId = Number(entry.tokenId);
    mintedByToken.set(tokenId, {
      tokenId,
      inscriptionId: entry.inscriptionId ?? null,
      address: normalizeAddress(entry.address),
      txid: entry.txid ?? null,
      batchId: entry.batchId ?? null,
      updatedAt: entry.updatedAt ?? null,
    });
  });

  const canonical = new Map();
  const warnings = [];

  // Seed minted entries first so they always win
  for (const [tokenId, data] of mintedByToken.entries()) {
    const docs = claimsByToken.get(tokenId) ?? [];
    const mintedDoc = pickLatestDoc(docs, (doc) => doc.status === 'minted');
    canonical.set(tokenId, fromMintedEntry(data, mintedDoc));
  }

  // Process CSV rows for reserved/failure context
  for (const row of csvRows) {
    const address = normalizeAddress(row.address);
    const reservedTokens = parseTokenList(row.reservedTokens);
    for (const tokenId of reservedTokens) {
      if (canonical.has(tokenId)) continue; // minted already captured
      const docs = claimsByToken.get(tokenId) ?? [];
      const reservedDoc = pickLatestDoc(
        docs,
        (doc) => doc.status === 'reserved' && normalizeAddress(doc.address) === address
      );
      if (reservedDoc) {
        canonical.set(tokenId, fromDoc(reservedDoc));
      } else {
        warnings.push(`Reserved token ${tokenId} for ${address} missing doc; synthesizing.`);
        const now = Date.now();
        canonical.set(tokenId, {
          collectionSlug: COLLECTION,
          tokenId,
          status: 'reserved',
          address,
          batchId: null,
          reservedAt: now,
          reservationExpiresAt: now + RESERVATION_TTL_MS,
          mintedAt: null,
          inscriptionId: null,
          txid: null,
          attempts: 0,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  // Fill remaining tokens from snapshot
  for (const [tokenId, docs] of claimsByToken.entries()) {
    if (canonical.has(tokenId)) continue;
    const doc = pickLatestDoc(docs);
    const entry = fromDoc(doc);
    if (entry) {
      canonical.set(tokenId, entry);
    }
  }

  const canonicalList = Array.from(canonical.values()).sort((a, b) => a.tokenId - b.tokenId);

  const statsByAddress = new Map();
  for (const entry of canonicalList) {
    const addr = entry.address;
    if (!addr) continue;
    if (!statsByAddress.has(addr)) {
      statsByAddress.set(addr, {
        address: addr,
        mintedCount: 0,
        mintedTokens: [],
        reservedCount: 0,
        reservedTokens: [],
        failedCount: 0,
        failedTokens: [],
      });
    }
    const stat = statsByAddress.get(addr);
    if (entry.status === 'minted') {
      stat.mintedCount += 1;
      stat.mintedTokens.push(entry.tokenId);
    } else if (entry.status === 'reserved') {
      stat.reservedCount += 1;
      stat.reservedTokens.push(entry.tokenId);
    } else if (entry.status === 'failed') {
      stat.failedCount += 1;
      stat.failedTokens.push(entry.tokenId);
    }
  }

  const statsList = Array.from(statsByAddress.values()).sort((a, b) => a.address.localeCompare(b.address));

  const canonicalPayload = {
    generatedAt: new Date().toISOString(),
    collection: COLLECTION,
    tokens: canonicalList,
    warnings,
  };
  const statsPayload = {
    generatedAt: canonicalPayload.generatedAt,
    collection: COLLECTION,
    wallets: statsList,
  };

  fs.writeFileSync(OUTPUT_CANONICAL, JSON.stringify(canonicalPayload, null, 2));
  fs.writeFileSync(OUTPUT_STATS, JSON.stringify(statsPayload, null, 2));

  console.log('Canonical tokens:', canonicalList.length);
  console.log('Wallet stats:', statsList.length);
  if (warnings.length) {
    console.log('Warnings:', warnings.length);
    warnings.slice(0, 10).forEach((w) => console.log(' -', w));
  }
})();
