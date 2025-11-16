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
    // These can be set via environment variables or directly
    this.apiUrl = process.env.NEXT_PUBLIC_ZCASH_RPC_URL || 'https://api.blockchair.com/zcash';
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
   * Uses Blockchair API: /stats
   */
  async getBlockCount(): Promise<number> {
    const data: any = await this.apiCall('/stats');
    return data.data.blocks;
  }

  /**
   * Get comprehensive blockchain information
   */
  async getBlockchainInfo(): Promise<ZcashBlockchainInfo> {
    const data: any = await this.apiCall('/stats');
    return {
      chain: 'main',
      blocks: data.data.blocks,
      headers: data.data.blocks,
      bestblockhash: data.data.best_block_hash,
      difficulty: data.data.difficulty,
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
}

// Export singleton instance
export const zcashRPC = new ZcashRPCService();

// Also export the class for testing/custom instances
export default ZcashRPCService;
