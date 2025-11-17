# Zcash Inscriptions MVP - Quick Start Guide

## TL;DR

**Problem**: ZIP 243 signature hash implementation blocking programmatic inscription creation.

**Solution**: Fork `bitcore-lib-zcash` to use proven signature hash, build web service in 2-3 weeks.

**Status**: Architecture complete, ready to implement.

---

## What We Have ✅

1. **Inscription Protection** - Production-ready system to prevent spending inscribed UTXOs
2. **Script Builders** - Correct Ordinals format (`ord` marker, content type, reveal script)
3. **Transaction Structure** - Proper commit/reveal pattern matching Zerdinals
4. **Helper Functions** - All building blocks in `scripts/inscribe/ordinals-builder.ts`

## What's Blocking ❌

**ZIP 243 Signature Hash** - Our implementation creates valid signatures locally but they fail on-chain validation. Subtle preimage structure issue.

## Recommended Path Forward 🚀

### Option 1: Full MVP (2-3 weeks)
Fork bitcore-lib-zcash → Build REST API → Create React frontend → Deploy service

**Best for**: Production service, multiple users, long-term platform

### Option 2: Minimal Script (1-2 days)
Fix bitcore-lib-zcash lodash issues → Create single-purpose inscription script → Test on mainnet

**Best for**: Proof of concept, learning, single inscription

### Option 3: Use Zerdinals UI (5 minutes)
Import wallet to https://mint.zerdinals.com → Create inscription now

**Best for**: Immediate result, no development needed

---

## Quick Implementation (Option 2)

If you want a working inscription script ASAP:

### Step 1: Fix bitcore-lib-zcash dependency

```bash
cd node_modules/bitcore-lib-zcash
npm install lodash@latest
```

Or create a local fork:

```bash
git clone https://github.com/zcash-hackworks/bitcore-lib-zcash
cd bitcore-lib-zcash
npm install
npm install lodash@latest
npm run build
npm link
```

Then in your project:

```bash
npm link bitcore-lib-zcash
```

### Step 2: Use the script

```typescript
// scripts/inscribe/simple-mint.ts
import * as Bitcore from 'bitcore-lib-zcash';

const privateKey = Bitcore.PrivateKey.fromWIF('L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q');

// Build commit transaction (standard P2SH)
const commitTx = new Bitcore.Transaction()
  .from(utxo)
  .to(p2shAddress, 60000)
  .change(privateKey.toAddress())
  .sign(privateKey);

// Broadcast commit...

// Build reveal transaction (custom scriptSig with inscription data)
// This is the tricky part - need custom scriptSig builder
```

### Step 3: Custom Reveal Builder

The reveal transaction needs manual scriptSig construction:

```
scriptSig = <inscription data> <signature> <reveal script>

Where:
- inscription data = 0x03 "ord" 0x51 <mime> 0x00 <content>
- signature = DER-encoded ECDSA signature
- reveal script = <pubkey> OP_CHECKSIGVERIFY OP_DROP(x5) OP_1
```

This is complex because bitcore doesn't natively support custom scriptSigs.

---

## Files Created

### Documentation
- `MVP_IMPLEMENTATION_PLAN.md` - Full 2-3 week implementation plan
- `MVP_QUICK_START.md` - This file
- `TECHNICAL_REPORT.md` - Deep technical analysis
- `IMMEDIATE_INSCRIPTION_GUIDE.md` - Zerdinals UI instructions

### Working Code
- `src/services/inscriptionProtection.ts` - UTXO protection (✅ production-ready)
- `scripts/inscribe/ordinals-builder.ts` - Script builders (✅ working)
- `scripts/inscribe/zip243.ts` - Signature hash (❌ needs fixing)
- `scripts/inscribe/zip244.ts` - ZIP 244 implementation (for reference)

### Test Scripts
- `scripts/inscribe/test-simple-tx.ts` - Test signature hash
- `scripts/inscribe/create-ordinals-inscription.ts` - Full commit/reveal attempt
- `scripts/inscribe/create-inscription-bitcore.ts` - Bitcore-based attempt

---

## Key Technical Insights

### Zerdinals Transaction Format

