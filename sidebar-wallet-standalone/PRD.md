# Enterprise Multi-Chain Wallet Adapter - Product Requirements Document

## Executive Summary

This document outlines the architecture, security best practices, and implementation details for an enterprise-ready, multi-chain wallet adapter with sidebar UI. This standalone component is designed to be integrated into Convex-native web applications.

## Audit Findings from zatoshi.market Implementation

### Current Architecture Strengths

#### 1. **Cryptographic Foundation** ✅
- **Library Selection**: Uses modern, audited libraries
  - `@scure/bip39`: BIP39 mnemonic generation (128-bit entropy for 12 words)
  - `@noble/secp256k1`: ECDSA signing (secp256k1 curve)
  - `@noble/hashes`: Browser-safe hashing (SHA-256, RIPEMD-160, BLAKE2b)
  - No dependency on Node.js crypto - fully browser-compatible

#### 2. **Key Storage & Encryption** ✅
- **Web Crypto API**: Industry-standard AES-256-GCM encryption
- **Key Derivation**: PBKDF2 with 250,000 iterations (OWASP recommended)
- **Salt & IV**: Randomly generated per encryption (16-byte salt, 12-byte IV)
- **Storage Strategy**:
  - Encrypted keystore → localStorage (persistent)
  - Unlocked wallet → sessionStorage (session-only)
  - Mnemonic → NOT stored in encrypted keystore (security measure)

#### 3. **State Management** ✅
- Three-state system: `disconnected` → `locked` → `unlocked`
- Session restoration on page refresh
- Legacy migration support for plaintext wallets
- Clear separation between in-memory and persistent storage

#### 4. **UI/UX Pattern** ✅
- Mobile-first responsive design
- Bottom sheet (mobile) / Right sidebar (desktop)
- Drag-to-close gesture on mobile
- Tab system for different asset types
- QR code generation for receiving
- Clear export workflows with security warnings

### Security Vulnerabilities Identified

#### 1. **Mnemonic Not Persisted** ⚠️
- Current: Mnemonic not saved in encrypted keystore
- Impact: Users lose mnemonic if they don't back it up during creation
- **Recommendation**: Store encrypted mnemonic with clear "backup now" UX flow

#### 2. **No BIP32/BIP44 Derivation** ⚠️
- Current: Simple derivation (first 32 bytes of seed + fallback counter)
- Impact: Not compatible with standard HD wallet paths
- **Recommendation**: Implement proper BIP44 derivation paths for each chain

#### 3. **Session Storage Exposure** ⚠️
- Current: Unlocked wallet stored in plaintext in sessionStorage
- Impact: Private keys accessible via XSS or browser extensions
- **Recommendation**: Keep unlocked wallet only in memory (React state)

#### 4. **No Transaction Signing Isolation** ⚠️
- Current: Private key passed directly to signing functions
- Impact: Private key exposed in multiple function scopes
- **Recommendation**: Create signing service with minimal exposure

#### 5. **No Multi-Account Support** ⚠️
- Current: Single account per wallet
- Impact: Users need multiple wallets for multiple accounts
- **Recommendation**: Implement BIP44 account derivation

## Enterprise-Ready Improvements

### 1. **Hierarchical Deterministic (HD) Wallets**
```
BIP32/BIP44 Derivation Path Structure:
m / purpose' / coin_type' / account' / change / address_index

Bitcoin:   m/44'/0'/0'/0/0
Ethereum:  m/44'/60'/0'/0/0
Solana:    m/44'/501'/0'/0'
Zcash:     m/44'/133'/0'/0/0
Base:      m/44'/60'/0'/0/0 (same as Ethereum)
```

### 2. **Enhanced Security Model**

#### Storage Layers:
1. **Encrypted Master Seed** (localStorage)
   - AES-256-GCM encrypted seed + mnemonic
   - PBKDF2 with 250,000+ iterations
   - Per-user salt and IV

2. **Derived Keys** (memory only)
   - Never persisted to any storage
   - Derived on-demand from encrypted seed
   - Cleared on lock/disconnect

