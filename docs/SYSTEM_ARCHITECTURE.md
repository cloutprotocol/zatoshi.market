# Zatoshi.market System Architecture Report

**Document Version:** 1.0
**Date:** December 4, 2025
**Platform:** Zcash Zerdinals Marketplace & Inscription Platform

---

## Executive Summary

Zatoshi.market is a **full-stack Zcash marketplace** for Zerdinals (Zcash Ordinals) inscriptions, ZRC-20 tokens, and ZRC-721 NFTs. The platform implements a **non-custodial, trustless trading system** using PSBT (Partially Signed Bitcoin Transactions) with SIGHASH_SINGLE|ANYONECANPAY signatures for maker-taker trading.

**Key Capabilities:**
- ✅ **Inscription Service**: P2SH commit-reveal inscription creation with ZIP-243 signing
- ✅ **Trustless Marketplace**: PSBT-based trading without custodial wallets
- ✅ **ZRC-20 Tokens**: Full token indexing, balances, and transfers
- ✅ **ZRC-721 NFTs**: Collection support with metadata
- ✅ **Inscription Protection**: Automatic UTXO safety checks to prevent NFT loss
- ✅ **Multi-Provider RPC**: Resilient broadcast with failover (Zatoshi RPC → Tatum → Blockchair)

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ZATOSHI.MARKET PLATFORM                        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐         ┌──────────────────┐         ┌──────────────┐
│   Web Frontend  │ ◄─────► │  Next.js API     │ ◄─────► │   Convex     │
│   (React/Next)  │         │   (Proxies)      │         │  (Backend)   │
└─────────────────┘         └──────────────────┘         └──────────────┘
        │                            │                            │
        │                            │                            │
        v                            v                            v
┌─────────────────┐         ┌──────────────────┐         ┌──────────────┐
│  User Wallet    │         │  RPC Services    │         │  Database    │
│  (Client-Side)  │         │  - Zatoshi RPC   │         │  (Convex)    │
│  - Sign Txs     │         │  - Tatum         │         │              │
│  - Noble Secp   │         │  - Blockchair    │         │  Tables:     │
└─────────────────┘         └──────────────────┘         │  - listings  │
                                     │                    │  - sales     │
                                     │                    │  - utxoLocks │
                                     v                    │  - contexts  │
                            ┌──────────────────┐         └──────────────┘
                            │  Zcash Mainnet   │
                            │  (Full Node)     │         ┌──────────────┐
                            │  - zcashd        │ ◄─────► │   Indexer    │
                            │  - ZIP-243       │         │  (Ordinals)  │
                            │  - InsightAPI    │         │              │
                            └──────────────────┘         │  Endpoints:  │
                                                          │  - ZRC-20    │
                                                          │  - ZRC-721   │
                                                          │  - Transfers │
                                                          └──────────────┘
```

---

## 1. RPC Infrastructure

### 1.1 Primary RPC Endpoint

**Location:** `convex/zcashHelpers.ts:471-514`

**Endpoint:** `rpc.zatoshi.market/api/rpc`

**Features:**
- JSON-RPC 2.0 interface to zcashd full node
- InsightAPI extensions (getaddressutxos, getaddressbalance, etc.)
- Origin-based authentication (dev.zatoshi.market, zatoshi.market)
- Basic Auth fallback for localhost development

**Key Methods:**
```typescript
// Blockchain queries
getblockchaininfo    // Network status + consensus branch ID
getrawtransaction    // Fetch transaction by txid (decoded with vins/vouts)
gettxout             // Check if UTXO is unspent
getaddressutxos      // Get all UTXOs for an address (InsightAPI)

// Transaction broadcast
sendrawtransaction   // Broadcast signed transaction
decoderawtransaction // Debug transaction hex

// Consensus
getblockchaininfo -> consensus.nextblock  // Current network branch ID (NU5: 0xf919a198)
```

### 1.2 Consensus Branch ID Management

**Location:** `convex/zcashHelpers.ts:335-423`

**Purpose:** ZIP-243 sighash requires the correct consensus branch ID for transaction signing.

**Strategy:**
1. **Live Fetch:** Query `getblockchaininfo` from RPC
2. **10-Minute Cache:** Avoid rate limits
3. **Fallback Chain:** Tatum → Mainnet Explorer → Env Override → NU5 Constant (0xf919a198)

**Important:** For v4 transactions, the system uses the **current network branch ID**, not a historical one like Canopy (0xe9ff75a6). This is why developers see signature mismatches if they hardcode old branch IDs.

```typescript
const branchId = await getConsensusBranchId();
// Returns: 0xf919a198 (NU5 mainnet as of 2025)
```

### 1.3 Broadcast Infrastructure

**Location:** `convex/zcashHelpers.ts:522-623`

**Multi-Provider Failover:**
```
1. Zatoshi RPC (Primary)
   ↓ (if fails)
