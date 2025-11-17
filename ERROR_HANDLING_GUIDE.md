# Production Error Handling Guide

**Date:** 2025-01-17
**Status:** Production Ready ✅

---

## Executive Summary

This guide documents the enterprise-grade error handling system implemented for Zatoshi Market. All errors are now user-friendly, actionable, and follow best practices from major wallet providers (Unisat, MetaMask, etc.).

**Key Principle:** Never expose technical details to users. Always provide clear, actionable guidance.

---

## The Problem

### Before

❌ **Technical Errors Shown to Users:**
```
[CONVEX A(inscriptionsActions:buildUnsignedCommitAction)]
[Request ID: 735ee432365366a2] Server Error
Uncaught Error: UTXO fetch failed
    at async handler (../convex/inscriptionsActions.ts:424:20)
    Called by client
```

**Issues:**
- Exposes internal system details (Convex, request IDs, stack traces)
- No actionable guidance for users
- Confusing technical jargon
- Poor user experience

---

## The Solution

### After

✅ **User-Friendly Error Messages:**
```
No Spendable Balance

Your wallet doesn't have any spendable ZEC for this inscription.
Fresh deposits work best.

Next Steps: Add ZEC to your wallet and try again
```

**Benefits:**
- Clear, simple language
- Actionable guidance
- No technical jargon
- Professional UX matching major wallets

---

## Architecture

### Error Flow

```
┌─────────────────────────────────────┐
│   Technical Error Occurs            │
│   (UTXO fetch failed, etc.)        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   parseError()                      │
│   Maps technical → user-friendly    │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   sanitizeError()                   │
│   Removes Convex, stack traces      │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   formatErrorAlert()                │
│   Formats for display to user       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   User Sees Clear Message ✅        │
└─────────────────────────────────────┘
```

---

## Implementation

### Core File

**`src/utils/errorMessages.ts`** - Centralized error handling system

#### Key Functions

1. **`parseError(error)`** - Maps technical errors to user-friendly messages
2. **`sanitizeError(error)`** - Removes technical details (Convex, IDs, stack traces)
3. **`formatErrorAlert(error)`** - Formats error for alert() dialogs
4. **`formatErrorMessage(error)`** - Formats error for UI display
5. **`logError(error, context)`** - Logs sanitized error for debugging
6. **`isRetryableError(error)`** - Determines if error can be retried
7. **`categorizeError(error)`** - Categorizes error (balance, network, wallet, etc.)

---

## Error Categories

### 1. Balance & UTXO Errors

| Technical Error | User-Friendly Message |
|----------------|----------------------|
| `UTXO fetch failed` | "No Spendable Balance - Your wallet doesn't have any spendable ZEC" |
| `Not enough spendable funds` | "Insufficient Balance - You don't have enough ZEC to complete this" |
| `no utxos` | "No Funds Available - Your wallet is empty" |

**Action:** "Add ZEC to your wallet and try again"

---

### 2. Network Errors

| Technical Error | User-Friendly Message |
|----------------|----------------------|
| `Failed to fetch` | "Connection Failed - Couldn't connect to the network" |
| `network` | "Network Error - Unable to connect to the Zcash network" |
| `timeout` | "Request Timeout - The network request took too long" |
| `rate limit` | "Too Many Requests - You're making requests too quickly" |

**Action:** "Check connection and retry" or "Wait 30 seconds and try again"

---

### 3. Wallet Errors

| Technical Error | User-Friendly Message |
|----------------|----------------------|
| `wallet not connected` | "Wallet Not Connected - Please connect your wallet to continue" |
| `Invalid private key` | "Invalid Private Key - It should start with 'L' or 'K'" |
| `password` | "Incorrect Password - Try again with the correct password" |

**Action:** "Connect wallet", "Double-check your private key", "Try correct password"

---

### 4. Inscription Errors

| Technical Error | User-Friendly Message |
|----------------|----------------------|
| `inscription protection` | "Inscription Protected - This UTXO contains an inscription" |
| `broadcast` | "Broadcast Failed - Unable to broadcast transaction" |
| `transaction failed` | "Transaction Failed - Your transaction couldn't be completed" |

**Action:** "Use a different UTXO", "Retry broadcasting", "Review and retry"

---

### 5. Validation Errors

| Technical Error | User-Friendly Message |
|----------------|----------------------|
| `invalid name` | "Invalid Name - Must be 3-20 characters (letters, numbers, hyphens)" |
| `invalid amount` | "Invalid Amount - Enter a positive number" |
| `invalid address` | "Invalid Address - Must start with 't1'" |

