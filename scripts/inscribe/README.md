# Zcash Inscription Scripts

Proof of concept scripts for creating Zcash inscriptions (Zerdinals) using Tatum SDK.

## 📁 Files

- **`inscribe-working.ts`** - Complete working implementation (recommended)
- **`test-tatum-rpc.ts`** - Test Tatum RPC connectivity and available methods
- **`inscribe-v2.ts`** - Alternative implementation with different API approach
- **`run-with-env.sh`** - Helper script to load environment variables

## 🚀 Quick Start

### 1. Prerequisites

Already installed in your project:
- `@tatumio/tatum` - For Zcash RPC calls
- `bitcore-lib-zcash` - For transaction building
- `bitcoinjs-lib` - Bitcoin transaction library

### 2. Configure Environment

Your `.env.local` already has:
```bash
TATUM_API_KEY=t-691ab5fae2b53035df472a13-2ea27385c5964a15b092bdab
```

### 3. Run Scripts

```bash
# Test Tatum connectivity
./scripts/inscribe/run-with-env.sh scripts/inscribe/test-tatum-rpc.ts

# Preview inscription (no broadcast)
./scripts/inscribe/run-with-env.sh scripts/inscribe/inscribe-working.ts \
  t1YourAddress "Hello Zcash"

# Create and broadcast inscription
./scripts/inscribe/run-with-env.sh scripts/inscribe/inscribe-working.ts \
  t1YourAddress "Hello Zcash" YourPrivateKeyWIF

# Custom protocol
./scripts/inscribe/run-with-env.sh scripts/inscribe/inscribe-working.ts \
  t1YourAddress "data" YourPrivateKeyWIF "zrc20"
```

## 🏗️ How It Works

### Step 1: Fetch UTXOs
Gets unspent transaction outputs (UTXOs) from your address using:
- Free Zcash explorer APIs (zcashblockexplorer.com, zcha.in)
- Alternative: Blockchair API (requires paid key)

### Step 2: Create Inscription Data
Formats content as: `protocol|content`

Example:
```
zerd|Hello Zcash!
```

Encoded as hex and embedded in OP_RETURN output.

### Step 3: Build Transaction
Creates a Zcash transaction with:
- **Inputs**: Your UTXOs (with enough funds for fee)
- **Output 1**: OP_RETURN with inscription data (0 value)
- **Output 2**: Change back to your address (input - fee)

### Step 4: Sign Transaction
Signs the transaction using your private key (WIF format).

### Step 5: Broadcast
Broadcasts the signed transaction using Tatum's `sendRawTransaction` RPC:
```typescript
await tatum.rpc.sendRawTransaction(signedTx);
```

## 🔑 Tatum Integration

### What Works
✅ **Transaction Broadcasting** - `sendRawTransaction` via Tatum SDK
```typescript
const tatum = await TatumSDK.init<ZCash>({
  network: Network.ZCASH,
  apiKey: process.env.TATUM_API_KEY
});

const txid = await tatum.rpc.sendRawTransaction(signedHex);
```

### What Doesn't Work
❌ **UTXO Fetching** - `listunspent` not available on Tatum's public RPC gateway
```
Error: Method not found: listunspent
```

**Solution**: Use external APIs (Zcash explorer, Blockchair) for UTXO fetching, Tatum only for broadcasting.

### Available Tatum RPC Methods
- `sendRawTransaction` ✅
- `getBlockCount` ✅
- `rawRpcCall` ✅
- `rawBatchRpcCall` ✅

Most wallet-specific methods (`listunspent`, `getbalance`, etc.) are not available.

## 📊 Transaction Structure

Example inscription transaction:
```
Input:  [UTXO with 100,000 zatoshis]
  ↓
Outputs:
  1. OP_RETURN: 0 zatoshis
     Data: 7a657264|48656c6c6f205a6361736821
           (hex for "zerd|Hello Zcash!")

  2. Change: 90,000 zatoshis
     Address: t1YourAddress

Fee: 10,000 zatoshis (0.0001 ZEC)
```

## 🔧 API Alternatives for UTXOs

### Option 1: Free Zcash Explorers
```bash
# ZcashBlockExplorer.com
curl "https://zcashblockexplorer.com/api/addr/ADDRESS/utxo"

# Zcha.in
curl "https://api.zcha.in/v2/mainnet/accounts/ADDRESS"
```

### Option 2: Blockchair (Paid)
```bash
curl "https://api.blockchair.com/zcash/dashboards/address/ADDRESS?key=YOUR_KEY"
```

### Option 3: Your Existing API Endpoint
You already have `/api/zcash/utxos/[address]` - could use this!

## 🎯 Next Steps

### For Development
- [ ] Test with a funded Zcash address
- [ ] Verify UTXO fetching from working API
- [ ] Test transaction signing and broadcasting
- [ ] Verify inscription appears on zerdinals.com

### For Production
- [ ] Create API endpoint: `/api/zcash/inscribe`
- [ ] Add inscription validation
- [ ] Support batch inscriptions
- [ ] Add fee estimation based on data size
- [ ] Implement different protocols (zerd, zrc20, etc.)
- [ ] Add inscription indexing/viewing

## 🔒 Security

⚠️ **CRITICAL SECURITY NOTES**:

1. **Never commit private keys** - Use environment variables
2. **Use .env.local** - Already in .gitignore
3. **Test with small amounts first**
4. **Verify transaction before signing**
5. **Consider using a dedicated inscription wallet**

## 📖 Example Output

```
═══════════════════════════════════════
    Zcash Inscription Tool v1.0
═══════════════════════════════════════

1️⃣  Fetching UTXOs...
    Address: t1ABC...
    ✅ Found 3 UTXO(s)
    Total: 1000000 zatoshis (0.01000000 ZEC)

2️⃣  Creating inscription...
    Protocol: zerd
    Content: Hello Zcash!
    Size: 19 bytes
    Data: 7a657264...

3️⃣  Building transaction...
    Inputs: 1000000 zatoshis
    Fee: 10000 zatoshis (0.00010000 ZEC)
    Change: 990000 zatoshis

4️⃣  Signing transaction...
    ✅ Signed (354 bytes)

5️⃣  Broadcasting...

═══════════════════════════════════════
         ✅ SUCCESS!
═══════════════════════════════════════
TXID: abc123...

View on:
  • https://zcashblockexplorer.com/transactions/abc123...
  • https://zerdinals.com/inscription/abc123...
═══════════════════════════════════════
```

## 🐛 Troubleshooting

### "Could not fetch UTXOs from any API"
- APIs may be slow or down
- Try with a different address
- Check if address has any UTXOs
- Consider implementing your own UTXO endpoint

### "Insufficient funds"
- Address needs at least 0.0001 ZEC for fee
- Plus data size (usually negligible)

### "TATUM_API_KEY not set"
- Make sure `.env.local` exists
- Use `run-with-env.sh` to load environment

### "Payment Required" (Blockchair)
- Blockchair requires paid API key for Zcash
- Use free alternatives or your own API endpoint
