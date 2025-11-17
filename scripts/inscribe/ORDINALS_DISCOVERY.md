# CRITICAL DISCOVERY: Zerdinals Uses Ordinals Commit/Reveal Pattern

**Date**: 2025-11-17
**Impact**: Changes entire implementation approach

---

## 🚨 Key Finding

We've been trying to create **single-transaction inscriptions** with OP_RETURN, but Zerdinals actually uses the **Bitcoin Ordinals two-transaction commit/reveal pattern**!

This explains why our approach wasn't matching their system.

---

## 📋 Zerdinals Inscription Structure

### Transaction 1: Commit Transaction

**Purpose**: Lock funds in a special P2SH script address

**Example**:
```
TXID: 15c799952f6bc2678c0a9bec14e09e2f4243f966944c27146c9c9b69acd9d282

Outputs:
├─ Output 0: 0.0006 ZEC to script address
│   └─ Script: a9142e12c4f03d19dbda53fedc5521db7d177dac14d087
│   └─ Type: P2SH (Pay to Script Hash)
│
└─ Output 1: 0.0013 ZEC to change address
    └─ Type: P2PKH (normal address)
```

**Script Breakdown**:
```
a914    = OP_HASH160 (20 bytes follow)
2e12... = 20-byte hash of the reveal script
87      = OP_EQUAL
```

This is a **P2SH output**, not OP_RETURN!

---

### Transaction 2: Reveal Transaction

**Purpose**: Spend the commit transaction's P2SH output and reveal the inscription data

**Example**:
```
TXID: 0b28b6ab05da1548e58ee89681c4f653242285b04d20b85eb96a2702a2b5fbb1

Input:
└─ Spends: 15c799952f6bc2678c0a9bec14e09e2f4243f966944c27146c9c9b69acd9d282:0
   └─ ScriptSig contains inscription data

ScriptSig Format:
├─ 036f7264                      # "ord" marker (3 bytes)
├─ 510a746578742f706c61696e      # "text/plain" MIME type
└─ 000b7a61746f7368692e7a6563    # "zatoshi.zec" content

Output:
└─ 0.0010 ZEC to recipient address
```

---

## 🔍 Script Data Breakdown

### "ord" Marker
```
036f7264
├─ 03    = Push 3 bytes
└─ 6f7264 = "ord" in ASCII
```

### MIME Type
```
510a746578742f706c61696e
├─ 51    = OP_1 (push 1 to stack)
├─ 0a    = Push 10 bytes
└─ 746578742f706c61696e = "text/plain" in ASCII
```

### Content
```
000b7a61746f7368692e7a6563
├─ 00    = OP_0 (push empty array)
├─ 0b    = Push 11 bytes
└─ 7a61746f7368692e7a6563 = "zatoshi.zec" in ASCII
```

---

## 🎯 How This Works

### Step 1: Create Commit Script

The reveal script that gets hashed:
```
OP_FALSE
OP_IF
  "ord"
  OP_1
  "text/plain"
  OP_0
  "zatoshi.zec"
OP_ENDIF
<pubkey>
OP_CHECKSIG
```

Hash this script with HASH160 to get the P2SH address.

### Step 2: Broadcast Commit Transaction

Send funds to the P2SH address created from the script hash.

```
Output: a9142e12c4f03d19dbda53fedc5521db7d177dac14d087
        └─ This locks the funds
```

### Step 3: Broadcast Reveal Transaction

Spend the P2SH output by providing:
1. The full reveal script (in scriptSig)
2. Signature

The script executes:
- `OP_FALSE OP_IF ... OP_ENDIF` = The IF block is skipped (inscription data ignored by script execution)
- `<pubkey> OP_CHECKSIG` = Standard signature check

The inscription data is in the script but doesn't affect validation - it's just data!

---

## 💡 Why This Approach?

1. **Inscription Data in Script**: Not in OP_RETURN (which is provably unspendable)
2. **Ordinals Compatibility**: Follows Bitcoin Ordinals specification
3. **Indexing**: Indexers look for the "ord" pattern in scriptSig
4. **Efficiency**: Can include larger data (not limited to 80 bytes like OP_RETURN)

---

## 🔧 Implementation Requirements

### What We Need to Build

