/**
 * Enterprise-Grade Balance Cache
 *
 * Persistent localStorage-based cache for wallet balances
 * Prevents balance "snapping back" to old values
 *
 * Features:
 * - Persistent across page reloads
 * - Per-address caching
 * - Automatic stale data handling
 * - Type-safe interfaces
 */

export interface CachedBalanceData {
  confirmed: number;
  unconfirmed: number;
  timestamp: number;
  address: string;
}

const CACHE_KEY_PREFIX = 'zatoshi_balance_';
const CACHE_DURATION = 30 * 1000; // 30 seconds (balances change more frequently than inscriptions)
const MAX_CACHE_AGE = 5 * 60 * 1000; // 5 minutes (absolute max)

/**
 * Get cached balance for an address
 */
export function getCachedBalance(address: string): CachedBalanceData | null {
  try {
    const key = CACHE_KEY_PREFIX + address;
    const cached = localStorage.getItem(key);

    if (!cached) return null;

    const data: CachedBalanceData = JSON.parse(cached);
    const age = Date.now() - data.timestamp;

    // Return null if cache is too old
    if (age > MAX_CACHE_AGE) {
      localStorage.removeItem(key);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Failed to read balance cache:', error);
    return null;
  }
}

/**
 * Check if cached balance is still fresh
 */
export function isBalanceCacheFresh(data: CachedBalanceData | null): boolean {
  if (!data) return false;
  const age = Date.now() - data.timestamp;
  return age < CACHE_DURATION;
}

/**
 * Save balance to cache
 */
export function setCachedBalance(
  address: string,
  confirmed: number,
  unconfirmed: number
): void {
  try {
    const key = CACHE_KEY_PREFIX + address;
    const data: CachedBalanceData = {
      confirmed,
      unconfirmed,
      timestamp: Date.now(),
      address
    };

    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save balance cache:', error);
  }
}

/**
 * Clear cached balance for an address
 */
export function clearCachedBalance(address: string): void {
  try {
    const key = CACHE_KEY_PREFIX + address;
    localStorage.removeItem(key);
  } catch (error) {
    console.error('Failed to clear balance cache:', error);
  }
}

/**
 * Clean up old balance cache entries
 */
export function cleanupOldBalanceCache(): void {
  try {
    const keys: { key: string; timestamp: number }[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_KEY_PREFIX)) {
        try {
          const data = JSON.parse(localStorage.getItem(key) || '{}');
          keys.push({ key, timestamp: data.timestamp || 0 });
        } catch {
          keys.push({ key, timestamp: 0 });
        }
      }
    }

    // Sort by timestamp and keep only last 5
    keys.sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = keys.length - 5;
    if (toRemove > 0) {
      for (let i = 0; i < toRemove; i++) {
        localStorage.removeItem(keys[i].key);
      }
    }
  } catch (error) {
    console.error('Failed to cleanup balance cache:', error);
  }
}
