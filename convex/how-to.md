# Convex Maintenance and Deployment Guide

Audience: Engineers and LLM agents maintaining the Convex backend that powers the Zatoshi inscriptions, fees, and UTXO safety flows.

Scope: This covers deploy workflows (dev/prod), schema context, key actions/mutations, critical invariants, provider behavior (UTXO + broadcast), and safe‑change guidance.

---

## Quick Start

- Install: `npm ci` (repo root)
- Convex CLI (optional): `npm i -g convex` or use `npx convex`
- Auth: follow Convex dashboard to authenticate the CLI to the deployment(s)

### Dev Deploy

1) Set required secrets in the Convex dev project (dashboard):
   - `BLOCKCHAIR_API_KEY` (recommended)
   - `TATUM_API_KEY` (recommended)
2) From repo root: `npx convex push`
3) Deploy: `npx convex deploy`
4) Verify logs while minting a small test inscription (≥ 210,000 zats UTXO):
   - Look for broadcast logs: `[broadcast][zerdinals|tatum|blockchair] …`

### Prod Deploy

1) Ensure prod Convex project has the same secrets:
   - `BLOCKCHAIR_API_KEY`
   - `TATUM_API_KEY`
2) Push schema/functions: `npx convex push`
3) Deploy: `npx convex deploy`
4) Mint a tiny text inscription to smoke test end‑to‑end.

Notes:
- `push` updates your schema + functions definitions.
- `deploy` publishes the current build to the alias you are targeting.

---

## Environment Variables (Convex)

- `BLOCKCHAIR_API_KEY` – Blockchair API; improves reliability/rate limits for UTXO fetch and broadcast fallback.
- `TATUM_API_KEY` – Tatum Zcash node gateway; used for consensus, getrawtransaction polls, and broadcast fallback.
- Optional overrides (normally not needed):
  - `ZCASH_CONSENSUS_BRANCH_ID` – override consensus branch id (decimal or 0x…)

No other envs are required in Convex for normal flows. Platform fee and treasury are hard‑coded in code.

---

## Schema Context (Tables)

See: `convex/schema.ts` for definitions.

- `inscriptions` – canonical record of inscribed items and metadata (txid = reveal txid, size, type, zrc-20 fields, fee audit fields).
- `utxoLocks` – idempotent UTXO locking to avoid races; prevents double‑use of an input.
- `txContexts` – durable context across the three‑phase client‑signing flow; stores utxo, scripts, branchId, commitTxid, etc.
- `jobs`, `mintTransactions` – batch mint orchestration and stats (used by jobsActions).

---

## Key Files and Responsibilities

- `convex/inscriptionsActions.ts`
  - buildUnsignedCommitAction: create context, lock a safe UTXO, return commit sighash to client.
  - finalizeCommitAndGetRevealPreimageAction: assemble + broadcast commit, wait ~8s for propagation, return reveal sighash; patch context with `commitTxid`.
  - broadcastSignedRevealAction: assemble + broadcast reveal, unlock UTXO, persist inscription record, set context `completed`.
  - split actions: optional UTXO split flows (client‑signed and server‑signed variants).

- `convex/utxoLocks.ts`
  - lockUtxo / unlockUtxo / lockUtxos / unlockUtxos
  - pruneStaleLocks: housekeeping to free abandoned locks.

- `convex/txContexts.ts`
  - create / getByContextId / patch – the durable transaction context for the inscription workflow.

- `convex/zcashHelpers.ts`
  - fetchUtxos: Blockchair → Zerdinals (pre‑change order restored). Empty array is valid; only throw when both sources fail.
  - getConsensusBranchId: JSON guard + cache + fallbacks.
  - broadcastTransaction: broadcaster order is `zerdinals → tatum → blockchair`; tolerant txid parser with logs.
  - Sighash + assembly helpers: commit/reveal (and split) helpers; ZIP‑243.

- `convex/treasury.config.ts`
  - Hard‑coded platform fee and treasury address used by Convex actions.

---

## Critical Invariants

