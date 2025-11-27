export interface OrdinalIndexToken {
  ticker: string;
  max: string;
  max_base_units: string;
  supply: string;
  supply_base_units: string;
  lim: string;
  dec: string;
  deployer: string;
  inscription_id: string;
  progress?: number;
}

export interface OrdinalIndexTokensResponse {
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
  items: OrdinalIndexToken[];
}

export interface OrdinalIndexStatus {
  chain_tip?: number;
  height?: number;
  tokens?: number;
  inscriptions?: number;
  names?: number;
  synced?: boolean;
  version?: string;
  components?: Record<string, { height: number; tip: number }>;
}

export interface HealthSnapshot {
  chain_tip?: number;
  height?: number;
  synced?: boolean;
  version?: string;
  components?: Record<string, { height: number; tip: number }>;
}

export interface ZRC20Status {
  chain_tip?: number;
  height?: number;
  tokens?: number;
  version?: string;
}

export interface OrdinalIndexBalanceEntry {
  address: string;
  available: string;
  overall: string;
  tick: string;
}

export interface OrdinalIndexBalancesResponse {
  page: number;
  limit: number;
  holders: OrdinalIndexBalanceEntry[];
  total_holders?: number;
  total_positive_holders?: number;
  positive_only?: boolean;
  tick?: string;
}

export interface TokenSummary {
  dec?: string;
  holders?: number;
  lim?: string;
  max?: string;
  supply_base_units?: string;
  tick: string;
  transfers_completed?: number;
  holders_total?: number;
  integrity?: {
    burned_base_units?: string;
    consistent?: boolean;
    sum_holders_base_units?: string;
  };
}

export interface TokenIntegrity {
  burned_base_units?: string;
  consistent: boolean;
  dec?: string;
  sum_available_base_units?: string;
  sum_overall_base_units?: string;
  supply_base_units?: string;
  tick: string;
  total_holders?: number;
  holders_positive?: number;
}

export interface ZRC721Collection {
  collection: string;
  deployer: string;
  inscription_id: string;
  meta?: string;
  minted?: number | string;
  royalty?: string;
  supply?: number | string;
}

export interface ZRC721CollectionsResponse {
  page: number;
  limit: number;
  collections: ZRC721Collection[];
}

export interface ZRC721Token {
  token_id: string;
  owner?: string;
  inscription_id: string;
  metadata_path?: string;
  metadata?: Record<string, unknown>;
}

export interface ZRC721TokensResponse {
  page: number;
  limit: number;
  tick: string;
  tokens: ZRC721Token[];
}

export interface ZRC721Status {
  chain_tip?: number;
  height?: number;
  collections?: number;
  tokens?: number;
  version?: string;
}

// Names API
export interface IndexerNameItem {
  name?: string; // domain without TLD
  domain?: string; // alias for name
  tld?: string; // e.g., 'zec' | 'zcash'
  owner?: string;
  inscription_id?: string;
  inscriptionId?: string;
}

export interface IndexerNamesResponse {
  page: number;
  limit: number;
  total?: number;
  has_more?: boolean;
  items: IndexerNameItem[];
}

class OrdinalIndexAPIService {
  private baseUrl = '/api/ordinal-index';

  private async apiCall<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Ordinal Index API error (${endpoint}): ${response.status} ${text}`
      );
    }

    return (await response.json()) as T;
  }

  async getTokens(
    page = 0,
    limit = 100,
    query?: string
  ): Promise<OrdinalIndexTokensResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });

    if (query) {
      params.set('q', query);
    }

    return this.apiCall<OrdinalIndexTokensResponse>(
      `/api/v1/tokens?${params.toString()}`
    );
  }

  async getStatus(): Promise<OrdinalIndexStatus> {
    return this.apiCall<OrdinalIndexStatus>('/api/v1/status');
  }

  async getHealth(): Promise<HealthSnapshot> {
    return this.apiCall<HealthSnapshot>('/api/v1/healthz');
  }

  async getZRC20Status(): Promise<ZRC20Status> {
    return this.apiCall<ZRC20Status>('/api/v1/zrc20/status');
  }

  async getTokenBalances(
    tick: string,
    page = 0,
    limit = 100,
    options?: { positiveOnly?: boolean }
  ): Promise<OrdinalIndexBalancesResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });

    if (options?.positiveOnly) {
      params.set('positive_only', 'true');
    }

    return this.apiCall<OrdinalIndexBalancesResponse>(
      `/api/v1/zrc20/token/${tick.toLowerCase()}/balances?${params.toString()}`
    );
  }

  async getTokenSummary(tick: string): Promise<TokenSummary> {
    return this.apiCall<TokenSummary>(
      `/api/v1/zrc20/token/${tick.toLowerCase()}/summary`
    );
  }

  async getTokenIntegrity(tick: string): Promise<TokenIntegrity> {
    return this.apiCall<TokenIntegrity>(
      `/api/v1/zrc20/token/${tick.toLowerCase()}/integrity`
    );
  }

  async getZRC721Collections(
    page = 0,
    limit = 50
  ): Promise<ZRC721CollectionsResponse> {
    return this.apiCall<ZRC721CollectionsResponse>(
      `/api/v1/zrc721/collections?page=${page}&limit=${limit}`
    );
  }

  async getZRC721Collection(collection: string): Promise<ZRC721Collection> {
    return this.apiCall<ZRC721Collection>(
      `/api/v1/zrc721/collection/${collection}`
    );
  }

  async getZRC721CollectionTokens(
    collection: string,
    page = 0,
    limit = 200
  ): Promise<ZRC721TokensResponse> {
    return this.apiCall<ZRC721TokensResponse>(
      `/api/v1/zrc721/collection/${collection}/tokens?page=${page}&limit=${limit}`
    );
  }

  async getZRC721Status(): Promise<ZRC721Status> {
    return this.apiCall<ZRC721Status>('/api/v1/zrc721/status');
  }

  async getNames(
    page = 0,
    limit = 50,
    tld?: string
  ): Promise<IndexerNamesResponse> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (tld) params.set('tld', tld);
    const res = await this.apiCall<any>(`/api/v1/names?${params.toString()}`);
    // Normalize response shape
    const items: IndexerNameItem[] = Array.isArray(res)
      ? res
      : (res?.items ?? []);
    return {
      page: (res?.page ?? page) as number,
      limit: (res?.limit ?? limit) as number,
      total: (res?.total ?? undefined) as number | undefined,
      has_more: (res?.has_more ?? (Array.isArray(items) && items.length === limit)) as boolean,
      items,
    };
  }
}

export const ordinalIndexAPI = new OrdinalIndexAPIService();
