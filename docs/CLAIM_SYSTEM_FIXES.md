# Claim System Fixes - Critical Bugs

## Date: 2025-11-23
## Status: READY TO DEPLOY

---

## Summary

Three critical bugs were identified that allowed users to claim more tokens than their allocation:

1. **Race condition** in `finalizeToken` - concurrent mints bypass allocation checks
2. **Address mismatch** handling doesn't update `collectionClaims`
3. **Reserved tokens** not counted toward allocation during finalization

---

## Bug #1: Race Condition (CRITICAL)

### Location
`convex/collectionClaims.ts:416-417`

### Problem
```typescript
const { minted } = await getClaimCountsForAddress(ctx, slug, address);
if (minted >= allowlist.max) {
```

Multiple concurrent `finalizeToken` calls all read the same `minted` count before any updates it, allowing over-allocation.

### Fix
Count the minted tokens AFTER updating the current one to "minted", or use optimistic concurrency control.

**Solution A: Include Current Transaction (Recommended)**
```typescript
// Check allocation AFTER marking as minted but BEFORE committing
const tempStatus = "minted";
const currentMintedCount = await ctx.db
  .query("collectionClaims")
  .withIndex("by_collection_address", (q) =>
    q.eq("collectionSlug", slug).eq("address", address))
  .collect()
  .then(docs => docs.filter(d =>
    d.status === "minted" || (d._id === existing._id && tempStatus === "minted")
  ).length);

if (currentMintedCount > allowlist.max) {
  // Rollback - mark as failed instead
  await ctx.db.patch(existing._id, {
    status: "failed",
    lastError: "Allocation exhausted (race condition prevented)",
    ...
  });
  return;
}
```

**Solution B: Use Reserved Count (Simpler - Recommended)**
```typescript
// Count both minted AND reserved tokens toward allocation
const { minted, reserved } = await getClaimCountsForAddress(ctx, slug, address);
const totalClaimed = minted + reserved;

if (totalClaimed >= allowlist.max) {
  await ctx.db.patch(existing._id, {
    status: "failed",
    lastError: "Allocation exhausted",
    ...
  });
  return;
}
```

This prevents the race condition because reserved tokens are already allocated and can't be double-counted.

---

## Bug #2: Address Mismatch Handling

### Location
`convex/collectionClaims.ts:371-386`

### Problem
```typescript
if ((existing.address || "").toLowerCase() !== address) {
  await ctx.db.insert("collectionClaimEvents", { ... });
  return; // Exits without updating collectionClaims!
}
```

Logs to events but doesn't update `collectionClaims`, leaving token in "reserved" state.

### Fix
Update `collectionClaims` to mark as failed when address mismatch occurs:

```typescript
if ((existing.address || "").toLowerCase() !== address) {
  // Mark as failed in collectionClaims
  await ctx.db.patch(existing._id, {
    status: "failed",
    lastError: "Address mismatch for reserved token",
    updatedAt: Date.now(),
  });

  // Log event
  await ctx.db.insert("collectionClaimEvents", {
    collectionSlug: slug,
    tokenId: args.tokenId,
    address,
    batchId: args.batchId ?? existing.batchId,
    status: "failed",
    message: "Address mismatch for reserved token",
    txid: args.txid,
    inscriptionId: args.inscriptionId,
    createdAt: Date.now(),
  });
  return;
}
```

---

## Bug #3: Reserved Tokens Not Counted

### Location
`convex/collectionClaims.ts:416`

### Problem
`getClaimCountsForAddress` only returns `{minted, reserved}` but `finalizeToken` only checks `minted`. This means reserved tokens aren't counted toward allocation.

### Fix
Already addressed in Bug #1 Solution B - count reserved tokens toward total allocation.

---

## Implementation Plan

### Step 1: Update `getClaimCountsForAddress` (Helper Function)
No changes needed - already returns both `minted` and `reserved`.

### Step 2: Update `finalizeToken`
Apply fixes for Bug #1 (Solution B) and Bug #2.

### Step 3: Add Integration Test
Create test to verify concurrent mints don't exceed allocation.

### Step 4: Deploy to Production
Deploy fixes and monitor for 24 hours.

---

## Testing Checklist

- [ ] User with allocation 5 can mint exactly 5 tokens
- [ ] User with allocation 5 cannot mint 6th token
- [ ] Concurrent mints (5 simultaneous) don't exceed allocation
- [ ] Address mismatch properly marks token as failed in collectionClaims
- [ ] Reserved tokens count toward allocation
- [ ] Expired reservations are properly cleaned up

---

## Deployment Notes

1. **No migration needed** - fixes are purely logic changes
2. **Backward compatible** - existing data structure unchanged
3. **Safe to deploy** - adds stricter checks, won't break existing functionality
4. **Monitor** - watch for "Allocation exhausted (race condition prevented)" errors

---

## Risk Assessment

**Risk Level:** LOW
- Changes only make allocation checking stricter
- Worst case: legitimate mints get rejected (can be retried)
- No data corruption possible
- No breaking changes to API

---

## Rollback Plan

If issues arise:
1. Revert `collectionClaims.ts` to previous version
2. Redeploy
3. No data cleanup needed

---

*Generated: 2025-11-23*
*Author: Claude Code*
