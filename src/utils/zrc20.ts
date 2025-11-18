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
 * - If you HOLD a "mint" inscription UTXO = you have minted tokens in your balance
 * - If you HOLD a "transfer" inscription UTXO = you have transferable tokens
 * - Amount is in the inscription content for both operations
 */

export interface ZRC20Token {
  tick: string;
  balance: string;
  transferableCount: number; // Number of transfer inscriptions
  mintCount: number; // Number of mint inscriptions
  totalInscriptions: number; // Total inscriptions (mints + transfers)
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
  const balances = new Map<string, { balance: bigint; mintCount: number; transferCount: number }>();

  for (const insc of inscriptions) {
    const content = inscriptionContents[insc.id];
    if (!content) continue;

    const zrc20 = parseZRC20(content);
    if (!zrc20) continue;

    // Count both "mint" and "transfer" operations as balance
    // Both represent tokens held in UTXOs owned by this wallet
    if ((zrc20.op === 'mint' || zrc20.op === 'transfer') && zrc20.amt) {
      const tick = zrc20.tick.toUpperCase();
      const amount = BigInt(zrc20.amt);

      const current = balances.get(tick) || { balance: BigInt(0), mintCount: 0, transferCount: 0 };
      balances.set(tick, {
        balance: current.balance + amount,
        mintCount: zrc20.op === 'mint' ? current.mintCount + 1 : current.mintCount,
        transferCount: zrc20.op === 'transfer' ? current.transferCount + 1 : current.transferCount
      });
    }
  }

  // Convert to array and sort
  const tokens: ZRC20Token[] = [];
  for (const [tick, data] of balances.entries()) {
    tokens.push({
      tick,
      balance: data.balance.toString(),
      transferableCount: data.transferCount,
      mintCount: data.mintCount,
      totalInscriptions: data.mintCount + data.transferCount
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