2. Tatum JSON-RPC
   ↓ (if fails)
3. Blockchair Push API
   ↓ (if all fail)
Error with aggregated messages
```

**Error Handling:**
- Recognizes "transaction already in block chain" (code -27) and returns computed txid
- Detects mempool conflicts and re-throws immediately (not retryable)
- Sanitizes provider-specific error messages for user-friendly output

**Tolerant TXID Parser:**
- Recursively searches JSON responses for 64-char hex strings
- Handles different response formats across providers
- Logs response snippets for debugging

---

## 2. Inscription Services

### 2.1 Architecture Overview

**Pattern:** P2SH Commit-Reveal with Ordinals Envelope

**Flow:**
```
1. Commit TX:
   Input:  User UTXO (P2PKH)
   Outputs:
     - P2SH (inscription amount) → Holds inscription data
     - Platform Fee (20,000 zats) → Treasury
     - Change → User

2. Reveal TX:
   Input:  P2SH UTXO (with inscription data in scriptSig)
   Output: Inscription UTXO → User (final inscribed token)
```

### 2.2 Server-Signed Flow (Legacy)

**Location:** `convex/inscriptionsActions.ts:45-287`

**Action:** `mintInscriptionAction`

**Parameters:**
```typescript
{
  wif: string,              // Private key for server-side signing
  address: string,          // User's t-address
  contentJson?: string,     // ZRC-20/ZRC-721 JSON
  contentType?: string,     // MIME type
  inscriptionAmount: number, // P2SH lock amount (default 50k zats)
  fee: number               // Network fee (≥20k zats for ZIP-317)
}
```

**Process:**
1. Fetch UTXOs from user address
2. Filter for safe (non-inscribed) UTXOs via indexer
3. Lock selected UTXO in `utxoLocks` table (prevents races)
4. Build commit transaction with platform fee
5. Sign with ZIP-243 sighash (SIGHASH_ALL)
6. Broadcast commit → wait 8s for propagation
7. Build reveal transaction with inscription data
8. Broadcast reveal → unlock UTXO → persist inscription record

**ZIP-317 Fee Floor:** 20,000 zats minimum (enforced for mempool acceptance)

### 2.3 Client-Signed Flow (Production)

**Location:** `convex/inscriptionsActions.ts:574-1016`

**Three-Phase Pattern:**

#### Phase 1: Prepare Commit
**Action:** `buildUnsignedCommitAction`

```typescript
const { contextId, commitSigHashHexes, inputs } = await buildUnsignedCommitAction({
  address,
  pubKeyHex,
  contentJson: '{"p":"zrc-721","op":"mint","collection":"ZGODS","id":"8"}',
  contentType: "application/json",
  inscriptionAmount: 60000,
  fee: 50000
});
```

**Returns:** Sighash preimage for client to sign (ZIP-243 SIGHASH_ALL)

#### Phase 2: Finalize Commit & Get Reveal Preimage
**Action:** `finalizeCommitAndGetRevealPreimageAction`

```typescript
const { commitTxid, revealSigHashHex } = await finalizeCommitAndGetRevealPreimageAction({
  contextId,
  commitSignaturesRawHex: [clientSignature] // 64-byte raw signature
});
```

**Process:**
- Assemble commit transaction with client's signature
- Broadcast commit
- Wait 8 seconds for network propagation
- Poll Tatum RPC for commit confirmation (best-effort)
- Return reveal sighash for client to sign

#### Phase 3: Broadcast Reveal
**Action:** `broadcastSignedRevealAction`

```typescript
const { revealTxid, inscriptionId } = await broadcastSignedRevealAction({
  contextId,
  revealSignatureRawHex: clientRevealSignature
});
```

**Process:**
- Assemble reveal transaction with client's signature
- Embed inscription data in scriptSig (Ordinals envelope format)
- Broadcast with 3 retry attempts (2s delay between)
- Unlock UTXOs on success/failure
- Award user points (POINTS_PER_MINT = 10)

### 2.4 Inscription Data Format (Ordinals Envelope)

**Location:** `convex/zcashHelpers.ts:93-122`

**Standard Format:**
```
OP_PUSH "ord"        [3 bytes: 6f7264]
OP_1                 [0x51 - content type tag]
OP_PUSH <mime>       [e.g., "application/json"]
OP_0                 [0x00 - content tag]
OP_PUSH <content>    [chunked if > 520 bytes]
```

**Critical Implementation Detail:**
- Numbers 0-16 MUST use opcodes (OP_0 = 0x00, OP_1 = 0x51), **not** data pushes
- Violation triggers `SCRIPT_VERIFY_MINIMALDATA` error
- Content > 520 bytes automatically chunked (MAX_SCRIPT_ELEMENT_SIZE)

**Example (ZRC-721 Mint):**
```json
{"p":"zrc-721","op":"mint","collection":"ZGODS","id":"8"}
```

Encoded as:
```
03 6f7264       OP_PUSH(3) "ord"
51              OP_1
10 6170706...   OP_PUSH(16) "application/json"
00              OP_0
2d 7b2270...    OP_PUSH(45) {...} (JSON bytes)
```

### 2.5 UTXO Safety System

**Location:** `convex/zcashHelpers.ts:752-778`

**Protection Strategy:**
1. **Check Indexer:** Query ordinal index for inscription at UTXO location
2. **Fail-Safe:** If indexer unreachable, assume UTXO is inscribed (prevents loss)
3. **Lock System:** `utxoLocks` table prevents concurrent usage

**checkInscriptionAt:**
```typescript
const hasInscription = await checkInscriptionAt(`${txid}:${vout}`);
// Returns true if:
// - UTXO holds an inscription (scriptSig contains "6f7264" = "ord")
// - RPC call fails (fail-safe)
// - Transaction not found (fail-safe)
```

**Locking Mechanism:**
- Lock before creating commit transaction
- Unlock after reveal broadcast (success or failure)
- Prune stale locks (> 10 minutes old)

---

## 3. Marketplace System (PSBT Trading)

### 3.1 Overview

**Pattern:** Maker-Taker with PSBT (Partially Signed Bitcoin Transactions)

**Location:** `convex/psbt.ts`

**Key Innovation:** Sellers pre-sign their token input with **SIGHASH_SINGLE|ANYONECANPAY (0x83)**, allowing buyers to add their own inputs without invalidating the seller's signature.

### 3.2 Trade Flow

#### Step 1: Seller Creates Listing

**Action:** `createListing`

```typescript
// 1. Validate ZRC-20 transfer ownership
const transferInfo = await validateZrc20Transfer({
  sellerAddress,
  tokenLocation: "txid:vout",
  tokenTicker: "PEPE",
  expectedAmountBase: "100000000000000", // 1M PEPE (18 decimals)
  tokenDecimals: 18
});

