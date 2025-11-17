# Zcash Inscriptions Service - MVP Implementation Plan

## Executive Summary

**Goal**: Build an independent Zcash inscriptions service matching Zerdinals' transaction structure for indexing compatibility.

**Timeline**: 2-3 weeks (1-2 developers)

**Key Decision**: Fork `bitcore-lib-zcash` to bypass ZIP 243 implementation issues and leverage proven transaction signing.

---

## Current Status

### ✅ Working Components

1. **Inscription Protection System** (`src/services/inscriptionProtection.ts`)
   - Production-ready UTXO checking
   - Prevents accidental inscription spending
   - API integration: `https://indexer.zerdinals.com/location/{txid}:{vout}`

2. **Script Structure Understanding**
   - Correct Ordinals format: `ord` marker + content type + data
   - Reveal script: `<pubkey> OP_CHECKSIGVERIFY OP_DROP(x5) OP_1`
   - Inscription data in scriptSig (not in reveal script)

3. **Transaction Structure**
   - Commit: P2SH locking mechanism
   - Reveal: Custom scriptSig with inscription data
   - Zerdinals-compatible format

4. **Helper Functions** (`scripts/inscribe/ordinals-builder.ts`)
   - `buildRevealScript()`
   - `buildInscriptionData()`
   - `buildP2SHScript()`

### ❌ Current Blocker

**ZIP 243 Signature Hash Implementation**
- Signature verifies locally ✓
- Fails on-chain validation ✗
- Likely subtle preimage structure issue

**Root Cause**: Implementing ZIP 243 from scratch is error-prone. Zerdinals likely uses bitcore-lib-zcash's proven signature hash.

---

## MVP Architecture

### System Overview

```
┌─────────────────┐
│  React Frontend │ (Next.js 14)
│  - Input form   │
│  - Wallet conn  │
│  - Status UI    │
└────────┬────────┘
         │
    REST API
         │
┌────────┴────────┐
│  Backend API    │ (Node.js/Express)
│  - Tx builder   │
│  - Signing      │
│  - Broadcasting │
└────────┬────────┘
         │
    ┌────┴─────┬──────────┬─────────────┐
    │          │          │             │
┌───┴───┐  ┌──┴──┐  ┌────┴────┐  ┌─────┴──────┐
│ UTXO  │  │ RPC │  │ Indexer │  │ Forked Lib │
│ API   │  │ Node│  │ Check   │  │ bitcore-   │
│       │  │     │  │         │  │ lib-zcash  │
└───────┘  └─────┘  └─────────┘  └────────────┘
```

### Technology Stack

**Frontend**
- Next.js 14 (React 18)
- TailwindCSS for styling
- Wallet integration (WIF import initially, later: browser extensions)

**Backend**
- Node.js 20+ with TypeScript
- Express.js for REST API
- Forked `bitcore-lib-zcash` for transaction construction

**Infrastructure**
- Zcash RPC node (Tatum or self-hosted)
- UTXO API: `utxos.zerdinals.com` (with fallback to Blockchair)
- Indexer: `api.zerdinals.com` for inscription protection

---

## Implementation Plan

### Week 1: Core Transaction Library

**Goal**: Fork bitcore-lib-zcash and create working transaction builder

**Tasks**:

1. **Fork bitcore-lib-zcash** (Day 1-2)
   - Clone: `https://github.com/zcash-hackworks/bitcore-lib-zcash`
   - Update dependencies (fix lodash compatibility)
   - Add TypeScript definitions
   - Test basic P2PKH transactions

2. **Extend for Ordinals** (Day 3-4)
   - Add custom scriptSig builder for reveal transactions
   - Implement inscription data encoding
   - Test commit transaction construction

3. **Reveal Transaction Builder** (Day 5)
   - Manual scriptSig construction: `<inscription data> <signature> <reveal script>`
   - Test full commit-reveal flow on testnet

**Deliverables**:
- Working `@zatoshi/bitcore-lib-zcash` package
- Test suite for commit/reveal transactions
- Example: Create "hello world" inscription on testnet

---

