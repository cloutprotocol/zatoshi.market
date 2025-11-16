# ZRC-20 CLI Implementation Strategy

This document outlines the comprehensive strategy for building a ZRC-20 CLI tool to interact with the Zerdinals protocol on Zcash.

## Overview

There are two main architectural paths for building ZRC-20 tooling:

1. **Path 1: Borrow Zerdinals' API** (Prototype Path)
2. **Path 2: Build Your Own Indexer** (Sovereign Path)

We recommend a **hybrid approach** that starts with Path 1 and evolves to Path 2.

## Path 1: Borrow Zerdinals' API (Prototype Path)

### Description
Build a lightweight client that depends on Zerdinals' infrastructure for indexing and transaction broadcasting.

### Pros
- **Fast Development**: Focus 100% on CLI UX and client-side transaction logic
- **Low Cost**: No need to run full node or manage database
- **Immediate Parity**: See the same protocol state as zerdinals.com
- **Reliable Infrastructure**: Leverage their tested, production indexer

### Cons
- **Centralized Dependency**: If zerdinals.com is down, CLI breaks
- **Rate Limiting**: Potential slowdowns for power users
- **Black Box**: Must trust their indexer is correct
- **Limited Queries**: Can't run custom queries their API doesn't support

### Implementation Plan

#### 1. API Client Layer

Create functions to call Zerdinals API endpoints:

```typescript
// Key endpoints to implement
GET /api/utxos/{address}           // Fetch available UTXOs
GET /api/balance/{address}/{tick}  // Get token balance
GET /api/tickers                   // List all ZRC20 tokens
POST /api/send-transaction         // Broadcast signed transaction
```

#### 2. Transaction Building Core

This is the **most critical component**. Must replicate the `Zk` and `bS` classes functionality:

**Required capabilities:**
- Fetch available UTXOs from API
- Construct new transaction with proper inputs/outputs
- Add ZRC-20 JSON payload as OP_RETURN output
- Sign transaction locally using user's private key
- Serialize signed transaction to raw hex format

**Example ZRC-20 payload structures:**

```json
// Deploy
{
  "p": "zrc-20",
  "op": "deploy",
  "tick": "TOKEN",
  "max": "21000000",
  "lim": "1000"
}

// Mint
{
  "p": "zrc-20",
  "op": "mint",
  "tick": "TOKEN",
  "amt": "1000"
}

// Transfer
{
  "p": "zrc-20",
  "op": "transfer",
  "tick": "TOKEN",
  "amt": "500"
}
```

#### 3. Wallet Management

**Security considerations:**
- Never transmit private keys over network
- Store keys encrypted locally
- Support HD wallet derivation
- Optional hardware wallet integration

**Key formats:**
- WIF (Wallet Import Format) for single keys
- Seed phrases for HD wallets
- Watch-only addresses for monitoring

#### 4. CLI Interface

Use a framework like **Commander.js** (Node) or **Click** (Python):

```bash
# Example commands
zrc20 deploy --tick TOKEN --max 21000000 --lim 1000
zrc20 mint --tick TOKEN --amt 1000
zrc20 transfer --tick TOKEN --amt 500 --to t1abc...
zrc20 balance --tick TOKEN
zrc20 list-tokens
```

#### 5. Recommended Libraries

**Node.js/TypeScript:**
- `@mayaprotocol/zcash-js` - Zcash primitives
- `commander` - CLI framework
- `bitcoinjs-lib` - Bitcoin-compatible transaction building (Zcash is a fork)
- `bip39` - Mnemonic seed phrases
- `hdkey` - HD wallet derivation

**Python:**
- `zcash-python` - Zcash library
- `click` - CLI framework
- `requests` - HTTP client for API calls
- `mnemonic` - BIP39 implementation

## Path 2: Build Your Own Indexer (Sovereign Path)

### Description
Build complete independent infrastructure by running your own Zcash node and indexing the blockchain.

### Pros
- **Full Control**: No dependency on external services
- **No Rate Limits**: Unlimited queries at your own speed
- **Customization**: Build any API you need
- **Contribution**: Could open-source or offer as public service

### Cons
- **Major Effort**: Significant engineering project
- **Infrastructure Cost**: Full node requires substantial storage/bandwidth
- **Complexity**: Must correctly parse and validate protocol rules
- **Maintenance**: 24/7 uptime responsibility

### Implementation Plan

#### 1. Run Zcash Full Node

**Setup `zcashd`:**

```bash
# Install zcashd
# Configure zcash.conf
rpcuser=yourusername
rpcpassword=yourpassword
txindex=1              # CRITICAL: Enable full transaction index
server=1
rpcallowip=127.0.0.1
```

**Requirements:**
- **Storage**: ~50GB+ for full blockchain
- **Bandwidth**: Continuous sync with network
- **RAM**: 4GB+ recommended
- **CPU**: Multi-core for verification

#### 2. Build Indexer Service

**Core responsibilities:**
- Connect to node via RPC or ZMQ
- Read every block and transaction
- Parse ZRC-20 JSON payloads from OP_RETURN
- Validate protocol rules (first-is-first for deploys, etc.)
- Maintain state database

**Protocol parsing logic:**

```typescript
// Pseudocode for indexer
for each block in blockchain:
  for each transaction in block:
    for each output in transaction:
      if output is OP_RETURN:
        try:
          payload = JSON.parse(output.data)
          if payload.p === "zrc-20":
            switch payload.op:
              case "deploy":
                validateDeploy(payload)
                createToken(payload)
              case "mint":
                validateMint(payload)
                incrementBalance(payload)
              case "transfer":
                validateTransfer(payload)
                updateBalances(payload)
```

