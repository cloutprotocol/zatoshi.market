# Inscription Service Restart — Inventory, Definition of Done, Report

Date: 2026-09-10. Scope: the five repos `zatoshi.market`, `index.zatoshi.market`, `zord`,
`mempool`, `zatoshi.wallet`. Companion runbook: `docs/OPERATIONS.md`.

## 0. Headline

The code that minted 1,856 ZGODS in December 2025 still exists and still builds. What is gone
is everything underneath it:

| Tier | State on 2026-09-10 | Evidence |
|---|---|---|
| Hetzner host 135.181.6.234 (node, RPC proxy, indexer) | unreachable on all ports; `rpc.` and `mempool.zatoshi.market` → Cloudflare 522 | port probe, curl |
| Zcash node software | zcashd halted network-wide 2026-07-18 at block 3,417,100; NU6.3 activated at 3,428,143; chain is at ~3,479,000 | z.cash/support/zcashd-deprecation, ZIP 258 |
| Convex backend (all mint actions) | dev deployment disabled for exceeding free-plan limits; prod (`cool-panda-546`) returns Server Error on a read query | `POST /api/query` |
| Zerdinals third-party APIs | `indexer.zerdinals.com` 521, `utxos.zerdinals.com` redirects to an sslip.io host with 401 | curl |
| Tatum (Zebra node) | up, at tip, `consensus.nextblock = 37a5165b`; free tier 3 req/s; no `getaddressutxos`/`decoderawtransaction` | RPC probes |
| Blockchair | up | `/zcash/stats` |
| Vercel frontend | up; `/api/inscriptions` returned 500 because the indexer is down | curl |

No code change can make an inscription happen until a Zebra node, the RPC proxy, and a
Convex deployment are back. The code changes below make the path survive a dead primary,
close the status loop, and stop the next restart from being a re-investigation.

## 1. Inventory

### zatoshi.market (Next.js 14 + Convex) — the product

| Area | Status | Where |
|---|---|---|
| Submit → build commit/reveal → browser signs → server broadcasts | **WORKS** (code) | `src/utils/inscribe.ts` → `convex/inscriptionsActions.ts` `buildUnsignedCommitAction` / `finalizeCommitAndGetRevealPreimageAction` / `broadcastSignedRevealAction`; hand-rolled v4 tx + ZIP-243 in `convex/zcashHelpers.ts` |
| Broadcast failover RPC → Tatum → Blockchair | **WORKS** | `zcashHelpers.ts` `broadcastTransaction` |
| Inscription-safety UTXO check | **was BROKEN with primary down** (RPC-only, fail-closed → every UTXO "unsafe") | fixed, see §4 |
| Consensus branch id | **WORKS** (live from Tatum) but last-resort constant was NU5 | fixed |
| Fee/quote | **HALF-DONE**: tiers hardcoded in `src/app/inscribe/page.tsx:519`, server recomputes ZIP-317 and can raise the fee after confirmation (`inscriptionsActions.ts:697-725`), `/api/zcash/fees` unused, floor constant triplicated | untouched |
| Status after broadcast | **was BROKEN**: rows inserted `pending`, never updated; `updateInscriptionStatus` had no callers | fixed, see §4 |
| Batch mint from UI | **BROKEN**: calls `api.jobs.createJob` but it is an `internalMutation`; also sends the raw WIF to the server and stores it in `jobs.params` | untouched, out of critical path; disable the UI button |
| `POST /api/inscriptions/create` | **DEAD and dangerous**: unauthenticated, accepts `walletWIF`, uses dead Zerdinals endpoints | untouched; delete in next PR |
| Key custody (single mint) | **WORKS**: PBKDF2-250k + AES-GCM keystore, signing never leaves browser | `src/lib/keystore.ts`, `inscribe/page.tsx:3381` |
| Legacy names mint | **BROKEN (likely)**: bitcore-lib-zcash path documented as failing | `src/app/names/page.tsx:563` |
| Deploy | Vercel (`vercel.json` minimal); Cloudflare Pages scripts present but no `wrangler.toml`; `typescript.ignoreBuildErrors: true`; 189 tsc errors baseline | untouched |
| Tests | none | — |
| Docs | only `docs/SYSTEM_ARCHITECTURE.md` matches code; `TREASURY_AND_FEES.md` names a different treasury address than the code; `scripts/inscribe/*.md` are a stale Nov-2025 dead end and leak a WIF | see §5 |

