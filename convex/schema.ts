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
    .index("by_address", ["address"]),

  // Pending transaction contexts for client-side signing flow
  txContexts: defineTable({
    contextId: v.string(),
    status: v.string(), // commit_prepared | commit_broadcast | completed | failed
    // Linked UTXO
    utxoTxid: v.optional(v.string()),
    utxoVout: v.optional(v.number()),
    utxoValue: v.optional(v.number()),
    utxos: v.optional(
      v.array(
        v.object({
          txid: v.string(),
          vout: v.number(),
          value: v.number(),
        })
      )
    ),
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
    .index("by_address", ["address"]),

  // Long-running orchestration jobs (e.g., batch mint)
  jobs: defineTable({
    type: v.string(), // e.g., "batch-mint"
    status: v.string(), // "pending" | "running" | "completed" | "failed"
    params: v.any(),
    totalCount: v.number(),
    completedCount: v.number(),
    inscriptionIds: v.array(v.string()),
    inscriptions: v.array(v.id("inscriptions")),
    totalCostZats: v.optional(v.number()), // accumulated actual spend (zats)
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"]),

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

  // PSBT Listings for the Launchpad
  psbtListings: defineTable({
    psbtBase64: v.string(), // The PSBT content
    sellerAddress: v.string(), // Seller's wallet address
    price: v.number(), // Price in ZEC (or other unit)
    tokenTicker: v.string(), // Ticker of the token being sold
    tokenAmount: v.number(), // Amount of tokens
    status: v.string(), // "active" | "completed" | "cancelled"
    createdAt: v.number(), // Timestamp
    txid: v.optional(v.string()), // Final transaction ID if completed
    buyerAddress: v.optional(v.string()), // Buyer's address if completed
  })
    .index("by_status", ["status"])
    .index("by_seller", ["sellerAddress"])
    .index("by_ticker", ["tokenTicker"])
    .index("by_created_at", ["createdAt"]),

  // Badge definitions (global, reusable across collections)
  badgeDefinitions: defineTable({
    slug: v.string(), // canonical id (e.g., "vip")
    label: v.string(), // display label (e.g., "VIP")
    description: v.optional(v.string()),
    icon: v.optional(v.string()), // optional icon url or emoji
    level: v.optional(v.number()), // optional ordering/priority
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  // Badge assignments to wallet addresses
  userBadges: defineTable({
    address: v.string(),
    badgeSlug: v.string(),
    source: v.optional(v.string()), // e.g., "whitelist:zgods"
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_address", ["address"])
    .index("by_badge_slug", ["badgeSlug"])
    .index("by_address_badge", ["address", "badgeSlug"]),

  // Collection claims (ZRC-721 allocations)
  collectionClaims: defineTable({
    collectionSlug: v.string(),
    tokenId: v.number(),
    status: v.string(), // reserved | minted | failed
    address: v.string(),
    inscriptionId: v.optional(v.string()),
    txid: v.optional(v.string()),
    batchId: v.optional(v.string()),
    attempts: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_collection_token", ["collectionSlug", "tokenId"])
    .index("by_collection_status", ["collectionSlug", "status"])
    .index("by_collection_address", ["collectionSlug", "address"]),

  collectionClaimEvents: defineTable({
    collectionSlug: v.string(),
    tokenId: v.number(),
    address: v.string(),
    batchId: v.optional(v.string()),
    status: v.string(), // reserved | minted | failed
    message: v.optional(v.string()),
    txid: v.optional(v.string()),
    inscriptionId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_collection", ["collectionSlug"])
    .index("by_address", ["address"])
    .index("by_batch", ["batchId"]),
});