**Commit TX**:
```
Version: 0x80000004 (v4 Sapling)
Inputs: Standard P2PKH
Outputs:
  - Output 0: P2SH (60,000 zats) ← Inscription locked here
  - Output 1+: Change outputs
```

**Reveal TX**:
```
Version: 0x80000004
Inputs:
  - Input 0: Spend P2SH
    scriptSig: <inscription data> <signature> <reveal script>
Outputs:
  - Output 0: P2PKH (back to wallet)
```

**Inscription Data Format**:
```
0x03 0x6f 0x72 0x64           # Push "ord"
0x51                          # OP_1 (content type tag)
0x0a 0x74 0x65 0x78...        # Push "text/plain"
0x00                          # OP_0 (body separator)
0x0b 0x68 0x65 0x6c...        # Push "hello world"
```

**Reveal Script**:
```
0x21 <33-byte compressed pubkey>  # Push pubkey
0xad                              # OP_CHECKSIGVERIFY
0x75                              # OP_DROP
0x75                              # OP_DROP
0x75                              # OP_DROP
0x75                              # OP_DROP
0x75                              # OP_DROP
0x51                              # OP_1
```

**P2SH Script** (commit output):
```
0xa9                              # OP_HASH160
0x14                              # Push 20 bytes
<20-byte HASH160(reveal script)>
0x87                              # OP_EQUAL
```

### Signature Hash (ZIP 243)

For v4 transactions on NU6:
- Hash function: **BLAKE2b-256** (not SHA-256!)
- Personalization: `"ZcashSigHash" || consensus_branch_id` (16 bytes)
- Consensus branch ID for NU6: `0xC8E71055`

Preimage structure:
1. Header (version, version group ID)
2. Prevouts hash (BLAKE2b of all inputs)
3. Sequence hash (BLAKE2b of all sequences)
4. Outputs hash (BLAKE2b of all outputs)
5. JoinSplits hash (32 zero bytes for transparent-only)
6. Shielded spends hash (32 zero bytes)
7. Shielded outputs hash (32 zero bytes)
8. Lock time, expiry height, value balance
9. Hash type (SIGHASH_ALL = 0x01)
10. Input being signed (prevout, scriptCode, value, sequence)

---

## Decision Matrix

| Approach | Time | Effort | Result |
|----------|------|--------|--------|
| **Full MVP** | 2-3 weeks | High | Production service |
| **Bitcore fork** | 3-5 days | Medium | Working script |
| **Fix ZIP 243** | Unknown | High | Custom implementation |
| **Zerdinals UI** | 5 minutes | None | Immediate inscription |

---

## Recommended Next Steps

### For Production Service
1. Review `MVP_IMPLEMENTATION_PLAN.md`
2. Get approval for 2-3 week timeline
3. Fork bitcore-lib-zcash repository
4. Begin Week 1 implementation

### For Quick Proof of Concept
1. Fork bitcore-lib-zcash locally
2. Fix lodash dependencies
3. Build custom reveal transaction builder
4. Test on mainnet

### For Immediate Result
1. Go to https://mint.zerdinals.com
2. Import wallet: `L54nU8xZd1HhGVZ1KzmcVDJLz3kdKv9oYbYu4PwgvKcWUStiUP4Q`
3. Create "hello world" inscription
4. Verify on indexer

---

## Questions?

**Q: Why not just fix ZIP 243?**
A: Diminishing returns. Zerdinals uses bitcore-lib-zcash's proven implementation. Building on proven code is faster and more reliable.

**Q: Can we use Zerdinals' JavaScript bundle?**
A: Not practical - it's minified, obfuscated, and 67,000+ lines. Cleaner to fork bitcore-lib-zcash.

**Q: What about NU6/ZIP 244?**
A: Not needed for MVP. Zerdinals uses v4 transactions. NU6 support can be added later.

**Q: Will our inscriptions work with Zerdinals indexer?**
A: Yes, if we match their transaction format exactly (which we do).

**Q: How much will this cost?**
A: Full MVP: $15-25k development + $50-100/month infrastructure. POC script: $2-5k.

---

## Contact

For questions or to discuss implementation, contact the development team.

**Ready to build?** Start with `MVP_IMPLEMENTATION_PLAN.md`.
