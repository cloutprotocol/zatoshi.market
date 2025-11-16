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
  private rpcUrl: string;
  private rpcUser: string;
  private rpcPassword: string;

  constructor() {
    // These can be set via environment variables or directly
    this.rpcUrl = process.env.NEXT_PUBLIC_ZCASH_RPC_URL || 'https://mainnet.zcashexplorer.app/api';
    this.rpcUser = process.env.ZCASH_RPC_USER || '';
    this.rpcPassword = process.env.ZCASH_RPC_PASSWORD || '';
  }

  /**
   * Make an RPC call to the Zcash node
   */
  private async rpcCall<T>(method: string, params: any[] = []): Promise<T> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.rpcUser && this.rpcPassword && {
            Authorization: `Basic ${Buffer.from(`${this.rpcUser}:${this.rpcPassword}`).toString('base64')}`,
          }),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'zatoshi',
          method,
          params,
        }),
      });

      if (!response.ok) {
        throw new Error(`RPC call failed: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(`RPC error: ${data.error.message}`);
      }

      return data.result;
    } catch (error) {
      console.error(`Zcash RPC error (${method}):`, error);
      throw error;
    }
  }

  /**
   * Get the current block count (height)
   */
  async getBlockCount(): Promise<number> {
    return this.rpcCall<number>('getblockcount');
  }

  /**
   * Get comprehensive blockchain information
   */
  async getBlockchainInfo(): Promise<ZcashBlockchainInfo> {
    return this.rpcCall<ZcashBlockchainInfo>('getblockchaininfo');
  }

  /**
   * Get block hash by height
   */
  async getBlockHash(height: number): Promise<string> {
    return this.rpcCall<string>('getblockhash', [height]);
  }

  /**
   * Get block information by hash
   */
  async getBlock(hash: string, verbosity: number = 1): Promise<ZcashBlock> {
    return this.rpcCall<ZcashBlock>('getblock', [hash, verbosity]);
  }

  /**
   * Get block by height
   */
  async getBlockByHeight(height: number): Promise<ZcashBlock> {
    const hash = await this.getBlockHash(height);
    return this.getBlock(hash);
  }

  /**
   * Get the best block hash
   */
  async getBestBlockHash(): Promise<string> {
    return this.rpcCall<string>('getbestblockhash');
  }

  /**
   * Get network hash rate per second
   */
  async getNetworkHashPS(blocks: number = 120, height: number = -1): Promise<number> {
    return this.rpcCall<number>('getnetworkhashps', [blocks, height]);
  }

  /**
   * Get mining info
   */
  async getMiningInfo(): Promise<any> {
    return this.rpcCall<any>('getmininginfo');
  }
}

// Export singleton instance
export const zcashRPC = new ZcashRPCService();

// Also export the class for testing/custom instances
export default ZcashRPCService;
