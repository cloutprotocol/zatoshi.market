# UTXO Exhaustion Error

## Error Message
```
Previous mint is still pending. Please wait for the earlier transaction
to confirm or free up a new UTXO before retrying.
```

## TL;DR
**This is NOT a bug** - it's correct behavior preventing double-spends. Users are trying to mint too fast and exhausting their available UTXOs.

---

## What's Happening

### The Problem:
1. User batch mints **5 tokens**
2. Each mint uses **one UTXO** from their wallet
3. All 5 UTXOs are now **in mempool** (pending confirmation)
4. User **immediately tries to mint again**
5. Wallet has **no available UTXOs** (all are pending)
6. Blockchain rejects transaction: **`txn-mempool-conflict`**
7. System shows: **"Previous mint is still pending..."**

### Why This Happens:
- Each inscription requires one UTXO as input
- Once used in a transaction, that UTXO is "locked" in the mempool
- The blockchain prevents using the same UTXO twice (double-spend protection)
- If all UTXOs are pending, no new transactions can be created

---

## This is CORRECT Behavior ✅

The system is **working as designed**:
- ✅ Prevents double-spending
- ✅ Protects blockchain integrity
- ✅ Tries up to 5 UTXO refresh attempts
- ✅ Provides helpful error message

**NOT a bug!** This is Zcash blockchain enforcing safety rules.

---

## Solutions

### Solution 1: Wait for Confirmation (Recommended)
**Wait 1-2 minutes** for previous mints to confirm, then retry.

**Why:**
- Block time: ~75 seconds
- After confirmation, UTXOs become change outputs
- Change outputs are new UTXOs ready to use

**User Action:**
```
1. Wait for previous batch to confirm (check block explorer)
2. Retry minting
```

---

### Solution 2: Split UTXOs (Advanced)
Create more UTXOs by splitting a large one into smaller pieces.

**How:**
1. Send a transaction to yourself splitting 1 large UTXO into 10+ smaller ones
2. Each small UTXO can then be used for one mint
3. Now you can batch mint up to 10 at once

**Example Script:**
```bash
# Split 1 ZEC into 10 UTXOs of 0.1 ZEC each
# This creates 10 independent UTXOs for minting
```

**Benefits:**
- Can mint larger batches
- Less waiting between batches
- More parallel minting capacity

---

### Solution 3: Implement Queuing (Future Enhancement)
**System could:**
1. Detect when UTXOs are exhausted
2. Queue mint requests
3. Auto-retry when UTXOs become available
4. Process queue as confirmations happen

**Status:** Not implemented yet

---

## How The Code Works

### Current Flow:
```javascript
// jobsActions.ts:72-246
1. Fetch user's UTXOs
2. Filter for suitable ones (large enough, not inscribed)
3. Try to use each UTXO:
   a. Build commit transaction
   b. Broadcast commit
   c. If "txn-mempool-conflict" → try next UTXO
   d. Build reveal transaction
   e. Broadcast reveal
4. If all UTXOs fail → show error
```

### Retry Logic:
```javascript
const MAX_UTXO_REFRESHES = 5;  // Try 5 times

UTXO_REFRESH:
while (!success && refreshCount < MAX_UTXO_REFRESHES) {
  refreshCount++;
  const utxos = await fetchUtxos(address);

  for (const utxo of utxos) {
    try {
      // Try to mint with this UTXO
      await broadcastTransaction(commitHex);
      success = true;
      break;
    } catch (e) {
      if (e.includes('txn-mempool-conflict')) {
        continue; // Try next UTXO
      }
      throw e; // Other errors are fatal
    }
  }
}
```

**The code already handles this well!**

---

## Error Breakdown

### From Zcash Node:
```
rpc: 258: txn-mempool-conflict
```
**Meaning:** Transaction uses UTXO that's already in mempool

### Translated to User-Friendly:
```
Previous mint is still pending. Please wait for the earlier
transaction to confirm or free up a new UTXO before retrying.
```
**Good translation!** Explains the issue and suggests solutions.

---

## Statistics from Analysis

From our failed claims analysis:
- **4** failures with "Previous mint pending" error
- **6** failures with "txn-mempool-conflict" error
- **Total:** 10 out of 11,579 failed claims (0.09%)

**This is rare and acceptable!**

---

## Recommendations

