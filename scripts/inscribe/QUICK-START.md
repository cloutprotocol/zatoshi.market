# Quick Start Guide

## TL;DR - Create Your First Inscription

```bash
cd /Users/cloutcoin/GitHub/zatoshi.market

# 1. Start dev server (terminal 1)
npm run dev

# 2. Test inscription (terminal 2)
./scripts/inscribe/run-with-env.sh scripts/inscribe/inscribe.ts \
  YOUR_T_ADDRESS "Hello Zcash!" YOUR_PRIVATE_KEY_WIF
```

## Files You Need

| File | Purpose | When to Use |
|------|---------|-------------|
| **inscribe.ts** | Main tool (uses your API) | ✅ Recommended - requires dev server |
| **inscribe-working.ts** | Standalone (uses public APIs) | Alternative - no server needed |
| **test-tatum-rpc.ts** | Test Tatum connection | Debugging |

## Commands

### Test Tatum Connection
```bash
./scripts/inscribe/run-with-env.sh scripts/inscribe/test-tatum-rpc.ts
```

### Preview Inscription (No Broadcast)
```bash
./scripts/inscribe/run-with-env.sh scripts/inscribe/inscribe.ts \
  t1YourAddress "Your content here"
```

### Create Inscription (With Broadcast)
```bash
./scripts/inscribe/run-with-env.sh scripts/inscribe/inscribe.ts \
  t1YourAddress "Your content here" YourPrivateKeyWIF
```

### Custom Protocol
```bash
./scripts/inscribe/run-with-env.sh scripts/inscribe/inscribe.ts \
  t1YourAddress '{"p":"zrc-20","op":"mint"}' YourPrivateKey "zrc20"
```

## What You Need

1. ✅ Tatum API key (already in .env.local)
2. ✅ Zcash address with funds (>0.0001 ZEC)
3. ✅ Private key in WIF format (starts with L, K, or 5)
4. ✅ Dev server running (for inscribe.ts) or use inscribe-working.ts

## Expected Output

```
┌─────────────────────────────────────┐
│   Zcash Inscription Tool v1.0      │
└─────────────────────────────────────┘

📦 Step 1: Fetching UTXOs
   Address: t1ABC...
   ✅ Found 3 UTXO(s)
   Total: 0.01000000 ZEC (1,000,000 zatoshis)

📝 Step 2: Creating inscription
   Protocol: zerd
   Content: "Hello Zcash!"
   Size: 19 bytes

🔨 Step 3: Building transaction
   Input: 0.01000000 ZEC
   Fee: 0.00010000 ZEC
   Change: 0.00990000 ZEC

✍️  Step 4: Signing transaction
   ✅ Signed (354 bytes)

📡 Step 5: Broadcasting transaction

┌─────────────────────────────────────┐
│          ✅ SUCCESS!                │
└─────────────────────────────────────┘

Transaction ID:
abc123def456...

View inscription:
• https://zcashblockexplorer.com/transactions/abc123...
• https://zerdinals.com/inscription/abc123...
```

## Costs

- Fee: ~0.0001 ZEC per inscription
- At $50/ZEC: $0.005
- At $100/ZEC: $0.01

## Troubleshooting

| Error | Solution |
|-------|----------|
| "TATUM_API_KEY not set" | Use `run-with-env.sh` script |
| "No UTXOs found" | Address needs funds (>0.0001 ZEC) |
| "Could not fetch UTXOs" | Start dev server OR use `inscribe-working.ts` |
| "Insufficient funds" | Need at least 0.0001 ZEC for fee |

## Next Steps

1. **Test it**: Create a test inscription
2. **Integrate**: Add to your API (`/api/zcash/inscribe`)
3. **UI**: Add inscription creation to wallet page
4. **Features**: Batch inscriptions, templates, gallery

## Documentation

- 📖 Full docs: `README.md`
- 📊 Architecture: `SUMMARY.md`
- 🔧 This file: Quick reference

## Security

⚠️ **NEVER** commit private keys!
- Keys stay in `.env.local` (gitignored)
- Test with small amounts first
- For production API: Sign client-side, broadcast server-side
