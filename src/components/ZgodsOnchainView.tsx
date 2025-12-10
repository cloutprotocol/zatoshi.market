'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { zrc721IndexAPI, type ZRC721Token, type ZRC721Collection } from '@/services/zrc721Index';
import { getCollectionConfig } from '@/config/collections';
import { buildImageUrls, buildTokenName, fetchCollectionMetadata } from '@/lib/collectionAssets';
import { loadImageWithRace } from '@/lib/imageLoader';

type EnrichedToken = ZRC721Token & {
    imageUrls: string[];
    name: string;
    tokenIdNum: number;
    id: string; // Alias for token_id for backward compatibility
    inscription: string; // Alias for inscription_id
    collection?: string; // Alias for tick
};

type ZgodsOnchainViewProps = {
    collectionSlug: string;
    limit?: number;
    title?: string;
    cardSize?: 'sm' | 'md';
    showForAddress?: string; // If provided, only show tokens owned by this address
};

export function ZgodsOnchainView({
    collectionSlug,
    limit = 12,
    title,
    cardSize = 'md',
    showForAddress
}: ZgodsOnchainViewProps) {
    const [tokens, setTokens] = useState<EnrichedToken[]>([]);
    const [collection, setCollection] = useState<ZRC721Collection | null>(null);
    const [loading, setLoading] = useState(true);
    const [imageLoaded, setImageLoaded] = useState<Record<string, boolean>>({});
    const [imageError, setImageError] = useState<Record<string, boolean>>({});
    const [optimalImageUrls, setOptimalImageUrls] = useState<Record<string, string>>({});

    const collectionConfig = getCollectionConfig(collectionSlug);

    const fetchData = useCallback(async () => {
        if (!collectionConfig) {
            setLoading(false);
            return;
        }

        try {
            // Fetch collection info
            const collectionData = await zrc721IndexAPI.getCollection(collectionConfig.name.toLowerCase());
            setCollection(collectionData);

            // Fetch tokens
            let allTokens: ZRC721Token[];
            if (showForAddress) {
                // Filter by address
                const addressTokens = await zrc721IndexAPI.getTokensByAddress(showForAddress);
                allTokens = addressTokens.filter(t =>
                    t.tick?.toLowerCase() === collectionConfig.name.toLowerCase()
                );
            } else {
                // Get recently inscribed tokens (chronological order)
                // This queries the main inscription index which has timestamps
                allTokens = await zrc721IndexAPI.getRecentTokens(collectionConfig.name.toLowerCase(), limit * 2);
            }

            // Map to enriched format
            const sortedTokens = allTokens
                .map(t => ({
                    ...t,
                    tokenIdNum: parseInt(t.token_id, 10),
                    id: t.token_id,
                    inscription: t.inscription_id,
                    collection: t.tick
                }))
                .slice(0, limit);

            // Enrich with collection artwork
            const enriched = await Promise.all(
                sortedTokens.map(async (token) => {
                    try {
                        const metadata = await fetchCollectionMetadata(collectionConfig, token.tokenIdNum);
                        const imageUrls = buildImageUrls(collectionConfig, token.tokenIdNum, metadata);
                        return {
                            ...token,
                            imageUrls,
                            name: buildTokenName(collectionConfig, token.tokenIdNum, metadata),
                        } as EnrichedToken;
                    } catch (err) {
                        // Fallback if metadata fails
                        return {
                            ...token,
                            imageUrls: [],
                            name: `${collectionConfig.name} #${token.token_id}`,
                        } as EnrichedToken;
                    }
                })
            );

            setTokens(enriched);

            // Preload images for first 6 items (above the fold)
            enriched.slice(0, 6).forEach(async (token) => {
                if (token.imageUrls.length > 0) {
                    try {
                        const result = await loadImageWithRace({ urls: token.imageUrls, timeout: 3000 });
                        if (result.success && result.url) {
                            setOptimalImageUrls((prev) => ({ ...prev, [token.id]: result.url! }));
                            setImageLoaded((prev) => ({ ...prev, [token.id]: true }));
                        }
                    } catch (err) {
                        // Suppress image preload errors
                    }
                }
            });
        } catch (err) {
            console.error('Failed to fetch ZGODS onchain data', err);
        } finally {
            setLoading(false);
        }
    }, [collectionConfig, limit, showForAddress]);

    useEffect(() => {
        fetchData();
        // Poll every 30 seconds
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleImageLoad = async (tokenId: string, urls: string[]) => {
        if (optimalImageUrls[tokenId]) {
            return;
        }

        try {
            const result = await loadImageWithRace({ urls, timeout: 5000 });
            if (result.success && result.url) {
                setOptimalImageUrls((prev) => ({ ...prev, [tokenId]: result.url! }));
                setImageLoaded((prev) => ({ ...prev, [tokenId]: true }));
            } else {
                setImageError((prev) => ({ ...prev, [tokenId]: true }));
            }
        } catch (err) {
            setImageError((prev) => ({ ...prev, [tokenId]: true }));
        }
    };

    const cardWidthClass = cardSize === 'sm' ? 'w-28 sm:w-32 md:w-36' : 'w-40 sm:w-48';

    // Render loading state
    if (loading) {
        return (
            <div className="space-y-4">
                {title && (
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <h2 className="text-2xl font-bold text-gold-100 tracking-tight">{title}</h2>
                        <div className="px-2 py-1 bg-gold-500/15 border border-gold-400/40 rounded-full">
                            <span className="text-sm sm:text-base font-semibold text-gold-100">Loading...</span>
                        </div>
                    </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {Array.from({ length: 6 }).map((_, idx) => (
                        <div key={`skeleton-${idx}`} className="aspect-square bg-black/20 border border-gold-500/10 rounded skeleton" />
                    ))}
                </div>
            </div>
        );
    }

    // Render badge (only when collection data is loaded)
    const mintedBadge = collection && (
        <div className="px-2 py-1 bg-gold-500/15 border border-gold-400/40 rounded-full flex items-center gap-2">
            <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            <span className="text-sm sm:text-base font-semibold text-gold-100">
                {collection?.minted?.toLocaleString()} / {collection?.supply?.toLocaleString()} minted
            </span>
        </div>
    );

    // Render empty state
    if (tokens.length === 0) {
        return (
            <div className="space-y-4">
                {title ? (
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <h2 className="text-2xl font-bold text-gold-100 tracking-tight">{title}</h2>
                        {mintedBadge}
                    </div>
                ) : (
                    <div className="flex items-center justify-end gap-4 flex-wrap">
                        {mintedBadge}
                    </div>
                )}
                <div className="text-center py-12 text-gold-200/60">
                    {showForAddress ? 'No tokens found for this address.' : 'No tokens minted yet.'}
                </div>
            </div>
        );
    }

    // Render tokens
    return (
        <div className="space-y-6">
            {title ? (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h2 className="text-2xl font-bold text-gold-100 tracking-tight">{title}</h2>
                    {mintedBadge}
                </div>
            ) : (
                <div className="flex items-center justify-end gap-4 flex-wrap">
                    {mintedBadge}
                </div>
            )}

            {/* Carousel */}
            <div className="relative overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
                <div className="flex gap-4 min-w-min">
                    {tokens.map((token, idx) => {
                        const isAboveFold = idx < 6;
                        const imageUrl = optimalImageUrls[token.id] || token.imageUrls[0];

                        return (
                            <Link
                                key={token.inscription}
                                href={`/inscription/${token.inscription}`}
                                className={`flex-shrink-0 ${cardWidthClass} group`}
                            >
                                <div className="relative aspect-square overflow-hidden rounded border border-gold-500/20 bg-black/40 group-hover:border-gold-400/60 transition-all">
                                    {!imageLoaded[token.id] && !imageError[token.id] && (
                                        <div className="absolute inset-0 bg-black/30 skeleton" />
                                    )}
                                    {imageError[token.id] && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-gold-200/60">
                                            Image unavailable
                                        </div>
                                    )}
                                    {token.imageUrls.length > 0 && (
                                        <Image
                                            src={imageUrl}
                                            alt={token.name}
                                            fill
                                            unoptimized
                                            priority={isAboveFold}
                                            sizes="(max-width: 640px) 50vw, 200px"
                                            onLoad={() => {
                                                setImageLoaded((prev) => ({ ...prev, [token.id]: true }));
                                                if (!isAboveFold && !optimalImageUrls[token.id]) {
                                                    handleImageLoad(token.id, token.imageUrls);
                                                }
                                            }}
                                            onError={() => {
                                                if (!optimalImageUrls[token.id]) {
                                                    handleImageLoad(token.id, token.imageUrls);
                                                } else {
                                                    setImageError((prev) => ({ ...prev, [token.id]: true }));
                                                }
                                            }}
                                            className={`object-cover transition-opacity duration-300 ${imageLoaded[token.id] ? 'opacity-100' : 'opacity-0'}`}
                                        />
                                    )}
                                </div>
                                <div className="mt-2 space-y-1">
                                    <div className="text-sm font-semibold text-gold-100 truncate group-hover:text-gold-300 transition-colors">
                                        {token.name}
                                    </div>
                                    <div className="text-xs text-gold-200/60">#{token.id}</div>
                                    {showForAddress && (
                                        <div className="text-[10px] text-gold-400/50 font-mono truncate">
                                            {token.inscription.slice(0, 8)}...
                                        </div>
                                    )}
                                </div>
                            </Link>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
