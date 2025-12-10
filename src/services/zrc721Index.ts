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
        // The API returns an array of tokens directly
        return Array.isArray(data) ? data : data.tokens || [];
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
}

export const zrc721IndexAPI = new ZRC721IndexAPI();