### For Users:

**Do:**
- ✅ Wait 1-2 minutes between large batches
- ✅ Split UTXOs if planning heavy minting
- ✅ Monitor blockchain explorer for confirmations
- ✅ Retry after seeing this error (just wait first)

**Don't:**
- ❌ Spam retry immediately
- ❌ Panic - this is normal
- ❌ Blame the system - it's protecting you

### For Developers:

**Current System:**
- ✅ Already handles this well
- ✅ Retries up to 5 times
- ✅ Provides clear error messages
- ✅ No changes needed for basic functionality

**Potential Enhancements:**
1. **Auto-Queue System**
   - Detect UTXO exhaustion
   - Queue requests
   - Auto-retry when confirmations happen
   - Complexity: High
   - Value: Medium

2. **UTXO Splitting Helper**
   - One-click "Split UTXO" button
   - Automatically creates 10+ UTXOs
   - Complexity: Medium
   - Value: High

3. **Better Error Message**
   - Show how many UTXOs are pending
   - Show estimated wait time
   - Complexity: Low
   - Value: Low

---

## Code Quality Assessment

### Current Implementation: **GOOD** ✅

**Strengths:**
- ✅ Properly detects mempool conflicts
- ✅ Retries with fresh UTXO fetches
- ✅ Clear error messages
- ✅ Prevents double-spends
- ✅ Handles edge cases well

**Weaknesses:**
- ⚠️ No queuing system (not critical)
- ⚠️ No UTXO splitting helper (nice-to-have)
- ⚠️ Could show more diagnostic info (minor)

**Overall:** Code is well-written and handles this correctly.

---

## Testing

### Reproduce the Error:
1. Create wallet with exactly 2 UTXOs
2. Batch mint 2 tokens
3. Immediately try to mint again
4. Error should appear ✓

### Verify Fix Works:
1. Wait for confirmations (~75 seconds)
2. Retry mint
3. Should succeed ✓

---

## Comparison to Bitcoin Ordinals

### Bitcoin Ordinals:
- Same issue exists
- Same solution (wait or split)
- Actually more common on Bitcoin due to higher fees

### Zcash Advantage:
- Faster block times (75s vs 600s)
- Lower fees (easier to split UTXOs)
- Better for batch minting

**Zcash handles this BETTER than Bitcoin!**

---

## Monitoring

### Check for UTXO Issues:
```bash
# Count how often this error occurs
npx convex run adminReconcile:analyzeFailedClaims \
  '{"collectionSlug":"zgods"}' --prod \
  | grep "Previous mint"
```

### Alert Thresholds:
- **< 1% of mints:** Normal ✅
- **1-5% of mints:** Monitor ⚠️
- **> 5% of mints:** Investigate 🔴

**Current:** 0.09% - Normal ✅

---

## FAQ

**Q: Is this a bug?**
A: No, it's correct behavior preventing double-spends.

**Q: Why doesn't the system wait automatically?**
A: It tries 5 times with refreshes. Full queuing adds complexity.

**Q: How long should I wait?**
A: 1-2 minutes for confirmation, then retry.

**Q: Can I prevent this?**
A: Yes, split UTXOs beforehand if planning heavy minting.

**Q: Will this cause failed claims?**
A: Yes, but they're legitimate failures that can be retried.

**Q: Is my transaction lost?**
A: No, nothing was broadcast. Just retry after waiting.

---

## Summary

| Aspect | Status |
|--------|--------|
| Is this a bug? | ❌ No - correct behavior |
| Should we fix it? | ❌ No - working as designed |
| Can users work around it? | ✅ Yes - wait or split UTXOs |
| Is code quality good? | ✅ Yes - handles it well |
| Frequency | ✅ Rare (0.09%) |
| User impact | ⚠️ Low (can retry) |
| **Recommendation** | ✅ Keep as-is, document for users |

---

## Action Items

1. ✅ **Document this behavior** - This file
2. ✅ **Verify it's not a bug** - Confirmed
3. ⏸️ **Consider queuing system** - Future enhancement
4. ⏸️ **Add UTXO splitting tool** - Future enhancement
5. ✅ **Update user docs** - Add to SAFE_MINTING_PROCEDURES.md

---

*Last Updated: 2025-11-23*
*Status: NOT A BUG - Working as Designed ✅*
