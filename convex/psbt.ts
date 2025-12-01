import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { broadcastTransaction, bytesToHex, hexToBytes, fetchUtxos, callZcashRPC, checkInscriptionAt } from "./zcashHelpers";
import { TREASURY_ADDRESS } from "./treasury.config";
import bs58check from "bs58check";

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

function parseAmountLike(v: any): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function assertValidZrc20Transfer(listing: any) {
  // Only validate ZRC-20 flow (tokenTicker/tokenAmount present)
  if (!listing?.tokenTicker || !(typeof listing?.tokenAmount === 'number' && listing.tokenAmount > 0)) return;
  const location = String(listing.tokenLocation || '');
  if (!location.includes(':')) throw new Error('Invalid token location');
  const [txid, voutStr] = location.split(':');
  const vout = parseInt(voutStr || '0', 10) || 0;

  // 1) Ensure seller controls the token UTXO (matches seller address script)
  try {
    const tx: any = await callZcashRPC('getrawtransaction', [txid, 1]);
    const vouts: any[] = Array.isArray(tx?.vout) ? tx.vout : [];
    const out = vouts.find((o: any) => o?.n === vout) ?? vouts[vout];
    if (!out) throw new Error('Output not found');
    const expected = buildP2PKHScript(pkhFromT1(listing.sellerAddress));
    const scriptHex: string = String(out?.scriptPubKey?.hex || '').toLowerCase();
    if (!scriptHex) throw new Error('Missing scriptPubKey');
    if (bytesToHex(expected).toLowerCase() !== scriptHex) {
      throw new Error('Seller does not own the token UTXO');
    }
  } catch (e: any) {
    throw new Error(`Ownership check failed: ${e?.message || String(e)}`);
  }

  // 2) Validate transfer against indexer (id is txid + 'i0' convention for inscriptions)
  const transferId = `${txid}i0`;
  let tf: any;
  try {
    tf = await ordinalIndexFetch(`/api/v1/zrc20/transfer/${transferId}`);
  } catch (e: any) {
    throw new Error(`Cannot validate transfer via indexer: ${e?.message || String(e)}`);
  }

  const tick = (tf?.tick || tf?.ticker || '').toString().toUpperCase();
  const amt = parseAmountLike(tf?.amt ?? tf?.amount);
  const used = Boolean(tf?.used || tf?.revealed || tf?.consumed);
  const sender = (tf?.sender || tf?.from || tf?.address || tf?.owner || '').toString();
  const outpoint = (tf?.outpoint || tf?.location || tf?.output || '').toString();

  if (used) throw new Error('Transfer already used');
  if (!tick || tick !== String(listing.tokenTicker).toUpperCase()) throw new Error('Transfer ticker mismatch');
  if (amt === null) throw new Error('Transfer amount missing');
  if (sender && sender.toLowerCase() !== String(listing.sellerAddress).toLowerCase()) throw new Error('Transfer sender mismatch');
  if (outpoint && outpoint !== location) throw new Error('Transfer outpoint mismatch');
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
    },
    handler: async (ctx, args) => {
        // Validate ZRC-20 transfer listings using indexer (fail-safe)
        if (args.tokenTicker && typeof args.tokenAmount === 'number') {
            await assertValidZrc20Transfer({
                tokenLocation: args.tokenLocation,
                sellerAddress: args.sellerAddress,
                tokenTicker: args.tokenTicker,
                tokenAmount: args.tokenAmount,
            });
        }
        // Optionally cache seller input value
        let sellerInputValue: number | undefined = undefined;
        try {
            const location = args.tokenLocation;
            const [txid, voutStr] = location.split(':');
            const vout = parseInt(voutStr, 10);
            if (txid && Number.isFinite(vout)) {
                try {
                    const tx: any = await callZcashRPC('getrawtransaction', [txid, 1]);
                    const vouts: any[] = Array.isArray(tx?.vout) ? tx.vout : [];
                    const out = vouts.find((o: any) => o?.n === vout) ?? vouts[vout];
                    const valZ = typeof out?.valueZat === 'number' ? out.valueZat
                                : typeof out?.satoshis === 'number' ? out.satoshis
                                : typeof out?.value === 'number' ? Math.round(out.value * 1e8)
                                : null;
                    if (valZ !== null) sellerInputValue = valZ;
                } catch {}
                if (sellerInputValue === undefined) {
                    try {
                        const utxo: any = await callZcashRPC('gettxout', [txid, vout, true]);
                        const valZ = typeof utxo?.valueZat === 'number' ? utxo.valueZat
                                    : typeof utxo?.satoshis === 'number' ? utxo.satoshis
                                    : typeof utxo?.value === 'number' ? Math.round(utxo.value * 1e8)
                                    : null;
                        if (valZ !== null) sellerInputValue = valZ;
                    } catch {}
                }
            }
        } catch {}

        const listingId = await ctx.db.insert("psbtListings", {
            psbtBase64: args.psbtBase64,
            tokenLocation: args.tokenLocation,
            sellerAddress: args.sellerAddress,
            price: args.price,
            tokenTicker: args.tokenTicker,
            tokenAmount: args.tokenAmount,
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
    },
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
    handler: async (ctx, args) => {
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
    },
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
  handler: async (ctx, args) => {
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
    if ((listing as any).tokenTicker && typeof (listing as any).tokenAmount === 'number') {
      await assertValidZrc20Transfer(listing);
    }

    // Parse inputs/outputs
    const inputs = decodeInputs(args.hex);
    const outs = decodeOutputs(args.hex);
    if (outs.length < 3) throw new Error('Invalid transaction: missing required outputs');

    // Validate output ordering and amounts
    const priceZats = Math.round(listing.price * 1e8);
    const sellerFeeZats = Math.floor(priceZats * 0.025);
    const expectedSellerPayout = priceZats - sellerFeeZats;
    const expectedBuyerScript = buildP2PKHScript(pkhFromT1(args.buyerAddress));
    const expectedSellerScript = listing.sellerPayoutScriptHex
      ? hexToBytes(listing.sellerPayoutScriptHex)
      : buildP2PKHScript(pkhFromT1(listing.sellerAddress));
    const expectedTreasuryScript = buildP2PKHScript(pkhFromT1(TREASURY_ADDRESS));

    // Output 0: token → buyer
    if (!(outs[0].script.length === expectedBuyerScript.length && outs[0].script.every((b, i) => b === expectedBuyerScript[i]))) {
      throw new Error('Output 0 must transfer the token to the buyer');
    }
    // Output 1: seller payout
    if (outs[1].value !== expectedSellerPayout || !(outs[1].script.length === expectedSellerScript.length && outs[1].script.every((b, i) => b === expectedSellerScript[i]))) {
      throw new Error('Output 1 (seller payout) does not match listing');
    }
    // Output 2: treasury
    if (outs[2].value !== sellerFeeZats || !(outs[2].script.length === expectedTreasuryScript.length && outs[2].script.every((b, i) => b === expectedTreasuryScript[i]))) {
      throw new Error('Output 2 (treasury) missing or incorrect');
    }

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
          try { tx = await callZcashRPC('getrawtransaction', [inp.txid, 1]); cache.set(inp.txid, tx); } catch {}
        }
        let valZ: number | null = null;
        try {
          const vouts: any[] = Array.isArray(tx?.vout) ? tx.vout : [];
          const out = vouts.find((o: any) => o?.n === inp.vout) ?? vouts[inp.vout];
          valZ = typeof out?.valueZat === 'number' ? out.valueZat
               : typeof out?.satoshis === 'number' ? out.satoshis
               : typeof out?.value === 'number' ? Math.round(out.value * 1e8)
               : null;
        } catch {}
        if (valZ === null) {
          try {
            const utxo: any = await callZcashRPC('gettxout', [inp.txid, inp.vout, true]);
            valZ = typeof utxo?.valueZat === 'number' ? utxo.valueZat
                 : typeof utxo?.satoshis === 'number' ? utxo.satoshis
                 : typeof utxo?.value === 'number' ? Math.round(utxo.value * 1e8)
                 : null;
          } catch {}
        }
        if (valZ) totalIn += valZ;
      }
    } catch {}
    let totalOut = 0;
    try { for (const o of outs) totalOut += o.value; } catch {}
    const feeZats = totalIn > 0 && totalOut > 0 ? (totalIn - totalOut) : undefined;

    // Broadcast via our RPC
    const txid = await broadcastTransaction(args.hex);
    // Update status via mutation from an action
    await ctx.runMutation(api.psbt.updateStatus, { listingId: args.listingId, status: 'completed', txid, buyerAddress: args.buyerAddress, feeZats });
    return txid;
  }
});

