# Convex Backend for zatoshi.market

This directory contains the Convex backend schema and functions for managing ZMAP parcels, mint transactions, and user data.

## Setup

1. Install Convex: `npm install convex`
2. Run `npx convex dev` to start the development server
3. This will generate the `.env.local` file with your deployment URL

## Schema

### zmapParcels
Tracks all ZMAP parcels and their status (available, reserved, minted).

### mintTransactions
Records all mint transactions on the Zcash blockchain.

### users
Tracks user activity, owned ZMAPs, and ZORE balances.

### activityFeed
Live activity feed for real-time updates across the site.

## Functions

### zmaps.ts
- `getAllZmaps` - Get all ZMAPs with pagination
- `getZmapByNumber` - Get specific ZMAP by map number
- `getZmapsByStatus` - Filter ZMAPs by status
- `getZmapsByAddress` - Get ZMAPs owned by address
- `reserveZmap` - Reserve a ZMAP for 15 minutes
- `mintZmap` - Mark ZMAP as minted after transaction
- `cancelReservation` - Cancel a reservation
- `getZmapStats` - Get overall statistics

### users.ts
- `getUserByAddress` - Get user data by Zcash address
- `upsertUser` - Create or update user
- `updateUserAfterMint` - Update user stats after successful mint
- `getTopHolders` - Get leaderboard of top ZMAP holders

## Deployment

Your deployment URL: https://whimsical-peccary-215.convex.cloud
