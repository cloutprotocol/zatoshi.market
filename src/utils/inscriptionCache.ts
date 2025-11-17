/**
 * Enterprise-Grade Inscription Cache
 *
 * Persistent localStorage-based cache for wallet inscriptions
 * Implements stale-while-revalidate pattern for optimal UX
 *
 * Features:
 * - Persistent across page reloads
 * - Per-address caching
 * - Automatic stale data cleanup
 * - Error-resilient with fallback to API
 * - Type-safe interfaces
 */

export interface CachedInscriptionData {
  inscriptions: any[];
  inscriptionContents: Record<string, string>;
  timestamp: number;
  address: string;
}

const CACHE_KEY_PREFIX = 'zatoshi_inscriptions_';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes (enterprise-grade caching)
const MAX_CACHE_AGE = 60 * 60 * 1000; // 1 hour (absolute max before forced refresh)

/**
 * Get cached inscription data for an address
 * @returns Cached data if valid, null if stale/missing
 */
export function getCachedInscriptions(address: string): CachedInscriptionData | null {
  try {
    const key = CACHE_KEY_PREFIX + address;
    const cached = localStorage.getItem(key);

    if (!cached) return null;

    const data: CachedInscriptionData = JSON.parse(cached);
    const age = Date.now() - data.timestamp;

    // Return null if cache is too old (forces fresh fetch)
    if (age > MAX_CACHE_AGE) {
      localStorage.removeItem(key);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Failed to read inscription cache:', error);
    return null;
  }
}

/**
 * Check if cached data is still fresh (within CACHE_DURATION)
 */
export function isCacheFresh(data: CachedInscriptionData | null): boolean {
  if (!data) return false;
  const age = Date.now() - data.timestamp;
  return age < CACHE_DURATION;
}

/**
 * Save inscription data to cache
 */
export function setCachedInscriptions(
  address: string,
  inscriptions: any[],
  inscriptionContents: Record<string, string>
): void {
  try {
    const key = CACHE_KEY_PREFIX + address;
    const data: CachedInscriptionData = {
      inscriptions,
      inscriptionContents,
      timestamp: Date.now(),
      address
    };

    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save inscription cache:', error);
    // Non-critical error - app continues without cache
  }
}

/**
 * Clear cached data for an address
 */
export function clearCachedInscriptions(address: string): void {
  try {
    const key = CACHE_KEY_PREFIX + address;
    localStorage.removeItem(key);
  } catch (error) {
    console.error('Failed to clear inscription cache:', error);
  }
}

/**
 * Clean up old cache entries (keep only last 5 addresses)
 */
export function cleanupOldCache(): void {
  try {
    const keys: { key: string; timestamp: number }[] = [];

    // Find all inscription cache keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_KEY_PREFIX)) {
        try {
          const data = JSON.parse(localStorage.getItem(key) || '{}');
          keys.push({ key, timestamp: data.timestamp || 0 });
        } catch {
          // Invalid entry, mark for deletion
          keys.push({ key, timestamp: 0 });
        }
      }
    }

    // Sort by timestamp (oldest first)
    keys.sort((a, b) => a.timestamp - b.timestamp);

    // Remove oldest entries if we have more than 5
    const toRemove = keys.length - 5;
    if (toRemove > 0) {
      for (let i = 0; i < toRemove; i++) {
        localStorage.removeItem(keys[i].key);
      }
    }
  } catch (error) {
    console.error('Failed to cleanup cache:', error);
  }
}

/**
 * Get cache status for UI display
 */
export function getCacheStatus(address: string): {
  exists: boolean;
  fresh: boolean;
  age: number;
  ageFormatted: string;
} {
  const cached = getCachedInscriptions(address);

  if (!cached) {
    return { exists: false, fresh: false, age: 0, ageFormatted: 'No cache' };
  }

  const age = Date.now() - cached.timestamp;
  const fresh = age < CACHE_DURATION;

  // Format age for display
  let ageFormatted: string;
  if (age < 60000) {
    ageFormatted = `${Math.floor(age / 1000)}s ago`;
  } else if (age < 3600000) {
    ageFormatted = `${Math.floor(age / 60000)}m ago`;
  } else {
    ageFormatted = `${Math.floor(age / 3600000)}h ago`;
  }

  return { exists: true, fresh, age, ageFormatted };
}
