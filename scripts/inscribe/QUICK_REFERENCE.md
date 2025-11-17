# Quick Reference - Zcash Inscription Implementation

## 🎯 TL;DR

**Status**: Implementation complete but blocked by outdated libraries
**Root Cause**: Zcash mainnet on NU6, all JS libraries only support Sapling
**Solution**: Implement ZIP 244 signature algorithm (~8-16 hours)
**Workaround**: Use https://mint.zerdinals.com to create inscriptions now

---

## 📁 Key Files

### Production Code (Ready to Deploy)
```
/src/services/inscriptionProtection.ts      # ✅ UTXO protection system
/src/app/api/zcash/utxos/[address]/route.ts # ✅ UTXO API endpoint
```

### Implementation (Needs ZIP 244)
```
/scripts/inscribe/manual-tx-builder.ts      # ⏸️ Raw tx builder (90% done)
/scripts/inscribe/zerdinals-api-inscribe.ts # ⏸️ Bitcore implementation
```

### Documentation
```
/scripts/inscribe/TECHNICAL_REPORT.md       # 📄 Complete technical report
/scripts/inscribe/STATUS.md                 # 📄 Project status
/scripts/inscribe/SIGNATURE_DEBUG.md        # 📄 Debug findings
```

### Utilities
```
/scripts/inscribe/generate-wallet.ts        # 🔧 Generate Zcash wallets
/scripts/inscribe/inspect-utxo.ts           # 🔧 Inspect transactions
/scripts/inscribe/get-blockchain-info.ts    # 🔧 Get network state
```

---

## 🔑 Test Wallet (Funded)

```
Address:     t1ZemSSmv1kcqapcCReZJGH4driYmbALX1x
Private Key: L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q
Balance:     0.005 ZEC (500,000 zatoshis)
UTXO:        48d9a62d2b368e5446409b5a346290fa7173d242dee744f36ec9575d05009ab1:0
```

⚠️ **Security**: This is a TEST wallet. Never commit private keys to git.

---

## 🚀 Quick Commands

### Test Inscription Protection
```bash
npx tsx scripts/inscribe/test-wallet-inscriptions.ts t1ZemSSmv1kcqapcCReZJGH4driYmbALX1x
```

### Generate New Wallet
```bash
npx tsx scripts/inscribe/generate-wallet.ts
```

### Check Network Status
```bash
npx tsx scripts/inscribe/get-blockchain-info.ts
```

### Inspect UTXO
```bash
npx tsx scripts/inscribe/inspect-utxo.ts
```

### Test Transaction Builder (will fail at broadcast)
```bash
npx tsx scripts/inscribe/manual-tx-builder.ts
```

---

## 📊 What We Discovered

### Network State (Block 3,137,787)
```json
{
  "current_upgrade": "NU6",
  "consensus_branch_id": "0xc8e71055",
  "activation_height": 2726400,
  "signature_algorithm": "ZIP 244 (BLAKE2b-256)",
  "next_upgrade": "NU6.1 (pending at block 3,146,400)"
}
```

### The Blocker
```
❌ All JavaScript libraries use ZIP 243 (Sapling)
   ├─ Uses: Double SHA-256
   ├─ Last updated: 2018
   └─ Network requires: ZIP 244 (NU5/NU6)

✅ Network now requires ZIP 244
   ├─ Uses: BLAKE2b-256
   ├─ Tree-structured hashing
   └─ Different personalization strings
```

---

## 💡 Solutions Comparison

| Solution | Effort | Timeline | Result |
|----------|--------|----------|--------|
| **ZIP 244 Implementation** | High | 8-16 hrs | Full programmatic support ⭐ |
| **Zerdinals UI** | None | 5 min | Manual inscriptions only |
| **Wait for libraries** | None | Unknown | May never happen |
| **Python implementation** | Medium | 4-8 hrs | Adds Python dependency |

---

## 🔧 Critical Code Snippets

### Inscription Protection (Production Ready)
```typescript
import { getSafeUTXOs } from '@/services/inscriptionProtection';

// ALWAYS use this before spending UTXOs
const { safeUtxos, inscribedUtxos } = await getSafeUTXOs(address);

if (inscribedUtxos.length > 0) {
  console.warn(`⚠️ Found ${inscribedUtxos.length} inscribed UTXOs`);
  // DO NOT spend these!
}

// Only use safeUtxos
const tx = buildTransaction(safeUtxos);
```