- UTXO Safety: never spend an inscribed UTXO. Use indexer check; select only clean inputs.
- Locking Discipline: lock UTXO at context creation; unlock on reveal or on any failure path.
- Fees:
  - Platform fee = `100,000` zats to treasury `t1YbJR1f6fv5LkTG1avBQFH1UtRT5hGGxDh` (commit output #2).
  - Network fee floor (ZIP‑317) = `≥ 50,000` zats; enforced in actions.
- Output Order (commit): `[inscription P2SH, platform fee P2PKH, change (if > 546)]`.
- Reveal Wait: after broadcasting commit, wait ~8 seconds before reveal to avoid propagation races.

### Funding & UTXO Requirements

- Default minimum single‑input for a mint = `inscriptionAmount (60k)` + `fee (≥ 50k)` + `platform fee (100k)` = `≥ 210,000` zats.
- Selection requires a single clean (non‑inscribed) UTXO ≥ required. Multiple small UTXOs will not be combined.
- Best practice: deposit one fresh UTXO ≥ the requirement, or use the Split UTXOs tool to prepare exact‑sized inputs.

---

## Provider Behavior

### UTXO Fetch
- Order: Blockchair (keyed) → Zerdinals helper.
- Empty results are OK. Only throw when both fail to respond OK.

### Broadcast
- Order: Zerdinals → Tatum → Blockchair.
- Parser: tolerant – recursively searches nested JSON or regex matches 64‑hex anywhere in body.
- Logging: logs provider, HTTP status, content‑type, and a short response snippet.

---

## Typical Trace (Client‑Signed)

1) `txContexts:create` – initialize context.
2) `utxoLocks:lockUtxo` – lock input.
3) `inscriptionsActions:buildUnsignedCommitAction` – returns commit sighash.
4) `txContexts:getByContextId`
5) `inscriptionsActions:finalizeCommitAndGetRevealPreimageAction` – broadcast commit, wait ~8s, return reveal sighash; patch context (commit_txid).
6) `txContexts:getByContextId`
7) `inscriptionsActions:broadcastSignedRevealAction` – broadcast reveal; unlock UTXO; persist inscription; patch context completed.

---

## Troubleshooting

