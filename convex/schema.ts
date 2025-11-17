import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Convex Schema for zatoshi.market
 *
 * This schema defines the data structure for:
 * - Reserved ZMAP parcels
 * - Mint transactions on Zcash
 * - User data for live reactivity
 */

export default defineSchema({
  // Reserved ZMAP parcels
  zmapParcels: defineTable({
    mapNumber: v.number(), // ZMAP number (e.g., 0, 1, 2...)
    blockStart: v.number(), // Starting block number (mapNumber * 100 + 1)
    blockEnd: v.number(), // Ending block number ((mapNumber + 1) * 100)
    status: v.string(), // "available" | "reserved" | "minted"
    reservedBy: v.optional(v.string()), // Zcash address that reserved it
    reservedAt: v.optional(v.number()), // Timestamp when reserved
    reservationExpiry: v.optional(v.number()), // When reservation expires
    txid: v.optional(v.string()), // Transaction ID when minted
    mintedAt: v.optional(v.number()), // Timestamp when minted
    inscriptionId: v.optional(v.string()), // Zerdinals inscription ID
  })
    .index("by_map_number", ["mapNumber"])
    .index("by_status", ["status"])
    .index("by_reserved_by", ["reservedBy"]),

  // Mint transactions
  mintTransactions: defineTable({
    txid: v.string(), // Zcash transaction ID
    mapNumber: v.number(), // Which ZMAP was minted
    fromAddress: v.string(), // Zcash address that minted
    amount: v.number(), // ZEC amount (should be 0.0015)
    zoreAmount: v.number(), // ZORE tokens received (should be 10000)
    blockHeight: v.number(), // Block height when minted
    timestamp: v.number(), // Unix timestamp
    status: v.string(), // "pending" | "confirmed" | "failed"
    confirmations: v.number(), // Number of confirmations
  })
    .index("by_txid", ["txid"])
    .index("by_map_number", ["mapNumber"])
    .index("by_address", ["fromAddress"])
    .index("by_status", ["status"])
    .index("by_timestamp", ["timestamp"]),

  // Users (for tracking wallet connections and activity)
  users: defineTable({
    address: v.string(), // Zcash address
    firstSeen: v.number(), // First connection timestamp
    lastSeen: v.number(), // Last activity timestamp
    totalMinted: v.number(), // Total ZMAPs minted
    totalZore: v.number(), // Total ZORE tokens owned
    zmapIds: v.array(v.number()), // Array of owned ZMAP numbers
    reservedZmaps: v.array(v.number()), // Currently reserved ZMAPs
  })
    .index("by_address", ["address"])
    .index("by_total_minted", ["totalMinted"]),

  // Activity feed for live updates
  activityFeed: defineTable({
    type: v.string(), // "mint" | "reservation" | "transfer"
    mapNumber: v.optional(v.number()),
    address: v.string(),
    txid: v.optional(v.string()),
    amount: v.optional(v.number()),
    timestamp: v.number(),
    message: v.string(), // Human-readable message
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_type", ["type"])
    .index("by_address", ["address"]),

  // Inscriptions (for /inscribe page tracking)
  inscriptions: defineTable({
    inscriptionId: v.string(), // txid + "i" + offset (e.g., "abc123i0")
    txid: v.string(), // Transaction ID
    address: v.string(), // Creator's address (public)
    contentType: v.string(), // "text/plain", "application/json", etc.
    contentPreview: v.string(), // First 200 chars of content for preview
    contentSize: v.number(), // Size in bytes
    type: v.string(), // "text" | "zrc20" | "image" | "other"
    status: v.string(), // "pending" | "confirmed" | "failed"
    createdAt: v.number(), // Timestamp when created
    confirmedAt: v.optional(v.number()), // When confirmed on chain
    blockHeight: v.optional(v.number()), // Block height when confirmed
    // ZRC-20 specific fields (if applicable)
    zrc20Tick: v.optional(v.string()),
    zrc20Op: v.optional(v.string()), // "mint" | "deploy" | "transfer"
    zrc20Amount: v.optional(v.string()),
    // Platform fee metadata
    platformFeeZat: v.optional(v.number()),
    treasuryAddress: v.optional(v.string()),
  })
    .index("by_inscription_id", ["inscriptionId"])
    .index("by_txid", ["txid"])
    .index("by_address", ["address"])
    .index("by_status", ["status"])
    .index("by_type", ["type"])
    .index("by_created_at", ["createdAt"]),

  // UTXO Locks for safe concurrency
  utxoLocks: defineTable({
    txid: v.string(),
    vout: v.number(),
    address: v.string(),
    lockedBy: v.optional(v.string()), // job id or request id
    lockedAt: v.number(),
  })
    .index("by_txid_vout", ["txid", "vout"]) 
    .index("by_address", ["address"]) ,

  // Pending transaction contexts for client-side signing flow
  txContexts: defineTable({
    contextId: v.string(),
    status: v.string(), // commit_prepared | commit_broadcast | completed | failed
    // Linked UTXO
    utxoTxid: v.string(),
    utxoVout: v.number(),
    utxoValue: v.number(),
    address: v.string(),
    // Transaction building params
    consensusBranchId: v.number(),
    inscriptionAmount: v.number(),
    fee: v.number(),
    platformFeeZats: v.number(),
    platformTreasuryAddress: v.optional(v.string()),
    // Scripts and data
    pubKeyHex: v.string(),
    redeemScriptHex: v.string(),
    p2shScriptHex: v.string(),
    inscriptionDataHex: v.string(),
    // Content metadata for logging
    contentType: v.string(),
    contentStr: v.string(),
    type: v.optional(v.string()),
    // Broadcast artifacts
    commitTxid: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_context_id", ["contextId"]) 
    .index("by_address", ["address"]) ,

  // Long-running orchestration jobs (e.g., batch mint)
  jobs: defineTable({
    type: v.string(), // e.g., "batch-mint"
    status: v.string(), // "pending" | "running" | "completed" | "failed"
    params: v.any(),
    totalCount: v.number(),
    completedCount: v.number(),
    inscriptionIds: v.array(v.string()),
    inscriptions: v.array(v.id("inscriptions")),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"]) ,

  // Sales tracking for marketplace
  sales: defineTable({
    inscriptionId: v.string(), // What was sold
    sellerAddress: v.string(),
    buyerAddress: v.string(),
    priceZec: v.number(), // Price in ZEC
    txid: v.string(), // Sale transaction ID
    timestamp: v.number(),
    status: v.string(), // "pending" | "completed" | "cancelled"
  })
    .index("by_inscription_id", ["inscriptionId"])
    .index("by_seller", ["sellerAddress"])
    .index("by_buyer", ["buyerAddress"])
    .index("by_timestamp", ["timestamp"]),
});
