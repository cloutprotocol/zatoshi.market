# Seeker / Solana / Privy / Flutter → Zcash inscriptions — research

Date: 2026-09-10. Purpose: verify the assumptions in the pasted "harness" plan before
re-platforming, and propose the smallest architecture that ships on the Seeker.

## 1. Corrections to the pasted plan

| Claim in the plan | Reality | Source |
|---|---|---|
| Build an **iOS** harness with a hidden WKWebView running the Privy JS SDK | The Seeker is an **Android** phone (MediaTek Dimensity 7300, Android). iOS is irrelevant to the Seeker, and Privy ships **native Android/iOS SDKs and an official Flutter plugin**; no WebView bridge is needed. | Decrypt review; pub.dev privy_flutter |
| Privy "does not have a native SDK for Solana embedded wallets" | `privy_flutter` 0.10.1 creates non-custodial Solana embedded wallets (`createSolanaWallet()`), Android API 27+, iOS 17+. | pub.dev privy_flutter |
| Use `signTransaction` / `signAndSendTransaction` | **Those exist only in the React/Expo SDKs.** The Flutter and Android Solana provider expose **`signMessage(String base64)`** only, documented as "a Base64 encoded message *or transaction*". You build the transaction yourself, sign its serialized message bytes through Privy, append the signature, and broadcast via your own RPC. | pub.dev API docs; docs.privy.io/basics/flutter/quickstart |
| Zcash inscriptions use `OP_FALSE OP_IF … OP_ENDIF` | Our indexer and CLI use the Zerdinals format: a bare `"ord" OP_1 <mime> OP_0 <data>` push sequence in the **reveal scriptSig of a P2SH spend**, redeem script `<pubkey> OP_CHECKSIGVERIFY OP_DROP×N OP_1`. See `docs/SYSTEM_ARCHITECTURE.md`. | this repo |
| "Solana Rails … locks SOL and emits proofs, a decentralized relayer funds Zcash" | No such generic product exists. What exists: **NEAR Intents 1Click API** (SOL/USDC → native ZEC to a Zcash address, solver-based, non-custodial), and SwapKit routing over NEAR Intents / THORChain / Maya. Transparent `t1` destinations are supported. | docs.near-intents.org; swapkit.dev |
| "$SKR is a standard SPL token" | Correct. Mint `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`, 10B initial supply, staking to Guardians, dApp Store curation governance. | solanamobile.com/skr |

## 2. Verified facts

### Seeker device and ecosystem
- Android phone from Solana Mobile, shipped August 2025. Built-in **Seed Vault** keeps keys in the device's secure environment; the **Seed Vault Wallet** (with Solflare) is the system wallet.
- **Seeker Genesis Token (SGT)**: Token-2022 NFT, one per device, limited transferability. Ownership check pattern from Solana Mobile docs: wallet holds an SGT (mint authority `GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4`) + user signs a message + track used mints. This is how you gate "Seeker-only" perks.
- **dApp Store** accepts Android APKs (and PWAs wrapped as APKs). Publisher policy covers illegal, hateful, misleading content and data-disclosure rules; it does **not** mandate Mobile Wallet Adapter or forbid embedded wallets. Financial-service apps must hold required regulatory documentation.
- **SKR**: mint `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`; 30% airdrops, 10% community treasury; staking yield shown ~16%; governance via Guardians who curate the dApp Store.

### Flutter tooling
| Package | Publisher | Version | Use |
|---|---|---|---|
| `privy_flutter` | Privy | 0.10.1 | auth (email, SMS, passkey, OAuth, SIWS), Solana embedded wallet, `signMessage` |
| `solana` | cryptoplease.com (Espresso Cash) | 0.32.0+1 | RPC client, tx building/encoding, SPL Token + ATA programs, memo, offline signing |
| `solana_mobile_client` | cryptoplease.com | 0.1.2 (15 months old) | Mobile Wallet Adapter client (Seed Vault / Phantom) on Android; `authorize`, `signTransactions`, `signAndSendTransactions` |

Solana Mobile officially maintains Kotlin and React Native SDKs; Flutter MWA is community-maintained by Espresso Cash.

