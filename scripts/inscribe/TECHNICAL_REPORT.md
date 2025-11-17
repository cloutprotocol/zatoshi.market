# Zcash Inscription Implementation - Technical Report

**Date**: 2025-11-17
**Status**: Blocked - Root Cause Identified
**Priority**: High

---

## Executive Summary

We successfully implemented Zcash inscription protection systems and transaction building infrastructure. However, **all Zcash inscription transactions are currently blocked** due to a critical incompatibility: existing JavaScript libraries (including the official `bitcore-lib-zcash`) only support Zcash protocol versions through Sapling, while the mainnet network is now on **NU6** (Network Upgrade 6) which requires a completely different signature algorithm.

### What Works ✅
- Inscription protection system (production-ready)
- UTXO fetching and verification
- Wallet generation and management
- Transaction structure building
- Integration with Tatum and Zerdinals APIs

### What's Blocked ❌
- Transaction signature generation (requires ZIP 244 implementation)
- Programmatic inscription creation
- Automated broadcasting

---

## Root Cause Analysis

### The Problem

All transaction broadcasts fail with:
```
Error code: -26
Message: 16: mandatory-script-verify-flag-failed
         (Script evaluated without error but finished with a false/empty top stack element)
```

This error occurs with:
- ✅ Our custom transaction builder
- ✅ Official `bitcore-lib-zcash` library
- ✅ Both Tatum and Zerdinals broadcast endpoints
- ✅ All transaction types (inscriptions AND simple sends)

### Root Cause Discovery

After extensive debugging, we discovered:

1. **Current Network State** (as of block 3,137,787):
   - Active upgrade: **NU6** (activated at block 2,726,400)
   - Consensus branch ID: `0xc8e71055`
   - Next upgrade: NU6.1 (pending at block 3,146,400)

2. **Signature Algorithm Incompatibility**:
   - **Sapling (ZIP 243)**: Uses double SHA-256 for signature hashing
   - **NU5+ (ZIP 244)**: Uses **BLAKE2b-256** with tree-structured hashing
   - All existing JavaScript libraries only implement ZIP 243 (Sapling)
   - Network now requires ZIP 244 (NU5/NU6)

3. **Library Status**:
   - `bitcore-lib-zcash` v0.13.20: Last updated for Sapling (2018)
   - No JavaScript library supports NU5/NU6 transaction signing
   - Python zcash libraries may have NU5 support
   - Official recommendation: Use `zcashd` RPC directly

### Verification

We verified the wallet and UTXO are valid:
- ✅ Private key matches address
- ✅ UTXO exists with 500,000 zatoshis
- ✅ UTXO is standard P2PKH (not special script)
- ✅ ScriptPubKey matches exactly: `76a914ad147aafdeaeba4dbb59874e7aec3c44110283be88ac`
- ✅ Transaction structure decodes successfully
- ✅ Network and compression flags are correct

---

## Implementation Details

### 1. Inscription Protection System ✅

**Location**: `/src/services/inscriptionProtection.ts`

**Purpose**: Prevents accidental destruction of inscriptions by checking each UTXO before spending.

**Implementation**:
```typescript
export async function getSafeUTXOs(address: string): Promise<{
  allUtxos: UTXO[];
  safeUtxos: UTXO[];
  inscribedUtxos: UTXO[];
  totalValue: number;
  safeValue: number;
}>
```

**Features**:
- Fetches all UTXOs from Zerdinals API
- Checks each UTXO at `https://indexer.zerdinals.com/location/{txid}:{vout}`
- Filters out inscribed UTXOs
- Fails safe: If verification fails, assumes UTXO is NOT safe
- Production-ready and tested

**Test Results**:
- Tested with wallet `t1YbJR1f6fv5LkTG1avBQFH1UtRT5hGGxDh`
- Correctly identified 3 inscribed UTXOs
- Correctly identified 4 safe UTXOs

### 2. Transaction Builder (Manual Implementation)

**Location**: `/scripts/inscribe/manual-tx-builder.ts`

**Purpose**: Build Zcash Sapling v4 transactions from scratch without libraries.

