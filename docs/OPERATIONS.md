# Inscription Service — Operations Runbook

Last verified: 2026-09-10. Source of truth for runtime configuration of the
submit → broadcast → confirm → status path. `docs/SYSTEM_ARCHITECTURE.md` remains the
accurate description of the transaction format; every other inscription doc under
`scripts/inscribe/` is historical and should not be followed.

## 1. Topology

```
browser (signs with local key)
  └─ Next.js on Vercel (www.zatoshi.market)
       ├─ /api/inscriptions/status/[id]  ──► Convex action checkInscriptionOnChain
       ├─ /api/inscriptions, /api/zrc721, /api/ordinal-index ──► zord indexer  (ORDINAL_INDEX_API_BASE)
       └─ /api/zcash/*                     ──► RPC proxy      (NEXT_PUBLIC_ZCASH_RPC_URL)
  └─ Convex (mint actions, txContexts, utxoLocks, inscriptions, cron status tracker)
       ├─ 1) RPC proxy  https://rpc.zatoshi.market/api/rpc   (index.zatoshi.market/server-rpc.js :9999, Basic auth)
       ├─ 2) Tatum      https://api.tatum.io/v3/blockchain/node/zcash-mainnet   (TATUM_API_KEY)
       └─ 3) Blockchair https://api.blockchair.com/zcash                       (BLOCKCHAIR_API_KEY)
RPC proxy ──► Zcash full node (Zebra) :8232      zord ──► same node
```

Order 1→3 is the failover order for UTXO lookup, `getrawtransaction`, and broadcast
(`convex/zcashHelpers.ts`: `fetchUtxos`, `getRawTransactionVerbose`, `broadcastTransaction`).
Tatum cannot serve `getaddressutxos` or `decoderawtransaction`, so with the primary RPC down
UTXOs come from Blockchair only.

## 2. Environment variables

### Vercel project (Next.js)

| Name | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | yes | Production Convex deployment URL. Used by the browser and by `/api/inscriptions/status/[id]`. |
| `NEXT_PUBLIC_ZCASH_RPC_URL` | yes | Defaults to `https://rpc.zatoshi.market/api/rpc`. |
| `ZCASH_RPC_USERNAME`, `ZCASH_RPC_PASSWORD` | yes | Basic auth for the proxy. The code reads `ZCASH_RPC_USERNAME`; `ZCASH_RPC_USER` is ignored. |
| `ORDINAL_INDEX_API_BASE` | yes | zord base URL, e.g. `http://<host>:3333`. Defaults to `http://135.181.6.234:3333`. |
| `TATUM_API_KEY` | recommended | Server-side fee estimate route and status fallback. |
| `BLOCKCHAIR_API_KEY` | recommended | Raises Blockchair rate limits. |
| `NEXT_PUBLIC_SITE_URL` | optional | OG images. |

### Convex deployment (dashboard → Settings → Environment Variables)

| Name | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_ZCASH_RPC_URL`, `ZCASH_RPC_USERNAME`, `ZCASH_RPC_PASSWORD` | yes | Same values as Vercel. |
| `ZCASH_RPC_TIMEOUT_MS` | optional | Primary RPC timeout before failover, default 8000. |
| `TATUM_API_KEY` | yes | Consensus branch id, tx lookup, broadcast fallback. Free tier is 3 req/s. |
| `BLOCKCHAIR_API_KEY` | recommended | UTXO and tx fallback. |
| `ZCASH_CONSENSUS_BRANCH_ID` | only if all providers are blocked | Hex, e.g. `0x37A5165B` (NU6.3). Update at each network upgrade. |

### RPC proxy host (`index.zatoshi.market/server-rpc.js`)

| Name | Notes |
|---|---|
| `ZCASH_RPC_URL`, `ZCASH_RPC_USER`, `ZCASH_RPC_PASSWORD` | Node RPC. Remove the hardcoded defaults in `server.js:5-11` and `server-rpc.js:72-73` before deploying. |
| `RPC_API_USER`, `RPC_API_PASSWORD` | Basic auth the frontend/Convex present. Must match `ZCASH_RPC_USERNAME`/`ZCASH_RPC_PASSWORD` above. |
| `PORT` | 9999 for `server-rpc.js` (the one `rpc.zatoshi.market` fronts), 8888 for the dashboard `server.js`. |

### zord indexer (`zord/.env.example`, `index.zatoshi.market/zord-docker/docker-compose.yml`)

`ZCASH_RPC_URL`, `ZCASH_RPC_USERNAME`, `ZCASH_RPC_PASSWORD`, `ZSTART_HEIGHT=3132356`,
`API_PORT=3333`, `DB_PATH=/data/zord.db`, `RUST_LOG=info`. `ZMQ_URL` is optional and must be
left unset with Zebra (no ZMQ); zord then polls every 10 s. `FORCE_START=1` re-indexes from
`ZSTART_HEIGHT` once (fixed 2026-09-10; previously looped on one block).

## 3. Node and RPC dependencies

**zcashd is gone.** Every zcashd binary halted at block 3,417,100 on 2026-07-18 and NU6.3
(consensus branch `0x37A5165B`) activated at 3,428,143. The node tier must be
[Zebra](https://zebra.zfnd.org/) (`zebrad`). Nothing in `install-zcashd.sh`, `zcash.conf`,
or `zcash.service` in `index.zatoshi.market` applies any more.

RPC methods the stack calls, and Zebra support (verified against Tatum's Zebra node 2026-09-10):

| Method | Caller | Zebra |
|---|---|---|
| `getblockchaininfo` (consensus.nextblock) | branch id, node-status | yes |
| `getaddressutxos`, `getaddressbalance`, `getaddresstxids` | UTXO fetch, balance | yes |
| `getrawtransaction txid 1` (vin.scriptSig.hex/asm, blockhash, height, confirmations) | inscription safety check, status tracker, zord | yes |
| `sendrawtransaction` | broadcast | yes |
| `getblockcount`, `getblockhash`, `getblock <h> 1` | zord | yes |
| `gettxout`, `getmempoolinfo`, `getrawmempool`, `getnetworkinfo`, `getpeerinfo`, `getinfo` | node-status, dashboard | yes |
| `getaddressmempool` | `/api/zcash/inscriptions/[address]` pending view | **not in Zebra**; route must tolerate the error |
| `decoderawtransaction` | `/api/zcash/broadcast` pre-flight guard | **not in Zebra**; guard fails closed. The Convex mint path does not use it. |
| `estimatefee` | nothing (allowlisted only) | no |

`zebrad.toml` minimum for this stack:

```toml
[network]
network = "Mainnet"
[rpc]
listen_addr = "127.0.0.1:8232"
enable_cookie_auth = false        # proxy uses user/password; or keep cookie auth and read it in the proxy
[state]
cache_dir = "/mnt/blockchain/zebra"
```

Zebra serves `getaddress*` without extra index flags. Initial sync is ~1 day on NVMe.

## 4. Restart / recovery

Order matters: node → proxy → indexer → Convex → Vercel. After each step run
`node scripts/ops/preflight.mjs` (add `SITE_URL=https://www.zatoshi.market` at the end).

