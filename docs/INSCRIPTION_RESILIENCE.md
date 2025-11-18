# Inscription Network Resilience

This document summarizes the hardening applied to UTXO fetching and consensus
branch ID retrieval to make inscription/mint flows resilient to upstream
provider failures and content-type mismatches.

## Problem Summary

- UTXO fetch previously threw on non-OK fallback responses and also treated
  an empty set as an error. This caused user-facing failures during minting.
- `getConsensusBranchId()` parsed JSON without verifying `Content-Type`. If
  the provider (e.g., Tatum) returned an HTML error/redirect, JSON parsing
  crashed with "Unexpected token '<'".

## Resilient Design

### 1) UTXO Fetching

- Multi-provider fallback order with tolerant normalization:
  1. Blockchair (uses `BLOCKCHAIR_API_KEY` if set)
  2. Zerdinals helper (`https://utxos.zerdinals.com/api/utxos/:address`)
  3. Public explorers (best-effort)
- Empty results are VALID. An address may have zero UTXOs or none that meet
  selection criteria; do not throw in that case.
- Only throw after all sources failed to respond with OK.

Code: `convex/zcashHelpers.ts:243`

### 2) Consensus Branch ID

- Verify `Content-Type` includes `application/json` before parsing.
- Cache the branch ID for 10 minutes to avoid rate limits.
- Fallback to an optional env override if the RPC is blocked.
- Call sites must handle failures with a user-friendly message.

Code: `convex/zcashHelpers.ts:140`, `convex/inscriptionsActions.ts:524`

### 3) Indexer Checks

- `checkInscriptionAt()` uses the Zerdinals indexer and falls back to a
  heuristic raw-transaction check. On failure, it currently defaults to
  "not inscribed" to avoid hard blocking; UI should still warn users.

Code: `convex/zcashHelpers.ts:305`

## Invariants and Guidelines

- Do not treat an empty UTXO list as an error. Selection logic should decide
  if funds are sufficient.
- Always gate JSON parsing by checking response `Content-Type`.
- Wrap network-dependent calls at the action boundary and convert into
  user-friendly, actionable messages.
- Keep provider keys in `.env.local` and avoid leaking them client-side.

## Configuration

- `BLOCKCHAIR_API_KEY` — avoids Blockchair rate limits (server-side).
- `TATUM_API_KEY` — required for Tatum RPC; improves reliability.
- `ZCASH_CONSENSUS_BRANCH_ID` — optional override (decimal or `0x…`) used if
  RPC is unavailable.

See `.env.example` for variable names and usage.

## Call-site Patterns

Mint (client-signing) path:
- Wrap UTXO fetch and consensus fetch in try/catch.
- On failure, surface a helpful message and abort early.

Code: `convex/inscriptionsActions.ts:497`, `convex/inscriptionsActions.ts:524`

## Troubleshooting

- If users see "Unable to check your spendable funds…": all providers failed.
  Check outbound access and API keys.
- If users see "Network is busy; cannot fetch consensus parameters…": the
  consensus RPC did not return JSON; consider setting `ZCASH_CONSENSUS_BRANCH_ID`.

## Change Log (2025-11-18)

- Hardened `fetchUtxos()` with multi-source fallbacks and normalization.
- Made empty UTXO responses non-fatal.
- Added content-type checks and env override in `getConsensusBranchId()`.
- Wrapped mint client-signing action to show friendly errors.

