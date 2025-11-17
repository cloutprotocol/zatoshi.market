# Inscription Feature Setup Guide

## Overview
The `/inscribe` route allows users to create inscriptions directly on Zcash using the Zerdinals protocol. All inscription creation happens client-side using the connected wallet.

## Architecture

### Client-Side Inscription Flow
1. User connects wallet
2. User enters inscription content (text or ZRC-20 mint)
3. Client fetches UTXOs from Zerdinals API
4. Client builds transaction with embedded inscription data
5. Client signs transaction with wallet's private key
6. Client broadcasts to Zerdinals network
7. Convex logs the inscription for tracking
8. Real-time status updates via Convex

### Files Created

#### `/src/services/inscription.ts`
Core inscription service with functions:
- `getUTXOs(address)` - Fetch UTXOs from Zerdinals API
- `createInscriptionTransaction()` - Build inscription transaction
- `broadcastTransaction()` - Submit to network
- `inscribe()` - Complete workflow for text inscriptions
- `mintZRC20Token()` - Complete workflow for ZRC-20 mints

#### `/src/app/inscribe/page.tsx`
Inscription UI with:
- Text inscription form
- ZRC-20 mint form
- Real-time status tracking
- User's recent inscriptions list
- Integration with Convex for logging

#### Convex Schema Updates
**New Tables:**
- `inscriptions` - Track all inscriptions created through platform
  - Stores: txid, address, content preview, type, status
  - No private keys or sensitive data
  - Real-time status updates

- `sales` - Track marketplace sales
  - Stores: inscription ID, seller, buyer, price, status

**New Functions:**
- `convex/inscriptions.ts` - Inscription CRUD operations
- `convex/sales.ts` - Sales tracking operations

## Important Notes

### Transaction Building
⚠️ **The transaction building logic uses `bitcoinjs-lib` which may need adjustments for Zcash specifics:**

1. **Network Parameters**: Zcash uses different network params than Bitcoin
2. **Script Format**: The inscription script follows Bitcoin Ordinals format
3. **UTXO Structure**: Assumes Zerdinals API returns compatible UTXO format

### Testing Requirements

Before production use:

1. **Test with Small Amounts**: Start with testnet or minimal ZEC
2. **Verify UTXO API**: Ensure Zerdinals UTXO API returns expected format
3. **Verify Broadcast API**: Confirm transaction broadcast endpoint works
4. **Test Inscription Format**: Verify inscriptions are indexed correctly

### Convex Deployment

To enable real-time tracking:

```bash
# Initialize Convex (interactive)
npx convex dev

# This will:
# 1. Create deployment
# 2. Generate types in convex/_generated/
# 3. Update .env.local with NEXT_PUBLIC_CONVEX_URL
# 4. Push schema and functions
```

After deployment, the inscribe page will:
- Log all inscriptions to Convex
- Show real-time status updates
- Display user's inscription history

## API Endpoints Used

### Zerdinals APIs
```
GET https://utxos.zerdinals.com/api/utxos/{address}
POST https://utxos.zerdinals.com/api/send-transaction
GET https://indexer.zerdinals.com/inscription/{inscriptionId}
```

## Inscription Format

### Text Inscription
```
OP_FALSE
OP_IF
  "zrc"
  "text/plain"
  <content>
OP_ENDIF
```

### ZRC-20 Mint
```
OP_FALSE
OP_IF
  "zrc"
  "application/json"
  {"p":"zrc-20","op":"mint","tick":"ZERO","amt":"1000"}
OP_ENDIF
```

## Cost Structure

- **Inscription Output**: 10,000 zatoshis (0.0001 ZEC)
- **Transaction Fee**: 10,000 zatoshis (0.0001 ZEC)
- **Total**: ~0.0002 ZEC per inscription

## Security Considerations

✅ **Safe:**
- Private keys never leave the browser
- All signing happens client-side
- Convex only stores public data (addresses, txids, content previews)

⚠️ **Important:**
- Users must have ZEC in wallet (check balance before inscribing)
- Inscriptions are permanent and immutable
- No way to reverse or delete inscriptions

## Next Steps

1. **Deploy Convex**: Run `npx convex dev`
2. **Test Inscription**: Create a test inscription with small amount
3. **Verify Indexing**: Check if inscription appears on Zerdinals Explorer
4. **Monitor Logs**: Watch Convex dashboard for inscription tracking
5. **Add Error Handling**: Enhance UX for failed transactions

## Troubleshooting

### "Insufficient funds" error
- User doesn't have enough ZEC
- Need at least 0.0002 ZEC + existing balance

### "Failed to fetch UTXOs" error
- Zerdinals API might be down
- Address format might be incorrect

### "Failed to broadcast transaction" error
- Invalid transaction format
- Network issues
- UTXO already spent (stale data)

### Convex errors
- Run `npx convex dev` to deploy
- Check `.env.local` has `NEXT_PUBLIC_CONVEX_URL`
- Verify generated types exist in `convex/_generated/`