### index.zatoshi.market (Node, next to the node) — RPC proxy + batch minter

| Area | Status |
|---|---|
| `server-rpc.js` :9999 (what `rpc.zatoshi.market` fronted): Basic-auth JSON-RPC allowlist incl. `sendrawtransaction` | **WORKS**, undocumented, uncommitted (+109 lines in `server.js`, `server-rpc.js` untracked) |
| `server.js` :8888 node dashboard | WORKS; Dockerfile healthcheck hits nonexistent `/api/health` |
| `.codex/inscribe/cli` ("zainscribe") — the CLI that minted ZGODS | **WORKS**, untracked, hardcodes NU6.1 branch id (`inscribe-mint.js:22`) → every signature now invalid post-NU6.3 |
| `inscribe/` (Gen-1 attempt) | BROKEN, abandoned, self-documented |
| `zcash.conf`, `install-zcashd.sh`, `zcash.service` | BROKEN: zcashd-only, and the conf strips the index flags production used |
| `zord-docker/` | coherent; healthcheck path fixed 2026-09-10 |
| Key custody | plaintext keys on disk; `.codex/.../wallet/*.txt` were not gitignored (fixed 2026-09-10) |
| Ledger | 1,856 mints Dec 10–18 2025 (`ZGODS_ASSIGNED.csv`); 35 wallets still owed (`ASSIGNMENT_REMAINING.csv`); over-assignment incident Dec 11 diagnosed and patched in `*-FIXED.js` |

### zord (Rust indexer)

| Area | Status |
|---|---|
| Poll-based chain follower, redb store, HTTP API on `API_PORT` | WORKS; no ZMQ needed (fine for Zebra) |
| Envelope parser (scriptSig heuristic), ZRC-20/721 engines | WORKS |
| Uncommitted diff (5 files) | compiles; `zrc721` numeric-id fix is good; `FORCE_START` looped forever on one block — fixed 2026-09-10 |
| Reorg handling | none |
| Recent-inscriptions ordering | lexicographic by txid, not chronological (`db.rs:180`) |
| `/status.synced` | hardcoded `true`; use `/api/v1/healthz` |
| Mempool/unconfirmed inscriptions | not implemented |
| Tests / CI | none; `.github/workflows` empty |

### mempool, zatoshi.wallet — not on the critical path

`mempool` is an uncommitted, older copy of `index.zatoshi.market/server.js` (dashboard only;
no mempool code). `zatoshi.wallet` is a never-installed Chrome-extension extraction with a
missing module import, missing icons, and a nonexistent `bitcore-lib-zcash@8.25.23` pin. Neither
is used by the product.

## 2. Definition of done

A user can, from `www.zatoshi.market/inscribe`:

1. **Submit** text or JSON; the fee breakdown shows platform fee, network fee, inscription output.
2. **Pay** by signing the commit and reveal in the browser; the server broadcasts both and
   returns `commitTxid`, `revealTxid`, `inscriptionId = <revealTxid>i0`.
3. **Confirm**: within ~2 block intervals the row flips to `confirmed` with `blockHeight`.
4. **Query**: `GET /api/inscriptions/status/<inscriptionId|txid>` returns the state, and the
   indexer serves `GET /content/<inscriptionId>` with the payload.

### Acceptance tests