**Action:** Clear validation guidance

---

### 6. Internal/Convex Errors

**All Convex errors are stripped and replaced with:**

```
Service Error

An error occurred while processing your request.

Next Steps: Please try again in a moment
```

**Examples of what gets stripped:**
- `[CONVEX A(...)]` prefixes
- `[Request ID: ...]` identifiers
- Stack traces (`at async handler (...)`)
- `Server Error`, `Uncaught Error:` prefixes

---

## Usage Examples

### Example 1: Inscribe Page

```typescript
import { formatErrorAlert, logError, sanitizeError } from '@/utils/errorMessages';

try {
  await createInscription(...);
} catch (err) {
  logError(err, 'Inscription Creation');  // Logs sanitized version
  setError(sanitizeError(err));           // Shows user-friendly message
}
```

### Example 2: Wallet Operations

```typescript
import { formatErrorAlert, logError } from '@/utils/errorMessages';

try {
  await importWallet(privateKey);
} catch (error) {
  logError(error, 'Wallet Import');
  alert(formatErrorAlert(error));  // Shows formatted alert
}
```

### Example 3: Manual Error Creation

```typescript
import { parseError } from '@/utils/errorMessages';

if (!balance) {
  const error = new Error('No spendable balance found');
  const friendly = parseError(error);

  console.log(friendly.title);    // "No Spendable Balance"
  console.log(friendly.message);  // "Your wallet doesn't have..."
  console.log(friendly.action);   // "Add ZEC to your wallet..."
}
```

---

## Backend Changes

### Convex Actions

**`convex/zcashHelpers.ts`** - Updated `fetchUtxos()` function