3. **Session State** (React Context)
   - Account selection
   - Active chain
   - UI preferences
   - NO private keys or seeds

#### Transaction Signing Flow:
```
1. User initiates transaction
2. UI prompts for password (if locked)
3. Decrypt master seed in isolated scope
4. Derive private key for active account
5. Sign transaction
6. Clear all sensitive data from memory
7. Return signed transaction
```

### 3. **Multi-Chain Support Architecture**

#### Chain Configuration:
```typescript
interface ChainConfig {
  id: string;
  name: string;
  symbol: string;
  coinType: number; // BIP44 coin type
  derivationPath: string;
  rpcUrl: string;
  explorerUrl: string;
  addressFormat: 'p2pkh' | 'bech32' | 'ethereum' | 'solana';
  features: {
    tokens: boolean;
    nfts: boolean;
    inscriptions: boolean;
  };
}
```

#### Supported Chains:
1. **Bitcoin** (BIP44: 0)
   - P2PKH addresses
   - Ordinals/BRC-20 support
   - UTXO management

2. **Ethereum** (BIP44: 60)
   - ERC-20 tokens
   - ERC-721/1155 NFTs
   - Account model

3. **Base** (BIP44: 60)
   - Same as Ethereum (EVM-compatible)
   - ERC-20 tokens

4. **Solana** (BIP44: 501)
   - SPL tokens
   - Native programs
   - Ed25519 signatures

5. **Zcash** (BIP44: 133)
   - T-addresses (transparent)
   - ZRC-20 tokens
   - Zerdinals inscriptions
   - ZIP-243 signatures

### 4. **Token Standards Support**

| Chain | Standard | Support |
|-------|----------|---------|
| Bitcoin | Ordinals | ✅ Inscription protocol |
| Bitcoin | BRC-20 | ✅ Token inscriptions |
| Ethereum | ERC-20 | ✅ Standard tokens |
| Ethereum | ERC-721 | ✅ NFTs |
| Base | ERC-20 | ✅ Standard tokens |
| Solana | SPL | ✅ Token program |
| Zcash | ZRC-20 | ✅ Inscription tokens |

### 5. **Import/Export Formats**

#### Supported Import Methods:
1. **12-Word Mnemonic** (BIP39)
   - Standard for all chains
   - Generates master seed

2. **24-Word Mnemonic** (BIP39)
   - Higher entropy option

3. **Private Key (WIF)** - UTXO chains only
   - Bitcoin, Zcash
   - Single-address import (no HD derivation)

4. **Private Key (Hex)** - Account chains
   - Ethereum, Base, Solana
   - Single-account import

#### Export Options:
1. **Mnemonic Phrase**
   - Full wallet backup
   - All chains recoverable

2. **Individual Private Keys**
   - Per-account export
   - WIF for UTXO chains
   - Hex for account chains

3. **Account Descriptor** (Advanced)
   - Master public key + derivation paths
   - Watch-only mode

## Security Best Practices Implementation

### 1. **Encryption Standards**
```typescript
// AES-256-GCM Configuration
{
  algorithm: 'AES-GCM',
  keyLength: 256,
  ivLength: 12,  // 96 bits for GCM
  tagLength: 128 // 128-bit authentication tag
}

// PBKDF2 Configuration
{
  algorithm: 'PBKDF2',
  hash: 'SHA-256',
  iterations: 310_000, // 2025 OWASP recommendation
  saltLength: 16,      // 128 bits
  keyLength: 32        // 256 bits
}
```

### 2. **Password Requirements**
- Minimum length: 12 characters (up from 8)
- Recommended: Password manager generated
- Optional: Zxcvbn strength meter
- Rate limiting: Lock after 5 failed attempts

### 3. **Memory Management**
```typescript
// Clear sensitive data after use
function clearSensitiveData(data: Uint8Array | string) {
  if (data instanceof Uint8Array) {
    crypto.getRandomValues(data); // Overwrite with random data
  }
  // Note: Can't fully zero strings in JS, rely on GC
}
```

### 4. **XSS Protection**
- Content Security Policy (CSP)
- Sanitize all user inputs
- No eval() or Function() constructor
- No inline scripts

