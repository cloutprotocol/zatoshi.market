/**
 * ZRC-20 Token Balance Calculator
 *
 * Calculates token balances from inscriptions held in wallet UTXOs
 *
 * How ZRC-20 works:
 * 1. deploy: Creates a new token (ticker, max supply, mint limit)
 * 2. mint: Mints tokens to creator's available balance
 * 3. transfer: Creates a transferable inscription (locks tokens in UTXO)
 *
 * Balance calculation:
 * - If you HOLD a "transfer" inscription UTXO = you have transferable tokens
 * - Amount is in the inscription content
 */

export interface ZRC20Token {
  tick: string;
  balance: string;
  transferableCount: number; // Number of transfer inscriptions
}

export interface ZRC20Inscription {
  p: string;
  op: string;
  tick: string;
  amt?: string;
  max?: string;
  lim?: string;
}

/**
 * Parse inscription content to check if it's ZRC-20
 */
function parseZRC20(content: string): ZRC20Inscription | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed.p === 'zrc-20' && parsed.tick) {
      return parsed as ZRC20Inscription;
    }
  } catch {
    // Not JSON or not ZRC-20
  }
  return null;
}

/**
 * Calculate ZRC-20 balances from inscriptions
 *
 * @param inscriptions - Array of inscriptions with content
 * @param inscriptionContents - Map of inscription ID to content
 * @returns Array of tokens with balances
 */
export function calculateZRC20Balances(
  inscriptions: any[],
  inscriptionContents: Record<string, string>
): ZRC20Token[] {
  const balances = new Map<string, { balance: bigint; count: number }>();

  for (const insc of inscriptions) {
    const content = inscriptionContents[insc.id];
    if (!content) continue;

    const zrc20 = parseZRC20(content);
    if (!zrc20) continue;

    // Only count "transfer" operations as balance
    // (mint/deploy operations don't represent holdings in this UTXO)
    if (zrc20.op === 'transfer' && zrc20.amt) {
      const tick = zrc20.tick.toUpperCase();
      const amount = BigInt(zrc20.amt);

      const current = balances.get(tick) || { balance: BigInt(0), count: 0 };
      balances.set(tick, {
        balance: current.balance + amount,
        count: current.count + 1
      });
    }
  }

  // Convert to array and sort
  const tokens: ZRC20Token[] = [];
  for (const [tick, data] of balances.entries()) {
    tokens.push({
      tick,
      balance: data.balance.toString(),
      transferableCount: data.count
    });
  }

  // Sort by ticker alphabetically
  tokens.sort((a, b) => a.tick.localeCompare(b.tick));

  return tokens;
}

/**
 * Format token amount with decimals (most ZRC-20 use 18 decimals, but we'll keep as-is)
 */
export function formatZRC20Amount(amount: string): string {
  // Most tokens are stored as integer amounts without decimals
  // Format with thousand separators
  const num = BigInt(amount);
  return num.toLocaleString();
}
