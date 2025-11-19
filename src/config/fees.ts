/**
 * Platform Fee Configuration
 * All fees in zatoshis (1 ZEC = 100,000,000 zatoshis)
 */

export const PLATFORM_FEES = {
  // ZMAP Creation Fee
  ZMAP_CREATION: 150000, // 0.0015 ZEC (~$1.05 @ $700/ZEC)

  // Name Registration Fee (.zec, .zcash)
  NAME_REGISTRATION: 100000, // 0.0010 ZEC

  // General Inscription/Mint Fee
  INSCRIPTION: 100000, // 0.0010 ZEC

  // Network fees (estimated, user pays actual)
  NETWORK_FEE_ESTIMATE: 10000, // 0.0001 ZEC

  // Inscription output value: must be > DUST_LIMIT
  // Minimum relayable output is 546 zats (DUST_LIMIT)
  // We make it 10000 for a small buffer
  INSCRIPTION_OUTPUT: 10000, // 0.0001 ZEC
} as const;

export const FEE_FLOOR_ZATS = 50000; // Minimum network fee (ZIP-317 enforced)
export const NETWORK_FEE_UNIT_ZATS_PER_BYTE = 10; // 10 zats/byte for mempool acceptance

export const DUST_LIMIT = 546; // Minimum relayable output for P2PKH
export const INSCRIPTION_MIN_OUTPUT_ZATS = DUST_LIMIT + 1; // Minimum to be considered non-dust

/**
 * Treasury wallet address for platform fees
 * TODO: Set this to your actual treasury address
 */
import { TREASURY_ADDRESS, PLATFORM_FEE_ZATS } from './treasury.config';

// Re-export for convenience
export { PLATFORM_FEE_ZATS };

export const TREASURY_WALLET = {
  address: TREASURY_ADDRESS,
  isDev: process.env.NODE_ENV === 'development',
} as const;


/**
 * Fee calculation helpers
 */
export const calculateTotalCost = (platformFee: number, contentSizeBytes: number = 0): {
  platformFee: number;
  networkFee: number;
  inscriptionOutput: number;
  total: number;
} => {
  // Base tx overhead: ~500 bytes (version, inputs, outputs, etc.)
  // Inscription data: contentSizeBytes (0 for names/ZRC20 without explicit content)
  // Witness/script overhead: ~200 bytes (for a typical 1-input, 2-output P2PKH tx)
  const estimatedTxSize = 500 + contentSizeBytes + 200;

  // ZIP-317 based fee calculation
  const calculatedFee = Math.ceil(estimatedTxSize * NETWORK_FEE_UNIT_ZATS_PER_BYTE);

  const ZIP_317_CAP = 100000;
  const networkFee = Math.min(Math.max(calculatedFee, FEE_FLOOR_ZATS), ZIP_317_CAP);

  const inscriptionOutput = networkFee + INSCRIPTION_MIN_OUTPUT_ZATS;

  return {
    platformFee,
    networkFee,
    inscriptionOutput,
    total: platformFee + networkFee + inscriptionOutput,
  };
};

/**
 * Maximum file size for image inscriptions (in bytes)
 * Content is automatically chunked into 520-byte pieces (MAX_SCRIPT_ELEMENT_SIZE)
 * Limited by total scriptSig size (~10KB) and practical mempool relay limits
 * Set to 50KB for balance between usability and reliability
 */
export const MAX_IMAGE_SIZE_BYTES = 50 * 1024; // 50KB
export const MAX_IMAGE_SIZE_KB = 50;

/**
 * File size threshold for showing "large file" warning (in KB)
 * Warning shown when file exceeds this size
 */
export const LARGE_FILE_WARNING_KB = 30;

/**
 * Calculate fees for image inscriptions based on file size
 * Implements ZIP-317 fee calculation with minimum floor
 *
 * @param fileSizeBytes - Size of the image file in bytes
 * @returns Fee breakdown with network fee based on transaction size
 */
export const calculateImageInscriptionFees = (fileSizeBytes: number): {
  platformFee: number;
  networkFee: number;
  inscriptionOutput: number;
  total: number;
  fileSizeKB: number;
} => {
  const fileSizeKB = fileSizeBytes / 1024;

  // ZIP-317 fee calculation
  // Base tx overhead: ~500 bytes (version, inputs, outputs, etc.)
  // Inscription data: fileSizeBytes
  // Witness/script overhead: ~200 bytes
  const estimatedTxSize = 500 + fileSizeBytes + 200;

  // ZIP-317: 1000 zats per 1000 bytes (1 zat/byte minimum)
  // But we need to account for mempool policy - use 10 zats/byte for safety
  const calculatedFee = Math.ceil(estimatedTxSize * NETWORK_FEE_UNIT_ZATS_PER_BYTE);

  // Enforce minimum fee floor (50,000 zats) to avoid "unpaid action limit exceeded"
  // Cap at reasonable maximum (100,000 zats) to keep large inscriptions affordable
  const ZIP_317_CAP = 100000;
  const networkFee = Math.min(Math.max(calculatedFee, FEE_FLOOR_ZATS), ZIP_317_CAP);

  const platformFee = PLATFORM_FEE_ZATS; // 100,000 zats

  // inscriptionOutput must be large enough to cover the reveal fee + minimum output
  // The reveal tx will have: output = inscriptionOutput - networkFee
  // So inscriptionOutput must be >= networkFee + INSCRIPTION_MIN_OUTPUT_ZATS
  const inscriptionOutput = networkFee + INSCRIPTION_MIN_OUTPUT_ZATS;

  return {
    platformFee,
    networkFee,
    inscriptionOutput,
    total: platformFee + networkFee + inscriptionOutput,
    fileSizeKB,
  };
};

/**
 * Convert zatoshis to ZEC
 */
export const zatoshisToZEC = (zatoshis: number): number => {
  return zatoshis / 100000000;
};

/**
 * Convert zatoshis to USD (approximate)
 */
export const zatoshisToUSD = (zatoshis: number, zecPrice: number = 700): number => {
  return zatoshisToZEC(zatoshis) * zecPrice;
};

/**
 * Format zatoshis as readable ZEC
 */
export const formatZEC = (zatoshis: number): string => {
  return `${zatoshisToZEC(zatoshis).toFixed(8)} ZEC`;
};

/**
 * Format zatoshis as readable USD
 */
export const formatUSD = (zatoshis: number, zecPrice: number = 700): string => {
  return `$${zatoshisToUSD(zatoshis, zecPrice).toFixed(2)}`;
};

/**
 * Validate name format
 */
export const isValidZcashName = (name: string): { valid: boolean; error?: string } => {
  // Keep the extension check
  if (!name.match(/\.(zec|zcash)$/i)) {
    return { valid: false, error: 'Name must end with .zec or .zcash' };
  }

  // No length or character restrictions as per user request
  return { valid: true };
};

/**
 * Name inscription types
 */
export type NameExtension = 'zec' | 'zcash';

export interface NameRegistration {
  name: string;
  extension: NameExtension;
  fullName: string;
  owner: string;
  registeredAt?: number;
  expiresAt?: number;
}
