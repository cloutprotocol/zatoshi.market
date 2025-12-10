/**
 * ZRC-721 Onchain Index API Client
 *
 * This service interfaces with the onchain ZRC-721 indexer
 * to fetch collection and token data directly from the blockchain index.
 */

// Use proxy in production to avoid mixed content issues
const BASE_URL = typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? '/api/zrc721'
    : 'http://135.181.6.234:3333/api/v1/zrc721';

export type ZRC721Token = {
    token_id: string;
    owner: string;
    inscription_id: string;
    tick: string;
    metadata?: any;
    metadata_path?: string;
    shielded_burn?: boolean;
};

export type ZRC721Collection = {
    collection: string;
    supply: number | string; // API returns string, we'll parse it
    minted: number;
    meta?: string;
    royalty?: string;
    deployer?: string;
    inscription_id?: string;
};

export type ZRC721TokensResponse = {
    tokens: ZRC721Token[];
    total: number;
    page: number;
    limit: number;
};

export type ZRC721Status = {
    collections: number;
    tokens: number;
    lastBlock?: number;
};

class ZRC721IndexAPI {
    private baseUrl: string;

    constructor(baseUrl: string = BASE_URL) {
        this.baseUrl = baseUrl;
    }

    /**
     * Get all collections with pagination
     */
    async getCollections(page: number = 0, limit: number = 100): Promise<ZRC721Collection[]> {
        const url = `${this.baseUrl}/collections?page=${page}&limit=${limit}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch collections: ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get a specific collection by name
     */
    async getCollection(collectionName: string): Promise<ZRC721Collection> {
        const url = `${this.baseUrl}/collection/${collectionName}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch collection ${collectionName}: ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get all tokens for a collection with pagination
     * Note: API returns tokens in alphabetical order, not numerical
     */
    async getCollectionTokens(
        collectionName: string,
        page: number = 0,
        limit: number = 10000
    ): Promise<ZRC721Token[]> {
        const url = `${this.baseUrl}/collection/${collectionName}/tokens?page=${page}&limit=${limit}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch tokens for ${collectionName}: ${response.statusText}`);
        }
        const data = await response.json();
        // The API returns an object with tokens array
        return data.tokens || [];
    }

    /**
     * Get a specific token by collection and ID
     */
    async getToken(collectionName: string, tokenId: string): Promise<ZRC721Token> {
        const url = `${this.baseUrl}/token/${collectionName}/${tokenId}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch token ${collectionName}/${tokenId}: ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get all tokens owned by an address
     */
    async getTokensByAddress(address: string): Promise<ZRC721Token[]> {
        const url = `${this.baseUrl}/address/${address}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch tokens for address ${address}: ${response.statusText}`);
        }
        const data = await response.json();
        return Array.isArray(data) ? data : data.tokens || [];
    }

    /**
     * Get indexer status
     */
    async getStatus(): Promise<ZRC721Status> {
        const url = `${this.baseUrl}/status`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch status: ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get recently inscribed tokens for a collection by querying the main inscription index
     * This provides chronological order (most recent first) unlike the token endpoint
     */
    async getRecentTokens(collectionName: string, limit: number = 20): Promise<ZRC721Token[]> {
        try {
            // Query main inscription index which has timestamps
            // Use proxy route when on HTTPS, direct when on HTTP (dev)
            const isProduction = typeof window !== 'undefined' && window.location.protocol === 'https:';
            const baseUrl = isProduction ? '/api' : 'http://135.181.6.234:3333/api/v1';
            const url = `${baseUrl}/inscriptions?page=0&limit=1000`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch recent inscriptions: ${response.statusText}`);
            }
            const data = await response.json();

            // Filter for this collection's mint inscriptions and extract token IDs
            const mintInscriptions = (data.items || [])
                .filter((item: any) => {
                    if (!item.preview_text) return false;
                    try {
                        const json = JSON.parse(item.preview_text);
                        return json.p === 'zrc-721' &&
                               json.op === 'mint' &&
                               json.collection?.toLowerCase() === collectionName.toLowerCase();
                    } catch {
                        return false;
                    }
                })
                .slice(0, limit);

            // Fetch full token data for each inscription
            const tokens = await Promise.all(
                mintInscriptions.map(async (item: any) => {
                    try {
                        const json = JSON.parse(item.preview_text);
                        return await this.getToken(collectionName, json.id);
                    } catch (err) {
                        return null;
                    }
                })
            );

            return tokens.filter((t): t is ZRC721Token => t !== null);
        } catch (err) {
            console.error('Failed to fetch recent tokens:', err);
            // Fallback to regular token fetch
            return [];
        }
    }
}

export const zrc721IndexAPI = new ZRC721IndexAPI();