### Week 2: Backend API & Integration

**Goal**: Build REST API for inscription creation

**Tasks**:

1. **API Endpoints** (Day 1-2)
   ```typescript
   POST /api/inscriptions/create
   {
     content: string;      // Max 80 bytes
     contentType: string;  // e.g., "text/plain"
     walletWIF: string;    // Private key (WIF format)
   }

   Response:
   {
     commitTxid: string;
     revealTxid: string;
     inscriptionId: string; // "{revealTxid}i0"
   }

   GET /api/inscriptions/check-utxo/:txid/:vout
   {
     hasInscription: boolean;
     inscriptionId?: string;
   }
   ```

2. **Transaction Flow** (Day 3-4)
   ```typescript
   async function createInscription(content: string, privateKey: string) {
     // 1. Check UTXO safety
     const safeUtxos = await getSafeUTXOs(address);

     // 2. Build reveal script
     const revealScript = buildRevealScript(publicKey);
     const p2shScript = buildP2SHScript(revealScript);

     // 3. Build commit transaction
     const commitTx = await buildCommitTransaction(
       safeUtxos[0],
       p2shScript,
       privateKey
     );

     // 4. Broadcast commit
     const commitTxid = await broadcastTransaction(commitTx);

     // 5. Wait 10 seconds
     await delay(10000);

     // 6. Build reveal transaction
     const revealTx = await buildRevealTransaction(
       commitTxid,
       revealScript,
       buildInscriptionData(content, contentType),
       privateKey
     );

     // 7. Broadcast reveal
     const revealTxid = await broadcastTransaction(revealTx);

     return {
       commitTxid,
       revealTxid,
       inscriptionId: `${revealTxid}i0`
     };
   }
   ```

3. **Error Handling** (Day 5)
   - UTXO validation errors
   - Broadcast failures
   - Inscription protection violations
   - Rate limiting

**Deliverables**:
- Working REST API
- Inscription creation endpoint
- UTXO safety check endpoint
- Error handling & logging

---

### Week 3: Frontend & Testing

**Goal**: Build user interface and validate indexing

**Tasks**:

1. **React Frontend** (Day 1-3)
   - Inscription creation form
   - Wallet import (WIF)
   - Transaction status display
   - Inscription gallery (fetch from Zerdinals indexer)

2. **Indexing Validation** (Day 4)
   - Create test inscriptions
   - Verify appearance in `api.zerdinals.com`
   - Check inscription data integrity
   - Test various content types

3. **Polish & Deploy** (Day 5)
   - Error messages & UX improvements
   - Loading states & progress indicators
   - Deploy to staging environment
   - Documentation

**Deliverables**:
- Functional web UI
- Confirmed Zerdinals indexing compatibility
- User documentation
- Deployment scripts

---

## Technical Implementation Details

### 1. Forked bitcore-lib-zcash Setup

**Package Structure**:
```
@zatoshi/bitcore-lib-zcash/
├── lib/
│   ├── transaction/
│   │   ├── transaction.js
│   │   └── ordinals.js          # NEW: Ordinals-specific logic
│   ├── script/
│   │   └── ordinals-script.js   # NEW: Reveal script builder
│   └── ...
├── package.json
└── tsconfig.json
```

**Key Modifications**:

1. **Update lodash** (`package.json`):
   ```json
   {
     "dependencies": {
       "lodash": "^4.17.21"
     }
   }
   ```

2. **Add Ordinals support** (`lib/transaction/ordinals.js`):
   ```javascript
   function buildRevealTransaction(commitTxid, revealScript, inscriptionData, privateKey) {
     const tx = new Transaction();

     // Input: Spend P2SH
     tx.from({
       txId: commitTxid,
       outputIndex: 0,
       script: Script.buildScriptHashOut(revealScript).toString(),
       satoshis: 60000
     });

     // Output: Send back to wallet
     tx.to(privateKey.toAddress(), 50000);

     // Custom scriptSig with inscription data
     const scriptSig = Buffer.concat([
       inscriptionData,
       // Signature will be added during signing
     ]);

     // Sign with custom scriptSig handling
     const signature = Transaction.Sighash.sign(
       tx,
       privateKey,
       Signature.SIGHASH_ALL,
       0,
       revealScript
     );

     // Build final scriptSig
     tx.inputs[0].setScript(Script.fromBuffer(
       Buffer.concat([
         inscriptionData,
         Buffertools.pushInt(signature.length),
         signature,
         Buffertools.pushInt(revealScript.length),
         revealScript
       ])
     ));

     return tx;
   }
   ```

