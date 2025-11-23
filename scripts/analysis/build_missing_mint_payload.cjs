const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SLUG = process.env.SLUG || 'zgods';
const CSV_PATH = path.join('temp', 'analysis', `${SLUG}_inscribed_missing_mint.csv`);
const EVENTS_PATH = path.join('temp', 'snapshots', 'collectionClaimEvents', 'documents.jsonl');
const OUTPUT_PATH = path.join('temp', 'analysis', `${SLUG}_missing_mint_payload.json`);

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseCsv(content) {
  const rows = content.replace(/\r/g, '').split('\n').filter(Boolean);
  if (!rows.length) return [];
  const headers = parseCsvLine(rows[0]);
  const entries = [];
  for (let i = 1; i < rows.length; i += 1) {
    const columns = parseCsvLine(rows[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = columns[idx] ?? '';
    });
    entries.push(row);
  }
  return entries;
}

function normalizeAddress(address) {
  return (address || '').toLowerCase();
}

async function loadEventsMap() {
  const rl = readline.createInterface({
    input: fs.createReadStream(EVENTS_PATH),
    crlfDelay: Infinity,
  });
  const map = new Map();
  for await (const line of rl) {
    if (!line.trim()) continue;
    const doc = JSON.parse(line);
    if (doc.collectionSlug !== SLUG) continue;
    if (!doc.inscriptionId) continue;
    const tokenId = Number(doc.tokenId);
    if (!map.has(tokenId)) map.set(tokenId, []);
    map.get(tokenId).push(doc);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }
  return map;
}

(async () => {
  if (!fs.existsSync(CSV_PATH)) {
    console.error('Missing CSV at', CSV_PATH);
    process.exit(1);
  }
  if (!fs.existsSync(EVENTS_PATH)) {
    console.error('Missing events snapshot at', EVENTS_PATH);
    process.exit(1);
  }

  const csvEntries = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
  const eventsMap = await loadEventsMap();

  const updates = [];
  const skipped = [];
  for (const entry of csvEntries) {
    const tokenId = Number(entry.tokenId);
    const inscriptionCount = Number(entry.inscriptionCount || 0);
    const addresses = (entry.inscriptionAddresses || '')
      .split(',')
      .map((a) => normalizeAddress(a.trim()))
      .filter(Boolean);
    const finalAddress = normalizeAddress(entry.finalAddress);

    if (!tokenId) continue;
    if (inscriptionCount > 1 || addresses.length > 1) {
      skipped.push({ tokenId, reason: 'duplicate_inscriptions', addresses });
      continue;
    }
    const events = eventsMap.get(tokenId) || [];
    const matchingEvent = events.find((event) => normalizeAddress(event.address) === (finalAddress || addresses[0]));
    if (!matchingEvent) {
      skipped.push({ tokenId, reason: 'missing_event' });
      continue;
    }
    updates.push({
      tokenId,
      address: finalAddress || addresses[0],
      inscriptionId: matchingEvent.inscriptionId,
      txid: matchingEvent.txid ?? undefined,
      batchId: matchingEvent.batchId ?? undefined,
    });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    collection: SLUG,
    totalCandidates: csvEntries.length,
    updates,
    skipped,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log('Wrote payload with', updates.length, 'updates and', skipped.length, 'skipped tokens to', OUTPUT_PATH);
})();