| # | Test | Pass condition |
|---|---|---|
| A1 | `node scripts/ops/preflight.mjs` | 0 FAIL |
| A2 | `POST <rpc>/api/rpc getblockchaininfo` with Basic auth | `consensus.nextblock` equals Tatum's value |
| A3 | `curl <indexer>/api/v1/healthz` | `synced: true`, `chain_tip - height <= 2` |
| A4 | Mint `text/plain` "restart-<date>" with a funded wallet (~0.0012 ZEC) | UI returns `inscriptionId`; `status/<id>` → `pending`, `confirmations: 0`, `source: chain` |
| A5 | Wait ≤ 5 min | `status/<id>` → `confirmed`, `blockHeight` set; `/inscribe` history shows Confirmed without reload |
| A6 | `curl <indexer>/content/<id>` | body equals the submitted text, `content-type: text/plain` |
| A7 | Mint with an inscribed UTXO as the only coin | server refuses ("no safe UTXOs"); no broadcast |
| A8 | Stop the RPC proxy, repeat A4 | mint still succeeds via Tatum/Blockchair within 30 s (8 s primary timeout) |
| A9 | `status/notahex` → 400; `status/<unknown txid>` → 404; `/api/inscriptions` with indexer down → 503 | as stated |
| A10 | Convex cron log | `[inscription-status] checked=… confirmed=…` every 2 min |

## 3. What was changed (critical path only)

zatoshi.market:

- `convex/zcashHelpers.ts` — `callZcashRPC` gets an 8 s timeout (`ZCASH_RPC_TIMEOUT_MS`);
  new `getRawTransactionVerbose` (RPC → Tatum → Blockchair) and `getTxConfirmation`;
  `checkInscriptionAt` now uses the failover, so a dead primary no longer marks every UTXO
  unsafe; last-resort branch-id constant NU5 → NU6.3 `0x37A5165B` (sourced: ZIP 258); the REST
  fallback picks the highest active upgrade instead of preferring "NU5".
- `convex/inscriptions.ts` — `listPendingInscriptions`, `getByTxid` (internal queries),
  `setStatusByTxid` (internal, idempotent). Existing public functions untouched.
- `convex/inscriptionStatusActions.ts` (new) — `refreshPendingInscriptions` (batch of 25,
  oldest first; `confirmed` at ≥1 confirmation, `failed` when unseen for 24 h) and
  `checkInscriptionOnChain` (on-demand).
- `convex/crons.ts` (new) — runs the refresh every 2 minutes.
- `src/app/api/inscriptions/status/[id]/route.ts` (new) — public status endpoint.
- `src/app/api/inscriptions/route.ts` — reads `ORDINAL_INDEX_API_BASE`, 8 s timeout, 503 with
  `Retry-After` when the indexer is unreachable (was a 500).
