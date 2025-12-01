/**
 * PSBT (Partially Signed Bitcoin Transaction) Marketplace for Zcash ZRC-20 Tokens
 *
 * This module implements a trustless, non-custodial marketplace using the maker-taker PSBT pattern
 * with SIGHASH_SINGLE|ANYONECANPAY signatures.
 *
 * ## Architecture Overview:
 *
 * ### Maker-Taker Flow:
 *
 * 1. **Maker (Seller)** creates a listing:
 *    - Owns a ZRC-20 transfer inscription at UTXO location `txid:vout`
 *    - Pre-signs their token input with SIGHASH_SINGLE|ANYONECANPAY (0x83)
 *    - Signature binds ONLY to their payout output (output index 1)
 *    - Stores signature as `sellerScriptSigHex` in listing document
 *
 * 2. **Taker (Buyer)** completes the trade:
 *    - Calls `prepareBuyerTemplate` to get canonical output structure
 *    - Adds their own inputs to pay the price + fees
 *    - Constructs transaction with EXACT output order:
 *      - Output 0: Token UTXO → Buyer
 *      - Output 1: Seller Payout (from `sellerPayoutZats`) → Seller
 *      - Output 2: Marketplace Fee → Treasury
 *    - Places seller's pre-signed input at **vin index 1** (CRITICAL for SIGHASH_SINGLE)
 *    - Submits to `finalizeAndBroadcast` for validation + broadcast
 *
 * 3. **Validation** (in finalizeAndBroadcast):
 *    - Verify listing still active and token unspent
 *    - Re-validate ZRC-20 transfer ownership via indexer
 *    - Parse transaction and confirm outputs match template
 *    - Verify seller input at vin 1 with correct `sellerScriptSigHex`
 *    - Protect buyer from spending inscribed UTXOs
 *    - Broadcast to Zcash network via RPC
 *
 * ## Why SIGHASH_SINGLE|ANYONECANPAY?
 *
 * - **SIGHASH_SINGLE**: Seller's signature binds to ONLY output 1 (their payout)
 *   - They don't care what other outputs exist (buyer's token, change, etc.)
 *   - BUT: Input index MUST match output index (vin 1 → vout 1)
 *
 * - **ANYONECANPAY**: Seller's signature covers ONLY their input
 *   - Buyer can add more inputs to pay the price
 *   - Enables maker-taker pattern without coordinator
 *
 * ## Critical Invariants:
 *
 * 1. **Output Ordering**: MUST be [token, payout, treasury]. Never reorder.
 * 2. **Seller Input Position**: MUST be at vin index 1. Never move.
 * 3. **Stored Payout Values**: MUST use `sellerPayoutZats`/`sellerPayoutScriptHex` from listing.
 *    Do NOT recompute based on current fee rates.
 * 4. **Signature Immutability**: Once `sellerScriptSigHex` is stored, it cannot be changed.
 *    If anything needs to change (price, payout, etc.), seller must cancel and re-list.
 *
 * ## Common Errors and Solutions:
 *
 * ### "mandatory-script-verify-flag-failed"
 * - **Cause**: Seller's signature doesn't validate (sighash mismatch)
 * - **Debug**: Compare `sellerPayoutZats` vs actual output 1 value
 * - **Fix**: Use stored values from listing, don't recompute
 *
 * ### "Seller input not at index 1"
 * - **Cause**: Buyer placed seller input at wrong position
 * - **Fix**: Always place seller input at vin 1 (buyer inputs before/after)
 *
 * ### "Listing invalidated: token spent"
 * - **Cause**: Seller spent their token UTXO elsewhere
 * - **Fix**: Listing should be marked inactive (can't salvage)
 *
 * ## Database Schema:
 *
 * ### psbtListings table:
 * - `tokenLocation`: "txid:vout" of ZRC-20 transfer inscription
 * - `sellerAddress`: Seller's t-address
 * - `price`: Price in ZEC
 * - `sellerScriptSigHex`: Pre-signed scriptSig (signature + pubkey)
 * - `sellerPayoutZats`: Exact amount seller receives (price - marketplace fee)
 * - `sellerPayoutScriptHex`: Seller's payout script (usually P2PKH)
 * - `status`: "active" | "completed" | "cancelled"
 *
 * ## References:
 * - ZIP-243: https://zips.z.cash/zip-0243 (Zcash signature hash)
 * - SIGHASH types: https://bitcoin.org/en/developer-guide#signature-hash-types
 * - Ordinals envelope: https://docs.ordinals.com/inscriptions.html
 */

import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { broadcastTransaction, bytesToHex, hexToBytes, fetchUtxos, callZcashRPC, checkInscriptionAt } from "./zcashHelpers";
import { TREASURY_ADDRESS } from "./treasury.config";
import bs58check from "bs58check";

const MARKETPLACE_FEES = {
  BUYER_BPS: 0,
  SELLER_BPS: 250,
} as const;

function computeFeeBreakdown(priceZats: number) {
  const sellerFeeZats = Math.floor((priceZats * MARKETPLACE_FEES.SELLER_BPS) / 10_000);
  const buyerFeeZats = Math.ceil((priceZats * MARKETPLACE_FEES.BUYER_BPS) / 10_000);
  const sellerPayoutZats = priceZats - sellerFeeZats;
  return { sellerFeeZats, buyerFeeZats, sellerPayoutZats };
}

async function withClientError<T>(fn: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    const message = error instanceof Error && error.message ? error.message : fallback;
    // Log the full error for debugging
    console.error('[withClientError] Caught error:', error);
    throw new ConvexError(message || fallback);
  }
}