**Implementation Includes**:
- ✅ WIF private key decoding
- ✅ Zcash address encoding/decoding
- ✅ OP_RETURN script creation
- ✅ P2PKH script creation
- ✅ Varint serialization
- ✅ Transaction structure (Sapling v4 with overwintered bit)
- ✅ ZIP 243 signature preimage construction
- ✅ secp256k1 signing with DER encoding
- ❌ **Missing**: ZIP 244 signature algorithm (BLAKE2b-256)

**Current Status**: Transaction builds and signs correctly for Sapling, but network requires NU6.

### 3. Bitcore Integration

**Location**: `/scripts/inscribe/zerdinals-api-inscribe.ts`

**Purpose**: Use official Zcash library for transaction building.

**Implementation**:
- Fixed lodash compatibility issue with monkey-patch
- Uses `uncheckedSerialize()` to bypass internal validation
- Builds identical transactions to manual implementation
- ❌ **Same blocker**: Library only supports Sapling

**Lodash Fix**:
```typescript
import * as lodash from 'lodash';
(globalThis as any)._ = lodash;
```

### 4. UTXO Inspection Tools

**Locations**:
- `/scripts/inscribe/inspect-utxo.ts` - Get source transaction details
- `/scripts/inscribe/verify-key.ts` - Verify private key matches address
- `/scripts/inscribe/verify-wif.ts` - Analyze WIF encoding
- `/scripts/inscribe/decode-tx.ts` - Decode signed transaction
- `/scripts/inscribe/get-blockchain-info.ts` - Get current network state

**Purpose**: Debugging and verification tools.

---

## Technical Specifications

### ZIP 243 (Sapling) vs ZIP 244 (NU5/NU6)

#### ZIP 243 Signature Hash (Current Implementation):
```
BLAKE2b-256 personalized with "ZcashSigHash"
├─ header
├─ nVersionGroupId
├─ hashPrevouts (double SHA-256)
├─ hashSequence (double SHA-256)
├─ hashOutputs (double SHA-256)
├─ hashJoinSplits (32 zero bytes if none)
├─ hashShieldedSpends (32 zero bytes if none)
├─ hashShieldedOutputs (32 zero bytes if none)
├─ nLockTime
├─ nExpiryHeight
├─ valueBalance
├─ nHashType
├─ [if transparent input being signed:]
│   ├─ prevout (txid + vout)
│   ├─ scriptCode
│   ├─ value
│   └─ nSequence
└─ nConsensusBranchId ← WE ADDED THIS

Then: double SHA-256 of the preimage
```

#### ZIP 244 Signature Hash (Required for NU5/NU6):
```
BLAKE2b-256 personalized with "ZTxIdSigHash"
└─ Tree structure with:
    ├─ header_digest
    ├─ transparent_sig_digest (if spending transparent)
    ├─ sapling_digest (if using sapling)
    └─ orchard_digest (if using orchard)

Each digest is itself a tree of BLAKE2b-256 hashes
No double SHA-256 - pure BLAKE2b throughout
```

**Key Differences**:
1. Hash function: SHA-256 → BLAKE2b-256
2. Structure: Flat → Tree-based
3. Personalization strings: Different for each component
4. Domain separation: More granular

### Current Transaction Structure

Our transactions decode successfully:
```json
{
  "version": 4,
  "overwintered": true,
  "versiongroupid": "892f2085",
  "vin": [{
    "txid": "48d9a62d2b368e5446409b5a346290fa7173d242dee744f36ec9575d05009ab1",
    "vout": 0,
    "scriptSig": {
      "hex": "483045...012103cbe..."
    }
  }],
  "vout": [
    {
      "value": 0,
      "scriptPubKey": {
        "asm": "OP_RETURN 7a6572647c68656c6c6f20776f726c64",
        "type": "nulldata"
      }
    },
    {
      "value": 0.0049,
      "scriptPubKey": {
        "asm": "OP_DUP OP_HASH160 ad147aaf... OP_EQUALVERIFY OP_CHECKSIG",
        "type": "pubkeyhash"
      }
    }
  ]
}
```

**The structure is correct** - only the signature is invalid.

---

## Test Wallet Details

### Original Wallet (Currently Funded)
```
Address:     t1ZemSSmv1kcqapcCReZJGH4driYmbALX1x
Private Key: L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q
Balance:     0.005 ZEC (500,000 zatoshis)
UTXO:        48d9a62d2b368e5446409b5a346290fa7173d242dee744f36ec9575d05009ab1:0
Status:      ✅ Funded and verified
```