// Prepare a canonical buyer template for outputs/order/scripts/amounts
export const prepareBuyerTemplate = action({
  args: { listingId: v.id('psbtListings'), buyerAddress: v.string() },
  handler: async (ctx, args) => {
    // In actions, DB access must go through runQuery
    const listing = await ctx.runQuery(api.psbt.getListing, { listingId: args.listingId });
    if (!listing) throw new Error('Listing not found');
    if (listing.status !== 'active') throw new Error('Listing not active');

    // Re-validate ZRC-20 transfer at time of purchase preparation
    if ((listing as any).tokenTicker && typeof (listing as any).tokenAmount === 'number') {
      await assertValidZrc20Transfer(listing);
    }

    // Fetch token input value from seller's UTXOs (fallback to direct RPC)
    const [txid, voutStr] = listing.tokenLocation.split(':');
    const vout = parseInt(voutStr, 10);
    let tokenValueZats: number | null = null;
    // Use cached value if available
    if (typeof (listing as any).sellerInputValue === 'number') tokenValueZats = (listing as any).sellerInputValue as number;
    try {
      const utxos = await fetchUtxos(listing.sellerAddress);
      const tokenUtxo = utxos.find(u => u.txid === txid && u.vout === vout);
      if (tokenUtxo) tokenValueZats = Number(tokenUtxo.value);
    } catch {}
    if (tokenValueZats === null) {
      try {
        const tx: any = await callZcashRPC('getrawtransaction', [txid, 1]);
        const vouts: any[] = Array.isArray(tx?.vout) ? tx.vout : [];
        const out = vouts.find((o: any) => o?.n === vout) ?? vouts[vout];
        const valZ = typeof out?.valueZat === 'number' ? out.valueZat
                    : typeof out?.satoshis === 'number' ? out.satoshis
                    : typeof out?.value === 'number' ? Math.round(out.value * 1e8)
                    : null;
        if (valZ !== null) tokenValueZats = valZ;
      } catch {}
    }
    if (tokenValueZats === null) {
      try {
        const utxo: any = await callZcashRPC('gettxout', [txid, vout, true]);
        const valZ = typeof utxo?.valueZat === 'number' ? utxo.valueZat
                    : typeof utxo?.satoshis === 'number' ? utxo.satoshis
                    : typeof utxo?.value === 'number' ? Math.round(utxo.value * 1e8)
                    : null;
        if (valZ !== null) tokenValueZats = valZ;
      } catch {}
    }
    if (tokenValueZats === null) throw new Error('Token UTXO not found or already spent');

    const priceZats = Math.round(listing.price * 1e8);
    const sellerFeeZats = Math.floor(priceZats * 0.025);
    const sellerPayoutZats = priceZats - sellerFeeZats;

    const buyerScript = buildP2PKHScript(pkhFromT1(args.buyerAddress));
    const sellerScript = buildP2PKHScript(pkhFromT1(listing.sellerAddress));
    const treasuryScript = buildP2PKHScript(pkhFromT1(TREASURY_ADDRESS));

    return {
      listingId: args.listingId,
      buyerAddress: args.buyerAddress,
      tokenLocation: listing.tokenLocation,
      tokenValueZats,
      outputs: [
        { index: 0, kind: 'token', valueZats: tokenValueZats, scriptHex: bytesToHex(buyerScript) },
        { index: 1, kind: 'sellerPayout', valueZats: sellerPayoutZats, scriptHex: bytesToHex(sellerScript) },
        { index: 2, kind: 'treasury', valueZats: sellerFeeZats, scriptHex: bytesToHex(treasuryScript) },
      ],
      constraints: {
        input0: listing.tokenLocation,
        buyerChangeIndexMin: 3,
        sellerSighash: 'SINGLE|ANYONECANPAY',
      },
    };
  }
});

