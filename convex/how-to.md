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
- Broadcast failed: non‑txid: check broadcast logs; if commit is new, wait 8–15s and retry reveal; tolerant parser logs will show the response snippet.
- Missing fee output: ensure commit assembly includes platform fee; see `convex/treasury.config.ts` and commit assembly in `convex/zcashHelpers.ts`.

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

## Deployment Checklist (Dev/Prod)

- [ ] BLOCKCHAIR_API_KEY set in Convex project
- [ ] TATUM_API_KEY set in Convex project
- [ ] `npx convex push` (schema/functions up to date)
- [ ] `npx convex deploy`
- [ ] Smoke test: commit has 2 outputs (inscription + fee), reveal has 1 output, inscription record persisted

