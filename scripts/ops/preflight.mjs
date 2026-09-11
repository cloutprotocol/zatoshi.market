#!/usr/bin/env node
/**
 * Inscription service preflight.
 *
 * Checks every external dependency of the submit -> broadcast -> confirm -> status path
 * and prints PASS/WARN/FAIL per dependency. Exit code 1 if any hard dependency FAILs.
 *
 *   node scripts/ops/preflight.mjs                # reads .env.local if present
 *   SITE_URL=https://www.zatoshi.market node scripts/ops/preflight.mjs
 *
 * Nothing here signs or broadcasts; all calls are read-only.
 */

import { readFileSync, existsSync } from 'node:fs';

// Minimal .env.local loader (no dependency on dotenv)
for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const RPC_URL = process.env.NEXT_PUBLIC_ZCASH_RPC_URL || 'https://rpc.zatoshi.market/api/rpc';
const INDEXER = (process.env.ORDINAL_INDEX_API_BASE || process.env.NEXT_PUBLIC_ORDINAL_INDEX_API || 'http://135.181.6.234:3333').replace(/\/$/, '');
const CONVEX = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL_PROD || process.env.NEXT_PUBLIC_CONVEX_URL_DEV || '';
const SITE = (process.env.SITE_URL || '').replace(/\/$/, '');
const TATUM_KEY = process.env.TATUM_API_KEY || '';
const TIMEOUT = 10000;

const results = [];
const record = (name, level, detail) => { results.push({ name, level, detail }); console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`); };

async function fetchJson(url, init = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { }
  return { status: r.status, json, text };
}

function rpcBody(method, params = []) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'preflight', method, params }) };
}

// 1. Primary RPC proxy (rpc.zatoshi.market -> node)
let liveBranchId = null;
try {
  const headers = {};
  if (process.env.ZCASH_RPC_USERNAME && process.env.ZCASH_RPC_PASSWORD) {
    headers.Authorization = 'Basic ' + Buffer.from(`${process.env.ZCASH_RPC_USERNAME}:${process.env.ZCASH_RPC_PASSWORD}`).toString('base64');
  }
  const init = rpcBody('getblockchaininfo'); init.headers = { ...init.headers, ...headers };
  const r = await fetchJson(RPC_URL, init);
  const res = r.json?.result;
  if (res?.blocks && res?.consensus?.nextblock) {
    liveBranchId = res.consensus.nextblock;
    record('primary RPC', 'PASS', `${RPC_URL} height=${res.blocks} nextblock=0x${liveBranchId}`);
  } else {
    record('primary RPC', 'FAIL', `${RPC_URL} HTTP ${r.status}: ${(r.json?.error?.message || r.text).slice(0, 120)}`);
  }
} catch (e) {
  record('primary RPC', 'FAIL', `${RPC_URL}: ${e.message}`);
}

// 2. Tatum fallback (branch id, getrawtransaction, sendrawtransaction)
if (!TATUM_KEY) {
  record('Tatum fallback', 'WARN', 'TATUM_API_KEY unset; broadcast/branch-id fallback disabled');
} else {
  try {
    const init = rpcBody('getblockchaininfo'); init.headers['x-api-key'] = TATUM_KEY;
    const r = await fetchJson('https://api.tatum.io/v3/blockchain/node/zcash-mainnet', init);
    const res = r.json?.result;
    if (res?.consensus?.nextblock) {
      if (!liveBranchId) liveBranchId = res.consensus.nextblock;
      record('Tatum fallback', 'PASS', `height=${res.blocks} nextblock=0x${res.consensus.nextblock}`);
    } else record('Tatum fallback', 'FAIL', `HTTP ${r.status}: ${r.text.slice(0, 120)}`);
  } catch (e) { record('Tatum fallback', 'FAIL', e.message); }
}

// 3. Blockchair fallback (UTXOs, tx lookup, push)
try {
  const key = process.env.BLOCKCHAIR_API_KEY ? `?key=${process.env.BLOCKCHAIR_API_KEY}` : '';
  const r = await fetchJson(`https://api.blockchair.com/zcash/stats${key}`);
  const h = r.json?.data?.best_block_height;
  if (h) record('Blockchair fallback', 'PASS', `height=${h}`);
  else record('Blockchair fallback', 'WARN', `HTTP ${r.status}`);
} catch (e) { record('Blockchair fallback', 'WARN', e.message); }

// 4. Consensus branch id sanity: whatever the code would sign with must equal the live network
if (liveBranchId) {
  const env = process.env.ZCASH_CONSENSUS_BRANCH_ID;
  if (env) {
    const envHex = (env.startsWith('0x') ? parseInt(env.slice(2), 16) : Number(env)).toString(16).padStart(8, '0');
    record('branch id override', envHex === liveBranchId ? 'PASS' : 'FAIL', `ZCASH_CONSENSUS_BRANCH_ID=0x${envHex} live=0x${liveBranchId}`);
  } else record('branch id', 'PASS', `resolved live (0x${liveBranchId}); no override set`);
} else record('branch id', 'FAIL', 'no provider returned consensus.nextblock; signatures would use the last-known constant');

// 5. Indexer (zord)
try {
  const r = await fetchJson(`${INDEXER}/api/v1/healthz`);
  const j = r.json;
  if (j?.height !== undefined) {
    const lag = (j.chain_tip ?? 0) - (j.height ?? 0);
    record('indexer healthz', lag <= 2 ? 'PASS' : 'WARN', `${INDEXER} height=${j.height} tip=${j.chain_tip} lag=${lag} synced=${j.synced}`);
  } else record('indexer healthz', 'FAIL', `${INDEXER} HTTP ${r.status}`);
} catch (e) { record('indexer healthz', 'FAIL', `${INDEXER}: ${e.message}`); }

// 6. Convex (status tracker + mint actions live here)
if (!CONVEX) record('Convex', 'FAIL', 'NEXT_PUBLIC_CONVEX_URL unset');
else {
  try {
    const r = await fetch(`${CONVEX}/version`, { signal: AbortSignal.timeout(TIMEOUT) });
    record('Convex', r.ok ? 'PASS' : 'FAIL', `${CONVEX} HTTP ${r.status}`);
  } catch (e) { record('Convex', 'FAIL', `${CONVEX}: ${e.message}`); }
}

// 7. Site routes (optional)
if (SITE) {
  for (const path of ['/api/zcash/node-status', '/api/inscriptions?page=0&limit=1', '/api/inscriptions/status/0000000000000000000000000000000000000000000000000000000000000000i0']) {
    try {
      const r = await fetchJson(`${SITE}${path}`);
      const ok = path.startsWith('/api/inscriptions/status') ? r.status === 404 : r.status === 200;
      record(`site ${path.split('?')[0]}`, ok ? 'PASS' : 'WARN', `HTTP ${r.status} ${(r.json?.error || '').toString().slice(0, 60)}`);
    } catch (e) { record(`site ${path}`, 'WARN', e.message); }
  }
}

const hardFail = results.filter(r => r.level === 'FAIL' && ['primary RPC', 'branch id', 'branch id override', 'Convex', 'indexer healthz'].includes(r.name));
console.log(`\n${results.filter(r => r.level === 'PASS').length} pass, ${results.filter(r => r.level === 'WARN').length} warn, ${results.filter(r => r.level === 'FAIL').length} fail`);
if (hardFail.length) {
  console.log('Blocking: ' + hardFail.map(r => r.name).join(', '));
  process.exit(1);
}
