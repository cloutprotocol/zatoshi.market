/**
 * Production-Ready Error Message Handler
 *
 * Maps technical errors to user-friendly messages
 * Following best practices from Unisat, MetaMask, and major wallet providers
 *
 * Design Principles:
 * 1. Never expose internal technical details (Convex, stack traces, etc.)
 * 2. Always provide actionable guidance
 * 3. Use simple, clear language
 * 4. Include next steps when possible
 * 5. Maintain consistent tone across all errors
 */

export interface UserFriendlyError {
  title: string;
  message: string;
  action?: string; // What user should do next
  severity: 'error' | 'warning' | 'info';
}

/**
 * Error categories for better organization
 */
export enum ErrorCategory {
  BALANCE = 'balance',
  NETWORK = 'network',
  WALLET = 'wallet',
  INSCRIPTION = 'inscription',
  VALIDATION = 'validation',
  UNKNOWN = 'unknown'
}

/**
 * Map of technical error patterns to user-friendly messages
 */
const ERROR_MESSAGES: Record<string, UserFriendlyError> = {
  // Balance & UTXO Errors
  'UTXO fetch failed': {
    title: 'No Spendable Balance',
    message: 'Your wallet doesn\'t have any spendable ZEC for this inscription. Fresh deposits work best.',
    action: 'Add ZEC to your wallet and try again',
    severity: 'error'
  },
  'Not enough spendable funds': {
    title: 'Insufficient Balance',
    message: 'You don\'t have enough ZEC to complete this inscription. Make sure you have enough for the inscription fee plus network fee.',
    action: 'Add more ZEC to your wallet',
    severity: 'error'
  },
  'no utxos': {
    title: 'No Funds Available',
    message: 'Your wallet is empty. Send some ZEC to get started.',
    action: 'Deposit ZEC to your wallet address',
    severity: 'error'
  },
  'balance': {
    title: 'Balance Issue',
    message: 'Unable to verify your wallet balance. Please try again.',
    action: 'Refresh and retry',
    severity: 'warning'
  },

  // Network Errors
  'network': {
    title: 'Network Error',
    message: 'Unable to connect to the Zcash network. Please check your internet connection.',
    action: 'Check connection and try again',
    severity: 'error'
  },
  'timeout': {
    title: 'Request Timeout',
    message: 'The network request took too long. Please try again.',
    action: 'Retry your transaction',
    severity: 'warning'
  },
  'Failed to fetch': {
    title: 'Connection Failed',
    message: 'Couldn\'t connect to the network. Please check your internet connection.',
    action: 'Check connection and retry',
    severity: 'error'
  },
  'rate limit': {
    title: 'Too Many Requests',
    message: 'You\'re making requests too quickly. Please wait a moment.',
    action: 'Wait 30 seconds and try again',
    severity: 'warning'
  },

  // Wallet Errors
  'wallet not connected': {
    title: 'Wallet Not Connected',
    message: 'Please connect your wallet to continue.',
    action: 'Click "Connect Wallet" to get started',
    severity: 'info'
  },
  'Invalid private key': {
    title: 'Invalid Private Key',
    message: 'The private key you entered is not valid. It should start with "L" or "K".',
    action: 'Double-check your private key and try again',
    severity: 'error'
  },
  'password': {
    title: 'Incorrect Password',
    message: 'The password you entered is incorrect.',
    action: 'Try again with the correct password',
    severity: 'error'
  },

  // Inscription Errors
  'inscription protection': {
    title: 'Inscription Protected',
    message: 'This UTXO contains an inscription and cannot be spent. Your inscriptions are automatically protected.',
    action: 'Use a different UTXO',
    severity: 'warning'
  },
  'broadcast': {
    title: 'Broadcast Failed',
    message: 'Unable to broadcast your transaction to the network. Please try again.',
    action: 'Retry broadcasting',
    severity: 'error'
  },
  'transaction failed': {
    title: 'Transaction Failed',
    message: 'Your transaction couldn\'t be completed. Please try again.',
    action: 'Review and retry',
    severity: 'error'
  },

  // Validation Errors
  'invalid name': {
    title: 'Invalid Name',
    message: 'The name you entered doesn\'t meet the requirements.',
    action: 'Use 3-20 characters (letters, numbers, hyphens only)',
    severity: 'error'
  },
  'invalid amount': {
    title: 'Invalid Amount',
    message: 'The amount you entered is not valid.',
    action: 'Enter a positive number',
    severity: 'error'
  },
  'invalid address': {
    title: 'Invalid Address',
    message: 'The Zcash address is not valid. It should start with "t1".',
    action: 'Double-check the address',
    severity: 'error'
  },

  // Convex / Internal Errors (strip out technical details)
  'convex': {
    title: 'Service Error',
    message: 'An error occurred while processing your request.',
    action: 'Please try again in a moment',
    severity: 'error'
  },
  'server error': {
    title: 'Service Unavailable',
    message: 'Our service is temporarily unavailable. We\'re working on it.',
    action: 'Please try again in a few minutes',
    severity: 'error'
  }
};

/**
 * Parse error and return user-friendly message
 */
