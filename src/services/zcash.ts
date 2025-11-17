/**
 * Zcash RPC Service
 * Provides methods to interact with Zcash blockchain
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
    const data: any = await this.apiCall('/stats');
    return data.blocks;
  }

  /**
   * Get comprehensive blockchain information
   */
  async getBlockchainInfo(): Promise<ZcashBlockchainInfo> {
    const data: any = await this.apiCall('/stats');
    return {
      chain: 'main',
      blocks: data.blocks,
      headers: data.blocks,
      bestblockhash: data.best_block_hash,
      difficulty: data.difficulty,
      verificationprogress: 1,
      chainwork: '',
      pruned: false,
    };
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
   */
  async getBalance(address: string): Promise<{ confirmed: number; unconfirmed: number }> {
    try {
      const response = await fetch(`https://api.blockchair.com/zcash/dashboards/address/${address}`);
      const data = await response.json();

      if (data.data && data.data[address]) {
        const addressData = data.data[address].address;
        return {
          confirmed: addressData.balance / 100000000, // Convert satoshis to ZEC
          unconfirmed: addressData.unconfirmed_balance / 100000000,
        };
      }

      return { confirmed: 0, unconfirmed: 0 };
    } catch (error) {
      console.error('Failed to fetch balance:', error);
      return { confirmed: 0, unconfirmed: 0 };
    }
  }

  /**
   * Get current ZEC to USD price
   */
  async getPrice(): Promise<number> {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd');
      const data = await response.json();
      return data.zcash?.usd || 0;
    } catch (error) {
      console.error('Failed to fetch price:', error);
      return 0;
    }
  }
}

// Export singleton instance
export const zcashRPC = new ZcashRPCService();

// Also export the class for testing/custom instances
export default ZcashRPCService;