// -----------------------------
// Ordinal Index validation utils
// -----------------------------
async function ordinalIndexFetch(path: string) {
  const baseFromEnv = (process.env.ORDINAL_INDEX_API_BASE || process.env.NEXT_PUBLIC_ORDINAL_INDEX_API || '').replace(/\/$/, '');
  const base = baseFromEnv || 'http://135.181.6.234:3333';
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'zatoshi/convex-psbt' } });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Indexer error ${r.status}${text ? `: ${text}` : ''}`);
  }
  return await r.json();
}

function humanToBaseUnits(human: string, decimals: number): bigint {
  const trimmed = human.trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) throw new Error('Invalid human amount');
  const [intPart, fracPart = ''] = trimmed.split('.');
  const frac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(intPart || '0') * BigInt(10) ** BigInt(decimals) + BigInt(frac || '0');
}

function parseAmountToBase(raw: any, decimals?: number): bigint | null {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  if (str.includes('.')) {
    if (typeof decimals !== 'number' || !Number.isFinite(decimals)) return null;
    try { return humanToBaseUnits(str, decimals); } catch { return null; }
  }
  try {
    return BigInt(str);
  } catch {
    return null;
  }
}

type ZrcTransferValidationArgs = {
  sellerAddress: string;
  tokenLocation: string;
  tokenTicker: string;
  expectedAmountBase?: string | number | bigint;
  tokenDecimals?: number;
};

type ZrcTransferValidationResult = {
  txid: string;
  vout: number;
  tokenValueZats: number;
  inscriptionId: string;
  tick: string;
  amtBase: bigint;
  senderAddress: string;
};

// Export as action so it can use fetch() to query the indexer
export const validateZrc20Transfer = action({
  args: {
    sellerAddress: v.string(),
    tokenLocation: v.string(),
    tokenTicker: v.string(),
    expectedAmountBase: v.optional(v.union(v.string(), v.number())),
    tokenDecimals: v.optional(v.number()),
  },
  handler: async (ctx, args) => withClientError(async () => {
    const result = await assertValidZrc20Transfer(args);
    // Convert bigint to string for JSON serialization
    return {
      ...result,
      amtBase: result.amtBase.toString(),
    };
  }, 'Unable to validate transfer'),
});

async function assertValidZrc20Transfer(args: ZrcTransferValidationArgs): Promise<ZrcTransferValidationResult> {
  const location = String(args.tokenLocation || '');
  if (!location.includes(':')) throw new Error('Invalid token location');
  const [txid, voutStr] = location.split(':');
  const vout = parseInt(voutStr || '0', 10);
  if (!Number.isFinite(vout) || vout < 0) throw new Error('Invalid token location');

  const inscriptionId = `${txid}i0`;
  let tf: any;
  try {
    tf = await ordinalIndexFetch(`/api/v1/zrc20/transfer/${inscriptionId}`);
  } catch (e: any) {
    throw new Error(`Cannot validate transfer via indexer: ${e?.message || String(e)}`);
  }
  if (!tf) throw new Error('Transfer not found in indexer');

  const tick = (tf?.transfer?.tick || tf?.tick || tf?.ticker || '').toString().toUpperCase();
  const used = Boolean(tf?.used || tf?.revealed || tf?.consumed);
  const sender = (tf?.transfer?.sender || tf?.sender || tf?.from || tf?.address || tf?.owner || '').toString();
  const outpoint = (tf?.outpoint || tf?.location || tf?.output || '').toString();
  if (used) throw new Error('Transfer already used');
  if (!tick || tick !== String(args.tokenTicker).toUpperCase()) throw new Error('Transfer ticker mismatch');
  if (sender && sender.toLowerCase() !== String(args.sellerAddress).toLowerCase()) throw new Error('Transfer sender mismatch');
  if (outpoint && outpoint !== location) throw new Error('Transfer outpoint mismatch');

  const amountRaw = tf?.transfer?.amt ?? tf?.amt ?? tf?.amount ?? tf?.amount_base_units ?? tf?.value ?? tf?.value_base_units;
  const amtBase = parseAmountToBase(amountRaw, args.tokenDecimals);
  if (amtBase === null) throw new Error('Transfer amount missing');

  if (args.expectedAmountBase != null) {
    let expectedBase: bigint;
    try {
      expectedBase = typeof args.expectedAmountBase === 'bigint'
        ? args.expectedAmountBase
        : BigInt(String(args.expectedAmountBase));
    } catch {
      throw new Error('Invalid expected transfer amount');
    }
    if (expectedBase !== amtBase) throw new Error('Transfer amount mismatch');
  }

  let rawTx: any;
  try {
    rawTx = await callZcashRPC('getrawtransaction', [txid, 1]);
  } catch (e: any) {
    throw new Error(`Ownership check failed: ${e?.message || String(e)}`);
  }
  const vouts: any[] = Array.isArray(rawTx?.vout) ? rawTx.vout : [];
  const out = vouts.find((o: any) => o?.n === vout) ?? vouts[vout];
  if (!out) throw new Error('Output not found');

  const expectedScriptHex = bytesToHex(buildP2PKHScript(pkhFromT1(args.sellerAddress))).toLowerCase();
  const scriptHex: string = String(out?.scriptPubKey?.hex || '').toLowerCase();
  if (!scriptHex) throw new Error('Missing scriptPubKey');
  if (scriptHex !== expectedScriptHex) throw new Error('Seller does not own the token UTXO');

  let tokenValueZats: number | null = null;
  if (typeof out?.valueZat === 'number') tokenValueZats = out.valueZat;
  else if (typeof out?.satoshis === 'number') tokenValueZats = out.satoshis;
  else if (typeof out?.value === 'number') tokenValueZats = Math.round(out.value * 1e8);
  if (tokenValueZats === null) throw new Error('Unable to determine token UTXO value');

  try {
    const utxo: any = await callZcashRPC('gettxout', [txid, vout, true]);
    if (!utxo) throw new Error('Token UTXO already spent');
  } catch (e: any) {
    throw new Error(e?.message || 'Token UTXO already spent');
  }

  return {
    txid,
    vout,
    tokenValueZats,
    inscriptionId: String(tf?.id || tf?.inscription_id || inscriptionId),
    tick,
    amtBase,
    senderAddress: sender,
  };
}

/**
 * Build the canonical buyer transaction template from a listing.
 *
 * This function reconstructs the EXACT outputs the seller pre-signed with SIGHASH_SINGLE|ANYONECANPAY.
 * Any deviation from what the seller signed will cause signature validation to fail with
 * "mandatory-script-verify-flag-failed".
 *
 * ## Output Order (CRITICAL - Do Not Change):
 *
 * - Output 0: Token UTXO → Buyer (value = tokenValueZats)
 * - Output 1: Seller Payout → Seller (value = sellerPayoutZats, script = sellerPayoutScriptHex)
 * - Output 2: Marketplace Fee → Treasury (value = sellerFeeZats)
 *
 * The seller's SIGHASH_SINGLE signature binds their input (at vin index 1) to output index 1.
 * If we reorder outputs or change amounts, the signature becomes invalid.
 *
 * ## Key Design Decisions:
 *
 * 1. **Use stored `sellerPayoutZats`**: We trust the value stored when the listing was created,
 *    NOT recomputed fees. This prevents signature mismatches if marketplace fee rate changes.
 *
 * 2. **Use stored `sellerPayoutScriptHex`**: Seller may have specified a different payout address
 *    than their main address (e.g., for escrow). We use what they signed.
 *
 * 3. **Validate token ownership**: Before building template, verify seller still owns the token
 *    UTXO via ZRC-20 indexer and RPC checks.
 *
 * @param listing - Listing document from database
 * @param buyerAddress - Buyer's t-address (for output 0 script)
 * @returns Template with outputs, scripts, and amounts matching seller's signature
 * @throws Error if token UTXO spent, transfer invalid, or amounts can't be determined
 */
async function buildBuyerTemplate(listing: any, buyerAddress: string) {
  let expectedBase: string | undefined = listing.tokenAmountBase;
  if (!expectedBase && typeof listing.tokenAmount === 'number' && typeof listing.tokenDecimals === 'number') {
    try { expectedBase = humanToBaseUnits(String(listing.tokenAmount), listing.tokenDecimals).toString(); } catch { }
  }

  let transferInfo: ZrcTransferValidationResult | null = null;
  if (listing.tokenTicker) {
    transferInfo = await assertValidZrc20Transfer({
      sellerAddress: listing.sellerAddress,
      tokenLocation: listing.tokenLocation,
      tokenTicker: listing.tokenTicker,
      expectedAmountBase: expectedBase,
      tokenDecimals: listing.tokenDecimals,
    });
  }

  let tokenValueZats: number | null = transferInfo ? Number(transferInfo.tokenValueZats) : null;
  if (tokenValueZats === null && typeof listing.sellerInputValue === 'number') {
    tokenValueZats = listing.sellerInputValue;
  }

  const [txid, voutStr] = listing.tokenLocation.split(':');
  const vout = parseInt(voutStr, 10);
  if (tokenValueZats === null) {
    try {
      const utxos = await fetchUtxos(listing.sellerAddress);
      const tokenUtxo = utxos.find((u) => u.txid === txid && u.vout === vout);
      if (tokenUtxo) tokenValueZats = Number(tokenUtxo.value);
    } catch { }
  }
  if (tokenValueZats === null) {
    try {
      const tx: any = await callZcashRPC('getrawtransaction', [txid, 1]);
      const vouts: any[] = Array.isArray(tx?.vout) ? tx.vout : [];
      const out = vouts.find((o: any) => o?.n === vout) ?? vouts[vout];
      const val = typeof out?.valueZat === 'number' ? out.valueZat
        : typeof out?.satoshis === 'number' ? out.satoshis
          : typeof out?.value === 'number' ? Math.round(out.value * 1e8)
            : null;
      if (val !== null) tokenValueZats = val;
    } catch { }
  }
  if (tokenValueZats === null) {
    try {
      const utxo: any = await callZcashRPC('gettxout', [txid, vout, true]);
      const val = typeof utxo?.valueZat === 'number' ? utxo.valueZat
        : typeof utxo?.satoshis === 'number' ? utxo.satoshis
          : typeof utxo?.value === 'number' ? Math.round(utxo.value * 1e8)
            : null;
      if (val !== null) tokenValueZats = val;
    } catch { }
  }
  if (tokenValueZats === null) throw new Error('Token UTXO not found or already spent');

  const priceZats = Math.round(listing.price * 1e8);
  const { sellerPayoutZats: computedPayout } = computeFeeBreakdown(priceZats);
  let sellerPayoutZats = typeof listing.sellerPayoutZats === 'number' ? listing.sellerPayoutZats : computedPayout;
  if (!Number.isFinite(sellerPayoutZats) || sellerPayoutZats <= 0) sellerPayoutZats = computedPayout;
  let sellerFeeZats = priceZats - sellerPayoutZats;
  if (sellerFeeZats < 0) {
    sellerFeeZats = 0;
    sellerPayoutZats = priceZats;
  }
  const buyerScriptHex = bytesToHex(buildP2PKHScript(pkhFromT1(buyerAddress)));
  const sellerScriptHex = listing.sellerPayoutScriptHex ?? bytesToHex(buildP2PKHScript(pkhFromT1(listing.sellerAddress)));
  const treasuryScriptHex = bytesToHex(buildP2PKHScript(pkhFromT1(TREASURY_ADDRESS)));

  return {
    tokenValueZats,
    outputs: [
      { index: 0, kind: 'token', valueZats: tokenValueZats, scriptHex: buyerScriptHex },
      { index: 1, kind: 'sellerPayout', valueZats: sellerPayoutZats, scriptHex: sellerScriptHex },
      { index: 2, kind: 'treasury', valueZats: sellerFeeZats, scriptHex: treasuryScriptHex },
    ],
  };
}

/**
 * Create a new PSBT listing for a ZRC-20 token or NFT.
 *
 * ## Maker-Taker Flow (PSBT Partial Signing):
 *
 * 1. **Maker (Seller)** creates a listing by:
 *    - Pre-signing their token input with SIGHASH_SINGLE|ANYONECANPAY
 *    - Locking their signature to specific outputs (token→buyer, payout→seller, fee→treasury)
 *    - Storing `sellerScriptSigHex` which contains their signature + pubkey
 *
 * 2. **Taker (Buyer)** completes the transaction by:
 *    - Adding their own inputs (to pay the price)
 *    - Preserving the seller's pre-signed input at **vin index 1** (required by SIGHASH_SINGLE)
 *    - Using the exact output order/amounts the seller signed (from `sellerPayoutZats`, `sellerPayoutScriptHex`)
 *
 * ## Critical Fields for Signature Validation:
 *
 * - `sellerScriptSigHex`: The seller's pre-signed scriptSig (signature + pubkey). This signature is
 *   cryptographically bound to the outputs present when they signed.
 * - `sellerPayoutZats`: The exact ZEC amount the seller will receive (after marketplace fee deduction).
 * - `sellerPayoutScriptHex`: The seller's payout script (P2PKH). Must match what was used during signing.
 * - `sellerInputValue`: The value of the token UTXO being sold (needed for ZIP-243 sighash).
 *
 * ## Common Signature Mismatch Causes:
 *
 * When `finalizeAndBroadcast` fails with "mandatory-script-verify-flag-failed (sighash mismatch)":
 *
 * 1. **Output ordering changed**: Seller signed with outputs [token, payout, treasury] but buyer
 *    assembled them in different order.
 * 2. **Payout amount changed**: `sellerPayoutZats` stored on listing doesn't match what seller
 *    actually signed for (e.g., fee rate changed after listing created).
 * 3. **Seller input not at vin index 1**: SIGHASH_SINGLE binds to output at same index as input.
 *    If seller input moves, signature fails.
 * 4. **Stale listing**: Seller spent/replaced their token UTXO but old listing still references it.
 *
 * ## Debugging Steps:
 *
 * 1. Fetch listing: `await db.get("psbtListings", "<listingId>")`
 * 2. Verify seller UTXO unspent: `callZcashRPC('gettxout', [txid, vout, true])`
 * 3. Decode `sellerScriptSigHex` to extract signature + pubkey
 * 4. Recompute ZIP-243 sighash using listing's stored outputs and compare
 * 5. If mismatch found, have seller cancel and re-list with fresh signature
 *
 * @param psbtBase64 - Optional legacy PSBT format (deprecated in favor of maker-taker fields)
 * @param tokenLocation - UTXO location of token being sold (format: "txid:vout")
 * @param sellerAddress - Seller's Zcash t-address (P2PKH)
 * @param price - Sale price in ZEC
 * @param tokenTicker - ZRC-20 ticker (e.g., "PEPE", "ZERO")
 * @param tokenAmount - Human-readable token amount
 * @param tokenAmountBase - Token amount in base units (with decimals)
 * @param tokenDecimals - Number of decimals for token
 * @param sellerScriptSigHex - Seller's pre-signed scriptSig (CRITICAL: must match outputs)
 * @param sellerPayoutZats - Exact payout amount seller signed for (after fees)
 * @param sellerPayoutScriptHex - Seller's payout script (usually P2PKH of sellerAddress)
 * @param tokenValueZats - Value of token UTXO in zatoshis (from validateZrc20Transfer)
 */
export const createListing = mutation({
  args: {
    psbtBase64: v.optional(v.string()),
    tokenLocation: v.string(),
    sellerAddress: v.string(),
    price: v.number(),
    // ZRC-20 (optional)
    tokenTicker: v.optional(v.string()),
    tokenAmount: v.optional(v.number()),
    tokenAmountBase: v.optional(v.string()),
    tokenDecimals: v.optional(v.number()),
    // NFT (optional)
    collectionSlug: v.optional(v.string()),
    tokenId: v.optional(v.number()),
    // Maker-ask fields (optional to maintain backward compat)
    sellerInputTxid: v.optional(v.string()),
    sellerInputVout: v.optional(v.number()),
    sellerInputSequence: v.optional(v.number()),
    sellerScriptSigHex: v.optional(v.string()),
    sellerPayoutZats: v.optional(v.number()),
    sellerPayoutScriptHex: v.optional(v.string()),
    tokenValueZats: v.optional(v.number()), // From validateZrc20Transfer action
  },
  handler: async (ctx, args) => withClientError(async () => {
    // IMPORTANT: For ZRC-20 listings, frontend must call validateZrc20Transfer action first
    // and pass the returned tokenValueZats here (mutations cannot use fetch for validation)
    const sellerInputValue = args.tokenValueZats;

    // Prevent duplicate listings for the same token UTXO
    const existingActive = await ctx.db
      .query("psbtListings")
      .withIndex("by_token_location_status", (q) =>
        q.eq("tokenLocation", args.tokenLocation).eq("status", "active")
      )
      .first();
    if (existingActive) {
      throw new Error('This transfer already has an active listing. Cancel the previous listing or wait for it to complete.');
    }

    const listingId = await ctx.db.insert("psbtListings", {
      psbtBase64: args.psbtBase64,
      tokenLocation: args.tokenLocation,
      sellerAddress: args.sellerAddress,
      price: args.price,
      tokenTicker: args.tokenTicker,
      tokenAmount: args.tokenAmount,
      tokenAmountBase: args.tokenAmountBase,
      tokenDecimals: args.tokenDecimals,
      collectionSlug: args.collectionSlug,
      tokenId: args.tokenId,
      status: "active",
      createdAt: Date.now(),
      // Maker-ask fields
      sellerInputTxid: args.sellerInputTxid,
      sellerInputVout: args.sellerInputVout,
      sellerInputSequence: args.sellerInputSequence,
      sellerScriptSigHex: args.sellerScriptSigHex,
      sellerPayoutZats: args.sellerPayoutZats,
      sellerPayoutScriptHex: args.sellerPayoutScriptHex,
      sellerInputValue,
    });
    return listingId;
  }, 'Unable to create listing'),
});

// List all active listings
export const listListings = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    const listings = await ctx.db
      .query("psbtListings")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("desc")
      .take(limit);
    return listings;
  },
});

// List active listings by ticker
export const listListingsByTicker = query({
  args: {
    ticker: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    // Note: We need a compound index for status + ticker to be efficient, 
    // or we filter in memory if volume is low. 
    // Schema has .index("by_ticker", ["tokenTicker"]) and .index("by_status", ["status"]).
    // A compound index ["tokenTicker", "status"] would be better.
    // For now, let's use by_ticker and filter by status.

    const listings = await ctx.db
      .query("psbtListings")
      .withIndex("by_ticker", (q) => q.eq("tokenTicker", args.ticker))
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("desc")
      .take(limit);

    return listings;
  },
});

// List active listings for a seller (optionally by ticker)
export const listActiveListingsBySeller = query({
  args: {
    sellerAddress: v.string(),
    ticker: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 200;
    const rows = await ctx.db
      .query("psbtListings")
      .withIndex("by_seller", (q) => q.eq("sellerAddress", args.sellerAddress))
      .order("desc")
      .take(limit);
    const tickerUpper = args.ticker?.toUpperCase();
    return rows.filter((row) => {
      if (row.status !== 'active') return false;
      if (tickerUpper) {
        const rowTicker = (row.tokenTicker || '').toUpperCase();
        if (rowTicker !== tickerUpper) return false;
      }
      return true;
    });
  },
});

// List active listings by collection
export const listListingsByCollection = query({
  args: {
    slug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    const listings = await ctx.db
      .query("psbtListings")
      .withIndex("by_collection", (q) => q.eq("collectionSlug", args.slug))
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("desc")
      .take(limit);

    return listings;
  },
});

// Get a specific listing by ID
export const getListing = query({
  args: { listingId: v.id("psbtListings") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.listingId);
  },
});

// Update listing status (e.g., after purchase or cancellation)
export const updateStatus = mutation({
  args: {
    listingId: v.id("psbtListings"),
    status: v.string(), // "completed" | "cancelled"
    txid: v.optional(v.string()),
    buyerAddress: v.optional(v.string()),
    feeZats: v.optional(v.number()),
  },
  handler: async (ctx, args) => withClientError(async () => {
    const { listingId, status, txid, buyerAddress } = args;

    // Validate status transition
    const listing = await ctx.db.get(listingId);
    if (!listing) throw new Error("Listing not found");
    if (listing.status !== "active") throw new Error("Listing is not active");

    await ctx.db.patch(listingId, {
      status,
      txid,
      buyerAddress,
      feeZats: args.feeZats,
    });
  }, 'Unable to update listing status'),
});

// Helper: decode raw transparent tx outputs (value + scriptPubKey)
function readVarInt(buf: Uint8Array, o: { i: number }): number {
  const first = buf[o.i++];
  if (first < 0xfd) return first;
  if (first === 0xfd) { const v = new DataView(buf.buffer).getUint16(o.i, true); o.i += 2; return v; }
  if (first === 0xfe) { const v = new DataView(buf.buffer).getUint32(o.i, true); o.i += 4; return v; }
  // 0xff (we won't see 64-bit counts for our sizes)
  const dv = new DataView(buf.buffer);
  const low = dv.getUint32(o.i, true); const high = dv.getUint32(o.i + 4, true); o.i += 8;
  return low + high * 2 ** 32;
}

function decodeOutputs(hex: string): { value: number; script: Uint8Array }[] {
  const bytes = hexToBytes(hex);
  const dv = new DataView(bytes.buffer);
  const o = { i: 0 };
  // version (4)
  o.i += 4;
  // versionGroupId (4)
  o.i += 4;
  // inputs
  const vin = readVarInt(bytes, o);
  for (let n = 0; n < vin; n++) {
    o.i += 32; // txid
    o.i += 4; // vout
    const scriptLen = readVarInt(bytes, o);
    o.i += scriptLen; // scriptSig
    o.i += 4; // sequence
  }
  // outputs
  const vout = readVarInt(bytes, o);
  const outs: { value: number; script: Uint8Array }[] = [];
  for (let n = 0; n < vout; n++) {
    // value (8 LE)
    const val = Number(dv.getBigUint64(o.i, true));
    o.i += 8;
    const pkLen = readVarInt(bytes, o);
    const script = bytes.slice(o.i, o.i + pkLen);
    o.i += pkLen;
    outs.push({ value: val, script });
  }
  return outs;
}

function scriptsEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, idx) => byte === b[idx]);
}

function decodeInputs(hex: string): { txid: string; vout: number; scriptSig: Uint8Array; sequence: number }[] {
  const bytes = hexToBytes(hex);
  const dv = new DataView(bytes.buffer);
  const o = { i: 0 } as { i: number };
  // version (4) + versionGroupId (4)
  o.i += 8;
  const inCount = readVarInt(bytes, o);
  const inputs: { txid: string; vout: number; scriptSig: Uint8Array; sequence: number }[] = [];
  for (let n = 0; n < inCount; n++) {
    const prev = bytes.slice(o.i, o.i + 32); o.i += 32;
    const txid = Array.from(prev).reverse().map(b => b.toString(16).padStart(2, '0')).join('');
    const vout = dv.getUint32(o.i, true); o.i += 4;
    const scriptLen = readVarInt(bytes, o);
    const scriptSig = bytes.slice(o.i, o.i + scriptLen); o.i += scriptLen;
    const sequence = dv.getUint32(o.i, true); o.i += 4;
    inputs.push({ txid, vout, scriptSig, sequence });
  }
  return inputs;
}

function pkhFromT1(address: string): Uint8Array {
  // t1 (P2PKH) base58check decodes to: 2-byte prefix + 20-byte hash
  const decoded = bs58check.decode(address) as unknown as Uint8Array;
  if (decoded.length < 22) throw new Error('Invalid t-address payload');
  return decoded.slice(2, 22);
}

function buildP2PKHScript(pkh: Uint8Array): Uint8Array {
  // OP_DUP OP_HASH160 PUSH20 <pkh> OP_EQUALVERIFY OP_CHECKSIG
  const out = new Uint8Array(25);
  out.set([0x76, 0xa9, 0x14], 0);
  out.set(pkh, 3);
  out.set([0x88, 0xac], 23);
  return out;
}

/**
 * Finalize and broadcast a buyer-completed PSBT transaction.
 *
 * This is the final validation + broadcast step in the maker-taker flow. It performs
 * comprehensive checks before submitting the transaction to the Zcash network.
 *
 * ## Validation Steps (in order):
 *
 * 1. **Listing Status**: Verify listing is active and not already completed/cancelled
 * 2. **Token Unspent**: Confirm seller's token UTXO hasn't been spent (prevents stale listings)
 * 3. **ZRC-20 Transfer**: Re-validate transfer ownership via indexer (just-in-time check)
 * 4. **Output Template Match**: Parse buyer's transaction and verify outputs match template:
 *    - Output 0: Token → Buyer (correct amount + script)
 *    - Output 1: Payout → Seller (correct amount + script from `sellerPayoutZats`/`sellerPayoutScriptHex`)
 *    - Output 2: Fee → Treasury (correct amount + script)
 * 5. **Seller Input Position**: Confirm seller's token input is at **vin index 1** (SIGHASH_SINGLE requirement)
 * 6. **Seller Signature Match**: Verify `sellerScriptSigHex` in transaction matches listing's stored signature
 * 7. **Inscription Protection**: Reject if any buyer input spends an inscribed UTXO (prevents NFT loss)
 *
 * ## Common Broadcast Errors:
 *
 * ### "mandatory-script-verify-flag-failed (Script evaluated without error but finished with false/empty top stack)"
 *
 * This means the seller's pre-signed scriptSig doesn't validate against the transaction we built.
 * Root causes:
 *
 * - **Sighash Mismatch**: The outputs we assembled don't match what the seller signed for
 *   - Check: `sellerPayoutZats` in listing vs actual output 1 value
 *   - Check: Output ordering (must be token, payout, treasury)
 *   - Check: `sellerPayoutScriptHex` matches output 1 script
 *
 * - **Wrong Input Index**: Seller input not at vin 1 (SIGHASH_SINGLE binds to same-index output)
 *   - Fix: Buyer must always place seller input at index 1
 *
 * - **Legacy Listing**: Seller created listing before we started storing `sellerPayoutZats`/`sellerPayoutScriptHex`
 *   - Fix: Have seller cancel and re-list
 *
 * ### Debugging a Failed Transaction:
 *
 * ```javascript
 * // 1. Get the listing
 * const listing = await db.get("psbtListings", listingId);
 *
 * // 2. Decode the stored seller signature
 * const scriptSig = hexToBytes(listing.sellerScriptSigHex);
 * // scriptSig format: [sigLength][signature+sighashType][pubkeyLength][pubkey]
 *
 * // 3. Verify outputs match what seller signed
 * console.log("Stored payout:", listing.sellerPayoutZats);
 * console.log("Stored script:", listing.sellerPayoutScriptHex);
 *
 * // 4. Parse buyer's transaction and compare
 * const outs = decodeOutputs(buyerTxHex);
 * console.log("Output 1 value:", outs[1].value, "should match", listing.sellerPayoutZats);
 * console.log("Output 1 script:", bytesToHex(outs[1].script), "should match", listing.sellerPayoutScriptHex);
 * ```
 *
 * @param listingId - ID of the listing being purchased
 * @param hex - Complete transaction hex with buyer inputs + seller's pre-signed input
 * @param buyerAddress - Buyer's address (for verification)
 * @returns Transaction ID (txid) of the broadcast transaction
 * @throws ConvexError with detailed message if validation or broadcast fails
 */
export const finalizeAndBroadcast = action({
  args: { listingId: v.id("psbtListings"), hex: v.string(), buyerAddress: v.string() },
  handler: async (ctx, args) => withClientError(async () => {
    // In actions, use runQuery to access DB
    const listing = await ctx.runQuery(api.psbt.getListing, { listingId: args.listingId });
    if (!listing) throw new Error('Listing not found');
    if (listing.status !== 'active') throw new Error('Listing not active');

    // Validate token still unspent (listing not invalidated)
    const [ltxid, lvoutStr] = String(listing.tokenLocation).split(':');
    const lvout = parseInt(lvoutStr || '0', 10);
    try {
      const utxo: any = await callZcashRPC('gettxout', [ltxid, lvout, true]);
      if (!utxo) throw new Error('Listing invalidated: token spent');
    } catch (_) {
      throw new Error('Listing invalidated: token spent');
    }

    // Re-validate ZRC-20 transfer just-in-time prior to parsing and broadcasting
    if (listing.tokenTicker && typeof listing.tokenAmount === 'number') {
      await assertValidZrc20Transfer({
        sellerAddress: listing.sellerAddress,
        tokenLocation: listing.tokenLocation,
        tokenTicker: listing.tokenTicker,
        expectedAmountBase: listing.tokenAmountBase,
        tokenDecimals: listing.tokenDecimals,
      });
    }

    // Parse inputs/outputs from buyer's transaction
    const inputs = decodeInputs(args.hex);
    const outs = decodeOutputs(args.hex);
    const template = await buildBuyerTemplate(listing, args.buyerAddress);
    if (outs.length < template.outputs.length) throw new Error('Invalid transaction: missing required outputs');

    // CRITICAL VALIDATION: Outputs must EXACTLY match what seller pre-signed
    // Any deviation (wrong order, wrong amounts, wrong scripts) will cause
    // "mandatory-script-verify-flag-failed" when the node validates seller's signature
    template.outputs.forEach((expected, idx) => {
      const actual = outs[idx];
      const expectedScript = hexToBytes(expected.scriptHex);

      // Debug logging for signature mismatch troubleshooting
      if (actual.value !== expected.valueZats) {
        console.error(`[PSBT] Output ${idx} value mismatch:`, {
          expected: expected.valueZats,
          actual: actual.value,
          kind: expected.kind,
          listing: listing._id,
        });
      }
      if (!scriptsEqual(actual.script, expectedScript)) {
        console.error(`[PSBT] Output ${idx} script mismatch:`, {
          expectedHex: bytesToHex(expectedScript),
          actualHex: bytesToHex(actual.script),
          kind: expected.kind,
          listing: listing._id,
        });
      }

      if (actual.value !== expected.valueZats || !scriptsEqual(actual.script, expectedScript)) {
        throw new Error(`Output ${idx} (${expected.kind}) does not match marketplace template. Expected value=${expected.valueZats}, got=${actual.value}. This will cause signature validation to fail.`);
      }
    });

    // Validate seller input presence and scriptSig equals stored maker-ask
    const [itxid, ivoutStr] = String(listing.tokenLocation).split(':');
    const ivout = parseInt(ivoutStr || '0', 10);

    // CRITICAL: Seller input MUST be at index 1 for SIGHASH_SINGLE to work
    // SIGHASH_SINGLE binds input N to output N. Since seller signed output 1 (their payout),
    // their input must be at vin index 1. If buyer reorders inputs, signature fails.
    if (inputs.length < 2) throw new Error('Invalid transaction: missing seller input at index 1');
    const sellerInput = inputs[1];
    if (sellerInput.txid !== itxid || sellerInput.vout !== ivout) {
      throw new Error(`Seller input not at index 1 or does not match tokenLocation. Expected ${itxid}:${ivout}, got ${sellerInput.txid}:${sellerInput.vout}`);
    }

    // CRITICAL: Sequence number is part of the sighash! Must match what seller signed.
    // ZIP-243 includes sequence in the sighash calculation. If buyer uses different sequence,
    // the signature validation will fail even if outputs are correct.
    if (typeof listing.sellerInputSequence === 'number' && sellerInput.sequence !== listing.sellerInputSequence) {
      throw new Error(`Seller input sequence mismatch. Expected ${listing.sellerInputSequence} (0x${listing.sellerInputSequence.toString(16)}), got ${sellerInput.sequence} (0x${sellerInput.sequence.toString(16)}). This will cause signature validation to fail.`);
    }

    // Verify the scriptSig in buyer's transaction matches what seller pre-signed
    // This is the seller's signature + pubkey that was stored when listing was created
    if (listing.sellerScriptSigHex) {
      const actualScriptSigHex = bytesToHex(sellerInput.scriptSig).toLowerCase();
      const expectedScriptSigHex = String(listing.sellerScriptSigHex).toLowerCase();

      // Decode the scriptSig to check sighash type
      try {
        const scriptSig = sellerInput.scriptSig;
        const sigLength = scriptSig[0];
        const sighashType = scriptSig[sigLength]; // Last byte of signature
        console.log(`[PSBT] Seller signature sighash type: 0x${sighashType.toString(16)} (${sighashType === 0x01 ? 'ALL' :
            sighashType === 0x03 ? 'SINGLE' :
              sighashType === 0x81 ? 'ALL|ANYONECANPAY' :
                sighashType === 0x83 ? 'SINGLE|ANYONECANPAY' :
                  'UNKNOWN'
          })`);

        if (sighashType !== 0x83 && sighashType !== 0x03) {
          console.warn(`[PSBT] WARNING: Expected sighash type 0x83 (SINGLE|ANYONECANPAY) but got 0x${sighashType.toString(16)}`);
        }
      } catch (e) {
        console.error('[PSBT] Failed to decode sighash type:', e);
      }

      if (actualScriptSigHex !== expectedScriptSigHex) {
        console.error(`[PSBT] Seller scriptSig mismatch:`, {
          expected: expectedScriptSigHex.slice(0, 100) + '...',
          actual: actualScriptSigHex.slice(0, 100) + '...',
          listing: listing._id,
        });
        throw new Error('Seller scriptSig does not match listing maker signature. Transaction has been modified.');
      }
    }

    // Guard: reject if any buyer input spends an inscribed UTXO (prevents accidental NFT loss)
    for (let i = 0; i < inputs.length; i++) {
      if (i === 1) continue; // skip seller input (by design at index 1)
      const inp = inputs[i];
      try {
        const isInscribed = await checkInscriptionAt(`${inp.txid}:${inp.vout}`);
        if (isInscribed) {
          throw new Error(`Refusing to broadcast: input ${inp.txid}:${inp.vout} appears to hold an inscription`);
        }
      } catch (e: any) {
        // checkInscriptionAt fails safe (treats unknown as inscribed). Re-throw to abort.
        const msg = e?.message || 'Inscription protection triggered';
        throw new Error(msg);
      }
    }

    // Compute fee: sum(inputs) - sum(outputs)
    let totalIn = 0;
    try {
      const cache = new Map<string, any>();
      for (const inp of inputs) {
        let tx: any = cache.get(inp.txid);
        if (!tx) {
          try { tx = await callZcashRPC('getrawtransaction', [inp.txid, 1]); cache.set(inp.txid, tx); } catch { }
        }
        let valZ: number | null = null;
        try {
          const vouts: any[] = Array.isArray(tx?.vout) ? tx.vout : [];
          const out = vouts.find((o: any) => o?.n === inp.vout) ?? vouts[inp.vout];
          valZ = typeof out?.valueZat === 'number' ? out.valueZat
            : typeof out?.satoshis === 'number' ? out.satoshis
              : typeof out?.value === 'number' ? Math.round(out.value * 1e8)
                : null;
        } catch { }
        if (valZ === null) {
          try {
            const utxo: any = await callZcashRPC('gettxout', [inp.txid, inp.vout, true]);
            valZ = typeof utxo?.valueZat === 'number' ? utxo.valueZat
              : typeof utxo?.satoshis === 'number' ? utxo.satoshis
                : typeof utxo?.value === 'number' ? Math.round(utxo.value * 1e8)
                  : null;
          } catch { }
        }
        if (valZ) totalIn += valZ;
      }
    } catch { }
    let totalOut = 0;
    try { for (const o of outs) totalOut += o.value; } catch { }
    const feeZats = totalIn > 0 && totalOut > 0 ? (totalIn - totalOut) : undefined;

    // Final debug log before broadcast - show EVERYTHING that goes into sighash
    console.log(`[PSBT] Broadcasting transaction for listing ${listing._id}:`, {
      listingPrice: listing.price,
      listingData: {
        sellerPayoutZats: listing.sellerPayoutZats,
        sellerPayoutScriptHex: listing.sellerPayoutScriptHex,
        sellerInputSequence: listing.sellerInputSequence,
        sellerInputValue: listing.sellerInputValue,
        tokenLocation: listing.tokenLocation,
      },
      expectedOutputs: template.outputs.map(o => ({
        index: o.index,
        kind: o.kind,
        valueZats: o.valueZats,
        scriptHex: o.scriptHex,
      })),
      actualOutputs: outs.map((o, i) => ({
        index: i,
        valueZats: o.value,
        scriptHex: bytesToHex(o.script),
      })),
      actualInputs: inputs.map((inp, i) => ({
        index: i,
        txid: inp.txid,
        vout: inp.vout,
        sequence: inp.sequence,
        sequenceHex: '0x' + inp.sequence.toString(16),
        scriptSigHex: bytesToHex(inp.scriptSig).slice(0, 100) + '...',
      })),
    });

    // Decode the transaction with RPC for additional verification
    try {
      const decoded: any = await callZcashRPC('decoderawtransaction', [args.hex]);
      console.log(`[PSBT] Decoded transaction:`, {
        txid: decoded.txid,
        vin: decoded.vin?.map((v: any, i: number) => ({
          idx: i,
          txid: v.txid,
          vout: v.vout,
          sequence: v.sequence,
        })),
        vout: decoded.vout?.map((v: any, i: number) => ({
          idx: i,
          value: v.value,
          valueZat: v.valueZat,
        })),
      });
    } catch (e: any) {
      console.error('[PSBT] Failed to decode transaction:', e.message);
    }

    // Broadcast via our RPC
    const txid = await broadcastTransaction(args.hex);
    // Update status via mutation from an action
    // Update status via mutation from an action
    await ctx.runMutation(api.psbt.updateStatus, { listingId: args.listingId, status: 'completed', txid, buyerAddress: args.buyerAddress, feeZats });

    // Record sale in sales table (for history/volume tracking)
    if (listing.tokenTicker && listing.tokenAmount) {
      await ctx.runMutation(api.psbt.recordSale, {
        inscriptionId: listing.inscriptionId || listing.tokenLocation, // Fallback if no inscriptionId stored
        sellerAddress: listing.sellerAddress,
        buyerAddress: args.buyerAddress,
        priceZec: listing.price,
        txid,
        timestamp: Date.now(),
        status: 'completed',
      });
    }

    return txid;
  }, 'Unable to finalize trade')
});

// Prepare a canonical buyer template for outputs/order/scripts/amounts
export const prepareBuyerTemplate = action({
  args: { listingId: v.id('psbtListings'), buyerAddress: v.string() },
  handler: async (ctx, args) => withClientError(async () => {
    // In actions, DB access must go through runQuery
    const listing = await ctx.runQuery(api.psbt.getListing, { listingId: args.listingId });
    if (!listing) throw new Error('Listing not found');
    if (listing.status !== 'active') throw new Error('Listing not active');

    const template = await buildBuyerTemplate(listing, args.buyerAddress);

    return {
      listingId: args.listingId,
      buyerAddress: args.buyerAddress,
      tokenLocation: listing.tokenLocation,
      tokenValueZats: template.tokenValueZats,
      outputs: template.outputs,
      constraints: {
        input0: listing.tokenLocation,
        buyerChangeIndexMin: 3,
        sellerSighash: 'SINGLE|ANYONECANPAY',
      },
    };
  }, 'Unable to prepare buyer template')
});

// Submit buyer offer payload (JSON) for a listing
export const submitBuyerOffer = action({
  args: {
    listingId: v.id("psbtListings"),
    buyerAddress: v.string(),
    offerPayload: v.string(), // JSON string
  },
  handler: async (ctx, args) => withClientError(async () => {
    const listing = await ctx.runQuery(api.psbt.getListing, { listingId: args.listingId });
    if (!listing) throw new Error('Listing not found');
    if (listing.status !== 'active') throw new Error('Listing not active');
    const template = await buildBuyerTemplate(listing, args.buyerAddress);
    let payload: any;
    try { payload = JSON.parse(args.offerPayload); } catch { throw new Error('Invalid offer payload'); }
    if ((payload?.buyerAddress || '').toString().toLowerCase() !== args.buyerAddress.toLowerCase()) {
      throw new Error('Buyer address mismatch');
    }
    const [ptxid, pvoutStr] = (payload.sellerInput?.txid && typeof payload.sellerInput?.vout === 'number')
      ? [payload.sellerInput.txid, String(payload.sellerInput.vout)] : [null, null];
    if (!ptxid || `${ptxid}:${pvoutStr}` !== listing.tokenLocation) {
      throw new Error('Offer seller input does not match listing token');
    }
    if (!Array.isArray(payload.outputs) || payload.outputs.length < template.outputs.length) {
      throw new Error('Offer outputs missing');
    }
    for (let i = 0; i < template.outputs.length; i++) {
      const expected = template.outputs[i];
      const provided = payload.outputs[i];
      if (!provided) throw new Error(`Offer output ${i} missing`);
      const providedValue = Number(provided.value);
      const providedScript = String(provided.scriptHex || '').toLowerCase();
      if (providedValue !== expected.valueZats || providedScript !== expected.scriptHex.toLowerCase()) {
        throw new Error(`Offer output ${i} mismatch`);
      }
    }
    const offerId = await ctx.runMutation(api.psbt.insertOffer, {
      listingId: args.listingId,
      sellerAddress: listing.sellerAddress,
      buyerAddress: args.buyerAddress,
      offerPayload: args.offerPayload,
    });
    return offerId;
  }, 'Unable to submit offer')
});

// List offers for a seller (pending)
export const listOffersForSeller = query({
  args: { sellerAddress: v.string() },
  handler: async (ctx, args) => {
    const offers = await ctx.db
      .query('psbtOffers')
      .withIndex('by_seller', (q) => q.eq('sellerAddress', args.sellerAddress))
      .order('desc')
      .collect();
    // Optionally filter only pending
    return offers.filter((o) => o.status === 'pending');
  }
});

// Mark offer completed (after broadcast)
export const markOfferCompleted = mutation({
  args: { offerId: v.id('psbtOffers'), txid: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.offerId, { status: 'completed', txid: args.txid });
  }
});

// Internal: insert offer record (used by action)
export const insertOffer = mutation({
  args: { listingId: v.id('psbtListings'), sellerAddress: v.string(), buyerAddress: v.string(), offerPayload: v.string() },
  handler: async (ctx, args: any) => {
    const offerId = await ctx.db.insert('psbtOffers', {
      listingId: args.listingId,
      sellerAddress: args.sellerAddress,
      buyerAddress: args.buyerAddress,
      offerPayload: args.offerPayload,
      status: 'pending',
      createdAt: Date.now(),
    });
    return offerId;
  }
});

// Cancel an active listing (seller only)
export const cancelListing = mutation({
  args: { listingId: v.id('psbtListings'), requester: v.string() },
  handler: async (ctx, args) => withClientError(async () => {
    const rec = await ctx.db.get(args.listingId);
    if (!rec) throw new Error('Listing not found');
    if (rec.status !== 'active') throw new Error('Listing not active');
    if (rec.sellerAddress.toLowerCase() !== args.requester.toLowerCase()) {
      throw new Error('Only the seller can cancel this listing');
    }
    await ctx.db.patch(args.listingId, { status: 'cancelled' });
  }, 'Unable to cancel listing')
});

// Get market stats for a ticker (spot price, 24h volume)
export const getMarketStats = query({
  args: { ticker: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const completedListings = await ctx.db
      .query("psbtListings")
      .withIndex("by_ticker", (q) => q.eq("tokenTicker", args.ticker))
      .filter((q) => q.eq(q.field("status"), "completed"))
      .order("desc")
      .collect();

    if (completedListings.length === 0) {
      return {
        spotPrice: null,
        volume24h: 0,
        priceChange24h: 0,
      };
    }

    const latest = completedListings[0];
    const spotPrice = latest.tokenAmount ? latest.price / latest.tokenAmount : 0;

    let volume24h = 0;
    let price24hAgo: number | null = null;

    for (const listing of completedListings) {
      if (listing.createdAt >= oneDayAgo) {
        volume24h += listing.price;
      } else {
        // Found the first trade older than 24h
        if (price24hAgo === null && listing.tokenAmount) {
          price24hAgo = listing.price / listing.tokenAmount;
        }
        // Since we are sorted by time desc, we can stop processing volume
        // But we might need to search further for price24hAgo if this one has invalid amount
        if (price24hAgo !== null) break;
      }
    }

    let priceChange24h = 0;
    if (price24hAgo) {
      priceChange24h = ((spotPrice - price24hAgo) / price24hAgo) * 100;
    }

    return {
      spotPrice,
      volume24h,
      priceChange24h,
    };
  },
});

// List completed trades (history) for a ticker
export const listTradeHistory = query({
  args: {
    ticker: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    const history = await ctx.db
      .query("psbtListings")
      .withIndex("by_ticker", (q) => q.eq("tokenTicker", args.ticker))
      .filter((q) => q.eq(q.field("status"), "completed"))
      .order("desc")
      .take(limit);
    return history;
  },
});

// Internal: Record a sale in the sales table
export const recordSale = mutation({
  args: {
    inscriptionId: v.string(),
    sellerAddress: v.string(),
    buyerAddress: v.string(),
    priceZec: v.number(),
    txid: v.string(),
    timestamp: v.number(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("sales", args);
  },
});

// Get global marketplace stats (total volume, recent trades)
export const getGlobalStats = query({
  args: {},
  handler: async (ctx) => {
    type MarketSummary = {
      ticker: string;
      floor: number | null;
      activeListings: number;
      volumeAllTime: number;
      volume24h: number;
      trades24h: number;
      tradeCount: number;
      lastTradeAt: number | null;
    };

    const [activeListings, completedListings] = await Promise.all([
      ctx.db
        .query("psbtListings")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .collect(),
      ctx.db
        .query("psbtListings")
        .withIndex("by_status", (q) => q.eq("status", "completed"))
        .order("desc")
        .collect(),
    ]);

    const marketMap = new Map<string, MarketSummary>();
    const ensureSummary = (ticker: string): MarketSummary => {
      const existing = marketMap.get(ticker);
      if (existing) return existing;
      const created: MarketSummary = {
        ticker,
        floor: null,
        activeListings: 0,
        volumeAllTime: 0,
        volume24h: 0,
        trades24h: 0,
        tradeCount: 0,
        lastTradeAt: null,
      };
      marketMap.set(ticker, created);
      return created;
    };

    const perTokenPrice = (listing: Doc<'psbtListings'>): number | null => {
      if (!listing.tokenAmount || listing.tokenAmount <= 0) {
        return null;
      }
      return listing.price / listing.tokenAmount;
    };

    activeListings.forEach((listing) => {
      const ticker = listing.tokenTicker?.toUpperCase();
      if (!ticker) return;
      const summary = ensureSummary(ticker);
      summary.activeListings += 1;
      const pricePerToken = perTokenPrice(listing);
      if (pricePerToken !== null) {
        if (summary.floor === null || pricePerToken < summary.floor) {
          summary.floor = pricePerToken;
        }
      }
    });

    const ONE_DAY = 24 * 60 * 60 * 1000;
    const cutoff24h = Date.now() - ONE_DAY;
    const RECENT_LIMIT = 25;
    const recentTrades: {
      id: string;
      ticker: string;
      price: number;
      tokenAmount: number | null;
      sellerAddress: string;
      buyerAddress?: string;
      createdAt: number;
      txid?: string;
    }[] = [];

    let totalVolume = 0;

    completedListings.forEach((listing) => {
      const ticker = listing.tokenTicker?.toUpperCase();
      if (!ticker) return;
      const summary = ensureSummary(ticker);
      const price = listing.price || 0;
      totalVolume += price;
      summary.volumeAllTime += price;
      summary.tradeCount += 1;
      summary.lastTradeAt = summary.lastTradeAt ? Math.max(summary.lastTradeAt, listing.createdAt) : listing.createdAt;
      if (listing.createdAt >= cutoff24h) {
        summary.volume24h += price;
        summary.trades24h += 1;
      }
      if (recentTrades.length < RECENT_LIMIT) {
        recentTrades.push({
          id: listing._id,
          ticker,
          price,
          tokenAmount: listing.tokenAmount ?? null,
          sellerAddress: listing.sellerAddress,
          buyerAddress: listing.buyerAddress,
          createdAt: listing.createdAt,
          txid: listing.txid,
        });
      }
    });

    const marketSummaries = Array.from(marketMap.values()).sort((a, b) => {
      if (b.volume24h !== a.volume24h) return b.volume24h - a.volume24h;
      return b.volumeAllTime - a.volumeAllTime;
    });

    const globalFloor = marketSummaries.reduce<number | null>((floor, summary) => {
      if (summary.floor === null) return floor;
      if (floor === null) return summary.floor;
      return Math.min(floor, summary.floor);
    }, null);

    return {
      activeListings: activeListings.length,
      uniqueTickers: marketSummaries.length,
      globalFloor,
      totalVolume,
      recentTrades,
      marketSummaries,
    };
  },
});
