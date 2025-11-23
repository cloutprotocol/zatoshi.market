const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CANONICAL_PATH = path.join('temp', 'reports', 'zgods-canonical-claims.json');
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 40);
const functionName = 'adminReconcile:applyInscribedMints';

if (!fs.existsSync(CANONICAL_PATH)) {
  console.error('Missing canonical file at', CANONICAL_PATH);
  process.exit(1);
}
const canonical = JSON.parse(fs.readFileSync(CANONICAL_PATH, 'utf8'));
if (!Array.isArray(canonical.tokens)) {
  console.error('Canonical file malformed.');
  process.exit(1);
}

const minted = canonical.tokens.filter((entry) => entry.status === 'minted');
console.log('Total minted entries:', minted.length);

const updates = minted.map((entry) => {
  const update = {
    tokenId: entry.tokenId,
    address: entry.address,
    inscriptionId: entry.inscriptionId,
  };
  if (entry.txid) update.txid = entry.txid;
  if (entry.batchId) update.batchId = entry.batchId;
  return update;
});

let chunkIndex = 0;
for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
  const chunk = updates.slice(i, i + CHUNK_SIZE);
  chunkIndex += 1;
  console.log(`\n[Chunk ${chunkIndex}] Sending ${chunk.length} minted records...`);
  const result = spawnSync('npx', ['convex', 'run', functionName, JSON.stringify({ collectionSlug: canonical.collection, updates: chunk, force: true })], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error('Chunk failed; aborting.');
    process.exit(result.status || 1);
  }
}

console.log('\nAll minted records applied.');