export function parseError(error: unknown): UserFriendlyError {
  const errorString = error instanceof Error ? error.message : String(error);
  const errorLower = errorString.toLowerCase();

  // Check for specific error patterns with more context (order matters - most specific first)

  // Empty wallet (check first, most specific)
  if ((errorLower.includes('empty') && errorLower.includes('wallet')) ||
      errorLower.includes('wallet is empty') ||
      errorLower.includes('wallet doesn\'t have')) {
    return ERROR_MESSAGES['no utxos'];
  }

  // UTXO and balance errors (most common)
  if (errorLower.includes('utxo fetch') ||
      errorLower.includes('utxo') ||
      errorLower.includes('no spendable') ||
      errorLower.includes('spendable balance')) {
    return ERROR_MESSAGES['UTXO fetch failed'];
  }

  // Insufficient balance
  if (errorLower.includes('not enough') ||
      errorLower.includes('insufficient') ||
      errorLower.includes('don\'t have enough')) {
    return ERROR_MESSAGES['Not enough spendable funds'];
  }

  // Check for exact matches
  for (const [pattern, message] of Object.entries(ERROR_MESSAGES)) {
    if (errorLower.includes(pattern.toLowerCase())) {
      return message;
    }
  }

  if (errorLower.includes('network') || errorLower.includes('fetch')) {
    return ERROR_MESSAGES['network'];
  }

  if (errorLower.includes('wallet') && errorLower.includes('connect')) {
    return ERROR_MESSAGES['wallet not connected'];
  }

  if (errorLower.includes('password') || errorLower.includes('decrypt')) {
    return ERROR_MESSAGES['password'];
  }

  // Strip out Convex references
  if (errorLower.includes('convex') || errorLower.includes('[request id')) {
    return ERROR_MESSAGES['convex'];
  }

  // Default fallback
  return {
    title: 'Something Went Wrong',
    message: 'An unexpected error occurred. Please try again.',
    action: 'If this continues, contact support',
    severity: 'error'
  };
}

/**
 * Format error for display to user
 */
export function formatErrorMessage(error: unknown): string {
  const parsed = parseError(error);
  let message = `**${parsed.title}**\n\n${parsed.message}`;

  if (parsed.action) {
    message += `\n\n**Next Steps:** ${parsed.action}`;
  }

  return message;
}

/**
 * Format error for simple alert() dialog
 */
export function formatErrorAlert(error: unknown): string {
  const parsed = parseError(error);
  let message = `${parsed.title}\n\n${parsed.message}`;

  if (parsed.action) {
    message += `\n\nNext Steps: ${parsed.action}`;
  }

  return message;
}

/**
 * Get error severity for styling
 */
export function getErrorSeverity(error: unknown): 'error' | 'warning' | 'info' {
  const parsed = parseError(error);
  return parsed.severity;
}

/**
 * Log error for debugging (sanitized)
 */
export function logError(error: unknown, context?: string): void {
  const errorString = error instanceof Error ? error.message : String(error);
  const parsed = parseError(error);

  // Log sanitized version for debugging
  console.error(
    `[Error${context ? ` - ${context}` : ''}]`,
    {
      userMessage: parsed.title,
      severity: parsed.severity,
      original: errorString, // Keep for debugging, but never show to user
    }
  );
}

/**
 * Determine if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  const errorString = error instanceof Error ? error.message : String(error);
  const errorLower = errorString.toLowerCase();

  const retryablePatterns = [
    'network',
    'timeout',
    'fetch',
    'rate limit',
    'service',
    'temporary',
    'unavailable'
  ];

  return retryablePatterns.some(pattern => errorLower.includes(pattern));
}

/**
 * Get user-friendly error category
 */
export function categorizeError(error: unknown): ErrorCategory {
  const errorString = error instanceof Error ? error.message : String(error);
  const errorLower = errorString.toLowerCase();

  if (errorLower.includes('balance') || errorLower.includes('utxo') || errorLower.includes('funds')) {
    return ErrorCategory.BALANCE;
  }

  if (errorLower.includes('network') || errorLower.includes('fetch') || errorLower.includes('timeout')) {
    return ErrorCategory.NETWORK;
  }

  if (errorLower.includes('wallet') || errorLower.includes('password') || errorLower.includes('key')) {
    return ErrorCategory.WALLET;
  }

  if (errorLower.includes('inscription') || errorLower.includes('broadcast') || errorLower.includes('transaction')) {
    return ErrorCategory.INSCRIPTION;
  }

  if (errorLower.includes('invalid') || errorLower.includes('validation')) {
    return ErrorCategory.VALIDATION;
  }

  return ErrorCategory.UNKNOWN;
}

/**
 * Sanitize error for production (remove sensitive info)
 * Returns user-friendly error message
 */
export function sanitizeError(error: unknown): string {
  const errorString = error instanceof Error ? error.message : String(error);

  // Step 1: Remove patterns that expose internal details (comprehensive patterns)
  const cleaned = errorString
    // Remove Convex-specific patterns
    .replace(/\[CONVEX.*?\]/gi, '')
    .replace(/\[Request ID:.*?\]/gi, '')
    // Remove ALL stack trace variations
    .replace(/at\s+async\s+\w+\s+\(.*?\)/gi, '') // "at async handler (...)"
    .replace(/at\s+\w+\s+\(.*?\)/gi, '')          // "at handler (...)"
    .replace(/at\s+.*?\(\.\.\/.*?\)/gi, '')       // "at async handler (../convex/...)"
    .replace(/at\s+.*?:\d+:\d+/gi, '')            // "at file.ts:424:20"
    // Remove generic error prefixes
    .replace(/Server Error:?/gi, '')
    .replace(/Uncaught Error:?/gi, '')
    .replace(/Error:?\s+/gi, '')
    // Remove "Called by client"
    .replace(/Called by client/gi, '')
    // Remove file paths
    .replace(/\.\.\/convex\/\S+/gi, '')
    .replace(/\.\.\/\S+\.ts:\d+:\d+/gi, '')
    // Clean up multiple spaces/newlines
    .replace(/\s+/g, ' ')
    .trim();

  // Step 2: Parse the cleaned error to get user-friendly message
  // Create a new error with the cleaned message for parsing
  const cleanedError = new Error(cleaned);
  const parsed = parseError(cleanedError);

  // Return the user-friendly message
  return parsed.message;
}
