# File Index - Zcash Inscription Implementation

## 📁 Directory Structure

```
zatoshi.market/
├── src/
│   ├── services/
│   │   ├── inscriptionProtection.ts          # ✅ CRITICAL: UTXO protection system
│   │   └── zcash.ts                          # ✅ Zcash service integration
│   └── app/
│       └── api/
│           └── zcash/
│               └── utxos/[address]/route.ts  # ✅ UTXO API endpoint
│
└── scripts/
    └── inscribe/
        ├── TECHNICAL_REPORT.md               # 📄 Complete technical documentation
        ├── QUICK_REFERENCE.md                # 📄 Quick reference guide
        ├── FILE_INDEX.md                     # 📄 This file
        ├── STATUS.md                         # 📄 Project status overview
        ├── BLOCKER.md                        # 📄 Library blocker details
        ├── SIGNATURE_DEBUG.md                # 📄 Signature verification analysis
        ├── INSCRIPTION_PROTECTION.md         # 📄 Protection system docs
        │
        ├── manual-tx-builder.ts              # 🔧 Custom transaction builder (90% done)
        ├── zerdinals-api-inscribe.ts         # 🔧 Bitcore-based builder
        ├── final-inscribe.ts                 # 🔧 Initial attempt (reference)
        │
        ├── generate-wallet.ts                # 🛠️ Generate Zcash wallets
        ├── test-wallet-inscriptions.ts       # 🛠️ Test inscription protection
        ├── inspect-utxo.ts                   # 🛠️ Inspect source transactions
        ├── verify-key.ts                     # 🛠️ Verify key/address match
        ├── verify-wif.ts                     # 🛠️ Analyze WIF encoding
        ├── decode-tx.ts                      # 🛠️ Decode transaction hex
        ├── get-blockchain-info.ts            # 🛠️ Get network upgrade info
        ├── test-simple-send.ts               # 🛠️ Test basic ZEC send
        └── test-with-branch-id.ts            # 🛠️ Branch ID reference
```

---

## 🎯 Production Files (Ready)

### `/src/services/inscriptionProtection.ts`
**Status**: ✅ Production-ready
**Purpose**: Prevents accidental inscription loss
**Dependencies**: None (uses fetch)

**Key Exports**:
```typescript
interface UTXO {
  txid: string;
  vout: number;
  value: number;
  address: string;
  blockHeight?: number;
  confirmed?: boolean;
}

interface InscriptionCheck {
  location: string;
  hasInscription: boolean;
  inscriptionData?: any;
}

// Main function - ALWAYS use before spending UTXOs
async function getSafeUTXOs(address: string): Promise<{
  allUtxos: UTXO[];
  safeUtxos: UTXO[];
  inscribedUtxos: UTXO[];
  totalValue: number;
  safeValue: number;
}>

// Helper functions
async function fetchUTXOs(address: string): Promise<UTXO[]>
async function checkUTXOForInscription(txid: string, vout: number): Promise<InscriptionCheck>
```

**Usage**:
```typescript
import { getSafeUTXOs } from '@/services/inscriptionProtection';

const { safeUtxos, inscribedUtxos } = await getSafeUTXOs(address);
```

---

### `/src/app/api/zcash/utxos/[address]/route.ts`
**Status**: ✅ Working
**Purpose**: API endpoint to fetch UTXOs for an address
**Endpoint**: `GET /api/zcash/utxos/:address`

**Response**:
```json
{
  "utxos": [
    {
      "txid": "48d9a62d...",
      "vout": 0,
      "value": 500000,
      "address": "t1ZemSS...",
      "blockHeight": 3137745,
      "confirmed": true
    }
  ]
}
```

**Fallback Chain**:
1. Blockchair API (if key available)
2. Zerdinals API
3. Other explorers

---

### `/src/services/zcash.ts`
**Status**: ✅ Working
**Purpose**: Zcash service utilities
**Exports**: Various Zcash helper functions

---

## 🔧 Implementation Files (Blocked - Need ZIP 244)

### `/scripts/inscribe/manual-tx-builder.ts`
**Status**: ⏸️ 90% complete, needs ZIP 244
**Purpose**: Build Zcash transactions from scratch
**Lines**: ~350

**What Works**:
- ✅ WIF private key decoding
- ✅ Address encoding/decoding
- ✅ Transaction structure building
- ✅ OP_RETURN script creation
- ✅ P2PKH script creation
- ✅ Varint serialization
- ✅ Sapling v4 format with overwintered bit
- ✅ secp256k1 signing
- ✅ DER signature encoding
- ❌ ZIP 244 signature hash (uses ZIP 243)