// 2. Pre-sign seller input with SIGHASH_SINGLE|ANYONECANPAY
const sellerSignature = signInput(
  tokenUtxo,
  outputs, // [token→buyer, payout→seller, fee→treasury]
  0x83     // SIGHASH_SINGLE | ANYONECANPAY
);

// 3. Store listing
await createListing({
  tokenLocation,
  sellerAddress,
  price: 0.01, // ZEC
  sellerScriptSigHex: bytesToHex(sellerSignature),
  sellerPayoutZats: 9750000,    // After 2.5% marketplace fee
  sellerPayoutScriptHex,        // Seller's payout script (P2PKH)
  sellerInputSequence: 0xfffffffd,
  tokenValueZats: 50000         // Token UTXO value
});
```

**Critical Fields:**
- `sellerScriptSigHex`: Pre-signed scriptSig (signature + pubkey) - **IMMUTABLE**
- `sellerPayoutZats`: Exact payout amount seller signed for
- `sellerPayoutScriptHex`: Seller's payout script (must match signature)
- `sellerInputSequence`: Part of sighash (must match when buyer assembles tx)

#### Step 2: Buyer Prepares Transaction

**Action:** `prepareBuyerTemplate`

```typescript
const template = await prepareBuyerTemplate(listingId, buyerAddress);

// Returns canonical output structure:
{
  outputs: [
    { index: 0, kind: 'token', valueZats: 50000, scriptHex: buyerP2PKH },
    { index: 1, kind: 'sellerPayout', valueZats: 9750000, scriptHex: sellerPayoutScript },
    { index: 2, kind: 'treasury', valueZats: 250000, scriptHex: treasuryP2PKH }
  ]
}
```

**Output Order is CRITICAL:**
- SIGHASH_SINGLE binds seller input at **vin index 1** to **vout index 1**
- Any reordering causes "mandatory-script-verify-flag-failed"

#### Step 3: Buyer Assembles & Broadcasts

**Action:** `finalizeAndBroadcast`

**Buyer's Transaction Structure:**
```
Inputs:
  0: Buyer payment input(s) (signed with SIGHASH_ALL)
  1: Seller token input (pre-signed with SIGHASH_SINGLE|ANYONECANPAY) ← MUST BE INDEX 1
  2+: Buyer change inputs (if needed)

Outputs:
  0: Token → Buyer (50k zats)
  1: Seller Payout (9.75M zats) ← Bound to seller's signature
  2: Marketplace Fee (250k zats)
  3+: Buyer change (if needed)