- `convex/zcash.ts`, `convex/testAction.ts` — explicit handler return types only (needed to
  keep Convex's `api`/`internal` type inference from collapsing after adding a module).
- `convex/_generated/api.d.ts` — the two new modules added by hand because `npx convex codegen`
  refuses ("You don't have access to the selected project"). `npx convex dev` will regenerate
  identically.
- `.env.example` — `ZCASH_RPC_USER` → `ZCASH_RPC_USERNAME` (the name the code reads), plus the
  missing `ORDINAL_INDEX_API_BASE`, `ZCASH_RPC_TIMEOUT_MS`, branch-id note.
- `scripts/ops/preflight.mjs` (new) — dependency check; A1 above.

index.zatoshi.market: `.gitignore` now excludes `.codex/inscribe/cli/src/wallet/` and
`.codex/**/.env*`; `zord-docker/docker-compose.yml` healthcheck `/api/health` → `/health`.

zord: `src/indexer.rs` `FORCE_START` advances an in-process cursor instead of re-indexing
`ZSTART_HEIGHT` forever. `cargo check` clean.

Verification: `npm run build` exit 0 with the new route registered; `tsc --noEmit` error set
identical to the pre-change baseline (189, all pre-existing); local `next start` returned
400/502/503 as designed for the three failure cases (502 because the Convex function is not
deployed yet). Nothing here was exercised against a live node, and nothing was committed.

## 4. Gaps and risks

1. **Infrastructure is the blocker, not code.** Host, node, and Convex are all down (§0).
2. **Secrets in public repos.** A WIF in 10 tracked files under `scripts/inscribe/`; a Tatum key
   in `src/services/InscriptionService.ts:30` and ~10 scripts; the RPC proxy password in
   `docs/RPC-INTEGRATION.md`; the node password in `index.zatoshi.market` `server.js:11`,
   `zcash.conf`, two guides. Treat the wallet `t1ZemSSmv1kcqapcCReZJGH4driYmbALX1x` and all three
   credentials as compromised; rotate before anything is redeployed.
3. **Treasury address disagreement.** Code pays `t1Z1wNUTbkX6UQpMjKKWaZTrSx5imhjYUFt`
   (`convex/treasury.config.ts:4`); `docs/TREASURY_AND_FEES.md` says
   `t1YbJR1f6fv5LkTG1avBQFH1UtRT5hGGxDh`. Decide which is right before the first paid mint.
4. **Batch mint path stores user private keys in Convex** (`jobs.params`) and is broken anyway.
   Hide the button until it is ported to the client-signing flow.
5. **`.codex` CLI signs with a hardcoded NU6.1 branch id** — the 35 outstanding ZGODS wallets
   cannot be served with it until `inscribe-mint.js:22` reads `getblockchaininfo`.
6. **Zebra gaps.** `/api/zcash/inscriptions/[address]` (pending view) calls
   `getaddressmempool`, and `/api/zcash/broadcast` calls `decoderawtransaction`; both are absent
   in Zebra. The Convex mint path uses neither.
7. **Convex plan.** The mint flow, UTXO locks, and now the cron all live in Convex. A disabled
   deployment silently stops every mint.
8. **Fee UX.** The server can raise the fee after the user confirmed the quote.
9. **No tests** around hand-rolled sighash code that moves funds; type errors ignored at build.
10. **Indexer correctness.** No reorg handling; recent-feed ordering is by txid; single
    `i0` per tx.

## 5. Smallest next PR to ship a working MVP

Precondition (ops, not a PR): Zebra node synced, `server-rpc.js` under systemd with rotated
credentials, zord running, Convex deployment enabled, Vercel env set. Then one PR:

1. `npx convex deploy` the changes in §3 (they are the PR's Convex half).
2. Delete `src/app/api/inscriptions/create/route.ts`, `src/services/InscriptionService.ts`,
   `src/services/inscription.ts`, `src/services/zcashTx.ts`, `src/lib/zcash/inscriptions.ts`,
   `src/services/inscriptionProtection.ts`, and `scripts/inscribe/` (dead paths, dead Zerdinals
   endpoints, leaked WIF and Tatum key). `experimental.externalDir` can then go too.
3. Hide the batch-mint button on `/inscribe` (or fix `api.jobs.createJob` →
   `internal.jobs.createJob` and stop sending `wif`).
4. Reconcile `docs/TREASURY_AND_FEES.md` with `convex/treasury.config.ts`.
5. Rotate: node RPC password, proxy Basic-auth password, Tatum key. Purge history later; rotation
   first.
6. Wire `/inscribe` history to poll `GET /api/inscriptions/status/<id>` for rows still pending
   (optional; the cron already updates the Convex row the UI subscribes to).

Everything else in §4 is a follow-up.

## 6. Assumptions

- `rpc.zatoshi.market` fronted `server-rpc.js` on port 9999, inferred from every client using
  Basic auth with no `Origin` header (the 8888 `server.js` would 403 them). Not verifiable
  while the host is down.
- Production Convex is `cool-panda-546` (three references in the live bundles). Its "Server
  Error" on a read query was not diagnosed further (no dashboard access from here).
- The Zebra method matrix was verified through Tatum's node, which may filter methods;
  `getaddressutxos` is documented as supported by Zebra even though Tatum returns
  "Method not found".
- No chain ids, addresses, or keys were introduced; the only new constant is the NU6.3 branch
  id from ZIP 258, and it is a fallback behind the live lookup.