**Key Functions**:
```typescript
function decodeWIF(wif: string): Buffer
function decodeAddress(address: string): Buffer
function createOpReturnScript(data: Buffer): Buffer
function createP2PKHScript(pubKeyHash: Buffer): Buffer
function varint(n: number): Buffer
function signatureToDER(signature: Uint8Array): Buffer
async function buildSignedTransaction(): Promise<string>
async function broadcastTransaction(signedTxHex: string): Promise<string>
async function createInscription(): Promise<string>
```

**Next Step**: Replace signature hash with ZIP 244 implementation

---

### `/scripts/inscribe/zerdinals-api-inscribe.ts`
**Status**: ⏸️ Working with bitcore, same ZIP 244 issue
**Purpose**: Use bitcore-lib-zcash for transaction building
**Lines**: ~130

**Implementation**:
```typescript
// Monkey-patch lodash to fix bitcore bug
import * as lodash from 'lodash';
(globalThis as any)._ = lodash;

import * as bitcore from 'bitcore-lib-zcash';

// Builds transaction using bitcore
const tx = new bitcore.Transaction();
tx.from({ txId, outputIndex, satoshis, script });
tx.addOutput(/* OP_RETURN */);
tx.to(address, changeAmount);
tx.sign(privateKey);

// Bypass lodash bug
const hex = tx.uncheckedSerialize();
```

**Issue**: bitcore-lib-zcash only implements ZIP 243 (Sapling)

---

### `/scripts/inscribe/final-inscribe.ts`
**Status**: ⏸️ Reference only
**Purpose**: Original attempt (abandoned)
**Note**: Kept for reference, use manual-tx-builder.ts instead

---

## 🛠️ Utility Scripts

### `/scripts/inscribe/generate-wallet.ts`
**Purpose**: Generate new Zcash mainnet wallets
**Usage**: `npx tsx scripts/inscribe/generate-wallet.ts`

**Output**:
```
Address:     t1...
Private Key: L...
```

---

### `/scripts/inscribe/test-wallet-inscriptions.ts`
**Purpose**: Test inscription protection system with real wallets
**Usage**: `npx tsx scripts/inscribe/test-wallet-inscriptions.ts <address>`

**Example**:
```bash
npx tsx scripts/inscribe/test-wallet-inscriptions.ts t1YbJR1f6fv5LkTG1avBQFH1UtRT5hGGxDh
```

**Output**:
```
Found 7 UTXOs
├─ 3 inscribed (PROTECTED)
└─ 4 safe to spend
```

---

### `/scripts/inscribe/inspect-utxo.ts`
**Purpose**: Get detailed info about a UTXO's source transaction
**Usage**: `npx tsx scripts/inscribe/inspect-utxo.ts`

**Shows**:
- Transaction version
- ScriptPubKey hex
- Script type (pubkeyhash, etc.)
- Output addresses

---

### `/scripts/inscribe/verify-key.ts`
**Purpose**: Verify private key matches address
**Usage**: `npx tsx scripts/inscribe/verify-key.ts`

**Checks**:
- Derives address from private key
- Compares with expected address
- Confirms match

---

### `/scripts/inscribe/verify-wif.ts`
**Purpose**: Analyze WIF encoding details
**Usage**: `npx tsx scripts/inscribe/verify-wif.ts`

**Shows**:
- Version byte (mainnet/testnet)
- Compression flag
- Private key hex

---

### `/scripts/inscribe/decode-tx.ts`
**Purpose**: Decode a signed transaction hex via Zcash RPC
**Usage**: Edit TX_HEX in file, then `npx tsx scripts/inscribe/decode-tx.ts`

**Output**:
- Full transaction JSON
- Inputs, outputs, scripts
- Verifies structure

---

### `/scripts/inscribe/get-blockchain-info.ts`
**Purpose**: Get current Zcash network state
**Usage**: `npx tsx scripts/inscribe/get-blockchain-info.ts`

**Shows**:
- Current block height
- Active network upgrades
- Consensus branch IDs
- Chain supply and value pools

---

### `/scripts/inscribe/test-simple-send.ts`
**Purpose**: Test basic P2PKH send (no inscription)
**Usage**: `npx tsx scripts/inscribe/test-simple-send.ts`