```

**Validation Steps:**
1. Verify listing still active
2. Verify token UTXO unspent
3. Re-validate ZRC-20 transfer ownership
4. Parse transaction and verify outputs match template
5. Verify seller input at vin index 1
6. Verify `sellerScriptSigHex` matches
7. Verify `sellerInputSequence` matches (part of sighash!)
8. Protect buyer from spending inscribed UTXOs
9. Broadcast transaction

**Success:** Listing marked `completed`, sale recorded in `sales` table

### 3.3 Why SIGHASH_SINGLE|ANYONECANPAY?

**SIGHASH_SINGLE (0x03):**
- Seller's signature binds to **ONLY output 1** (their payout)
- Doesn't care about other outputs (buyer's token, change, etc.)
- **BUT:** Input index MUST match output index (vin 1 → vout 1)

**ANYONECANPAY (0x80):**
- Seller's signature covers **ONLY their input**
- Buyer can add more inputs to pay the price
- Enables trustless maker-taker without coordinator

**Combined (0x83):**
```
Seller signs:
  - Their token input (vin 1)
  - Binding it to their payout output (vout 1)
  - Buyer free to add inputs/outputs around it
```

### 3.4 Common Signature Mismatch Causes

**Error:** "mandatory-script-verify-flag-failed"

**Root Causes:**
1. **Output ordering changed** → Seller signed [token, payout, treasury] but buyer assembled differently
2. **Payout amount changed** → `sellerPayoutZats` doesn't match what seller signed
3. **Seller input not at vin 1** → SIGHASH_SINGLE binds to output at same index
4. **Sequence mismatch** → Buyer used different sequence number than seller signed
5. **Stale listing** → Seller spent/replaced token UTXO

**Debug:**
```typescript
// Compare stored vs actual
console.log("Stored payout:", listing.sellerPayoutZats);
console.log("Actual output 1:", outs[1].value);
console.log("Stored sequence:", listing.sellerInputSequence);
console.log("Actual sequence:", inputs[1].sequence);
```

---

## 4. Indexer Infrastructure

### 4.1 Ordinal Index API

**Base URL:** `http://135.181.6.234:3333` (proxied via `/api/ordinal-index`)

**Location:** `src/services/ordinalIndex.ts`

**Features:**
- ZRC-20 token balances, transfers, and supply tracking
- ZRC-721 collection metadata and ownership
- Zerdinals names (.zec domains)
- Inscription ownership validation
- Transfer usage tracking (prevents double-spend)

### 4.2 Key Endpoints

#### ZRC-20 Tokens

**Get Token List:**
```
GET /api/v1/tokens?page=0&limit=100&q=PEPE
```

**Get Token Balances:**
```
GET /api/v1/zrc20/token/{tick}/balances?page=0&limit=100&positive_only=true
```

**Get Transfer Details:**
```
GET /api/v1/zrc20/transfer/{inscriptionId}
```

Returns:
```json
{
  "transfer": {
    "tick": "PEPE",
    "amt": "1000000000000000000", // 1 PEPE (18 decimals)
    "sender": "t1abc...",
    "receiver": null
  },
  "used": false,       // Has this transfer been used?
  "outpoint": "txid:vout",
  "inscription_id": "txidi0"
}
```

**Critical:** `used` flag prevents double-spending of transfer inscriptions

#### ZRC-721 Collections

**Get Collections:**
```
GET /api/v1/zrc721/collections?page=0&limit=50
```

**Get Collection Tokens:**
```
GET /api/v1/zrc721/collection/{slug}/tokens?page=0&limit=200
```

#### Health & Status

**Indexer Health:**
```
GET /api/v1/healthz
```

**ZRC-20 Status:**
```
GET /api/v1/zrc20/status
```

Returns sync status and indexed token count.

### 4.3 Transfer Validation Flow

**Location:** `convex/psbt.ts:193-271`

**Used by:** Marketplace listing creation & purchase validation

```typescript
async function assertValidZrc20Transfer(args: {
  sellerAddress: string;
  tokenLocation: string; // "txid:vout"
  tokenTicker: string;
  expectedAmountBase?: string; // Base units (with decimals)
  tokenDecimals?: number;
}): Promise<ZrcTransferValidationResult>
```

**Validation Steps:**
1. Query indexer for transfer details
2. Verify transfer not already used (`used: false`)
3. Verify ticker matches
4. Verify sender matches seller address
5. Verify outpoint matches token location
6. Verify amount matches (if provided)
7. Query RPC to verify UTXO ownership via scriptPubKey
8. Query RPC to verify UTXO unspent

**Returns:**
```typescript
{
  txid: string,
  vout: number,
  tokenValueZats: number,    // UTXO value in zatoshis
  inscriptionId: string,
  tick: string,
  amtBase: bigint,          // Token amount in base units
  senderAddress: string
}
```

**Fail-Safe:** If validation fails, throws detailed error (prevents invalid listing)

---

## 5. Database Schema (Convex)

### 5.1 Core Tables

**Location:** `convex/schema.ts`