### Solana → ZEC liquidity
- NEAR Intents 1Click API: quote → deposit to a quote-specific address → status. "1Click does not take custody". API keys/JWT documented under "Keys". Live token list (`GET https://1click.chaindefuser.com/v0/tokens`, 253 assets) includes native ZEC `nep141:zec.omft.near` (8 decimals), native SOL `nep141:sol.omft.near`, Solana USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, and a wrapped ZEC SPL on Solana `A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS`.
- SwapKit (aggregator over NEAR Intents, THORChain, Maya, Chainflip) offers ZEC with transparent-address destinations at launch.
- Zashi (ECC's wallet) uses NEAR Intents for private swaps, so the route is production-proven.

## 3. Recommended architecture (smallest thing that ships)

Do **not** bridge per inscription. An inscription costs ~0.0012 ZEC in fees; a cross-chain
swap per mint adds minutes of latency, a minimum-size floor, and a failure mode the user
can't recover from. Instead:

```
Seeker (Flutter)                                    Backend (existing pieces)
┌──────────────────────────────┐                    ┌────────────────────────────────┐
│ privy_flutter: login,        │  1. pay SKR/USDC   │ Solana payment verifier        │
│   Solana embedded wallet     │ ───────────────►   │   (RPC: confirm transfer to     │
│ solana: build SPL transfer   │                    │    treasury ATA + memo=orderId) │
│   to treasury, memo=orderId  │                    │                                │
│ Privy signMessage(tx bytes)  │  2. POST /orders   │ Order table (Convex or Postgres)│
│ solana: sendRawTransaction   │ ───────────────►   │                                │
│                              │                    │ Inscriber (server-side ZEC hot │
│ 3. GET /orders/:id  ◄──────────────────────────── │  wallet, commit/reveal via     │
│    pending → inscribed → confirmed                │  Zebra RPC; existing builder)  │
└──────────────────────────────┘                    │ zord indexer → content/status  │
                                                    └────────────────────────────────┘
        treasury ZEC replenished periodically via NEAR Intents 1Click (SOL/USDC → t1…)
```

- **Payment rail**: user pays in SKR or USDC on Solana. Verification is a `getTransaction`
  lookup for a transfer to your treasury's associated token account with a memo carrying the
  order id. This is the "Solana rails" part; it needs no bridge.
- **Inscription**: the server-side commit/reveal builder already exists (Convex
  `zcashHelpers.ts`, or the `.codex` zainscribe CLI once its branch id is made dynamic).
  The platform hot wallet pays ZEC fees. This is exactly how the 1,856 ZGODS were minted.
- **Ownership**: the inscription's destination `t1` address is either (a) a platform-custodied
  per-user address recorded on the order, with a later "export to Zashi" path, or (b) an
  address the user pastes from Zashi. Start with (a) with clear disclosure; it is the only
  option a Seeker user without a Zcash wallet can use in one tap.
- **Treasury top-up**: convert accumulated SKR/USDC to ZEC in batches with the 1Click API to
  a transparent treasury address. One swap per day/week, not per mint.
- **Seeker gating**: verify SGT ownership + signed message to unlock Seeker-only collections
  or SKR-denominated pricing.

### Signing detail that decides feasibility in Flutter
Privy's Flutter Solana provider only signs bytes. The flow per payment is:
1. `solana` package: build `Message` (SPL `transferChecked` to treasury ATA + `Memo`), fetch
   recent blockhash, `compile()` → message bytes.
2. `privy` `embeddedSolanaWallets.first.provider.signMessage(base64(messageBytes))` →
   base64 ed25519 signature.
3. Assemble `SignedTx(signatures: [sig], compiledMessage)` and `rpcClient.sendTransaction`.
Confirm this end-to-end on devnet in the first spike; if Privy's provider rejects raw
transaction bytes on Android, fall back to Mobile Wallet Adapter (`solana_mobile_client`) with
the Seed Vault Wallet, which natively signs and sends.

### Alternative without Privy
On a Seeker every user already has the Seed Vault Wallet. MWA gives one-tap signing with
device-secured keys and no auth service. Privy adds email/passkey onboarding and a wallet that
also works off-Seeker (iOS, web). Decide based on whether non-Seeker users matter at launch.

## 4. Open questions to settle before the spike
1. Custody stance for the Zcash side: platform-held `t1` per user vs. user-supplied address.
2. Which token is the price denominated in (SKR is volatile; USDC is simpler for refunds).
3. Whether the dApp Store listing needs the app to work without Privy (MWA-only path) for
   review.
4. Do we keep Convex for orders or move to Postgres alongside the Zebra host.

## 5. Sources
- Privy Flutter: https://pub.dev/packages/privy_flutter , https://docs.privy.io/basics/flutter/quickstart , https://pub.dev/documentation/privy_flutter/latest/
- Privy Android: https://docs.privy.io/basics/android/quickstart
- Privy React Solana (for contrast): https://docs.privy.io/wallets/using-wallets/solana/send-a-transaction
- SKR: https://solanamobile.com/skr
- Seeker Genesis Token verification: https://docs.solanamobile.com/marketing/engaging-seeker-users
- dApp Store publishing: https://docs.solanamobile.com/dapp-publishing/intro , policy https://legal.solanamobile.com/publisher-policy-web
- Seed Vault: https://docs.solanamobile.com/developers/seed-vault
- Seeker hardware: https://decrypt.co/336582/solana-seeker-review-more-measured-crypto-phone
- Flutter packages: https://pub.dev/packages/solana , https://pub.dev/packages/solana_mobile_client
- NEAR Intents 1Click: https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api , token list https://1click.chaindefuser.com/v0/tokens
- SwapKit Zcash: https://swapkit.dev/blog/swapkit-zcash-integration/ , https://swapkit.dev/near-intents/
- Zashi + NEAR Intents: https://www.coindesk.com/markets/2025/10/09/near-intents-activity-spikes-as-zcash-s-zashi-wallet-taps-it-for-private-swaps
