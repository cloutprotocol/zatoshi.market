# Claim Reconciliation Playbook

This checklist explains how to regenerate the offline claim reports, reconcile missing mints back into Convex production, and clean up stale reservations. Follow it every time we need to sync the on-chain inscriptions with Convex data.

## 1. Export Production Snapshots

1. Sign into the Convex dashboard for the production deployment (`c-judemc`).
2. Export both `collectionClaims` and `collectionClaimEvents` as JSONL (Convex “Download data” → zip). Place the zip under `temp/snapshots/` and unzip so the structure matches `temp/snapshots/<table>/documents.jsonl`.

> Any on-chain mints that happened after the export will be missing, so always pull a fresh snapshot before reconciliations.

## 2. Rebuild Offline Reports

From the repo root:

```bash
python3 scripts/analysis/generate_claims_report.py zgods
```

This regenerates:

- `temp/analysis/zgods_inscribed_missing_mint.csv` – tokens with inscription events but no minted row.
- `temp/analysis/zgods_duplicate_inscriptions.csv` – tokens with multiple inscription addresses.
- `temp/analysis/zgods_reserved_pending.csv` – currently reserved tokens with no inscription.
- `temp/analysis/zgods_token_history.csv` and `temp/analysis/zgods_address_claims.csv` – audit references.

If we need the JSON payload for the reconciler scripts:

```bash
node scripts/analysis/build_missing_mint_payload.cjs
```

The payload lands at `temp/analysis/zgods_missing_mint_payload.json` and mirrors the CSV (split into `updates` and `skipped`).

## 3. Set the Convex Deployment Context

Before writing to Convex prod, **always use the `--prod` flag** with convex commands:

```bash
npx convex run <function> --prod
npx convex deploy --prod
```

Double-check this so we do not patch the dev deployment by mistake.

## 4. Apply the Missing-Mint Reconciler

Run the Node script that uploads chunks of fixes:

```bash
node scripts/analysis/run_missing_mints.cjs
```

Monitor the console; each chunk prints success/failure counts. The CLI calls the `adminReconcile:applyInscribedMints` mutation under the hood.

## 5. Handle Skipped/Duplicate Tokens

The `skipped` array inside `zgods_missing_mint_payload.json` lists tokens that had multiple inscription addresses. Decide which address should own each token (usually the earliest inscription or a manual policy), then call the mutation manually:

```bash
npx convex run adminReconcile:applyInscribedMints \
  '{"collectionSlug":"zgods","updates":[{"tokenId":123,"address":"t1...","inscriptionId":"...","txid":"..."}],"force":true}' --prod
```

Repeat per token until all duplicates are resolved.

## 6. Release Stale Reservations

Use `temp/analysis/zgods_reserved_pending.csv` as input for a reservation cleanup script or manual mutation. Each row has `tokenId`, `address`, and the last `updatedAt`. Mark entries older than the reservation TTL as `failed` to free supply:

```bash
npx convex run adminReconcile:releaseReservation '{"collectionSlug":"zgods","tokenId":123}' --prod
```

(Write this helper mutation once; reuse it across collections.)

## 7. Verify

After reconciliation:

1. Re-export prod snapshots and rerun `python3 scripts/analysis/generate_claims_report.py zgods`.
2. Confirm `zgods_inscribed_missing_mint.csv` is empty (or only contains known duplicates), and that `zgods_reserved_pending.csv` only lists fresh reservations.
3. Compare the UI stats to `zgods_address_claims.csv` to ensure counts line up.

Document any manual adjustments (e.g., which wallet received a duplicate token) in the PR or runbook.