#### `inscriptions`
```typescript
{
  txid: string,              // Reveal transaction ID
  address: string,           // Owner address
  contentType: string,       // MIME type
  contentPreview: string,    // First 200 chars
  contentSize: number,       // Bytes
  type: string,              // "zrc20" | "zrc721" | "text" | "image"
  platformFeeZat: number,    // Platform fee paid
  treasuryAddress: string,   // Fee recipient
  zrc20Tick?: string,        // Token ticker (if ZRC-20)
  zrc20Op?: string,          // Operation (deploy/mint/transfer)
  zrc20Amount?: string       // Amount (if transfer)
}
```

#### `psbtListings`
```typescript
{
  tokenLocation: string,         // "txid:vout" of token UTXO
  sellerAddress: string,
  price: number,                 // ZEC
  status: "active" | "completed" | "cancelled",

  // ZRC-20 metadata
  tokenTicker?: string,
  tokenAmount?: number,          // Human-readable
  tokenAmountBase?: string,      // Base units (bigint as string)
  tokenDecimals?: number,

  // PSBT maker-ask fields (CRITICAL)
  sellerInputTxid?: string,
  sellerInputVout?: number,
  sellerInputSequence?: number,  // Part of sighash!
  sellerScriptSigHex?: string,   // Pre-signed signature + pubkey
  sellerPayoutZats?: number,     // Exact payout amount
  sellerPayoutScriptHex?: string,// Seller's payout script
  tokenValueZats?: number,       // Token UTXO value

  // Purchase metadata
  txid?: string,                 // Sale transaction ID
  buyerAddress?: string,
  feeZats?: number,
  createdAt: number
}
```

#### `utxoLocks`
```typescript
{
  txid: string,
  vout: number,
  address: string,
  lockedBy: string,    // Context ID or job ID
  lockedAt: number,
  expiresAt: number    // Auto-prune after 10 minutes
}
```

#### `txContexts`
```typescript
{
  contextId: string,           // Unique context ID
  status: string,              // "commit_prepared" | "commit_broadcast" | "completed"
  utxos?: Array<{txid, vout, value}>,
  address: string,
  consensusBranchId: number,
  inscriptionAmount: number,
  fee: number,
  platformFeeZats: number,
  platformTreasuryAddress?: string,
  pubKeyHex: string,           // User's public key
  redeemScriptHex: string,     // P2SH redeem script
  p2shScriptHex: string,       // P2SH script
  inscriptionDataHex: string,  // Ordinals envelope
  contentType: string,
  contentStr: string,
  type?: string,
  commitTxid?: string,         // Set after commit broadcast
  createdAt: number,
  updatedAt: number
}
```

#### `sales`
```typescript
{
  inscriptionId: string,
  sellerAddress: string,
  buyerAddress: string,
  priceZec: number,
  txid: string,
  timestamp: number,
  status: string
}
```

### 5.2 Indices

**Performance-Critical:**
- `psbtListings`: `by_token_location_status`, `by_status`, `by_ticker`, `by_seller`, `by_collection`
- `utxoLocks`: `by_txid_vout`, `by_address`, `by_expiresAt`
- `txContexts`: `by_contextId`, `by_status`
- `inscriptions`: `by_address`, `by_txid`

---

## 6. Frontend Integration

### 6.1 Key Services

**Inscription Service:**
`src/services/InscriptionService.ts` - Client-side inscription creation

**Ordinal Index API:**
`src/services/ordinalIndex.ts` - Token balances, collections, transfers

**Wallet Management:**
`src/components/WalletDrawer.tsx` - Client-side signing with @noble/secp256k1

### 6.2 Client-Side Signing

**Library:** `@noble/secp256k1`

**Process:**
```typescript
import * as secp256k1 from '@noble/secp256k1';

// 1. Get sighash from Convex
const { commitSigHashHexes } = await buildUnsignedCommitAction({...});

// 2. Sign with user's private key
const sig = await secp256k1.sign(hexToBytes(commitSigHashHexes[0]), privateKey);
const sigRaw = sig.toCompactRawBytes(); // 64 bytes (r + s)

// 3. Send signature back to Convex
const { commitTxid, revealSigHashHex } = await finalizeCommitAndGetRevealPreimageAction({
  contextId,
  commitSignaturesRawHex: [bytesToHex(sigRaw)]
});
```

**Security:** Private keys never leave the browser

---

## 7. Deployment Configuration

### 7.1 Environment Variables

**Required (Convex):**
```bash
BLOCKCHAIR_API_KEY=     # Improves UTXO fetch reliability
TATUM_API_KEY=          # Fallback RPC + broadcast
```