### 5. **CSRF Protection**
- SameSite cookies
- Origin verification
- No sensitive data in URL params

## API Design

### Core Wallet Interface
```typescript
interface MultiChainWallet {
  // Lifecycle
  create(password: string): Promise<WalletData>;
  unlock(password: string): Promise<boolean>;
  lock(): void;

  // Account management
  deriveAccount(chain: ChainId, accountIndex: number): Account;
  getActiveAccount(): Account;
  switchAccount(accountId: string): void;

  // Import/Export
  importMnemonic(phrase: string, password: string): Promise<WalletData>;
  importPrivateKey(key: string, chain: ChainId, password: string): Promise<Account>;
  exportMnemonic(password: string): Promise<string>;
  exportPrivateKey(accountId: string, password: string): Promise<string>;

  // Balance & Assets
  getBalance(accountId: string): Promise<Balance>;
  getTokens(accountId: string): Promise<Token[]>;
  getInscriptions(accountId: string): Promise<Inscription[]>;

  // Transactions
  prepareTransaction(params: TxParams): Promise<PreparedTx>;
  signTransaction(preparedTx: PreparedTx, password?: string): Promise<SignedTx>;
  broadcastTransaction(signedTx: SignedTx): Promise<TxReceipt>;
}
```

### Convex Integration Schema
```typescript
// Wallet state (encrypted)
wallets: defineTable({
  userId: v.string(),
  encryptedSeed: v.string(),
  salt: v.string(),
  iv: v.string(),
  createdAt: v.number(),
  lastUnlocked: v.number(),
})

// Derived accounts (public data only)
accounts: defineTable({
  walletId: v.id("wallets"),
  chain: v.string(),
  accountIndex: v.number(),
  address: v.string(),
  publicKey: v.string(),
  derivationPath: v.string(),
  label: v.optional(v.string()),
  createdAt: v.number(),
})

// Transaction history
transactions: defineTable({
  accountId: v.id("accounts"),
  txHash: v.string(),
  chain: v.string(),
  type: v.string(),
  status: v.string(),
  amount: v.string(),
  fee: v.string(),
  timestamp: v.number(),
})

// Token balances cache
tokenBalances: defineTable({
  accountId: v.id("accounts"),
  contractAddress: v.string(),
  symbol: v.string(),
  balance: v.string(),
  decimals: v.number(),
  lastUpdated: v.number(),
})
```

## UI Component Structure

```
sidebar-wallet-standalone/
├── lib/
│   ├── crypto/
│   │   ├── encryption.ts        # AES-256-GCM encryption
│   │   ├── derivation.ts        # BIP32/BIP44 HD derivation
│   │   └── signing.ts           # Chain-specific signing
│   ├── chains/
│   │   ├── bitcoin.ts           # Bitcoin + Ordinals
│   │   ├── ethereum.ts          # Ethereum + ERC-20
│   │   ├── base.ts              # Base + ERC-20
│   │   ├── solana.ts            # Solana + SPL
│   │   └── zcash.ts             # Zcash + ZRC-20
│   ├── storage/
│   │   ├── keystore.ts          # Encrypted storage
│   │   └── session.ts           # Session state
│   └── utils/
│       ├── validation.ts        # Input validation
│       └── formatting.ts        # Address/amount formatting
├── components/
│   ├── WalletSidebar.tsx        # Main sidebar component
│   ├── AccountSelector.tsx      # Multi-account dropdown
│   ├── ChainSelector.tsx        # Chain switcher
│   ├── BalanceDisplay.tsx       # Balance + USD value
│   ├── TokenList.tsx            # Token holdings list
│   ├── InscriptionGrid.tsx      # Inscription/NFT grid
│   ├── SendForm.tsx             # Send transaction form
│   ├── ReceiveModal.tsx         # Receive with QR code
│   └── SettingsPanel.tsx        # Wallet settings
├── context/
│   └── WalletContext.tsx        # React context provider
├── convex/
│   ├── schema.ts                # Convex schema
│   ├── walletActions.ts         # Server actions
│   └── balanceQueries.ts        # Balance queries
├── styles/
│   └── wallet.css               # Raw CSS (no Tailwind)
└── types/
    └── index.ts                 # TypeScript definitions
```