#### 1. Commit Transaction Builder
```typescript
function buildCommitTransaction(
  utxos: UTXO[],
  inscriptionScript: Buffer,
  privateKey: Buffer
): Promise<string> {
  // 1. Build reveal script with inscription data
  const revealScript = buildRevealScript(inscriptionData, publicKey);

  // 2. Hash script to create P2SH address
  const scriptHash = hash160(revealScript);
  const p2shScript = buildP2SHOutput(scriptHash);

  // 3. Create transaction sending to P2SH
  const tx = new Transaction();
  tx.addInput(utxos[0]);
  tx.addOutput(p2shScript, commitAmount);  // To script
  tx.addOutput(changeScript, changeAmount); // Change
  tx.sign(privateKey);

  return tx.serialize();
}
```

#### 2. Reveal Transaction Builder
```typescript
function buildRevealTransaction(
  commitTxId: string,
  commitVout: number,
  revealScript: Buffer,
  privateKey: Buffer
): Promise<string> {
  const tx = new Transaction();

  // Input: Spend the P2SH output
  tx.addInput({
    txid: commitTxId,
    vout: commitVout,
    scriptSig: revealScript  // Full script here!
  });

  // Output: Send to final address
  tx.addOutput(recipientScript, amount);

  // Sign
  tx.sign(privateKey);

  return tx.serialize();
}
```

#### 3. Reveal Script Builder
```typescript
function buildRevealScript(
  content: string,
  mimeType: string,
  publicKey: Buffer
): Buffer {
  return Buffer.concat([
    Buffer.from([0x00]),           // OP_FALSE
    Buffer.from([0x63]),           // OP_IF
    Buffer.from([0x03]),           // Push 3 bytes
    Buffer.from('ord', 'utf8'),    // "ord"
    Buffer.from([0x51]),           // OP_1
    varint(mimeType.length),
    Buffer.from(mimeType, 'utf8'),
    Buffer.from([0x00]),           // OP_0
    varint(content.length),
    Buffer.from(content, 'utf8'),
    Buffer.from([0x68]),           // OP_ENDIF
    varint(publicKey.length),
    publicKey,
    Buffer.from([0xac])            // OP_CHECKSIG
  ]);
}
```

---

## 🚀 Zerdinals Frontend Implementation

According to the HAR file, Zerdinals' JavaScript:

1. **Uses**: `index-BImLyB8B.js` (their frontend bundle)
2. **Signs**: Transactions in browser
3. **Broadcasts**: Via JSON-RPC to `rpc.zerdinals.com`
4. **Method**: `sendrawtransaction`

**This means they HAVE working JavaScript implementation!**

---

## 🔍 Critical Questions

### 1. How Does Zerdinals Sign NU6 Transactions?

They're successfully broadcasting, which means they either:
- **A)** Have implemented ZIP 244 in JavaScript
- **B)** Are using a different signing service
- **C)** Are using a library we don't know about

**We need to**:
- Decompile/analyze `index-BImLyB8B.js`
- Find their signing implementation
- See if they're using ZIP 244 or something else

### 2. What RPC Endpoint Are They Using?

```
rpc.zerdinals.com/sendrawtransaction
```

This might:
- Be a modified Zcash node
- Have different validation rules
- Accept older signature formats

### 3. Can We Use Their Approach?

If they have working JavaScript:
- We could analyze their implementation
- Potentially use similar approach
- Or understand how they solve ZIP 244

---

## 📊 Comparison: Our Approach vs Zerdinals

| Aspect | Our Attempt | Zerdinals Actual |
|--------|-------------|------------------|
| **Pattern** | Single transaction | Two transactions (commit/reveal) |
| **Data Storage** | OP_RETURN | P2SH script witness |
| **Transaction 1** | N/A | Lock funds in P2SH |
| **Transaction 2** | Inscription data | Reveal script with data |
| **Format** | `6a10 + data` | Ordinals-style script |
| **Indexing** | OP_RETURN pattern | "ord" marker in scriptSig |
| **Signature** | ZIP 243 (failed) | ??? (works!) |

---

## 🎯 New Implementation Plan