### 2. Backend Transaction Builder

**File**: `src/services/inscriptionBuilder.ts`

```typescript
import * as Bitcore from '@zatoshi/bitcore-lib-zcash';
import { buildRevealScript, buildInscriptionData, buildP2SHScript } from './ordinalsScripts';
import { getSafeUTXOs } from './inscriptionProtection';

export class InscriptionBuilder {
  private privateKey: Bitcore.PrivateKey;

  constructor(wif: string) {
    this.privateKey = Bitcore.PrivateKey.fromWIF(wif);
  }

  async createInscription(content: string, contentType: string = 'text/plain') {
    // 1. Get safe UTXOs
    const address = this.privateKey.toAddress().toString();
    const { safeUtxos } = await getSafeUTXOs(address);

    if (safeUtxos.length === 0) {
      throw new Error('No safe UTXOs available');
    }

    // 2. Build scripts
    const publicKey = this.privateKey.toPublicKey();
    const revealScript = buildRevealScript(publicKey.toBuffer());
    const p2shScript = buildP2SHScript(revealScript);
    const inscriptionData = buildInscriptionData(content, contentType);

    // 3. Build commit transaction
    const commitTx = new Bitcore.Transaction()
      .from({
        txId: safeUtxos[0].txid,
        outputIndex: safeUtxos[0].vout,
        address,
        script: Bitcore.Script.buildPublicKeyHashOut(address).toString(),
        satoshis: safeUtxos[0].value
      })
      .to(
        Bitcore.Script.fromBuffer(p2shScript).toScriptHashOut().toAddress(),
        60000  // Lock amount
      )
      .change(address)
      .fee(10000)
      .sign(this.privateKey);

    // 4. Broadcast commit
    const commitTxid = await this.broadcastTransaction(commitTx.toString());

    // 5. Wait for propagation
    await new Promise(resolve => setTimeout(resolve, 10000));

    // 6. Build reveal transaction (custom scriptSig)
    const revealTx = this.buildRevealTransaction(
      commitTxid,
      revealScript,
      inscriptionData
    );

    // 7. Broadcast reveal
    const revealTxid = await this.broadcastTransaction(revealTx.toString());

    return {
      commitTxid,
      revealTxid,
      inscriptionId: `${revealTxid}i0`
    };
  }

  private buildRevealTransaction(
    commitTxid: string,
    revealScript: Buffer,
    inscriptionData: Buffer
  ): Bitcore.Transaction {
    // This uses the custom Ordinals logic from forked library
    return Bitcore.Transaction.Ordinals.buildReveal(
      commitTxid,
      revealScript,
      inscriptionData,
      this.privateKey
    );
  }

  private async broadcastTransaction(txHex: string): Promise<string> {
    // Implementation from existing code
  }
}
```

### 3. Frontend Component

**File**: `src/app/mint/page.tsx`

