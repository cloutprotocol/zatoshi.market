# Backend API Testing Results - positive_only Parameter

## Testing Date
November 27, 2025

## Summary
The new `positive_only` query parameter has been deployed to the `/api/v1/zrc20/token/{tick}/balances` endpoint, but testing reveals it's not filtering zero-balance addresses correctly.

## Expected Behavior
When `positive_only=true`, the endpoint should return **only** addresses where `overall > 0`.

## Actual Behavior
The `positive_only` parameter is accepted but **zero-balance addresses are still included** in the results.

## Test Evidence

### Test 1: Summary Endpoint (Baseline)
```bash
curl -s "http://135.181.6.234:3333/api/v1/zrc20/token/zero/summary" | jq '{holders, holders_total}'
```

**Result:**
```json
{
  "holders": 2376,        // positive-only count
  "holders_total": 3487   // all addresses (including zeros)
}
```

**Expected:** 1111 addresses with zero balance (3487 - 2376)

### Test 2: Balances Response Structure
```bash
curl -s "http://135.181.6.234:3333/api/v1/zrc20/token/zero/balances?page=0&limit=3&positive_only=true" | jq .
```

**Result:**
```json
{
  "holders": [
    {
      "address": "t1SDxc3F9zLUF1UaFTZksYfPgAgm9F9wiAj",
      "available": "274083000000000000000000",
      "overall": "274083000000000000000000"
    },
    ...
  ],
  "limit": 3,
  "page": 0,
  "tick": "zero",
  "total_holders": 3487
}
```

**Note:** Response structure is correct (includes `total_holders`), but missing `positive_only` and `total_positive_holders` fields mentioned in the spec.

### Test 3: Zero-Balance Filtering (FAILED)
At page 237-238, zero-balance addresses should appear in default mode but be filtered out with `positive_only=true`.

**Default (all balances) - page 238:**
```bash
curl -s "http://135.181.6.234:3333/api/v1/zrc20/token/zero/balances?page=238&limit=10" \
  | jq '.holders[] | select(.overall == "0") | .address' | wc -l
```
**Result:** 10 zero-balance addresses found ✅

**With positive_only=true - page 238:**
```bash
curl -s "http://135.181.6.234:3333/api/v1/zrc20/token/zero/balances?page=238&limit=10&positive_only=true" \
  | jq '.holders[] | select(.overall == "0") | .address' | wc -l
```
**Result:** 10 zero-balance addresses found ❌ **SHOULD BE 0**

**Page 237 (last positive page) with positive_only:**
```bash
curl -s "http://135.181.6.234:3333/api/v1/zrc20/token/zero/balances?page=237&limit=10&positive_only=true" \
  | jq '.holders[-1] | {address, overall}'
```
**Result:**
```json
{
  "address": "t1HupT6HXPSydTT1q66nuGfPv7RhUyEUgLU",
  "overall": "0"
}
```
❌ **Last holder has zero balance - should not be included with positive_only=true**

### Test 4: Unique Balance Values
```bash
# With positive_only at page with zeros
curl -s "http://135.181.6.234:3333/api/v1/zrc20/token/zero/balances?page=238&limit=10&positive_only=true" \
  | jq '.holders[] | .overall' | sort -u
```
**Result:** `"0"` (all 10 results have zero balance)

```bash
# Without positive_only at page 0 (should have positive values)
curl -s "http://135.181.6.234:3333/api/v1/zrc20/token/zero/balances?page=0&limit=5&positive_only=true" \
  | jq '.holders[] | .overall' | sort -u
```
**Result:**
```
"149996000000000000000000"
"154998000000000000000000"
"166976000000000000000000"
"211721108000000000000000"
"274083000000000000000000"
```
✅ **Page 0 correctly returns positive balances**

## Issue Analysis

### What's Working ✅
1. API accepts the `positive_only` parameter without error
2. Response includes `total_holders` field
3. Page 0 returns positive balances
4. Default behavior (without positive_only) works correctly

### What's Not Working ❌
1. **Critical:** `positive_only=true` does not filter out zero-balance addresses at later pages (238+)
2. Response missing `positive_only` field (should echo the query param)
3. Response missing `total_positive_holders` field

### Root Cause Hypothesis
The filtering logic may be applied **before pagination** instead of filtering the query results. This would explain why:
- Early pages (0-236) show positive balances (they're sorted by balance DESC)
- Later pages (237+) show zeros because pagination offset goes beyond positive holders
- The parameter is accepted but not properly applied to the WHERE clause

## Recommended Fixes

### Backend Implementation
The SQL query should look like this:

```sql
-- Current (suspected broken implementation)
SELECT * FROM (
  SELECT * FROM balances WHERE tick = ? ORDER BY overall DESC
) LIMIT ? OFFSET ?
WHERE positive_only = true AND overall > 0  -- ❌ Too late!

-- Correct implementation
SELECT * FROM balances
WHERE tick = ?
  AND (NOT ? OR overall > 0)  -- Apply positive_only filter HERE
ORDER BY overall DESC
LIMIT ? OFFSET ?
```

### Response Fields
Add the missing fields:

```json
{
  "holders": [...],
  "page": 0,
  "limit": 10,
  "tick": "zero",
  "total_holders": 3487,
  "total_positive_holders": 2376,  // ← ADD THIS
  "positive_only": true              // ← ADD THIS (echo parameter)
}
```

## Verification Commands

After fix is deployed, run these commands to verify:

```bash
# 1. Verify zero balances are filtered out
curl -s "http://135.181.6.234:3333/api/v1/zrc20/token/zero/balances?page=238&limit=10&positive_only=true" \
  | jq '.holders[] | select(.overall == "0")' \
  | wc -l
# Expected: 0

# 2. Verify response includes new fields
curl -s "http://135.181.6.234:3333/api/v1/zrc20/token/zero/balances?page=0&limit=10&positive_only=true" \
  | jq '{positive_only, total_holders, total_positive_holders}'
# Expected: {"positive_only": true, "total_holders": 3487, "total_positive_holders": 2376}

# 3. Verify consistency: count all positive results vs summary
curl -s "http://135.181.6.234:3333/api/v1/zrc20/token/zero/balances?page=0&limit=5000&positive_only=true" \
  | jq '.holders | length'
# Expected: 2376 (or close if using pagination)

# 4. Compare with summary
curl -s "http://135.181.6.234:3333/api/v1/zrc20/token/zero/summary" | jq '.holders'
# Expected: 2376
```

## Frontend Impact

The frontend has been updated to support the `positive_only` parameter:
- TypeScript types updated to include new response fields
- `getTokenBalances()` method accepts `{ positiveOnly: boolean }` option
- UI prepared to display `total_holders` vs `total_positive_holders`

**However**, we should **NOT enable** `positiveOnly: true` in frontend calls until the backend bug is fixed, as it would result in:
- Missing data (zero-balance addresses shown instead of positive ones)
- Incorrect pagination (pages beyond 237 would show all zeros)

## Status
🔴 **Backend fix required before frontend can use positive_only parameter**

## Frontend Preparation Status
✅ Types updated
✅ API method ready
✅ UI prepared
⏸️ Not enabled (waiting for backend fix)
