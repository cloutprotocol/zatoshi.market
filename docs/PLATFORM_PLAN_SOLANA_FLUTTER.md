# Platform plan: Solana rails + Privy + Flutter, with web parity

Date: 2026-09-10. Builds on `docs/RESTART_REPORT.md`, `docs/SOLANA_SEEKER_RESEARCH.md`, and
the keep/rebuild decisions for zord and the runes fork.

## 0. The three answers

1. **Where do users manage funds?** Solana funds (SOL, USDC, SKR) live in the user's Privy
   embedded Solana wallet: non-custodial, created at login, works on Seeker, other Android, iOS,
   and web. Zcash-side assets (inscriptions, runes) sit on a Zcash `t1` address that the app
   derives deterministically from the user's Privy wallet, so the user owns both sides with one
   login and no seed phrase (details in §3). The platform hot wallet only pays ZEC network fees.
2. **One Flutter codebase for phone, web, and desktop?** No. `privy_flutter` 0.10.1 declares
   Android and iOS only; there is no Flutter Web or desktop build of the Privy SDK. Parity has
   to live in the API and the domain logic, not the UI framework.
3. **Adapt the current Next.js web (v1) or start over?** Adapt. Keep the Next.js app as the web
   client, swap its self-hosted keystore for Privy's React SDK, strip the dead code, and point it
   at the same backend the Flutter app uses. Desktop, if wanted, is the web client wrapped
   (Tauri or PWA install); Privy's JS SDK runs fine inside a webview.

## 1. Target shape

```
                ┌──────────────── clients ────────────────┐
                │ Flutter app (Seeker/Android, iOS)        │  privy_flutter + solana (dart)
                │ Next.js web v2 (+ Tauri wrapper = desktop)│  @privy-io/react-auth + @solana/kit
                └──────────────┬──────────────────────────┘
                               │  one HTTP/JSON API, one order state machine
                ┌──────────────▼──────────────────────────┐
                │ zatoshi-api (Node/TS)                    │  orders · Solana payment verifier
                │   · Zcash tx builder (from convex/)       │  · ZEC hot wallet · status
                │   · SKR/USDC pricing, SGT gating          │
                └──────┬──────────────────────┬────────────┘
                       │                      │
              ┌────────▼───────┐     ┌────────▼────────────────┐
              │ zord (Rust)    │     │ Solana RPC (Helius/Triton)│
              │ inscriptions   │     │ 1Click (treasury top-up)  │
              │ + runes module │     └───────────────────────────┘
              └────────┬───────┘
                ┌──────▼──────┐
                │ Zebra node  │
                └─────────────┘
```

Parity rule: any screen that exists in both clients is a thin view over the same API
response. Business rules (fee quote, UTXO safety, order states, rune edicts) never live in a
client.

## 2. Repository plan

| Repo | Decision | Notes |
|---|---|---|
| `zord` | **keep, harden, extend** | reorg buffer + rollback, height-ordered feeds, tests with block fixtures, `runes` module with its own start height. Stays the single Zcash read model. |
| `zatoshi.market` (Next.js) | **keep as web v2** | remove the local keystore, Convex mint actions, Zerdinals paths, `scripts/inscribe`, batch-mint; add Privy React SDK; call `zatoshi-api`. |
| `zatoshi-api` (new, Node/TS) | **create** | extract `convex/zcashHelpers.ts` (builder, ZIP-243, branch id, UTXO safety, broadcast failover) and the order logic; Postgres for orders and per-user addresses; runs next to Zebra. Replaces Convex. |
| `zatoshi-app` (new, Flutter) | **create** | Seeker first. `privy_flutter`, `solana`, optional `solana_mobile_client` for Seed Vault users. Android + iOS targets only. |
| `infra` (new) | **create** | Zebra config, `server-rpc.js` (only if the web client still needs direct RPC; otherwise retire it), zord docker-compose, systemd units, preflight. Pulled out of `index.zatoshi.market`. |
| `index.zatoshi.market` | **archive** after moving `server-rpc.js`, `zord-docker/`, and the `.codex` CLI's `inscribe-mint.js` into `zatoshi-api`/`infra` | contains committed secrets; rotate first, then archive the repo. |
| `mempool`, `zatoshi.wallet`, `sidebar-wallet-standalone/` | **delete** | never shipped; superseded. |
| Convex | **retire** | plan is disabled; the only irreplaceable thing in it is data (`inscriptions`, `collectionClaims`, `userProfiles`), export it into Postgres. |

Why not one monorepo: Rust, Node, Flutter, and Next.js have four different toolchains and
release cadences, and zord is a standalone public-good indexer. Use one GitHub org, four
repos, and a shared `openapi.yaml` in `zatoshi-api` that both clients generate types from.

## 3. Wallet and custody model

**Solana (payments, SKR):** Privy embedded wallet. Non-custodial, recoverable through the
user's login. On Seeker, additionally offer "use Seed Vault wallet" via Mobile Wallet Adapter
for users who prefer device keys; the API only ever sees a Solana address plus a signed
message, so both paths look identical to the backend.

**Zcash (inscriptions, runes):** Privy does not support Zcash. Derive the Zcash key on the
client from the Privy wallet:

```
seed = signMessage("zatoshi-zcash-key-v1")   // ed25519 signatures are deterministic
priv = SHA-256(seed) mod n                    // secp256k1 scalar
t1   = P2PKH(pubkey(priv))
```

Properties: reproducible on every device the user logs into, never stored, never sent to the
server (the server only learns `t1`). Costs: one Privy signing prompt when the wallet is
first opened per session; the key exists in app memory while signing. Both clients implement
this identically (Dart and TS), and a golden-vector test pins the derivation forever, because
changing it strands assets.

