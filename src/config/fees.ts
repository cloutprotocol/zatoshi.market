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

  // Inscription output value
  INSCRIPTION_OUTPUT: 10000, // 0.0001 ZEC
} as const;

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
export const calculateTotalCost = (platformFee: number): {
  platformFee: number;
  networkFee: number;
  inscriptionOutput: number;
  total: number;
} => ({
  platformFee,
  networkFee: PLATFORM_FEES.NETWORK_FEE_ESTIMATE,
  inscriptionOutput: PLATFORM_FEES.INSCRIPTION_OUTPUT,
  total: platformFee + PLATFORM_FEES.NETWORK_FEE_ESTIMATE + PLATFORM_FEES.INSCRIPTION_OUTPUT,
});

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
  const calculatedFee = Math.ceil(estimatedTxSize * 10);

  // Enforce minimum fee floor (50,000 zats) to avoid "unpaid action limit exceeded"
  const ZIP_317_FLOOR = 50000;
  const networkFee = Math.max(calculatedFee, ZIP_317_FLOOR);

  const platformFee = PLATFORM_FEE_ZATS; // 100,000 zats
  const inscriptionOutput = 60000; // Standard inscription output

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
  // Remove extension for validation
  const nameWithoutExtension = name.replace(/\.(zec|zcash)$/i, '');

  // Check length (3-63 characters without extension)
  if (nameWithoutExtension.length < 3) {
    return { valid: false, error: 'Name must be at least 3 characters' };
  }

  if (nameWithoutExtension.length > 63) {
    return { valid: false, error: 'Name must be 63 characters or less' };
  }

  // Check valid characters (alphanumeric and hyphens, no leading/trailing hyphens)
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(nameWithoutExtension)) {
    return {
      valid: false,
      error: 'Name can only contain letters, numbers, and hyphens (no leading/trailing hyphens)'
    };
  }

  // Check extension
  if (!name.match(/\.(zec|zcash)$/i)) {
    return { valid: false, error: 'Name must end with .zec or .zcash' };
  }

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