- Unable to check your spendable funds: both UTXO providers failed. Check `BLOCKCHAIR_API_KEY`, zerdinals status, retry.
- Network rejected due to ZIP‑317: increase fee to `≥ 50,000` zats.
- **"64: scriptsig-size"**: ScriptSig exceeds mempool relay limits. Content is automatically chunked into 520-byte pieces, but very large files (>50KB) may still exceed practical limits. Compress/optimize the file. If this error appears for files <50KB, it indicates a chunking bug.
- Broadcast failed: non‑txid: check broadcast logs; if commit is new, wait 8–15s and retry reveal; tolerant parser logs will show the response snippet.
- Missing fee output: ensure commit assembly includes platform fee; see `convex/treasury.config.ts` and commit assembly in `convex/zcashHelpers.ts`.
- Need a single UTXO with at least X zats: prepare one UTXO ≥ required (fresh deposit recommended) or use the Split UTXOs tool; inputs with inscriptions are intentionally excluded.
- Not enough spendable funds for this inscription: same as above; ensure a clean UTXO ≥ required (inscribed UTXOs are protected and won't be used).
- **Negative output value**: inscriptionAmount too low to cover reveal fee. For images, fee is capped at 100k zats, so inscriptionAmount must be ≥ 110k zats (100k fee + 10k minimum output).

---

## Safe Change Guide

- Client‑Signed Flow Only: default for security. Avoid changing signatures or introducing server‑side signing unless guarded by flags.
- Adding Providers: add behind a feature flag, with fixed timeouts, at most 2–3 retries; integrate into tolerant parser.
- Changing Fees: commit only; reveal must remain a single P2PKH back to minter.
- Schema Changes: add/modify tables in `convex/schema.ts`; run `npx convex push` and ensure all affected actions read/write with compatibility.
- Logging: keep broadcast logs on while iterating; reduce verbosity after stable period.

---

## File Map (Pointers)

- Actions: `convex/inscriptionsActions.ts` (commit/reveal end‑to‑end)
- Mutations/Queries: `convex/utxoLocks.ts`, `convex/txContexts.ts`, `convex/inscriptions.ts`, `convex/jobs.ts`, `convex/jobsActions.ts`
- Helpers: `convex/zcashHelpers.ts` (sighash, assembly, UTXO, broadcast, consensus, parsing)
- Config: `convex/treasury.config.ts` (platform fee + treasury)

---

## Image Inscription Implementation (PNG/SVG)

Added: November 2025

### Overview

Image inscriptions (PNG and SVG) follow the exact same commit-reveal pattern as text inscriptions but with binary content encoded as base64 on the client side and decoded to raw bytes on the server before embedding in the witness script.

### File Format Support

- **PNG**: `image/png` MIME type, binary data
- **SVG**: `image/svg+xml` MIME type, XML text (but treated as binary for consistency)
- **SVGZ** (future): Gzipped SVG with `image/svg+xml-compressed` MIME type (60-80% size reduction)

### Size Limits

- **Maximum: 50KB** (practical limit for mempool relay and fees)
- Recommended: <30KB for optimal fees and faster confirmation
- Warning threshold: >30KB (shows user notice to optimize)

**Content Chunking**: Images are automatically split into 520-byte chunks to comply with Bitcoin/Zcash MAX_SCRIPT_ELEMENT_SIZE. The number of OP_DROPs in the redeemScript matches the total number of envelope elements (4 + number of content chunks). For example, a 13KB image = 26 chunks, requiring 30 OP_DROPs (4 envelope elements + 26 chunks).

### Fee Calculation

Images use dynamic fee calculation based on file size to comply with ZIP-317:

```typescript
estimatedTxSize = 500 (base tx) + fileSizeBytes + 200 (witness/script overhead)
networkFee = max(estimatedTxSize * 10 zats/byte, 50000 zats)
```

- Small files (<5KB): 50,000 zats (floor)
- Medium files (50KB): ~57,000 zats
- Large files (200KB): ~207,000 zats

Total cost = `networkFee + platformFee (100k) + inscriptionOutput (60k)`

### Client-Side Flow

1. User uploads image via drag-and-drop or file picker
2. File validation (type: PNG/SVG, size: <4MB)
3. Image preview displayed
4. Fee calculation based on file size
5. File read as base64 via `FileReader.readAsDataURL()`
6. Base64 data (without data URL prefix) passed to Convex action

### Server-Side Flow

1. Receive base64-encoded content with `type: 'image'`
2. Decode base64 to raw bytes using `base64ToBytes()` helper
3. Build inscription envelope with proper Ordinals format
4. Standard commit-reveal flow (same as text)

### Critical Issues Fixed

#### Issue 1: scriptsig-not-pushonly (Initial)

**Error**: `"64: scriptsig-not-pushonly"`

**Root Cause**: Raw bytes (0x51, 0x00) in inscription data were being interpreted as opcodes instead of data.

**Fix**: Implemented `pushData()` helper to wrap all data with proper OP_PUSHDATA1/2/4 opcodes based on length:
- ≤75 bytes: Direct length prefix
- 76-255 bytes: OP_PUSHDATA1 (0x4c)
- 256-65535 bytes: OP_PUSHDATA2 (0x4d)
- >65535 bytes: OP_PUSHDATA4 (0x4e)

**Location**: `convex/zcashHelpers.ts:59-82`, `src/lib/zcash/inscriptions.ts:39-54`

#### Issue 2: Incorrect Ordinals Protocol (Fixed Immediately After)

**Error**: Still `scriptsig-not-pushonly` after initial fix

**Root Cause**: Used `0x51` (OP_1 opcode) instead of byte value `0x01` for content type field tag.

**Attempted Fix**: Changed to push byte value `0x01` using `pushData(new Uint8Array([0x01]))`

**Result**: Created new error (see Issue 3 below)

#### Issue 3: SCRIPT_VERIFY_MINIMALDATA Violation (Final Fix)

**Error**: `"64: non-mandatory-script-verify-flag (Data push larger than necessary)"`

**Root Cause**: Bitcoin/Zcash script validation requires using dedicated opcodes (OP_0 through OP_16) for numbers 0-16, not data pushes. Pushing `0x01 0x01` (push 1 byte: value 0x01) violates SCRIPT_VERIFY_MINIMALDATA.

**Correct Ordinals Envelope Format**:
```
OP_PUSH "ord"     → pushData(utf8("ord"))    [3 bytes: "ord"]
OP_1              → 0x51                     [content type tag]
OP_PUSH <mime>    → pushData(mime)           [N bytes MIME type]
OP_0              → 0x00                     [content tag]
OP_PUSH <content> → pushData(body)           [N bytes content]
```

**Final Fix**: Use literal opcodes for numbers 0-16:
```typescript
new Uint8Array([0x51])  // OP_1 (not pushData!)
new Uint8Array([0x00])  // OP_0 (not pushData!)
```

**Location**: `convex/zcashHelpers.ts:84-98`, `src/lib/zcash/inscriptions.ts:56-70`

**Reference**: This matches the exact format used by Zerdinals indexer and Bitcoin Ordinals protocol.

### Broadcast Error Handling

Improved error capture and user-friendly messages:

```typescript
// Network errors are now captured from all providers
errors: [
  'zerdinals(500): {"error":"failed to send raw transaction"}',
  'tatum: {"code":-26,"message":"64: scriptsig-not-pushonly"}',
  'blockchair(400): Invalid transaction...'
]

// User sees clean messages
"Transaction rejected: Invalid script format. Please try again or contact support."
```

**Location**: `convex/zcashHelpers.ts:327-406`, `convex/inscriptionsActions.ts:744-767`

### Implementation Files

**Frontend**:
- `src/app/inscribe/page.tsx`: Images tab UI (lines 1027-1184)
- `src/config/fees.ts`: Dynamic fee calculation (lines 56-89)

**Backend**:
- `convex/inscriptionsActions.ts`: Image type detection and base64 decoding (line 579)
- `convex/zcashHelpers.ts`: Base64 decoder (lines 23-30), inscription envelope builder (lines 84-98)
- `src/lib/zcash/inscriptions.ts`: Browser-side helpers (mirror of above)

### Key Learnings

1. **SCRIPT_VERIFY_MINIMALDATA** is strict: Numbers 0-16 MUST use OP_0 through OP_16 opcodes, never data pushes.

2. **Ordinals Protocol Precision**: The exact byte sequence matters. Even a single incorrect opcode breaks indexer compatibility.

3. **Error Visibility**: Logging actual network rejection reasons (not just "broadcast failed") is critical for debugging script validation issues.

4. **Size-Based Fees**: Images require dynamic fee calculation; a fixed fee causes rejections for larger files.

5. **Base64 Handling**: Client encodes to base64 for transport; server must decode back to raw bytes before building the inscription envelope.

### Testing Checklist

- [ ] PNG upload (<100KB)
- [ ] SVG upload (<100KB)
- [ ] Large file warning (>100KB)
- [ ] Fee scaling with file size
- [ ] Commit transaction includes platform fee output
- [ ] Reveal transaction broadcasts successfully
- [ ] Image viewable on Zerdinals explorer
- [ ] Inscription ID format: `{revealTxid}i0`

---

## Deployment Checklist (Dev/Prod)

- [ ] BLOCKCHAIR_API_KEY set in Convex project
- [ ] TATUM_API_KEY set in Convex project
- [ ] `npx convex push` (schema/functions up to date)
- [ ] `npx convex deploy`
- [ ] Smoke test: commit has 2 outputs (inscription + fee), reveal has 1 output, inscription record persisted
- [ ] Image inscription test: PNG/SVG uploads work, fees scale correctly, images viewable on Zerdinals