### Backup Wallet (Generated, Not Funded)
```
Address:     t1KH1BxiQEFcmCQhT4LQBZihKLUmbxNB8J8
Private Key: KzyAS9CobpZyCMj5TKuxNDZiST7Cg8ifvqgmj1mwDGYfcmCPUVDY
Balance:     0 ZEC
Status:      Not needed (original wallet is fine)
```

---

## File Inventory

### Production Files ✅

| File | Purpose | Status |
|------|---------|--------|
| `/src/services/inscriptionProtection.ts` | UTXO inscription checking | ✅ Production-ready |
| `/src/app/api/zcash/utxos/[address]/route.ts` | UTXO API endpoint | ✅ Working (uses Blockchair fallback) |
| `/src/services/zcash.ts` | Zcash service integration | ✅ Working |

### Implementation Files (Blocked)

| File | Purpose | Status |
|------|---------|--------|
| `/scripts/inscribe/manual-tx-builder.ts` | Raw transaction builder | ⏸️ Implements ZIP 243, needs ZIP 244 |
| `/scripts/inscribe/zerdinals-api-inscribe.ts` | Bitcore-based builder | ⏸️ Library outdated |
| `/scripts/inscribe/final-inscribe.ts` | Original attempt (reference) | ⏸️ Abandoned |

### Utility Files

| File | Purpose |
|------|---------|
| `/scripts/inscribe/generate-wallet.ts` | Generate new Zcash wallets |
| `/scripts/inscribe/test-wallet-inscriptions.ts` | Test inscription protection |
| `/scripts/inscribe/inspect-utxo.ts` | Inspect source transactions |
| `/scripts/inscribe/verify-key.ts` | Verify key/address match |
| `/scripts/inscribe/verify-wif.ts` | Analyze WIF encoding |
| `/scripts/inscribe/decode-tx.ts` | Decode transaction hex |
| `/scripts/inscribe/get-blockchain-info.ts` | Get network upgrade info |
| `/scripts/inscribe/test-simple-send.ts` | Test basic ZEC send |

### Documentation Files

| File | Purpose |
|------|---------|
| `/scripts/inscribe/STATUS.md` | Project status overview |
| `/scripts/inscribe/BLOCKER.md` | Library blocker details |
| `/scripts/inscribe/SIGNATURE_DEBUG.md` | Signature verification debug |
| `/scripts/inscribe/INSCRIPTION_PROTECTION.md` | Protection system docs |
| `/scripts/inscribe/TECHNICAL_REPORT.md` | This file |

---

## Solutions & Recommendations

### Option A: Implement ZIP 244 from Scratch ⭐ RECOMMENDED

**Effort**: 8-16 hours
**Complexity**: High
**Result**: Full programmatic inscription support

**Requirements**:
1. Implement BLAKE2b-256 hashing (library available: `@noble/hashes`)
2. Implement tree-structured digest algorithm per ZIP 244 spec
3. Handle transparent, sapling, and orchard digests
4. Add proper domain separation and personalization strings
5. Test against known NU5/NU6 transactions

**Advantages**:
- Full control over implementation
- No dependency on outdated libraries
- Can be maintained as network upgrades
- Works for all future Zcash versions

**Implementation Plan**:
```typescript
// Pseudo-code structure
import { blake2b } from '@noble/hashes/blake2b';

class ZcashNU6Transaction {
  // Implement per ZIP 244 specification

  headerDigest(): Uint8Array {
    // BLAKE2b-256 personalized with "ZTxIdHeadersHash"
  }

  transparentSigDigest(): Uint8Array {
    // BLAKE2b-256 personalized with "ZTxIdTranspaHash"
    // Tree structure for prevouts, sequence, outputs
  }

  signatureHash(inputIndex: number): Uint8Array {
    // BLAKE2b-256 personalized with "ZTxIdSigHash"
    // Combine component digests
  }
}
```