**Required (Next.js):**
```bash
NEXT_PUBLIC_ZCASH_RPC_URL=https://rpc.zatoshi.market/api/rpc
NEXT_PUBLIC_ZERDINALS_API_URL=https://zerdinals.com/api
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

**Optional:**
```bash
ZCASH_RPC_USERNAME=     # Basic auth for localhost
ZCASH_RPC_PASSWORD=
ZCASH_CONSENSUS_BRANCH_ID=  # Override (decimal or 0x-hex)
```

### 7.2 Convex Deployment

**Location:** `convex/how-to.md`

**Dev Deploy:**
```bash
npx convex push          # Update schema + functions
npx convex deploy        # Deploy to dev environment
```

**Prod Deploy:**
```bash
CONVEX_DEPLOYMENT=prod npx convex push
CONVEX_DEPLOYMENT=prod npx convex deploy
```

**Secrets (via Convex Dashboard):**
- `BLOCKCHAIR_API_KEY`
- `TATUM_API_KEY`

### 7.3 RPC Access Control

**Allowed Origins (No Password):**
- `https://zatoshi.market`
- `https://www.zatoshi.market`
- `https://dev.zatoshi.market`

**Requires Basic Auth:**
- `http://localhost:3000`
- `http://localhost:5173`

**Credentials:**
- Username: `zatoshi`
- Password: `ZcashRPC2024!`

---

## 8. Critical Invariants

### 8.1 Inscription Service

1. **UTXO Safety:** Never spend an inscribed UTXO (indexer check + fail-safe)
2. **Locking Discipline:** Lock UTXO before commit, unlock after reveal or failure
3. **Platform Fee:** 100,000 zats to `t1YbJR1f6fv5LkTG1avBQFH1UtRT5hGGxDh`
4. **Network Fee Floor:** ≥20,000 zats (ZIP-317 compliance)
5. **Output Order (Commit):** [P2SH inscription, platform fee, change]
6. **Reveal Wait:** 8 seconds after commit broadcast (propagation delay)
7. **Ordinals Envelope:** OP_0/OP_1 opcodes, NOT data pushes (SCRIPT_VERIFY_MINIMALDATA)

### 8.2 Marketplace (PSBT)

1. **Output Ordering:** [token, payout, treasury] - **NEVER REORDER**
2. **Seller Input Position:** MUST be at vin index 1 (SIGHASH_SINGLE requirement)
3. **Stored Payout Values:** Use `sellerPayoutZats`/`sellerPayoutScriptHex` from listing
4. **Sequence Immutability:** `sellerInputSequence` part of sighash (must match)
5. **Signature Immutability:** `sellerScriptSigHex` cannot be changed after listing
6. **Transfer Validation:** Re-check `used` flag just-in-time before broadcast

### 8.3 RPC Resilience

1. **Multi-Provider Failover:** Zatoshi → Tatum → Blockchair
2. **Tolerant Parsing:** Accept any JSON structure with 64-hex txid
3. **Consensus Branch ID Caching:** 10-minute TTL to avoid rate limits
4. **Fail-Safe Inscription Check:** Treat unreachable indexer as "inscribed"

---

## 9. Known Issues & Solutions

### 9.1 Signature Mismatch (Inscriptions)

**Error:** "mandatory-script-verify-flag (unknown error)"

**Cause:** Developer using wrong consensus branch ID (e.g., Canopy 0xe9ff75a6 instead of NU5 0xf919a198)

**Solution:** Always fetch branch ID via `getConsensusBranchId()`, never hardcode

**Debug:**
```bash
npx tsx -e "
import { getConsensusBranchId } from './convex/zcashHelpers';
getConsensusBranchId().then(id => console.log('0x' + id.toString(16)));
"
```

### 9.2 Signature Mismatch (Marketplace)

**Error:** "mandatory-script-verify-flag-failed"

**Cause:** Output values/scripts don't match what seller pre-signed

**Solution:**
1. Use `prepareBuyerTemplate` to get canonical output structure
2. Never recompute fees - use `sellerPayoutZats` from listing
3. Verify seller input at vin index 1
4. Match `sellerInputSequence` exactly

**Debug:** `convex/psbt.ts:942-990` logs all inputs/outputs before broadcast

### 9.3 Unpaid Action Limit (ZIP-317)

**Error:** "unpaid action limit exceeded"

**Cause:** Fee too low for transaction size

**Solution:** Enforce minimum 20,000 zats for small txs, scale with size for large files

**Fee Calculation (Images):**
```typescript
estimatedTxSize = 500 (base) + fileSizeBytes + 200 (overhead)
networkFee = max(estimatedTxSize * 10, 20000)
```

---

## 10. Performance Optimizations

### 10.1 UTXO Selection

**Strategy:** Greedy descending sort + lazy inscription checking

```typescript
// Sort by value descending
utxos.sort((a, b) => b.value - a.value);

// Check inscriptions only until we have enough
for (const u of utxos) {
  if (total >= required) break;
  const hasInsc = await checkInscriptionAt(`${u.txid}:${u.vout}`);
  if (!hasInsc) {
    selected.push(u);
    total += u.value;
  }
}
```

