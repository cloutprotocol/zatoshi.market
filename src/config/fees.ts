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