// Submit buyer offer payload (JSON) for a listing
export const submitBuyerOffer = action({
  args: {
    listingId: v.id("psbtListings"),
    buyerAddress: v.string(),
    offerPayload: v.string(), // JSON string
  },
  handler: async (ctx, args) => {
    const listing = await ctx.runQuery(api.psbt.getListing, { listingId: args.listingId });
    if (!listing) throw new Error('Listing not found');
    if (listing.status !== 'active') throw new Error('Listing not active');
    if ((listing as any).tokenTicker && typeof (listing as any).tokenAmount === 'number') {
      await assertValidZrc20Transfer(listing);
    }
    // Build canonical template inline to avoid cross-calling actions from a mutation
    const [txid, voutStr] = listing.tokenLocation.split(':');
    const vout = parseInt(voutStr, 10);
    let tokenValueZats2: number | null = null;
    try {
      const utxos = await fetchUtxos(listing.sellerAddress);
      const tokenUtxo = utxos.find(u => u.txid === txid && u.vout === vout);
      if (tokenUtxo) tokenValueZats2 = Number(tokenUtxo.value);
    } catch {}
    if (tokenValueZats2 === null) {
      try {
        const tx: any = await callZcashRPC('getrawtransaction', [txid, 1]);
        const vouts: any[] = Array.isArray(tx?.vout) ? tx.vout : [];
        const out = vouts.find((o: any) => o?.n === vout) ?? vouts[vout];
        const valZ = typeof out?.valueZat === 'number' ? out.valueZat
                    : typeof out?.satoshis === 'number' ? out.satoshis
                    : typeof out?.value === 'number' ? Math.round(out.value * 1e8)
                    : null;
        if (valZ !== null) tokenValueZats2 = valZ;
      } catch {}
    }
    if (tokenValueZats2 === null) {
      try {
        const utxo: any = await callZcashRPC('gettxout', [txid, vout, true]);
        const valZ = typeof utxo?.valueZat === 'number' ? utxo.valueZat
                    : typeof utxo?.satoshis === 'number' ? utxo.satoshis
                    : typeof utxo?.value === 'number' ? Math.round(utxo.value * 1e8)
                    : null;
        if (valZ !== null) tokenValueZats2 = valZ;
      } catch {}
    }
    if (tokenValueZats2 === null) throw new Error('Token UTXO not found or already spent');
    const priceZats = Math.round(listing.price * 1e8);
    const sellerFeeZats = Math.floor(priceZats * 0.025);
    const sellerPayoutZats = priceZats - sellerFeeZats;
    const buyerScriptHex = bytesToHex(buildP2PKHScript(pkhFromT1(args.buyerAddress)));
    const sellerScriptHex = bytesToHex(buildP2PKHScript(pkhFromT1(listing.sellerAddress)));
    const treasuryScriptHex = bytesToHex(buildP2PKHScript(pkhFromT1(TREASURY_ADDRESS)));
    let payload: any;
    try { payload = JSON.parse(args.offerPayload); } catch { throw new Error('Invalid offer payload'); }
    const [ptxid, pvoutStr] = (payload.sellerInput?.txid && typeof payload.sellerInput?.vout === 'number')
      ? [payload.sellerInput.txid, String(payload.sellerInput.vout)] : [null, null];
    if (!ptxid || `${ptxid}:${pvoutStr}` !== listing.tokenLocation) {
      throw new Error('Offer seller input does not match listing token');
    }
    if (!Array.isArray(payload.outputs) || payload.outputs.length < 3) {
      throw new Error('Offer outputs missing');
    }
    // Check first 3 outputs match template
    const o0 = payload.outputs[0];
    const o1 = payload.outputs[1];
    const o2 = payload.outputs[2];
    if (!o0 || o0.value !== tokenValueZats2 || (o0.scriptHex || '').toLowerCase() !== buyerScriptHex.toLowerCase()) {
      throw new Error('Offer output 0 mismatch');
    }
    if (!o1 || o1.value !== sellerPayoutZats || (o1.scriptHex || '').toLowerCase() !== sellerScriptHex.toLowerCase()) {
      throw new Error('Offer output 1 (seller payout) mismatch');
    }
    if (!o2 || o2.value !== sellerFeeZats || (o2.scriptHex || '').toLowerCase() !== treasuryScriptHex.toLowerCase()) {
      throw new Error('Offer output 2 (treasury) mismatch');
    }
    const offerId = await ctx.runMutation(api.psbt.insertOffer, {
      listingId: args.listingId,
      sellerAddress: listing.sellerAddress,
      buyerAddress: args.buyerAddress,
      offerPayload: args.offerPayload,
    });
    return offerId;
  }
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
  handler: async (ctx, args) => {
    const rec = await ctx.db.get(args.listingId);
    if (!rec) throw new Error('Listing not found');
    if (rec.status !== 'active') throw new Error('Listing not active');
    if (rec.sellerAddress.toLowerCase() !== args.requester.toLowerCase()) {
      throw new Error('Only the seller can cancel this listing');
    }
    await ctx.db.patch(args.listingId, { status: 'cancelled' });
  }
});