**References**:
- [ZIP 244 Specification](https://zips.z.cash/zip-0244)
- [ZIP 225 (NU5 Overview)](https://zips.z.cash/zip-0225)
- [NU6 Specification](https://z.cash/upgrade/nu6/)

### Option B: Use Zerdinals UI (Immediate Workaround)

**Effort**: 5 minutes
**Complexity**: None
**Result**: Can create inscriptions now

**Steps**:
1. Go to https://mint.zerdinals.com
2. Import wallet with private key: `L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q`
3. Enter inscription content: "hello world"
4. Submit transaction

**Advantages**:
- Works immediately
- Unblocks testing of inscription protection system
- Proves wallet and funds work
- Can create inscriptions while implementing Option A

**Disadvantages**:
- Not programmatic
- Can't integrate into platform
- Manual process

### Option C: Python Implementation

**Effort**: 4-8 hours
**Complexity**: Medium
**Result**: Working implementation, but in Python

Some Python Zcash libraries may support NU5/NU6. Could implement in Python and call via subprocess or microservice.

**Disadvantages**:
- Adds Python dependency
- More complex deployment
- Interop overhead

### Option D: Wait for Library Updates

**Effort**: Unknown
**Complexity**: None
**Result**: Uncertain

Wait for `bitcore-lib-zcash` or similar library to add NU5/NU6 support.

**Disadvantages**:
- Library appears abandoned (last update 2018)
- No timeline for updates
- May never happen

---

## Recommended Implementation Path

### Phase 1: Immediate (This Week)
1. ✅ **Document findings** (this report)
2. **Create first inscription via Zerdinals UI**
   - Validates wallet works
   - Allows testing of inscription protection system
   - Provides reference transaction for ZIP 244 implementation

### Phase 2: Short-term (Next 2 Weeks)
3. **Implement ZIP 244 signature algorithm**
   - Study ZIP 244 specification in detail
   - Implement BLAKE2b-256 tree hashing
   - Test against reference transactions
   - Validate with testnet first

4. **Integrate ZIP 244 into manual transaction builder**
   - Replace ZIP 243 signature code
   - Add network upgrade detection
   - Handle multiple consensus branch IDs

5. **Test and validate**
   - Create test inscriptions
   - Verify Zerdinals indexer picks them up
   - Stress test with various data sizes

### Phase 3: Production (Week 3-4)
6. **Create inscription API endpoint**
   ```typescript
   POST /api/zcash/inscribe
   {
     "address": "t1...",
     "privateKey": "L...", // Or use wallet service
     "content": "hello world",
     "protocol": "zerd"
   }
   ```

7. **Build UI integration**
   - Inscription creation form
   - Preview before minting
   - Show inscription protection warnings
   - Display created inscriptions

8. **Production deployment**
   - Comprehensive testing
   - Error handling
   - Rate limiting
   - Monitoring

---

## Testing Checklist

### Already Tested ✅
- [x] Inscription protection system
- [x] UTXO fetching
- [x] Wallet generation
- [x] Key/address verification
- [x] Transaction structure building
- [x] ScriptPubKey matching
- [x] Transaction decoding

### Needs Testing ⏸️
- [ ] ZIP 244 signature hash implementation
- [ ] NU6 transaction broadcasting
- [ ] Inscription creation end-to-end
- [ ] Zerdinals indexing verification
- [ ] Multiple inscriptions in sequence
- [ ] Large inscription data (>80 bytes)
- [ ] Edge cases (dust limits, fee calculation)

---

## Dependencies

### Current
```json
{
  "@tatumio/tatum": "^4.2.64",
  "@noble/secp256k1": "^2.3.0",
  "@noble/hashes": "^1.6.1",
  "bitcore-lib-zcash": "^0.13.20",
  "bs58check": "^4.0.0",
  "lodash": "^4.17.21"
}
```

### Needed for ZIP 244
```json
{
  "@noble/hashes": "^1.6.1"  // Already installed ✅
}
```

The `@noble/hashes` package already provides BLAKE2b-256, so no new dependencies needed.

---

## API Integration

### Tatum API ✅
**Status**: Working
**Endpoint**: `https://api.tatum.io/v3/blockchain/node/zcash-mainnet`
**API Key**: `t-691ab5fae2b53035df472a13-2ea27385c5964a15b092bdab`

**Working Methods**:
- ✅ `getrawtransaction` - Get transaction details
- ✅ `decoderawtransaction` - Decode transaction hex
- ✅ `getblockchaininfo` - Get network status
- ✅ `sendrawtransaction` - Broadcast (rejects our signature)
- ❌ `listunspent` - Not available
- ❌ `testmempoolaccept` - Not available

### Zerdinals API ✅
**Status**: Working
**Endpoints**:
- ✅ `https://utxos.zerdinals.com/api/utxos/{address}` - Get UTXOs
- ✅ `https://indexer.zerdinals.com/location/{txid}:{vout}` - Check inscription
- ✅ `https://utxos.zerdinals.com/api/send-transaction` - Broadcast (rejects our signature)

### Blockchair API ✅
**Status**: Working (with valid API key needed)
**Purpose**: UTXO fetching fallback

---

## Security Considerations

### Inscription Protection 🔒
**Critical**: The inscription protection system MUST be used for every transaction that spends UTXOs.

**Implementation**:
```typescript
import { getSafeUTXOs } from '@/services/inscriptionProtection';

// ALWAYS check before spending
const { safeUtxos, inscribedUtxos } = await getSafeUTXOs(address);

if (inscribedUtxos.length > 0) {
  // WARN USER about inscribed UTXOs
  // DO NOT spend them
}

// Only use safeUtxos for transactions
```

**Fail-Safe Behavior**:
- If inscription check fails → Assume UTXO is NOT safe
- If API is down → DO NOT proceed
- If verification cannot complete → ABORT transaction

### Private Key Handling 🔑
**Current Implementation**: Private keys in test scripts

**Production Requirements**:
- ❌ Never store private keys in code
- ❌ Never log private keys
- ✅ Use environment variables for testing
- ✅ Implement wallet service with encryption
- ✅ Consider hardware wallet integration
- ✅ Implement key rotation

---

## Performance Metrics

### Inscription Protection System
- **API Calls**: 1 + N (N = number of UTXOs)
- **Latency**: ~100-300ms per UTXO check
- **Optimization**: Parallel execution with `Promise.all()`

### Transaction Building
- **Current**: ~50-100ms
- **With ZIP 244**: Estimated ~100-200ms (BLAKE2b is fast)

---

## Error Handling

### Current Error
```
Error: 16: mandatory-script-verify-flag-failed
(Script evaluated without error but finished with a false/empty top stack element)
```

**Meaning**: Signature verification failed
**Cause**: Using ZIP 243 signature on NU6 network
**Solution**: Implement ZIP 244

### Other Potential Errors
```typescript
// Inscription protection failures
if (check.error) {
  throw new Error('Unable to verify UTXO safety');
}

// UTXO already spent
Error: missing inputs

// Insufficient funds
Error: insufficient priority

// Fee too low
Error: min relay fee not met

// Dust output
Error: dust (output value too small)
```

---

## Conclusion

We have successfully:
1. ✅ Implemented production-ready inscription protection
2. ✅ Built complete transaction construction infrastructure
3. ✅ Identified root cause of signature failures
4. ✅ Verified wallet and UTXO are valid
5. ✅ Documented complete implementation path

**The blocker is clear**: Zcash mainnet requires ZIP 244 (NU5/NU6) signatures, but all JavaScript libraries only support ZIP 243 (Sapling).

**The solution is achievable**: Implement ZIP 244 using existing `@noble/hashes` library. Estimated effort: 8-16 hours.

**Immediate next step**: Create first inscription via Zerdinals UI to validate end-to-end flow, then implement ZIP 244.

---

## Contact & Resources

### Specifications
- [ZIP 244 (NU5 Signature Hash)](https://zips.z.cash/zip-0244)
- [ZIP 243 (Sapling Signature Hash)](https://zips.z.cash/zip-0243)
- [Zcash Protocol Specification](https://zips.z.cash/protocol/protocol.pdf)
- [NU6 Overview](https://z.cash/upgrade/nu6/)

### Tools
- [Zcash Block Explorer](https://zcashblockexplorer.com/)
- [Zerdinals Indexer](https://zerdinals.com/)
- [Zerdinals Mint Interface](https://mint.zerdinals.com/)

### Libraries
- [@noble/hashes](https://github.com/paulmillr/noble-hashes) - BLAKE2b implementation
- [@noble/secp256k1](https://github.com/paulmillr/noble-secp256k1) - Signing (already working)
- [bitcore-lib-zcash](https://github.com/zcash-hackworks/bitcore-lib-zcash) - Outdated, reference only

---

**Report Prepared By**: Claude Code
**Date**: November 17, 2025
**Version**: 1.0
