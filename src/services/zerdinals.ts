/**
 * Zerdinals API Service
 * Provides methods to interact with Zerdinals inscriptions and ZRC-20 tokens
 */

export interface ZerdinalsToken {
  tick: string; // Token ticker (e.g., "ZORE")
  name?: string;
  supply?: number | string;
  decimals?: number;
  holders?: number;
  minted?: number | string;
  mintedAmount?: number;
  limit?: number | string;
  progress?: number;
  price?: number;
  priceChange24h?: number;
  marketCap?: number;
  volume24h?: number;
  transactions?: number;
  deployBlock?: number;
  block?: number;
  deployTxid?: string;
  txid?: string;
  deployTime?: number;
  time?: number;
  description?: string;
  isMinted?: boolean;
  inscription_id?: string;
  deployer?: string;
  completedBlock?: number;
}

export interface ZerdinalsInscription {
  id: string;
  number: number;
  contentType: string;
  contentLength: number;
  timestamp: number;
  height: number;
  fee: number;
  address: string;
  txid: string;
}

export interface ZerdinalsHolder {
  address: string;
  balance: string;
  percentage: number;
}

export interface ZerdinalsTransaction {
  txid: string;
  from: string;
  to: string;
  amount: string;
  timestamp: number;
  height: number;
  type: 'mint' | 'transfer';
}

class ZerdinalsAPIService {
  private apiUrl: string;

  constructor() {
    // Use Next.js API proxy to avoid CORS issues
    this.apiUrl = '/api/zerdinals';
  }

  /**
   * Make an API call to Zerdinals
   */
  private async apiCall<T>(endpoint: string, options?: RequestInit): Promise<T> {
    try {
      const response = await fetch(`${this.apiUrl}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`API call failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Zerdinals API error (${endpoint}):`, error);
      throw error;
    }
  }

  /**
   * Get token information by ticker
   */
  async getToken(tick: string): Promise<ZerdinalsToken> {
    return this.apiCall<ZerdinalsToken>(`/token/${tick.toLowerCase()}`);
  }

  /**
   * Get all tokens from Zerdinals Token API
   */
  async getTokens(limit: number = 100, offset: number = 0): Promise<{ results: ZerdinalsToken[]; total?: number }> {
    const response = await this.apiCall<any>(`/zrc20/token/token-list/all?limit=${limit}&offset=${offset}`);
    return {
      results: response.data?.results || [],
      total: response.data?.total
    };
  }

  /**
   * Get token holders
   */
  async getTokenHolders(tick: string, limit: number = 100): Promise<ZerdinalsHolder[]> {
    return this.apiCall<ZerdinalsHolder[]>(`/token/${tick.toLowerCase()}/holders?limit=${limit}`);
  }

  /**
   * Get token transactions
   */
  async getTokenTransactions(
    tick: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<ZerdinalsTransaction[]> {
    return this.apiCall<ZerdinalsTransaction[]>(
      `/token/${tick.toLowerCase()}/transactions?limit=${limit}&offset=${offset}`
    );
  }

  /**
   * Get inscription by ID
   */
  async getInscription(id: string): Promise<ZerdinalsInscription> {
    return this.apiCall<ZerdinalsInscription>(`/inscription/${id}`);
  }

  /**
   * Get latest inscriptions
   */
  async getLatestInscriptions(limit: number = 50): Promise<ZerdinalsInscription[]> {
    return this.apiCall<ZerdinalsInscription[]>(`/inscriptions?limit=${limit}`);
  }

  /**
   * Get address balance for a specific token
   */
  async getAddressBalance(address: string, tick: string): Promise<{ balance: string }> {
    return this.apiCall<{ balance: string }>(`/address/${address}/token/${tick.toLowerCase()}`);
  }

  /**
   * Get all token balances for an address
   */
  async getAddressBalances(address: string): Promise<Record<string, string>> {
    return this.apiCall<Record<string, string>>(`/address/${address}/balances`);
  }

  /**
   * Search tokens
   */
  async searchTokens(query: string): Promise<ZerdinalsToken[]> {
    return this.apiCall<ZerdinalsToken[]>(`/search?q=${encodeURIComponent(query)}`);
  }

  /**
   * Get ZORE token specifically (helper method)
   */
  async getZOREToken(): Promise<ZerdinalsToken> {
    return this.getToken('zore');
  }

  /**
   * Mock data for development (until actual API endpoints are confirmed)
   * This provides fallback data structure
   */
  async getZORETokenMock(): Promise<ZerdinalsToken> {
    return {
      tick: 'ZORE',
      name: 'Zerdinals Ore',
      supply: '21000000',
      decimals: 8,
      holders: 1247,
      minted: '15750000',
      limit: '1000',
      progress: 75,
      price: 0.10,
      priceChange24h: 5.23,
      marketCap: 1575000,
      volume24h: 45230,
      transactions: 8934,
      deployBlock: 2450000,
      deployTime: 1704067200000,
      description: 'ZORE is the native mining token for ZMAPS blocks on the Zcash network.',
    };
  }
}

// Export singleton instance
export const zerdinalsAPI = new ZerdinalsAPIService();

// Also export the class for testing/custom instances
export default ZerdinalsAPIService;
