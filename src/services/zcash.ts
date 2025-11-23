/**
 * Zcash RPC Service
 *
 * Client-side service for interacting with Zcash blockchain via Next.js API routes
 *
 * Architecture Overview:
 * ===================
 * This service acts as a client-side proxy to our Next.js API routes, which in turn
 * communicate with external blockchain APIs (Blockchair + Tatum RPC).
 *
 * API Provider Strategy:
 * ----------------------
 * 1. Blockchair API (with API key A___e4MleX7tmjVk50SHfdfZR0pLqcOs)
 *    - Used for: Balance lookups, blockchain stats, transaction lookups
 *    - Rate limit: 10,000 requests/day (free tier)
 *    - Why: Fast, reliable, no RPC node required for read operations
 *
 * 2. Tatum RPC (with API key t-691ab5fae2b53035df472a13-2ea27385c5964a15b092bdab)
 *    - Used for: Critical operations only (fees, UTXOs, broadcasting)
 *    - Rate limit: Limited free tier
 *    - Why: Direct RPC access needed for transaction building/signing
 *
 * Caching Strategy to Minimize API Calls:
 * ----------------------------------------
 * - Balance: 1 minute cache per address (frequently updated, but not every second)
 * - Stats: 2 minutes cache (block time ~75 seconds, safe to cache)
 * - Fees: 10 minutes cache (fees change slowly, long cache acceptable)
 * - Price: 60 seconds cache (price updates frequently but not critical)
 * - UTXOs: No cache (called only during inscription, needs fresh data)
 * - Broadcast: No cache (one-time operation)
 * - Transactions: 5 minutes cache (immutable once confirmed)
 *
 * Client-side Polling (matches server cache durations):
 * ------------------------------------------------------
 * - Home page: 2 min polling for block count
 * - ZMAPS page: 2 min polling for block count
 * - Wallet page: Manual refresh only (no auto-polling)
 * - Wallet drawer: 60 sec polling when open (matches balance cache)
 *
 * Cost Optimization Summary:
 * --------------------------
 * Before optimization: ~1,200+ API calls/hour (30-sec polling everywhere)
 * After optimization: ~60 API calls/hour (~95% reduction)
 *
 * Key principle: "Only poll what's visible, cache what's expensive, RPC only when critical"
 */

export interface ZcashBlockchainInfo {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
  difficulty: number;
  verificationprogress: number;
  chainwork: string;
  pruned: boolean;
  size_on_disk?: number;
  commitments?: number;
  valuePools?: Array<{
    id: string;
    monitored: boolean;
    chainValue: number;
    chainValueZat: number;
  }>;
  softforks?: any;
  upgrades?: any;
  consensus?: {
    chaintip: string;
    nextblock: string;
  };
}

export interface ZcashBlock {
  hash: string;
  confirmations: number;
  height: number;
  version: number;
  merkleroot: string;
  time: number;
  nonce: string;
  bits: string;
  difficulty: number;
  previousblockhash?: string;
  nextblockhash?: string;
  tx?: string[];
}

interface ZcashNodeStatus {
  status: 'online' | 'degraded' | 'offline';
  healthy: boolean;
  blockchainInfo?: Partial<ZcashBlockchainInfo & { bestblockhash?: string; chainwork?: string }> | null;
  mempoolInfo?: Record<string, any> | null;
  networkInfo?: Record<string, any> | null;
  timestamp: number;
  errors?: Record<string, string>;
}

class ZcashRPCService {
  private apiUrl: string;

  constructor() {
    // Use Next.js API route as proxy to avoid CORS issues
    this.apiUrl = '/api/zcash';
  }