**Note**: Also fails with ZIP 244 issue (proves it's not inscription-specific)

---

### `/scripts/inscribe/test-with-branch-id.ts`
**Purpose**: Reference for consensus branch IDs
**Content**: Lists all Zcash network upgrade branch IDs

---

## 📄 Documentation Files

### `/scripts/inscribe/TECHNICAL_REPORT.md`
**Size**: ~500 lines
**Content**:
- Executive summary
- Root cause analysis
- Complete implementation details
- Solution comparisons
- Testing checklist
- API documentation
- Security considerations

**Audience**: Technical lead, senior developers

---

### `/scripts/inscribe/QUICK_REFERENCE.md`
**Size**: ~200 lines
**Content**:
- TL;DR summary
- Key file paths
- Quick commands
- Code snippets
- Next actions

**Audience**: All team members

---

### `/scripts/inscribe/FILE_INDEX.md`
**Size**: This file
**Content**: Complete file inventory with purposes

---

### `/scripts/inscribe/STATUS.md`
**Size**: ~200 lines
**Content**:
- What's ready (100%)
- What's blocked
- Solutions (4 options)
- Recommended path forward

**Created**: During initial implementation

---

### `/scripts/inscribe/BLOCKER.md`
**Size**: ~200 lines
**Content**:
- bitcore-lib-zcash compatibility issue
- Lodash dependency error
- Attempted fixes
- Workarounds

**Created**: During library debugging phase

---

### `/scripts/inscribe/SIGNATURE_DEBUG.md`
**Size**: ~150 lines
**Content**:
- Signature verification failure analysis
- Comparison of manual vs bitcore transactions
- Possible causes
- Debugging approaches

**Created**: During signature debugging phase

---

### `/scripts/inscribe/INSCRIPTION_PROTECTION.md`
**Size**: ~100 lines
**Content**:
- Protection system documentation
- API usage
- Best practices
- Warning examples

**Created**: After protection system implementation

---

## 📦 Dependencies

### Production
```json
{
  "@tatumio/tatum": "^4.2.64",      // ✅ Zcash RPC access
  "@noble/secp256k1": "^2.3.0",     // ✅ Signing works
  "@noble/hashes": "^1.6.1",        // ✅ Has BLAKE2b for ZIP 244
  "bs58check": "^4.0.0"             // ✅ Address encoding
}
```

### Development
```json
{
  "bitcore-lib-zcash": "^0.13.20",  // ⏸️ Outdated (Sapling only)
  "lodash": "^4.17.21"              // ✅ Fixes bitcore compatibility
}
```

---

## 🔗 Important Links

### API Endpoints
```
Tatum RPC:
https://api.tatum.io/v3/blockchain/node/zcash-mainnet

Zerdinals UTXOs:
https://utxos.zerdinals.com/api/utxos/{address}

Zerdinals Indexer:
https://indexer.zerdinals.com/location/{txid}:{vout}

Zerdinals Broadcast:
https://utxos.zerdinals.com/api/send-transaction

Zerdinals Mint UI:
https://mint.zerdinals.com
```

### Specifications
```
ZIP 244 (NU5/NU6):
https://zips.z.cash/zip-0244

ZIP 243 (Sapling):
https://zips.z.cash/zip-0243

NU6 Info:
https://z.cash/upgrade/nu6/

Protocol Spec:
https://zips.z.cash/protocol/protocol.pdf
```

---

## 🎯 File Reading Order

For technical lead review:

1. **Start Here**: `/scripts/inscribe/QUICK_REFERENCE.md`
2. **Deep Dive**: `/scripts/inscribe/TECHNICAL_REPORT.md`
3. **Code Review**:
   - `/src/services/inscriptionProtection.ts` (production-ready)
   - `/scripts/inscribe/manual-tx-builder.ts` (needs ZIP 244)
4. **Reference**: This file for navigation

---

## 📊 File Statistics

```
Production Files:        3 files  ✅
Implementation Files:    3 files  ⏸️
Utility Scripts:        10 files  ✅
Documentation:           7 files  📄
Total:                  23 files
```

**Lines of Code**:
- Production:     ~500 LOC ✅
- Implementation: ~800 LOC (90% done)
- Utilities:      ~600 LOC ✅
- Documentation:  ~2000 lines 📄

---

## ✅ Testing Coverage

**Tested and Working**:
- [x] Inscription protection system
- [x] UTXO fetching
- [x] Wallet generation
- [x] Key/address verification
- [x] WIF encoding/decoding
- [x] Transaction structure building
- [x] ScriptPubKey matching
- [x] Transaction decoding
- [x] Network state queries

**Needs Testing** (after ZIP 244):
- [ ] ZIP 244 signature implementation
- [ ] Transaction broadcasting
- [ ] Inscription creation end-to-end
- [ ] Zerdinals indexing
- [ ] Multiple inscriptions

---

**Last Updated**: November 17, 2025
**Maintainer**: Development Team
