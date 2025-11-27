# Backend API Enhancement Recommendations

## Overview
This document outlines recommended enhancements to the Ordinal Indexer API to support positive-only balance filtering and improve consistency with the recently added `holders_positive` field.

## Current State

### Summary Endpoint ✅ (Already Implemented)
```
GET /api/v1/zrc20/token/{tick}/summary
```

Returns:
- `holders`: Addresses with overall > 0 (positive balances only)
- `holders_total`: All balance rows (includes zero-balance entries)
- `transfers_completed`: Total number of transfers

Example (ZERO token):
```json
{
  "holders": 2376,
  "holders_total": 3487,
  "transfers_completed": 5026,
  "tick": "zero"
}
```

### Integrity Endpoint ✅ (Already Implemented)
```
GET /api/v1/zrc20/token/{tick}/integrity
```

Returns:
- `holders_positive`: Addresses with overall > 0
- `total_holders`: All balance rows
- `consistent`: Boolean integrity check

Example (ZERO token):
```json
{
  "total_holders": 3487,
  "holders_positive": 2376,
  "consistent": true,
  "tick": "zero"
}
```

## Recommended Enhancement: Balances Endpoint

### Current Implementation
```
GET /api/v1/zrc20/token/{tick}/balances?page={page}&limit={limit}
```

Returns all balance entries (including zero balances).

### Proposed Enhancement
Add optional `positive_only` query parameter:

```
GET /api/v1/zrc20/token/{tick}/balances?page={page}&limit={limit}&positive_only={true|false}
```

#### Parameters
- `page` (integer, default: 0): Page number for pagination
- `limit` (integer, default: 100): Results per page
- `positive_only` (boolean, default: false): Filter to only addresses with overall > 0

#### Behavior
- **Default (`positive_only=false`)**: Returns all balance entries (current behavior) - maintains backward compatibility
- **With `positive_only=true`**: Returns only addresses where `overall > 0`

#### Implementation Pseudocode
```sql
-- Default behavior (positive_only=false or omitted)
SELECT address, available, overall, tick
FROM token_balances
WHERE tick = $tick
ORDER BY overall DESC
LIMIT $limit OFFSET $offset;

-- With positive_only=true
SELECT address, available, overall, tick
FROM token_balances
WHERE tick = $tick
  AND overall > 0
ORDER BY overall DESC
LIMIT $limit OFFSET $offset;
```

#### Response Format
```json
{
  "page": 0,
  "limit": 100,
  "total_holders": 3487,
  "total_positive_holders": 2376,
  "holders": [
    {
      "address": "t1...",
      "available": "1000000000000000000",
      "overall": "1000000000000000000",
      "tick": "zero"
    }
  ]
}
```

### Alternative Approach (More Opinionated)

Change the default to positive-only and add `include_zero=true` for full data:

```
GET /api/v1/zrc20/token/{tick}/balances?include_zero=true
```

**Pros:**
- Most UI use cases want positive balances only
- Cleaner default behavior
- Matches the new `holders` vs `holders_total` semantics

**Cons:**
- Breaking change for existing API consumers
- Requires migration strategy

## Frontend Integration

The frontend has been updated to support the `positive_only` parameter:

```typescript
// TypeScript service method
async getTokenBalances(
  tick: string,
  page = 0,
  limit = 100,
  options?: { positiveOnly?: boolean }
): Promise<OrdinalIndexBalancesResponse> {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });

  if (options?.positiveOnly) {
    params.set('positive_only', 'true');
  }

  return this.apiCall<OrdinalIndexBalancesResponse>(
    `/api/v1/zrc20/token/${tick.toLowerCase()}/balances?${params.toString()}`
  );
}
```

### Usage Example
```typescript
// Get only positive balances
const positiveBalances = await ordinalIndexAPI.getTokenBalances('zero', 0, 100, { positiveOnly: true });

// Get all balances (including zeros)
const allBalances = await ordinalIndexAPI.getTokenBalances('zero', 0, 100);
```

## UI Enhancements Implemented

### Token Detail Panels
Both the ZRC-20 page and inscribe page now show:
- **Primary metric**: Positive holders (addresses with balance > 0)
- **Secondary metric**: Total addresses (when different from positive holders)
- Tooltip: "Total includes addresses with zero balance"

Example display:
```
Holders
2376
3487 total addresses
5026 transfers
```

## Rationale

### Why Positive-Only Matters
1. **User Expectations**: When users see "holders," they expect active participants, not historical addresses
2. **UI Clarity**: Displaying 2376 vs 3487 gives users insight into token activity
3. **Consistency**: Matches the new `holders` vs `holders_total` API semantics
4. **Performance**: Filtering at the database level is more efficient than client-side filtering

### Why Optional Parameter (Not Default Change)
1. **Backward Compatibility**: Existing API consumers continue working
2. **Flexibility**: Full dataset still available when needed
3. **Explicit Intent**: Code clearly shows when requesting positive-only balances
4. **Migration Path**: Can change default in v2 of API after deprecation period

## Testing Recommendations

### API Tests
```bash
# Test default behavior (all balances)
curl "http://135.181.6.234:3333/api/v1/zrc20/token/zero/balances?page=0&limit=10"

# Test positive_only=true
curl "http://135.181.6.234:3333/api/v1/zrc20/token/zero/balances?page=0&limit=10&positive_only=true"

# Test positive_only=false (explicit)
curl "http://135.181.6.234:3333/api/v1/zrc20/token/zero/balances?page=0&limit=10&positive_only=false"

# Verify counts match summary
curl "http://135.181.6.234:3333/api/v1/zrc20/token/zero/summary" | jq '{holders,holders_total}'
```

### Verification
1. Default response should include zero-balance addresses
2. `positive_only=true` response should only include addresses with overall > 0
3. Count of results with `positive_only=true` should match `holders` from summary
4. Count of all results should match `holders_total` from summary

## Migration Path (if changing default)

If you decide to make positive-only the default in the future:

1. **Phase 1** (Current): Add optional `positive_only` parameter
2. **Phase 2** (3 months): Add deprecation warning to API docs for default behavior
3. **Phase 3** (6 months): Add `include_zero=true` parameter
4. **Phase 4** (9 months): Make positive-only the default, require `include_zero=true` for all results
5. **Phase 5** (12 months): Remove deprecation warnings

## Summary

This enhancement provides:
- ✅ Backward compatibility
- ✅ Consistency with summary/integrity endpoints
- ✅ Performance optimization
- ✅ Clear user intent
- ✅ Flexibility for different use cases
- ✅ Frontend already prepared to use it

## Questions?

If you need help implementing this on the backend, let me know and I can provide more specific code examples for your stack.