### Phase 1: Analyze Zerdinals' JavaScript
```bash
# Fetch their bundle
curl https://mint.zerdinals.com/assets/index-BImLyB8B.js > zerdinals-bundle.js

# Look for:
# - Transaction building code
# - Signing implementation
# - ZIP 244 or signature hash code
# - Any Zcash libraries they use
```

### Phase 2: Implement Commit/Reveal Pattern
```typescript
// New files needed:
/scripts/inscribe/ordinals-commit.ts     # Build commit tx
/scripts/inscribe/ordinals-reveal.ts     # Build reveal tx
/scripts/inscribe/ordinals-scripts.ts    # Script builders
```

### Phase 3: Solve Signing
Based on what we find in their code:
- If they have ZIP 244 → Use their approach
- If they use a service → Investigate that
- If they use a library → Install and use it

---

## 🔧 Immediate Next Steps

1. **Fetch Zerdinals' JavaScript bundle**
   ```bash
   curl https://mint.zerdinals.com/assets/index-BImLyB8B.js -o zerdinals-bundle.js
   ```

2. **Search for key patterns**:
   ```bash
   grep -i "sign" zerdinals-bundle.js
   grep -i "blake2b" zerdinals-bundle.js
   grep -i "transaction" zerdinals-bundle.js
   grep -i "commit" zerdinals-bundle.js
   ```

3. **Analyze their RPC calls**:
   - What parameters do they send?
   - What transaction format do they use?
   - How are signatures structured?

4. **Test their endpoint**:
   ```bash
   curl -X POST https://rpc.zerdinals.com \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"getblockchaininfo","id":1}'
   ```

---

## 💡 Why This Changes Everything

### Before This Discovery:
- ❌ Trying to use OP_RETURN
- ❌ Single transaction approach
- ❌ Signature failing with ZIP 243
- ❓ No understanding of how Zerdinals actually works

### After This Discovery:
- ✅ Understand commit/reveal pattern
- ✅ Know the exact script format
- ✅ Can analyze their working implementation
- ✅ Can potentially copy their signing approach

---

## 🎓 What This Means

1. **We were solving the wrong problem**
   - Focused on OP_RETURN inscriptions
   - Should have been building Ordinals-style commit/reveal

2. **Zerdinals HAS working signing**
   - They're successfully broadcasting to NU6
   - Their JavaScript bundle contains the solution
   - We can analyze and learn from it

3. **The path forward is clearer**
   - Analyze their code
   - Implement commit/reveal pattern
   - Use their signing approach (or understand it)

---

## 🚀 Updated Recommendation

### New Priority Order:

1. **IMMEDIATE**: Fetch and analyze Zerdinals' JavaScript
   - Find their transaction building code
   - Understand their signing implementation
   - Identify any libraries they use

2. **SHORT-TERM**: Implement commit/reveal pattern
   - Build commit transaction builder
   - Build reveal transaction builder
   - Create proper Ordinals-format scripts

3. **MEDIUM-TERM**: Solve signing
   - Use whatever approach Zerdinals uses
   - Or implement ZIP 244 if that's what they did

---

## 📝 Questions for Technical Lead

1. **Should we reverse-engineer Zerdinals' JavaScript?**
   - It's publicly available
   - Contains working implementation
   - Could save significant time

2. **Can we use their RPC endpoint?**
   - `rpc.zerdinals.com`
   - Might accept our transactions
   - Worth testing

3. **Licensing concerns?**
   - Their code is public but may be proprietary
   - We'd be analyzing, not copying
   - Worth clarifying legal stance

---

## 🎯 Success Criteria (Updated)

### Phase 1: Analysis ✅
- [ ] Download Zerdinals bundle
- [ ] Identify signing code
- [ ] Find library dependencies
- [ ] Document their approach

### Phase 2: Implementation
- [ ] Build commit transaction
- [ ] Build reveal transaction
- [ ] Create proper scripts
- [ ] Sign correctly (using their method)

### Phase 3: Testing
- [ ] Broadcast commit transaction
- [ ] Wait for confirmation
- [ ] Broadcast reveal transaction
- [ ] Verify inscription indexed

---

**This discovery fundamentally changes our approach. The solution may be much simpler than implementing ZIP 244 from scratch - we just need to see how Zerdinals does it!**

---

**Next Action**: Fetch and analyze `https://mint.zerdinals.com/assets/index-BImLyB8B.js`