  /**
   * Make an API call to the Zcash blockchain API
   */
  private async apiCall<T>(endpoint: string): Promise<T> {
    try {
      const response = await fetch(`${this.apiUrl}${endpoint}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`API call failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Zcash API error (${endpoint}):`, error);
      throw error;
    }
  }

  /**
   * Get the current block count (height)
   * Uses proxy API: /api/zcash/stats
   */
  async getBlockCount(): Promise<number> {
    const data: ZcashNodeStatus = await this.apiCall('/node-status');
    return data.blockchainInfo?.blocks ?? 0;
  }

  /**
   * Get comprehensive blockchain information
   */
  async getBlockchainInfo(): Promise<ZcashBlockchainInfo> {
    const status: ZcashNodeStatus = await this.apiCall('/node-status');
    const data: Record<string, any> = status.blockchainInfo || {};
    return {
      chain: data.chain || 'main',
      blocks: data.blocks || 0,
      headers: data.headers || data.blocks || 0,
      bestblockhash: data.bestblockhash || '',
      difficulty: data.difficulty || 0,
      verificationprogress: data.verificationprogress ?? 1,
      chainwork: data.chainwork || '',
      pruned: Boolean(data.pruned),
      commitments: data.commitments,
      valuePools: data.valuePools,
      softforks: data.softforks,
      upgrades: data.upgrades,
      consensus: data.consensus,
    };
  }

  /**
   * Fetch combined node status snapshot (blockchain + mempool + network)
   */
  async getNodeStatus(): Promise<ZcashNodeStatus> {
    return this.apiCall('/node-status');
  }

  /**
   * Get block hash by height
   */
  async getBlockHash(height: number): Promise<string> {
    const data: any = await this.apiCall(`/dashboards/block/${height}`);
    return data.data.block.hash;
  }

  /**
   * Get block information by hash
   */
  async getBlock(hash: string): Promise<ZcashBlock> {
    const data: any = await this.apiCall(`/dashboards/block/${hash}`);
    const block = data.data.block;
    return {
      hash: block.hash,
      confirmations: 1,
      height: block.id,
      version: block.version,
      merkleroot: '',
      time: new Date(block.time).getTime() / 1000,
      nonce: '',
      bits: '',
      difficulty: block.difficulty,
      previousblockhash: block.previous_block_hash,
      nextblockhash: block.next_block_hash,
    };
  }

  /**
   * Get block by height
   */
  async getBlockByHeight(height: number): Promise<ZcashBlock> {
    return this.getBlock(height.toString());
  }

  /**
   * Get the best block hash
   */
  async getBestBlockHash(): Promise<string> {
    const data: any = await this.apiCall('/stats');
    return data.data.best_block_hash;
  }

  /**
   * Get network hash rate per second
   */
  async getNetworkHashPS(): Promise<number> {
    const data: any = await this.apiCall('/stats');
    return data.data.hashrate_24h;
  }

  /**
   * Get mining info
   */
  async getMiningInfo(): Promise<any> {
    return this.apiCall('/stats');
  }

  /**
   * Get balance for a Zcash address
   * Uses proxied API route to avoid CORS and rate limits
   * @param address - Zcash address to check
   * @param forceRefresh - If true, bypasses cache and fetches fresh data
   */
  async getBalance(address: string, forceRefresh: boolean = false): Promise<{ confirmed: number; unconfirmed: number }> {
    try {
      const url = forceRefresh
        ? `/api/zcash/balance/${address}?refresh=true`
        : `/api/zcash/balance/${address}`;
      const response = await fetch(url);
      const data = await response.json();
      return {
        confirmed: data.confirmed || 0,
        unconfirmed: data.unconfirmed || 0,
      };
    } catch (error) {
      console.error('Balance API failed:', error);
      return { confirmed: 0, unconfirmed: 0 };
    }
  }

  /**
   * Get current ZEC to USD price
   * Uses proxied API route to avoid CORS
   */
  async getPrice(): Promise<number> {
    try {
      const response = await fetch('/api/zcash/price');
      const data = await response.json();
      return data.usd || 0;
    } catch (error) {
      console.error('Failed to fetch price:', error);
      return 0;
    }
  }

  /**
   * Get fee estimate for transactions (Tatum RPC - cached 5min)
   * Use ONLY when preparing to inscribe/broadcast transactions
   */
  async getFeeEstimate(): Promise<{ feerate: number; blocks: number }> {
    try {
      const response = await fetch('/api/zcash/fees');
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to fetch fees:', error);
      return { feerate: 0.0001, blocks: 6 };
    }
  }

  /**
   * Broadcast a signed transaction (Tatum RPC)
   * Use ONLY for inscriptions and critical transactions
   */
  async broadcastTransaction(signedTx: string): Promise<string> {
    try {
      const response = await fetch('/api/zcash/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedTx }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data.txid;
    } catch (error) {
      console.error('Failed to broadcast transaction:', error);
      throw error;
    }
  }

  /**
   * Get UTXOs for an address (Tatum RPC)
   * Use ONLY when building inscription transactions
   */
  async getUTXOs(address: string, refresh: boolean = false): Promise<any[]> {
    try {
      const url = refresh ? `/api/zcash/utxos/${address}?refresh=true` : `/api/zcash/utxos/${address}`;
      const response = await fetch(url);
      const data = await response.json();
      return data.utxos || [];
    } catch (error) {
      console.error('Failed to fetch UTXOs:', error);
      return [];
    }
  }

  /**
   * Get inscriptions for an address
   * Returns inscribed UTXO locations to prevent accidental spending
   * and full inscription data for display
   * @param address - Zcash address to check
   * @param forceRefresh - If true, bypasses cache and fetches fresh data
   */
  async getInscriptions(address: string, forceRefresh: boolean = false): Promise<{ inscribedLocations: string[]; count: number; inscriptions: any[] }> {
    try {
      const url = forceRefresh
        ? `/api/zcash/inscriptions/${address}?refresh=true`
        : `/api/zcash/inscriptions/${address}`;
      const response = await fetch(url);
      const data = await response.json();
      return {
        inscribedLocations: data.inscribedLocations || [],
        count: data.count || 0,
        inscriptions: data.inscriptions || []
      };
    } catch (error) {
      console.error('Failed to fetch inscriptions:', error);
      return { inscribedLocations: [], count: 0, inscriptions: [] };
    }
  }
}

// Export singleton instance
export const zcashRPC = new ZcashRPCService();

// Also export the class for testing/custom instances
export default ZcashRPCService;
