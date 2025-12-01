import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
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

// Create a new PSBT listing
// Create a new PSBT listing
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

    // Parse inputs/outputs
    const inputs = decodeInputs(args.hex);
    const outs = decodeOutputs(args.hex);
    const template = await buildBuyerTemplate(listing, args.buyerAddress);
    if (outs.length < template.outputs.length) throw new Error('Invalid transaction: missing required outputs');

    template.outputs.forEach((expected, idx) => {
      const actual = outs[idx];
      const expectedScript = hexToBytes(expected.scriptHex);
      if (actual.value !== expected.valueZats || !scriptsEqual(actual.script, expectedScript)) {
        throw new Error(`Output ${idx} does not match marketplace template`);
      }
    });

    // Validate seller input presence and scriptSig equals stored maker-ask
    const [itxid, ivoutStr] = String(listing.tokenLocation).split(':');
    const ivout = parseInt(ivoutStr || '0', 10);
    // Require seller input be index 1 to bind to payout (SINGLE)
    if (inputs.length < 2) throw new Error('Invalid transaction: missing seller input at index 1');
    const sellerInput = inputs[1];
    if (sellerInput.txid !== itxid || sellerInput.vout !== ivout) {
      throw new Error('Seller input not at index 1 or does not match tokenLocation');
    }
    if (listing.sellerScriptSigHex && bytesToHex(sellerInput.scriptSig).toLowerCase() !== String(listing.sellerScriptSigHex).toLowerCase()) {
      throw new Error('Seller scriptSig does not match listing maker signature');
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

    // Broadcast via our RPC
    const txid = await broadcastTransaction(args.hex);
    // Update status via mutation from an action
    await ctx.runMutation(api.psbt.updateStatus, { listingId: args.listingId, status: 'completed', txid, buyerAddress: args.buyerAddress, feeZats });
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
