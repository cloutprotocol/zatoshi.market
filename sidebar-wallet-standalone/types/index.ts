/**
 * Multi-Chain Wallet Adapter - TypeScript Definitions
 *
 * Enterprise-ready type definitions for Bitcoin, Ethereum, Base, Solana, and Zcash
 */

// ============================================================================
// Chain Configuration Types
// ============================================================================

export type ChainId = 'bitcoin' | 'ethereum' | 'base' | 'solana' | 'zcash';

export type AddressFormat = 'p2pkh' | 'p2wpkh' | 'ethereum' | 'solana' | 'zcash';

export interface ChainConfig {
  id: ChainId;
  name: string;
  symbol: string;
  coinType: number; // BIP44 coin type
  derivationPath: string; // BIP44 path template
  rpcUrl: string;
  explorerUrl: string;
  addressFormat: AddressFormat;
  features: {
    tokens: boolean;
    nfts: boolean;
    inscriptions: boolean;
  };
}

// ============================================================================
// Wallet & Account Types
// ============================================================================

export interface HDWallet {
  mnemonic: string; // BIP39 12 or 24 words
  seed: Uint8Array; // 512-bit seed
  masterKey: Uint8Array; // Master private key
  createdAt: number;
}

export interface Account {
  id: string; // Unique account ID
  chain: ChainId;
  accountIndex: number;
  address: string;
  publicKey: string;
  derivationPath: string;
  label?: string;
}

export interface WalletState {
  isLocked: boolean;
  hasKeystore: boolean;
  activeAccountId: string | null;
  accounts: Account[];
}

// ============================================================================
// Encryption Types
// ============================================================================

export interface EncryptedKeystore {
  version: 1;
  salt: string; // Base64 encoded
  iv: string; // Base64 encoded
  ciphertext: string; // Base64 encoded
  createdAt: number;
  lastUnlocked: number;
}

export interface KeystoreData {
  mnemonic: string;
  accounts: {
    chain: ChainId;
    accountIndex: number;
    label?: string;
  }[];
}

// ============================================================================
// Balance & Asset Types
// ============================================================================

export interface Balance {
  confirmed: number;
  unconfirmed: number;
  total: number;
  usdValue: number;
}

export interface Token {
  chain: ChainId;
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  usdValue: number;
  standard: 'ERC20' | 'SPL' | 'ZRC20' | 'BRC20';
}

export interface UTXO {
  txid: string;
  vout: number;
  value: number; // satoshis
  scriptPubKey: string;
  address: string;
  confirmations: number;
  isInscription?: boolean; // Ordinals/Zerdinals
}

export interface Inscription {
  id: string;
  contentType: string;
  contentPreview: string;
  contentSize: number;
  inscriptionNumber: number;
  location: string; // txid:vout
  chain: 'bitcoin' | 'zcash';
  standard: 'Ordinals' | 'Zerdinals';
}

// ============================================================================
// Transaction Types
// ============================================================================

export interface TransactionParams {
  from: string;
  to: string;
  amount: string;
  chain: ChainId;
  token?: string; // Contract address for token transfers
  data?: string; // Arbitrary data (for inscriptions, etc.)
  fee?: string; // Optional fee override
}

export interface PreparedTransaction {
  chain: ChainId;
  rawTx: string;
  fee: string;
  estimatedGas?: string;
  requiresPassword: boolean;
}

export interface SignedTransaction {
  chain: ChainId;
  signedTx: string;
  txHash: string;
}

export interface TransactionReceipt {
  txHash: string;
  chain: ChainId;
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber?: number;
  confirmations: number;
  fee: string;
  timestamp: number;
}

// ============================================================================
// Import/Export Types
// ============================================================================

export type ImportFormat = 'mnemonic12' | 'mnemonic24' | 'wif' | 'privateKeyHex';

export interface ImportOptions {
  format: ImportFormat;
  data: string;
  password: string;
  chain?: ChainId; // Required for single-key imports
  accountIndex?: number;
}

export interface ExportOptions {
  format: 'mnemonic' | 'privateKey';
  accountId?: string; // For single account export
  password: string;
}

export interface ExportResult {
  format: string;
  data: string;
  warning: string;
}

// ============================================================================
// Error Types
// ============================================================================

export class WalletError extends Error {
  constructor(
    message: string,
    public code: WalletErrorCode,
    public chain?: ChainId
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

export type WalletErrorCode =
  | 'INVALID_PASSWORD'
  | 'INVALID_MNEMONIC'
  | 'INVALID_PRIVATE_KEY'
  | 'WALLET_LOCKED'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_ADDRESS'
  | 'TRANSACTION_FAILED'
  | 'RPC_ERROR'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'DERIVATION_FAILED'
  | 'SIGNING_FAILED';

// ============================================================================
// UI Component Props
// ============================================================================

export interface WalletSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  desktopExpanded?: boolean;
  onDesktopExpandedChange?: (expanded: boolean) => void;
}

export interface AccountSelectorProps {
  accounts: Account[];
  activeAccountId: string | null;
  onAccountChange: (accountId: string) => void;
  onAddAccount: () => void;
}

export interface ChainSelectorProps {
  currentChain: ChainId;
  onChainChange: (chain: ChainId) => void;
}

export interface SendFormProps {
  account: Account;
  balance: Balance;
  onSend: (params: TransactionParams) => Promise<void>;
  onCancel: () => void;
}

// ============================================================================
// Context Types
// ============================================================================

export interface WalletContextValue {
  // State
  isLocked: boolean;
  hasKeystore: boolean;
  activeAccount: Account | null;
  accounts: Account[];
  balance: Balance | null;
  tokens: Token[];
  inscriptions: Inscription[];

  // Wallet Management
  createWallet: (password: string) => Promise<Account[]>;
  unlockWallet: (password: string) => Promise<boolean>;
  lockWallet: () => void;
  deleteWallet: () => void;

  // Account Management
  deriveAccount: (chain: ChainId, accountIndex?: number, label?: string) => Promise<Account>;
  switchAccount: (accountId: string) => void;
  renameAccount: (accountId: string, label: string) => void;

  // Import/Export
  importWallet: (options: ImportOptions) => Promise<Account[]>;
  exportMnemonic: (password: string) => Promise<string>;
  exportPrivateKey: (accountId: string, password: string) => Promise<string>;

  // Transactions
  sendTransaction: (params: TransactionParams) => Promise<TransactionReceipt>;

  // Data Refresh
  refreshBalance: () => Promise<void>;
  refreshTokens: () => Promise<void>;
  refreshInscriptions: () => Promise<void>;
}

// ============================================================================
// Chain-Specific Types
// ============================================================================

// Bitcoin
export interface BitcoinTxInput {
  txid: string;
  vout: number;
  value: number;
  scriptPubKey: string;
  sequence: number;
}

export interface BitcoinTxOutput {
  value: number;
  scriptPubKey: string;
  address: string;
}

// Ethereum/Base
export interface EvmTxParams {
  to: string;
  value: string;
  data?: string;
  gasLimit?: string;
  gasPrice?: string;
  nonce?: number;
}

// Solana
export interface SolanaTxParams {
  to: string;
  lamports: number;
  recentBlockhash: string;
}

// Zcash
export interface ZcashTxParams {
  inputs: BitcoinTxInput[];
  outputs: BitcoinTxOutput[];
  consensusBranchId: number;
  expiryHeight: number;
}