**Platform hot wallet:** pays ZEC fees for commit/reveal and rune etch/mint/transfer. Users
never need ZEC. Top-up via NEAR Intents 1Click from accumulated USDC/SKR, batched daily.

**Migration for v1 web users:** their `t1` key sits in `localStorage` (`zatoshi_keystore_v1`).
Ship an "import legacy wallet" screen on web that decrypts the old keystore locally and sweeps
inscriptions to the newly derived address (one reveal-style transfer per inscription UTXO,
fee paid by the platform for a limited window). Remove the old keystore code after the window.

## 4. Order state machine (shared by both clients)

`quoted → awaiting_payment → paid → building → broadcast → confirmed | failed | refunded`

- `quoted`: API returns price in SKR/USDC (ZEC fee × oracle + platform fee), a Solana treasury
  ATA, a memo `orderId`, a 10-minute expiry.
- `awaiting_payment → paid`: client builds the SPL transfer with memo, signs (Privy
  `signMessage` on the serialized message bytes in Flutter; `signAndSendTransaction` on web),
  sends it, then `POST /orders/:id/payment {signature}`. API verifies via `getTransaction`
  (amount, mint, destination ATA, memo). Idempotent.
- `building → broadcast`: `zatoshi-api` runs the existing commit/reveal builder with the user's
  derived `t1` as destination; for runes, one `OP_RETURN` transaction.
- `confirmed`: the tracker already written in `convex/inscriptionStatusActions.ts` moves into
  `zatoshi-api` unchanged in logic (RPC → Tatum → Blockchair failover, 24 h → failed).
- `refunded`: `failed` orders refund the SPL transfer from the treasury; automatic.

## 5. Phased actions

### Phase 0 — unblock (this week; ops, not code)
- Rotate node RPC, proxy, and Tatum credentials; treat the leaked WIF wallet as burned.
- Zebra node synced; zord running from 3,132,356; preflight green.
- Decide the treasury `t1` (code vs doc disagree) and the price denomination (USDC recommended
  for refunds, SKR shown as an option).

### Phase 1 — `zatoshi-api` (2–3 weeks)
- Extract builder + helpers from `convex/zcashHelpers.ts`; keep the function signatures.
- Postgres schema: `users(privy_id, solana_address, zcash_t1)`, `orders`, `inscriptions`
  (import Convex export), `treasury_ledger`.
- Endpoints: `POST /quotes`, `POST /orders`, `POST /orders/:id/payment`, `GET /orders/:id`,
  `GET /inscriptions/status/:id`, `GET /me` (Privy access-token verified server-side).
- Solana payment verifier + refund worker. SGT ownership check endpoint.
- Port `scripts/ops/preflight.mjs` and the acceptance tests from `RESTART_REPORT.md`.

### Phase 2 — Flutter app on Seeker (parallel with Phase 1, 3–4 weeks)
- Spike first, before any UI: Privy login → `createSolanaWallet` → build SPL transfer with the
  `solana` package → `signMessage(messageBytes)` → `sendTransaction` on devnet. If Privy's
  Android provider rejects raw transaction bytes, fall back to MWA for payment signing and keep
  Privy for identity and Zcash-key derivation.
- Screens: login, wallet (SOL/USDC/SKR balances, derived `t1`), inscribe (text/JSON, quote,
  pay, status), collection/rune views from zord, Seeker perks gated by SGT.
- dApp Store submission: APK, publisher policy checklist, privacy disclosure.

### Phase 3 — Web v2 in `zatoshi.market` (2 weeks, after Phase 1 API is stable)
- Add `@privy-io/react-auth` with Solana; remove `WalletContext` keystore, Convex client,
  mint actions, `/api/zcash/*` routes that proxied RPC (the API replaces them), all dead
  inscription code listed in `RESTART_REPORT.md` §5.
- Legacy wallet import + sweep flow (§3).
- Keep `/api/inscriptions`, `/api/zrc721`, `/api/ordinal-index` as thin proxies to zord.
- Optional desktop: `tauri init` around the deployed web URL; nothing else changes.

### Phase 4 — Runes fork (after Phase 1; spec first)
- One-page protocol spec: magic opcode, start height, LEB128 fields, etch commitment rule
  (P2SH reveal or first-seen + fee), shielded-output rule, 80-byte budget.
- `zord` module + fixtures; `zatoshi-api` etch/mint/transfer builders; both clients add rune
  screens as views over zord responses.

## 6. Adjustments to make now in existing repos (cheap, unblock later phases)
- `zatoshi.market`: stop adding features to the Convex mint path; land the status tracker and
  failover changes already in the tree so v1 keeps working during the transition.
- `zord`: commit the ZRC-721 fix and the `FORCE_START` fix; open the reorg/ordering/tests
  work as the first three issues; reserve a `runes` module.
- `index.zatoshi.market`: move `server-rpc.js` and `zord-docker/` to `infra`, copy
  `inscribe-mint.js` into `zatoshi-api` as reference for the CLI batch path (fix its hardcoded
  branch id on the way), then archive the repo.
- Everything: add a `SECURITY.md` note that the pre-2026-09 credentials are revoked.

## 7. Risks specific to this plan
- Privy Flutter Solana signing is `signMessage`-only; the devnet spike in Phase 2 is the gate.
- The derived-key scheme is only as safe as the constant message and the Privy signing key;
  document the derivation, pin it with tests, and never rotate it.
- Zcash 80-byte `OP_RETURN` bounds rune messages; design edicts to fit.
- Solana RPC rate limits on free tiers; budget a paid Helius/Triton plan from day one.
- dApp Store review cycle is opaque; submit a payment-free build early to learn the process.