```tsx
'use client';

import { useState } from 'react';

export default function MintPage() {
  const [content, setContent] = useState('');
  const [wif, setWif] = useState('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<any>(null);

  const handleMint = async () => {
    if (content.length > 80) {
      setStatus('Error: Content too long (max 80 bytes)');
      return;
    }

    setStatus('Creating inscription...');

    try {
      const response = await fetch('/api/inscriptions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          contentType: 'text/plain',
          walletWIF: wif
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Mint failed');
      }

      setResult(data);
      setStatus('Success!');
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
    }
  };

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">Create Inscription</h1>

      <div className="max-w-md space-y-4">
        <div>
          <label className="block mb-2">Content (max 80 bytes)</label>
          <textarea
            className="w-full border p-2"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="hello world"
          />
          <p className="text-sm text-gray-500">
            {content.length} / 80 bytes
          </p>
        </div>

        <div>
          <label className="block mb-2">Wallet Private Key (WIF)</label>
          <input
            type="password"
            className="w-full border p-2"
            value={wif}
            onChange={(e) => setWif(e.target.value)}
            placeholder="L..."
          />
        </div>

        <button
          onClick={handleMint}
          className="bg-blue-500 text-white px-6 py-2 rounded"
          disabled={!content || !wif}
        >
          Create Inscription
        </button>

        {status && (
          <div className="p-4 bg-gray-100 rounded">
            <p>{status}</p>
          </div>
        )}

        {result && (
          <div className="p-4 bg-green-100 rounded">
            <h3 className="font-bold mb-2">Inscription Created!</h3>
            <p className="text-sm">Commit: {result.commitTxid}</p>
            <p className="text-sm">Reveal: {result.revealTxid}</p>
            <p className="text-sm">ID: {result.inscriptionId}</p>
            <a
              href={`https://zerdinals.com/inscription/${result.inscriptionId}`}
              target="_blank"
              className="text-blue-500 underline"
            >
              View on Zerdinals
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## Testing Strategy

### 1. Unit Tests
- Script builders (reveal script, P2SH, inscription data)
- Transaction construction
- Signature creation

### 2. Integration Tests
- Full commit-reveal flow on testnet
- UTXO protection logic
- Broadcasting & confirmations

### 3. Indexing Validation
- Create test inscriptions
- Verify Zerdinals indexer recognition
- Check data integrity

### 4. Edge Cases
- Multiple inscriptions per transaction
- Large content (80 bytes limit)
- UTXO with existing inscription (protection)
- Network failures & retries

---

## Success Criteria

1. ✅ Create "hello world" inscription programmatically
2. ✅ Inscription appears in Zerdinals indexer within 5 minutes
3. ✅ UTXO protection prevents double-inscribing
4. ✅ Web UI allows non-technical users to mint
5. ✅ Transaction format matches Zerdinals exactly

---

## Future Enhancements (Post-MVP)

1. **Wallet Integration**
   - Browser extension support (MetaMask-style)
   - Hardware wallet support

2. **Advanced Features**
   - Image inscriptions (Base64 encoding)
   - Multiple content types (JSON, HTML, etc.)
   - Batch minting
   - Collection management

3. **Performance**
   - Own Zcash RPC node (no Tatum dependency)
   - Own indexer (no Zerdinals dependency)
   - Caching layer for UTXOs

4. **NU6 Support**
   - Upgrade to v5/v6 transactions
   - ZIP 244 implementation (once debugged)

---

## Risk Mitigation

### Risk: bitcore-lib-zcash fork maintenance
**Mitigation**: Keep fork minimal, only add Ordinals-specific code. Stay updated with upstream.

### Risk: Zerdinals indexer compatibility
**Mitigation**: Test extensively on testnet. Document exact transaction format. Have fallback indexer plan.

### Risk: Signature hash issues persist
**Mitigation**: Use bitcore's proven signature hash. If issues arise, hire Zcash core developer for consultation.

---

## Resource Requirements

### Development Team
- 1 Senior Full-Stack Developer (Node.js, React, Zcash)
- 1 Junior Developer (optional, for frontend polish)

### Infrastructure
- Zcash RPC access (Tatum or self-hosted)
- Web hosting (Vercel/AWS)
- Domain & SSL

### Estimated Cost
- Development: $15-25k (2-3 weeks @ $200-300/hr)
- Infrastructure: $50-100/month initially

---

## Conclusion

By forking bitcore-lib-zcash and replicating Zerdinals' proven transaction structure, we can bypass the ZIP 243 debugging blocker and deliver a working MVP in 2-3 weeks. The service will be fully compatible with Zerdinals' indexer while providing an independent minting platform for users.

**Next Steps**:
1. Approve this plan
2. Fork bitcore-lib-zcash
3. Begin Week 1 implementation