**State tracking:**
```sql
-- Example database schema
CREATE TABLE tokens (
  tick VARCHAR(10) PRIMARY KEY,
  max_supply BIGINT,
  mint_limit BIGINT,
  total_minted BIGINT,
  deployer VARCHAR(100),
  deploy_block INT
);

CREATE TABLE balances (
  address VARCHAR(100),
  tick VARCHAR(10),
  balance BIGINT,
  PRIMARY KEY (address, tick)
);

CREATE TABLE inscriptions (
  tx_hash VARCHAR(100) PRIMARY KEY,
  block_height INT,
  operation VARCHAR(20),
  payload JSONB,
  timestamp TIMESTAMP
);
```

#### 3. Build API Server

Create REST API that mirrors Zerdinals endpoints:

```typescript
// Express.js example routes
app.get('/api/utxos/:address', async (req, res) => {
  const utxos = await getUTXOsFromNode(req.params.address);
  res.json(utxos);
});

app.get('/api/balance/:address/:tick', async (req, res) => {
  const balance = await db.query(
    'SELECT balance FROM balances WHERE address = ? AND tick = ?',
    [req.params.address, req.params.tick]
  );
  res.json({ balance: balance.rows[0]?.balance || 0 });
});

app.post('/api/send-transaction', async (req, res) => {
  const { rawtx } = req.body;
  const txid = await broadcastToNode(rawtx);
  res.json({ txid });
});
```

#### 4. Reference Implementations

Look at existing Zcash indexers:
- **Zingolabs/zaino** - Modern Zcash indexer
- **Insight API** - Block explorer indexer
- **Electrum Server** - Lightweight indexer for SPV

## Hybrid Approach: Recommended Strategy

### Timeline

**Month 1-2: Phase 1 - Prototype CLI**
- Build CLI using Zerdinals API
- Perfect transaction building/signing logic
- Release v0.1 for community testing
- Gather feedback and iterate

**Month 3-6: Phase 2 - Infrastructure**
- Set up Zcash full node
- Build indexer service
- Create PostgreSQL database
- Develop internal API

**Month 7+: Phase 3 - Migration**
- Run both systems in parallel
- Validate indexer accuracy
- Switch CLI to self-hosted API
- Open-source indexer

### Why This Works

1. **Derisked**: Get working tool to market quickly
2. **Learning**: Understand protocol deeply before building indexer
3. **Validation**: Test assumptions with real usage
4. **Incremental**: Each phase delivers value independently

## Transaction Building Deep Dive

This is the heart of any ZRC-20 tool. Here's detailed pseudocode:

```typescript
async function buildZRC20Transaction(
  operation: 'deploy' | 'mint' | 'transfer',
  payload: any,
  privateKey: string
): Promise<string> {

  // 1. Fetch UTXOs
  const utxos = await fetchUTXOs(getAddress(privateKey));

  // 2. Create transaction builder
  const tx = new TransactionBuilder();

  // 3. Add inputs (select UTXOs with enough value for fees)
  let inputValue = 0;
  for (const utxo of utxos) {
    tx.addInput(utxo.txid, utxo.vout);
    inputValue += utxo.value;
    if (inputValue > FEE_REQUIRED) break;
  }

  // 4. Create ZRC-20 OP_RETURN output
  const zrc20Data = Buffer.from(JSON.stringify(payload), 'utf8');
  const opReturnScript = bitcoin.script.compile([
    bitcoin.opcodes.OP_RETURN,
    zrc20Data
  ]);
  tx.addOutput(opReturnScript, 0); // 0 value for OP_RETURN

  // 5. Add change output
  const changeValue = inputValue - FEE;
  tx.addOutput(getAddress(privateKey), changeValue);

  // 6. Sign all inputs
  for (let i = 0; i < utxos.length; i++) {
    tx.sign(i, privateKey);
  }

  // 7. Build and serialize
  const rawTx = tx.build().toHex();

  return rawTx;
}
```

## Security Considerations

### Private Key Management
- **Never log private keys**
- Encrypt keys at rest with user password
- Support hardware wallets (Ledger, Trezor)
- Implement key derivation for HD wallets

### Transaction Validation
- Verify all UTXOs before signing
- Check fee calculation (avoid overpaying)
- Validate recipient addresses
- Double-check amounts before broadcast

### API Security
- Use HTTPS for all API calls
- Validate API responses
- Implement request signing for self-hosted API
- Rate limit to prevent abuse

## Testing Strategy

### Unit Tests
- Transaction building logic
- Payload validation
- UTXO selection algorithms
- Cryptographic functions

### Integration Tests
- End-to-end transaction flow
- API client error handling
- Database state consistency
- Node communication

### Test Networks
- Use Zcash testnet for development
- Create test tokens for validation
- Simulate various scenarios:
  - Insufficient funds
  - Double-spend attempts
  - Invalid payloads
  - Network failures

## Next Steps

1. **Set up development environment**
   - Install Node.js/TypeScript or Python
   - Configure Zcash testnet node
   - Set up testing framework

2. **Start with transaction building**
   - Implement UTXO fetching
   - Create basic transaction builder
   - Add signing capability
   - Test with simple transfers

3. **Build CLI interface**
   - Implement command structure
   - Add wallet commands
   - Create ZRC-20 operations
   - Polish UX

4. **Deploy and iterate**
   - Release alpha to small group
   - Gather feedback
   - Fix bugs
   - Add features

## Resources

- [Zcash Protocol Specification](https://zips.z.cash/)
- [Bitcoin Transaction Structure](https://en.bitcoin.it/wiki/Transaction)
- [BIP39 Mnemonic Codes](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)
- [Zerdinals Documentation](https://docs.zerdinals.com)

---

This strategy balances speed to market with long-term sovereignty. Start simple, validate early, then build toward independence.