## Migration Path

### For Existing Users:
1. Detect existing zatoshi.market wallet
2. Prompt for password
3. Export mnemonic from old wallet
4. Import into new HD wallet structure
5. Derive legacy address as account 0
6. Verify balance matches
7. Delete old wallet

### For New Users:
1. Generate HD wallet from scratch
2. Display mnemonic backup
3. Require confirmation before proceeding
4. Encrypt and store master seed
5. Derive default accounts for all chains

## Performance Considerations

### 1. **Lazy Loading**
- Only load chain libraries when needed
- Code split by chain
- Async imports for heavy dependencies

### 2. **Caching Strategy**
- Balance: 30-second cache
- Token list: 5-minute cache
- Transaction history: 10-minute cache
- Force refresh on user action

### 3. **RPC Optimization**
- Batch requests where possible
- QuickNode for primary RPCs
- Fallback to public RPCs
- Rate limit awareness

## Testing Requirements

### Unit Tests:
- [ ] Mnemonic generation (BIP39)
- [ ] HD derivation (BIP32/BIP44)
- [ ] Encryption/decryption (AES-256-GCM)
- [ ] Address generation (all chains)
- [ ] Transaction signing (all chains)
- [ ] WIF import/export
- [ ] Private key import/export

### Integration Tests:
- [ ] Create → Lock → Unlock flow
- [ ] Import mnemonic → Derive accounts
- [ ] Send transaction (testnet)
- [ ] Token balance fetch
- [ ] Multi-chain switching

### Security Tests:
- [ ] Brute force password attempts
- [ ] Invalid mnemonic handling
- [ ] Malformed transaction rejection
- [ ] XSS prevention
- [ ] Memory leak detection

## Compliance & Legal

### MIT License Requirements:
- ✅ Permission for commercial use
- ✅ Permission for modification
- ✅ Permission for distribution
- ✅ No warranty disclaimer
- ✅ Copyright notice preservation

### User Warnings:
```
⚠️ NON-CUSTODIAL WALLET NOTICE
- You are solely responsible for your private keys
- Loss of mnemonic = permanent loss of funds
- No password recovery mechanism exists
- This software is provided "as is" without warranty
```

## Deliverables Checklist

- [ ] PRD documentation (this file)
- [ ] Wallet audit report
- [ ] Core crypto libraries implementation
- [ ] Multi-chain support (Bitcoin, Ethereum, Base, Solana, Zcash)
- [ ] Sidebar UI component (responsive, raw CSS)
- [ ] Convex schema definition
- [ ] Server actions for wallet operations
- [ ] Import/export functionality (mnemonic + WIF)
- [ ] Token balance calculation
- [ ] Inscription/Ordinals support
- [ ] Unit test suite
- [ ] Integration test examples
- [ ] Migration guide from existing wallet
- [ ] Developer documentation
- [ ] Example integration project

## Timeline Estimate

| Phase | Duration | Tasks |
|-------|----------|-------|
| Phase 1 | 2 hours | Core crypto + HD derivation |
| Phase 2 | 3 hours | Chain implementations (5 chains) |
| Phase 3 | 2 hours | Sidebar UI components |
| Phase 4 | 1 hour | Convex integration |
| Phase 5 | 2 hours | Testing + documentation |
| **Total** | **10 hours** | Complete implementation |

## Success Metrics

- ✅ 100% BIP39/BIP44 compatibility
- ✅ Sub-100ms encryption/decryption
- ✅ < 500KB bundle size (per chain)
- ✅ Zero security vulnerabilities
- ✅ Mobile-responsive UI (< 400px width)
- ✅ 95%+ test coverage
- ✅ Clear migration path from legacy wallet

---

**Document Version**: 1.0
**Last Updated**: 2025-01-17
**Author**: Claude Code (Anthropic)
**Review Status**: Ready for Implementation
