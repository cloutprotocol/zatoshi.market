# Inscription Protection System

## 🛡️ Critical Safety Feature

**MANDATORY inscription protection** following Zerdinals best practices to prevent accidental destruction of valuable inscriptions.

## ⚠️ The Problem

Inscriptions are stored in specific UTXOs. Spending an inscribed UTXO **permanently destroys the inscription**.

## 🔍 Zerdinals Best Practice (from HAR analysis)

### Step 1: Fetch UTXOs
```
GET https://utxos.zerdinals.com/api/utxos/{address}
```

### Step 2: Check EACH UTXO (MANDATORY)
```
GET https://indexer.zerdinals.com/location/{txid}:{vout}
```

**Safe (404):**
```json
{"code":404,"message":"0 Inscription  found!"}
```
✅ SAFE to spend

**Inscribed:**
```json
{"inscription_id": "...", "content_type": "..."}
```
⛔ MUST NOT SPEND

### Step 3: Filter
- Use ONLY UTXOs that return 404
- NEVER spend UTXOs with inscription data

## 📊 Test Results

### Wallet with Inscriptions: t1YbJR1f6fv5LkTG1avBQFH1UtRT5hGGxDh
```
Total UTXOs: 7
Safe: 4 (0.02871552 ZEC)
Inscribed: 3 🛡️ PROTECTED

Protected Inscriptions:
- 820b0d4ca7be271398501c0284024eff1648a390e67bcff1e6a40cae99705bb6:0
- 317b15c858ccf8be1564a8e02edee4c3fa1e99f29d8e244c89636cf8306df476:0
- 0b28b6ab05da1548e58ee89681c4f653242285b04d20b85eb96a2702a2b5fbb1:0
```

### Clean Wallet: t1ZemSSmv1kcqapcCReZJGH4driYmbALX1x
```
Total UTXOs: 1
Safe: 1 (0.00500000 ZEC)
Inscribed: 0
```

## 🚨 Fail-Safe Design

**If verification fails → ABORT transaction**

```typescript
// NEVER assume safe if check fails
try {
  await checkUTXOForInscription(txid, vout);
} catch (error) {
  throw new Error(
    `Cannot verify UTXO is safe. ABORTING to prevent inscription loss.`
  );
}
```

## 🔧 Implementation

### Service: `/src/services/inscriptionProtection.ts`
```typescript
import { getSafeUTXOs } from '@/services/inscriptionProtection';

const { safeUtxos, inscribedUtxos } = await getSafeUTXOs(address);
// Build transaction using ONLY safeUtxos
```

### Test Script:
```bash
npx tsx scripts/inscribe/test-wallet-inscriptions.ts <address>
```

## ✅ Integration Checklist

- [ ] Inscription creation flow
- [ ] ZEC send flow
- [ ] Token transfer flow
- [ ] UI warnings for protected inscriptions
- [ ] Error handling tests
- [ ] Production monitoring

---

**Status: ✅ IMPLEMENTED - Prevents accidental inscription loss**