### Current Transaction Structure (90% Complete)
```typescript
// This builds correctly but signature fails
const tx = {
  version: 0x80000004,        // ✅ Overwintered Sapling v4
  versionGroupId: 0x892f2085, // ✅ Sapling version group
  inputs: [...],               // ✅ Correct format
  outputs: [
    { value: 0, script: OP_RETURN("zerd|hello world") }, // ✅ Inscription
    { value: 490000, script: P2PKH(changeAddress) }       // ✅ Change
  ],
  lockTime: 0,
  expiryHeight: 0,
  // ❌ Missing: ZIP 244 signature (using ZIP 243 instead)
};
```

### What Needs Implementation
```typescript
import { blake2b } from '@noble/hashes/blake2b';

// Need to implement per ZIP 244
function signatureHashZIP244(
  tx: Transaction,
  inputIndex: number,
  consensusBranchId: number
): Uint8Array {
  // 1. header_digest (BLAKE2b personalized "ZTxIdHeadersHash")
  const headerDigest = blake2b(/* ... */, { personalization: 'ZTxIdHeadersHash' });

  // 2. transparent_sig_digest (BLAKE2b personalized "ZTxIdTranspaHash")
  const transparentDigest = blake2b(/* ... */, { personalization: 'ZTxIdTranspaHash' });

  // 3. Combine digests (BLAKE2b personalized "ZTxIdSigHash")
  return blake2b(
    concat(headerDigest, transparentDigest, ...),
    { personalization: 'ZTxIdSigHash' }
  );
}
```

---

## 🔍 Verification Commands

### Verify Wallet
```bash
npx tsx scripts/inscribe/verify-key.ts
# ✅ Private Key (WIF): L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q
# ✅ Expected Address: t1ZemSSmv1kcqapcCReZJGH4driYmbALX1x
# ✅ Derived Address: t1ZemSSmv1kcqapcCReZJGH4driYmbALX1x
# ✅ Match: YES
```

### Verify UTXO
```bash
curl "https://utxos.zerdinals.com/api/utxos/t1ZemSSmv1kcqapcCReZJGH4driYmbALX1x"
# ✅ Returns 1 UTXO with 500,000 zatoshis
```

### Check Inscription Protection
```bash
npx tsx scripts/inscribe/test-wallet-inscriptions.ts t1YbJR1f6fv5LkTG1avBQFH1UtRT5hGGxDh
# ✅ Found 3 inscribed UTXOs (correctly filtered)
# ✅ Found 4 safe UTXOs (available to spend)
```

---

## 🎯 Next Actions

### Immediate (Today)
1. Review this technical report
2. Decide on solution approach
3. (Optional) Create test inscription via Zerdinals UI

### This Week
1. Implement ZIP 244 signature algorithm
2. Test with testnet first
3. Validate against reference transactions

### Next Week
1. Integrate into production API
2. Build UI components
3. Deploy to staging

---

## 📚 Resources

### Specifications
- [ZIP 244](https://zips.z.cash/zip-0244) - NU5 Signature Hash (REQUIRED)
- [ZIP 243](https://zips.z.cash/zip-0243) - Sapling Signature Hash (current implementation)
- [ZIP 225](https://zips.z.cash/zip-0225) - NU5 Overview
- [NU6 Info](https://z.cash/upgrade/nu6/)

### APIs
- Tatum: `https://api.tatum.io/v3/blockchain/node/zcash-mainnet`
- Zerdinals UTXOs: `https://utxos.zerdinals.com/api/utxos/{address}`
- Zerdinals Indexer: `https://indexer.zerdinals.com/location/{txid}:{vout}`

### Tools
- Explorer: `https://zcashblockexplorer.com/`
- Mint UI: `https://mint.zerdinals.com/`

---

## ⚠️ Important Notes

1. **Inscription Protection is CRITICAL**: Always check UTXOs before spending
2. **Library is Outdated**: bitcore-lib-zcash only supports Sapling (2018)
3. **Network on NU6**: Block 2,726,400+ requires ZIP 244 signatures
4. **Wallet is Valid**: No need for new wallet, current one works fine
5. **UTXO is Valid**: Standard P2PKH, ready to spend once signing works

---

## 📞 Questions?

**See**: `/scripts/inscribe/TECHNICAL_REPORT.md` for complete details

**Key Decision**: Implement ZIP 244 or use Zerdinals UI?
- ZIP 244: 8-16 hours, full programmatic control
- Zerdinals UI: 5 minutes, manual only

**Recommendation**: Start with Zerdinals UI to create first inscription (validates everything works), then implement ZIP 244 for programmatic support.
