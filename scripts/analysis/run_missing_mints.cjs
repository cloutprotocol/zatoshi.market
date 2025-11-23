#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SLUG = process.env.SLUG || 'zgods';
const PAYLOAD_PATH = path.join('temp', 'analysis', `${SLUG}_missing_mint_payload.json`);
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 50);

if (!fs.existsSync(PAYLOAD_PATH)) {
  console.error('Missing payload file at', PAYLOAD_PATH);
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(PAYLOAD_PATH, 'utf8'));
if (!Array.isArray(payload.updates) || payload.updates.length === 0) {
  console.error('Payload has no updates. Run build_missing_mint_payload.cjs first.');
  process.exit(1);
}

console.log(`Applying ${payload.updates.length} mint reconciliations in chunks of ${CHUNK_SIZE}...`);

let chunkIndex = 0;
for (let i = 0; i < payload.updates.length; i += CHUNK_SIZE) {
  const chunk = payload.updates.slice(i, i + CHUNK_SIZE);
  chunkIndex += 1;
  const args = {
    collectionSlug: payload.collection,
    updates: chunk,
  };
  console.log(`\n[Chunk ${chunkIndex}] Applying ${chunk.length} updates...`);
  const result = spawnSync('npx', ['convex', 'run', 'adminReconcile:applyInscribedMints', JSON.stringify(args)], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error('Chunk failed, aborting.');
    process.exit(result.status || 1);
  }
}

console.log('\nCompleted all chunks.');
