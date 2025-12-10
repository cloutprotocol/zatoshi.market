# ZGODS Onchain Index Migration

## Summary
Successfully migrated the ZGODS claim system to use the onchain ZRC-721 index API instead of the Convex-based claim system.

## Changes Made

### 1. New Service: ZRC-721 Index API Client
**File:** `src/services/zrc721Index.ts`
- Created a new service to interface with the onchain ZRC-721 indexer
- API endpoint: `http://135.181.6.234:3333/api/v1/zrc721`
- Supports fetching:
  - Collections
  - Collection tokens
  - Tokens by address
  - Individual tokens
  - Indexer status

### 2. New Component: ZgodsOnchainView
**File:** `src/components/ZgodsOnchainView.tsx`
- Displays ZGODS tokens from the onchain index
- Features:
  - 30-second polling (no websockets needed)
  - Shows collection-wide or address-specific tokens
  - Image loading with race conditions for optimal performance
  - Responsive card layout

### 3. New Claim Page Client
**File:** `src/app/claim/[slug]/ClaimClientOnchain.tsx`
- Replaced the old claim functionality
- Shows:
  - Notice that claim system is paused
  - Collection stats (supply, minted, progress)
  - User's owned tokens (when wallet connected)
  - Recent mints from the collection

### 4. Updated Claim Page Route
**File:** `src/app/claim/[slug]/page.tsx`
- Switched from `ClaimClient` to `ClaimClientOnchain`
- Updated metadata descriptions to reflect viewing instead of claiming

### 5. Updated Homepage
**File:** `src/app/page.tsx`
- Replaced `RecentClaims` with `ZgodsOnchainView`
- Updated ZGODS section text:
  - "View all minted ZGODS from the onchain ZRC-721 index"
  - Button changed from "Claim Now" to "View Collection"

### 6. Content Security Policy Update
**File:** `next.config.mjs`
- Added `http://135.181.6.234:3333` to CSP `connect-src` directive
- Required because the API uses HTTP (not HTTPS)

## API Endpoints Used

```
GET /api/v1/zrc721/collection/ZGODS
  → Returns collection info (supply, minted, etc.)

GET /api/v1/zrc721/collection/ZGODS/tokens?page=0&limit=10000
  → Returns all tokens with id, owner, inscription

GET /api/v1/zrc721/address/{address}
  → Returns all tokens owned by an address

GET /api/v1/zrc721/status
  → Returns indexer status
```

## Data Structure

### ZRC721Token
```typescript
{
  id: string;           // Token ID
  owner: string;        // Owner address
  inscription: string;  // Inscription ID
  collection?: string;  // Collection name
}
```

### ZRC721Collection
```typescript
{
  collection: string;   // Collection name
  supply: number;       // Total supply
  minted: number;       // Number minted
  meta?: string;        // Metadata URI
  royalty?: string;     // Royalty info
  deployer?: string;    // Deployer address
}
```

## Polling Strategy
- All components poll every 30 seconds
- No websocket connections needed
- Automatic cleanup on component unmount

## Old Files (Preserved)
The following files are still in the codebase but no longer used:
- `src/app/claim/[slug]/ClaimClient.tsx` (old claim system)
- `src/components/RecentClaims.tsx` (old Convex-based component)

These can be removed or archived if desired.

## Testing Checklist
- [x] Homepage shows recent ZGODS mints from onchain index
- [x] `/claim/zgods` page shows collection stats
- [x] Connected wallet shows owned tokens
- [x] CSP allows API calls
- [ ] Verify polling works (30-second intervals)
- [ ] Test with different wallet addresses
- [ ] Verify image loading works correctly
- [ ] Check mobile responsiveness

## Notes
- The API returns tokens sorted by ID, we re-sort them descending (newest first)
- Image loading uses the existing `loadImageWithRace` utility for optimal performance
- The onchain index is the source of truth for all minted tokens
- Claim functionality is completely paused, users can only view