**Benefit:** Avoid checking every UTXO when user has many

### 10.2 Consensus Branch ID Caching

**Location:** `convex/zcashHelpers.ts:326-328`

```typescript
let _cachedBranchId: { value: number; expiresAt: number } | null = null;
const BRANCH_ID_TTL_MS = 10 * 60 * 1000; // 10 minutes
```

**Benefit:** Avoid RPC rate limits on high-frequency operations

### 10.3 Multi-Input Commit Transactions

**Location:** `convex/zcashHelpers.ts:934-1020`

**Feature:** Support multiple UTXOs when single UTXO insufficient

**Process:**
1. Select multiple clean UTXOs
2. Generate sighash for each input
3. Collect signatures from client
4. Assemble with all inputs

**Use Case:** User with many small UTXOs (e.g., 10 x 50k instead of 1 x 500k)

---

## 11. Security Considerations

### 11.1 Client-Side Signing (Non-Custodial)

**Approach:** All transactions signed in browser with @noble/secp256k1

**Benefits:**
- Zero custody risk
- Private keys never transmitted
- User always in control

**Drawbacks:**
- Requires client to compute signatures
- More complex UX (3 signature steps for inscription)

### 11.2 UTXO Lock System

**Purpose:** Prevent race conditions when multiple operations select same UTXO

**Implementation:**
```typescript
// Lock before using
await lockUtxo({ txid, vout, address, lockedBy: contextId });

// Unlock after completion (success or failure)
await unlockUtxo({ txid, vout });

// Auto-prune stale locks (> 10 minutes)
await pruneStaleLocks();
```

**Risk Mitigation:** Prevents double-spending of same UTXO across concurrent inscriptions

### 11.3 Transfer Usage Tracking

**Indexer Feature:** `used` flag on ZRC-20 transfers

**Marketplace Protection:**
1. Query indexer for transfer details
2. Reject if `used: true`
3. Re-validate just-in-time before broadcast (prevents TOCTOU)

**Attack Prevented:** Seller listing same transfer multiple times

### 11.4 Inscription Protection

**Guard:** `checkInscriptionAt()` before spending any UTXO

**Fail-Safe Strategy:**
- If indexer unreachable → Assume inscribed (prevents loss)
- If transaction not found → Assume inscribed
- Only mark safe if RPC confirms + no "ord" marker

**User Experience:** May reject valid UTXOs in rare cases, but prevents NFT loss

---

## 12. Monitoring & Debugging

### 12.1 Broadcast Logging

**Location:** `convex/zcashHelpers.ts:163-182`

```typescript
console.log(`[broadcast][${provider}] parsed txid from JSON`, {
  status: r.status,
  ct,
  txid: deep.slice(0, 16) + '…'
});
```

**Logged:**
- Provider name (zatoshi/tatum/blockchair)
- HTTP status
- Content-Type
- TXID (truncated)
- Response snippet (first 240 chars)

**Use Case:** Debug broadcast failures across providers

### 12.2 PSBT Validation Logging

**Location:** `convex/psbt.ts:813-990`

```typescript
console.log(`[PSBT] Broadcasting transaction for listing ${listing._id}:`, {
  listingData: {
    sellerPayoutZats: listing.sellerPayoutZats,
    sellerInputSequence: listing.sellerInputSequence,
    ...
  },
  expectedOutputs: [...],
  actualOutputs: [...],
  actualInputs: [...]
});
```

**Use Case:** Debug signature mismatches by comparing stored vs actual values

### 12.3 Convex Logs

**Access:**
```bash
CONVEX_DEPLOYMENT=dev npx convex logs --history 20
```

**Key Events:**
- Inscription steps (commit_prepared → commit_broadcast → completed)
- UTXO locking/unlocking
- Broadcast errors with provider details
- Transfer validation failures

---

## 13. Future Enhancements

### 13.1 Planned Features

1. **Batch Inscriptions:** Multi-reveal in single transaction (save fees)
2. **PSBT Offer System:** Buyers submit counter-offers (stored in `psbtOffers` table)
3. **Auction Support:** Time-based bidding for ZRC-721 NFTs
4. **Inscription Content Hosting:** IPFS integration for large files
5. **Advanced Fee Estimation:** Dynamic ZIP-317 calculation based on mempool

### 13.2 Known Limitations

1. **Single UTXO Requirement:** Inscription requires one clean UTXO ≥ required amount (workaround: Split UTXOs tool)
2. **10KB ScriptSig Limit:** Very large inscriptions may hit mempool relay limits
3. **8s Propagation Delay:** Hardcoded wait after commit (could optimize with polling)
4. **No Batch Listing Cancel:** Must cancel listings one-by-one

---

## 14. Quick Reference

### 14.1 Key Files

