/**
 * Enterprise-Grade Fetch with Retry Logic
 *
 * Implements exponential backoff and retry for network requests
 * Handles transient failures gracefully
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryOn?: (error: Error, attempt: number) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2,
  retryOn: (error: Error, attempt: number) => {
    // Retry on network errors and 5xx server errors
    return true;
  }
};

/**
 * Fetch with automatic retry and exponential backoff
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retryOptions?: RetryOptions
): Promise<Response> {
  const opts = { ...DEFAULT_OPTIONS, ...retryOptions };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // If successful or client error (4xx), return immediately (no retry)
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }

      // Server error (5xx) - will retry
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    // Don't retry if this was the last attempt
    if (attempt === opts.maxRetries) {
      break;
    }

    // Check if we should retry
    if (lastError && !opts.retryOn(lastError, attempt)) {
      break;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      opts.initialDelay * Math.pow(opts.backoffMultiplier, attempt),
      opts.maxDelay
    );

    console.log(`⚠️ Request failed (attempt ${attempt + 1}/${opts.maxRetries + 1}), retrying in ${delay}ms...`, lastError.message);

    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // All retries exhausted
  throw lastError || new Error('Request failed after all retries');
}

/**
 * Fetch JSON with retry logic
 */
export async function fetchJSONWithRetry<T = any>(
  url: string,
  options?: RequestInit,
  retryOptions?: RetryOptions
): Promise<T> {
  const response = await fetchWithRetry(url, options, retryOptions);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch text with retry logic
 */
export async function fetchTextWithRetry(
  url: string,
  options?: RequestInit,
  retryOptions?: RetryOptions
): Promise<string> {
  const response = await fetchWithRetry(url, options, retryOptions);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.text();
}