1. **Host.** 135.181.6.234 (Hetzner) is unreachable on every port. Recover it or provision a
   new one; the Cloudflare records for `rpc.zatoshi.market` and `mempool.zatoshi.market` must
   point at the new origin.
2. **Node.** Install `zebrad`, sync to tip, confirm
   `curl -s localhost:8232 -d '{"method":"getblockchaininfo"}'` returns `consensus.nextblock`.
3. **RPC proxy.** In `index.zatoshi.market`: `PORT=9999 node server-rpc.js` under systemd
   (not `/tmp`). Rotate `RPC_API_PASSWORD` and the node password first; both are in git history.
4. **Indexer.** `cd index.zatoshi.market/zord-docker && docker compose up -d --build`
   (builds `../zord`). Health: `curl :3333/health` and `:3333/api/v1/healthz` → `synced: true`.
   Only `/api/v1/healthz` is honest; `/status.synced` is hardcoded `true`.
5. **Convex.** The dev deployment `whimsical-peccary-215` is disabled ("exceeded the free
   plan limits"). Production bundles use `cool-panda-546`, which currently returns a generic
   Server Error on read queries. Upgrade/unblock in the Convex dashboard, then from a login
   with project access: `npx convex deploy` (pushes `crons.ts` and `inscriptionStatusActions.ts`).
6. **Vercel.** Set the variables in §2, redeploy. `next.config.mjs` allowlists the indexer host
   in `connect-src`; change it if the indexer moves.

Recovery of a stuck inscription: `GET /api/inscriptions/status/<txid>` forces a live check
and persists `confirmed`/`failed`. Rows older than 24 h that no provider can see become
`failed`; the user's funds are untouched because a dropped commit never left the mempool.

## 5. Verifying on a test network

The code is network-agnostic except for the mainnet fallbacks (Tatum and Blockchair are
mainnet endpoints) and `zebrad`'s network setting. To run the full path on testnet:

1. `zebrad` with `network = "Testnet"`; proxy and zord pointed at it (`ZSTART_HEIGHT` = a recent
   testnet height).
2. Convex dev deployment env: `NEXT_PUBLIC_ZCASH_RPC_URL` = testnet proxy, **unset**
   `TATUM_API_KEY` and `BLOCKCHAIR_API_KEY` so fallbacks cannot leak to mainnet, and set
   `ZCASH_CONSENSUS_BRANCH_ID` from the testnet node's `consensus.nextblock` (branch ids are
   shared across networks; activation heights differ).
3. Fund a `tm…` address from the testnet faucet. `addressToPkh` accepts any 2-byte version
   prefix, so `tm` addresses work; note it also does not reject P2SH `t3/t2` inputs.
4. Run the acceptance tests in `docs/RESTART_REPORT.md` §3 against `npm run dev`.

Cost of a mainnet smoke test with the defaults: 20,000 zats platform fee + 50,000 network fee
+ 50,547 inscription output ≈ 0.0012 ZEC.