| Component | Location | Purpose |
|-----------|----------|---------|
| Inscription Service | `convex/inscriptionsActions.ts` | Commit-reveal inscription creation |
| ZIP-243 Helpers | `convex/zcashHelpers.ts` | Sighash, signing, broadcast, UTXO |
| PSBT Marketplace | `convex/psbt.ts` | Maker-taker trading with SIGHASH_SINGLE\|ANYONECANPAY |
| Indexer Client | `src/services/ordinalIndex.ts` | ZRC-20/ZRC-721 queries |
| RPC Helper (Next.js) | `src/app/api/zcash/rpcHelper.ts` | Server-side RPC calls |
| Frontend Wallet | `src/components/WalletDrawer.tsx` | Client-side signing |

### 14.2 Important Constants

```typescript
// Platform Fee
PLATFORM_FEE_ZATS = 100_000  // 0.001 ZEC
TREASURY_ADDRESS = "t1YbJR1f6fv5LkTG1avBQFH1UtRT5hGGxDh"

// Network Fees
ZIP317_FLOOR = 20_000  // Minimum network fee
FEE_PER_ACTION = 5_000 // ZIP-317: logical_actions × 5k

// UTXO Limits
DUST_LIMIT = 546       // Minimum output value
MIN_CHANGE = 546       // Don't create change output if < 546

// Marketplace Fees
BUYER_BPS = 0          // 0% buyer fee
SELLER_BPS = 250       // 2.5% seller fee

// Consensus
NU5_MAINNET = 0xf919a198  // Current network branch ID

// Script Limits
MAX_SCRIPT_ELEMENT_SIZE = 520  // Chunk content if larger

// Timing
COMMIT_WAIT_MS = 8000    // Wait after commit broadcast
UTXO_LOCK_TTL_MS = 600000  // 10 minutes
```

### 14.3 Common Commands

```bash
# Deploy Convex (dev)
npx convex push
npx convex deploy

# View logs
npx convex logs --limit 50

# Test inscription (server-signed)
npx convex run inscriptionsActions:mintInscriptionAction \
  --arg wif="YOUR_WIF" \
  --arg address="t1abc..." \
  --arg contentJson='{"p":"zrc-20","op":"mint","tick":"PEPE","amt":"1000"}'

# Check consensus branch ID
curl -X POST https://rpc.zatoshi.market/api/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"getblockchaininfo","params":[],"id":1}'

# Verify UTXO unspent
curl -X POST https://rpc.zatoshi.market/api/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"gettxout","params":["txid",0,true],"id":1}'
```

---

## 15. Contact & Support

**Developer:** Guide external developers to use Convex actions at `/api/ordinal-index` for indexer queries and `convex/inscriptionsActions` for inscription creation.

**Key Documentation:**
- `convex/how-to.md` - Convex deployment guide
- `docs/RPC-INTEGRATION.md` - RPC configuration
- `scripts/inscribe/BLOCKER.md` - Known JavaScript inscription issues

**Production Endpoints:**
- RPC: `https://rpc.zatoshi.market/api/rpc`
- Indexer: `http://135.181.6.234:3333` (proxied via `/api/ordinal-index`)
- Marketplace: `https://zatoshi.market`

---

## Appendix A: ZIP-243 Sighash Details

**Location:** `convex/zcashHelpers.ts:262-323`

**Implementation:** Full ZIP-243 signature hash for Zcash Sapling+ transactions

**Sighash Types:**
- `0x01` - SIGHASH_ALL (signs all inputs, all outputs)
- `0x03` - SIGHASH_SINGLE (signs all inputs, ONLY output at same index)
- `0x80` - ANYONECANPAY modifier (signs ONLY this input)
- `0x83` - SIGHASH_SINGLE|ANYONECANPAY (marketplace standard)

**Components:**
```
BLAKE2b-256 with personalization "ZcashSigHash" + branchId:
  - version (4 bytes)
  - versionGroupId (4 bytes)
  - hashPrevouts (32 bytes) - empty if ANYONECANPAY
  - hashSequence (32 bytes) - empty if ANYONECANPAY
  - hashOutputs (32 bytes) - single output if SIGHASH_SINGLE, all if SIGHASH_ALL
  - hashJoinSplits (32 bytes) - empty for transparent-only
  - hashShieldedSpends (32 bytes) - empty
  - hashShieldedOutputs (32 bytes) - empty
  - lockTime (4 bytes)
  - expiryHeight (4 bytes)
  - valueBalance (8 bytes)
  - sighashType (4 bytes)
  - prevout (36 bytes) - txid + vout
  - scriptCode (varint + bytes)
  - value (8 bytes)
  - nSequence (4 bytes)
```

**Reference:** https://zips.z.cash/zip-0243

---

**End of System Architecture Report**

*Last Updated: December 4, 2025*
