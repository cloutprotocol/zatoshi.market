/**
 * Sequential image loading utility
 * Tries loading from multiple URLs and returns once one successfully loads
 */

export interface ImageLoadOptions {
  urls: string[];
  timeout?: number; // Timeout per URL in milliseconds (default: 5000)
  cacheKey?: string;
}

export interface ImageLoadResult {
  url: string | null;
  success: boolean;
  index: number;
}

const RESOLVED_IMAGE_CACHE = new Map<string, string>();
const GATEWAY_FAILURES = new Map<string, number>();

const FAILURE_THRESHOLD = 3;
const FAILURE_DECAY_MS = 5 * 60 * 1000;
const GATEWAY_FAILURE_EXPIRY = new Map<string, number>();

function normalizeGateway(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    // Support ipfs:// style URLs
    if (url.startsWith('ipfs://')) {
      return 'ipfs://';
    }
    if (url.startsWith('//')) {
      return new URL(`https:${url}`).origin;
    }
    return url.split('/').slice(0, 3).join('/') || url;
  }
}

function recordGatewayFailure(gateway: string) {
  const next = (GATEWAY_FAILURES.get(gateway) ?? 0) + 1;
  GATEWAY_FAILURES.set(gateway, next);
  GATEWAY_FAILURE_EXPIRY.set(gateway, Date.now() + FAILURE_DECAY_MS);
}

function decayGatewayFailures(gateway: string) {
  const expiry = GATEWAY_FAILURE_EXPIRY.get(gateway);
  if (expiry && expiry < Date.now()) {
    GATEWAY_FAILURES.delete(gateway);
    GATEWAY_FAILURE_EXPIRY.delete(gateway);
  }
}

function successGateway(gateway: string) {
  GATEWAY_FAILURES.delete(gateway);
  GATEWAY_FAILURE_EXPIRY.delete(gateway);
}

/**
 * Attempts to load an image from a single URL with timeout
 */
function loadImageWithTimeout(url: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.src = ''; // Cancel loading
      reject(new Error(`Timeout loading ${url}`));
    }, timeout);

    img.onload = () => {
      clearTimeout(timer);
      resolve(url);
    };

    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Failed to load ${url}`));
    };

    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.src = url;
  });
}

/**
 * Attempts to load an image from the provided URLs sequentially
 * Stops at the first successful response
 */
export async function loadImageWithRace(options: ImageLoadOptions): Promise<ImageLoadResult> {
  const { urls, timeout = 5000, cacheKey } = options;

  if (!urls || urls.length === 0) {
    throw new Error('No URLs provided');
  }

  if (cacheKey && RESOLVED_IMAGE_CACHE.has(cacheKey)) {
    const cached = RESOLVED_IMAGE_CACHE.get(cacheKey)!;
    return { url: cached, success: true, index: urls.indexOf(cached) ?? 0 };
  }

  const candidates = urls.filter(Boolean);
  if (candidates.length === 0) {
    return { url: null, success: false, index: -1 };
  }

  // Prefer gateways with fewer recent failures
  const orderedCandidates = candidates.sort((a, b) => {
    const failureA = GATEWAY_FAILURES.get(normalizeGateway(a)) ?? 0;
    const failureB = GATEWAY_FAILURES.get(normalizeGateway(b)) ?? 0;
    return failureA - failureB;
  });

  for (let index = 0; index < orderedCandidates.length; index++) {
    const url = orderedCandidates[index];
    const gateway = normalizeGateway(url);
    decayGatewayFailures(gateway);
    const failureCount = GATEWAY_FAILURES.get(gateway) ?? 0;
    if (failureCount >= FAILURE_THRESHOLD) {
      // Skip gateways that have repeatedly failed recently
      continue;
    }
    try {
      await loadImageWithTimeout(url, timeout);
      successGateway(gateway);
      if (cacheKey) RESOLVED_IMAGE_CACHE.set(cacheKey, url);
      return { url, success: true, index: urls.indexOf(url) };
    } catch (err) {
      recordGatewayFailure(gateway);
    }
  }

  if (cacheKey) RESOLVED_IMAGE_CACHE.delete(cacheKey);
  return { url: null, success: false, index: -1 };
}

/**
 * Preloads images in the background
 * Useful for prefetching images before they're needed
 */
export function preloadImages(urls: string[]): void {
  urls.forEach((url) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.src = url;
  });
}

import { useState, useEffect } from 'react';

export function useIpfsImage(urls: string[], enabled: boolean, cacheKey?: string) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!enabled || urls.length === 0) {
      setResolved(null);
      setLoading(false);
      setErrored(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrored(false);
    loadImageWithRace({ urls, timeout: 5000, cacheKey })
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.url) {
          setResolved(result.url);
          setErrored(false);
        } else {
          setResolved(null);
          setErrored(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolved(null);
          setErrored(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [urls, enabled, cacheKey]);

  return { resolved, loading, errored };
}