#### Before
```typescript
export async function fetchUtxos(address: string){
  const r = await fetch(`https://utxos.zerdinals.com/api/utxos/${address}`);
  if (!r.ok) throw new Error('UTXO fetch failed');
  return r.json() as Promise<Utxo[]>;
}
```

#### After
```typescript
export async function fetchUtxos(address: string){
  try {
    const r = await fetch(`https://utxos.zerdinals.com/api/utxos/${address}`);
    if (!r.ok) {
      throw new Error('No spendable balance found. Please add ZEC to your wallet and try again.');
    }
    const utxos = await r.json() as Utxo[];

    if (!utxos || utxos.length === 0) {
      throw new Error('Your wallet is empty. Send some ZEC to get started.');
    }

    return utxos;
  } catch (error) {
    // Re-throw with user-friendly message
    if (error instanceof Error && error.message.includes('wallet is empty')) {
      throw error;
    }
    if (error instanceof Error && error.message.includes('No spendable balance')) {
      throw error;
    }
    throw new Error('Unable to check your wallet balance. Please check your connection and try again.');
  }
}
```

**Key Improvements:**
- User-friendly error messages from the source
- Specific empty wallet handling
- Network error handling
- No more "UTXO fetch failed"

---

## Frontend Integration

### Files Updated

1. **`src/app/inscribe/page.tsx`**
   - All error handlers updated to use `sanitizeError()` and `logError()`
   - Name registration, text inscription, ZRC-20 mint, batch mint

2. **`src/components/WalletDrawer.tsx`**
   - Wallet generation, import, unlock errors
   - Transaction errors
   - All use `formatErrorAlert()` for consistent messaging

3. **`convex/zcashHelpers.ts`**
   - Updated `fetchUtxos()` to provide user-friendly errors at source

---

## Best Practices

### DO ✅

1. **Always use the error handling utilities:**
   ```typescript
   import { formatErrorAlert, logError, sanitizeError } from '@/utils/errorMessages';
   ```

2. **Log errors with context:**
   ```typescript
   logError(error, 'Wallet Import');
   ```

3. **Sanitize before showing to user:**
   ```typescript
   setError(sanitizeError(error));
   ```

4. **Provide actionable guidance:**
   ```typescript
   throw new Error('Your wallet is empty. Send some ZEC to get started.');
   ```

### DON'T ❌

1. **Don't show technical errors directly:**
   ```typescript
   // ❌ BAD
   setError(error.message);

   // ✅ GOOD
   setError(sanitizeError(error));
   ```

2. **Don't expose internal system details:**
   ```typescript
   // ❌ BAD
   throw new Error('[CONVEX] Failed at line 424');

   // ✅ GOOD
   throw new Error('Unable to process request. Please try again.');
   ```

3. **Don't use vague error messages:**
   ```typescript
   // ❌ BAD
   throw new Error('Something went wrong');

   // ✅ GOOD
   throw new Error('Your wallet is empty. Send some ZEC to get started.');
   ```

4. **Don't forget to provide next steps:**
   ```typescript
   // ❌ BAD
   "Invalid amount"

   // ✅ GOOD
   "Invalid Amount - Enter a positive number"
   ```

---

## Testing

### Test Cases

All error scenarios have been tested:

- [x] Empty wallet (no UTXOs)
- [x] Insufficient balance
- [x] Network connection failures
- [x] Invalid private key import
- [x] Incorrect password unlock
- [x] Invalid form inputs (name, amount, address)
- [x] Inscription broadcast failures
- [x] Rate limiting
- [x] Convex internal errors

### Example Test: Empty Wallet

**Scenario:** New wallet, attempting to mint with 0 balance

**Before:**
```
[CONVEX A(inscriptionsActions:buildUnsignedCommitAction)]
[Request ID: 735ee432365366a2] Server Error
Uncaught Error: UTXO fetch failed
```

**After:**
```
Your wallet is empty. Send some ZEC to get started.
```

✅ **Result:** Clear, actionable, user-friendly

---

## Error Message Comparison

### Major Wallet Providers

| Provider | Style | Example |
|----------|-------|---------|
| **Unisat** | Simple, actionable | "Insufficient balance. Please add BTC to continue." |
| **MetaMask** | Clear title + message | "Transaction Failed - Insufficient funds for gas" |
| **Phantom** | Friendly tone | "Oops! You don't have enough SOL for this transaction" |
| **Zatoshi** | Professional + actionable | "No Spendable Balance - Add ZEC to your wallet and try again" |

**Our approach aligns with industry leaders while maintaining Zatoshi's professional tone.**

---

## Monitoring & Debugging

### Debug Logging

The `logError()` function logs sanitized errors for debugging:

```typescript
logError(error, 'Wallet Import');
```

**Console output:**
```javascript
[Error - Wallet Import] {
  userMessage: "Invalid Private Key",
  severity: "error",
  original: "Invalid WIF format at line 42"  // For debugging only
}
```

**Benefits:**
- User sees friendly message
- Developers see technical details in console
- Easy to track error sources

---

## Future Improvements

### Potential Enhancements

1. **Error Analytics Dashboard**
   - Track most common errors
   - Identify UX pain points
   - Monitor error rates over time

2. **Internationalization (i18n)**
   - Translate error messages
   - Support multiple languages
   - Locale-specific guidance

3. **Contextual Help Links**
   - Link to docs for common errors
   - In-app tutorials
   - Video guides

4. **Smart Retry Logic**
   - Auto-retry retryable errors
   - Exponential backoff
   - User-friendly retry UI

5. **Error Recovery Suggestions**
   - Suggest specific amounts for insufficient balance
   - Recommend UTXO consolidation
   - Guide users through complex recovery steps

---

## Maintenance

### Adding New Error Messages

**Step 1:** Add to `ERROR_MESSAGES` map in `src/utils/errorMessages.ts`

```typescript
const ERROR_MESSAGES: Record<string, UserFriendlyError> = {
  // ... existing errors
  'your-error-pattern': {
    title: 'Clear Title',
    message: 'Clear explanation of what happened',
    action: 'What user should do next',
    severity: 'error'  // or 'warning' | 'info'
  }
};
```

**Step 2:** Update error source to throw user-friendly errors

```typescript
// Convex action, API route, or service
throw new Error('Clear explanation of what happened');
```

**Step 3:** Test the error flow end-to-end

---

## Support & Troubleshooting

### Common Issues

**Q: Error still shows technical details**
- **A:** Make sure you're using `sanitizeError()` before displaying to user

**Q: Error message is generic "Something Went Wrong"**
- **A:** Add specific error pattern to `ERROR_MESSAGES` map

**Q: Convex prefix still appearing**
- **A:** Error is being shown before going through `sanitizeError()` - check the call chain

**Q: Need different message for same error in different contexts**
- **A:** Throw context-specific errors from source, or check context in `parseError()`

---

## Conclusion

The production error handling system ensures:

✅ **User-Friendly:** Clear, simple language
✅ **Actionable:** Always provide next steps
✅ **Professional:** Matches major wallet providers
✅ **Secure:** Never exposes internal system details
✅ **Maintainable:** Centralized, easy to update

**Status: Production Ready ✅**

---

*Generated: 2025-01-17*
*Version: 1.0.0*
*Document ID: ERROR_HANDLING_2025*
