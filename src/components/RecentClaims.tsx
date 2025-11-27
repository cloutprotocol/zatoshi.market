'use client';

import { useEffect, useState } from 'react';
import { getConvexClient } from '@/lib/convexClient';
import { api } from '../../convex/_generated/api';
import { getCollectionConfig } from '@/config/collections';
import { buildImageUrls, buildTokenName, fetchCollectionMetadata } from '@/lib/collectionAssets';
import { loadImageWithRace } from '@/lib/imageLoader';

type ClaimedToken = {
  tokenId: number;
  inscriptionId: string;
  imageUrls: string[];
  name: string;
};

type RecentClaimsProps = {
  collectionSlug: string;
  limit?: number;
  title?: string;
  cardSize?: 'sm' | 'md';
};

export function RecentClaims({ collectionSlug, limit = 12, title, cardSize = 'md' }: RecentClaimsProps) {
  const [claims, setClaims] = useState<ClaimedToken[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [imageLoaded, setImageLoaded] = useState<Record<number, boolean>>({});
  const [imageError, setImageError] = useState<Record<number, boolean>>({});
  const [optimalImageUrls, setOptimalImageUrls] = useState<Record<number, string>>({});

  useEffect(() => {
    const fetchClaims = async () => {
      const convex = getConvexClient();
      if (!convex) {
        setLoading(false);
        return;
      }

      try {
        // Get recent claims
        const minted = await convex.query(api.collectionClaims.listMinted, {
          collectionSlug,
          limit,
        });

        // Get total count
        const stats = await convex.query(api.collectionClaims.getClaimStats, {
          collectionSlug,
        });

        setTotalCount(stats.mintedCount);

        const collection = getCollectionConfig(collectionSlug);
        if (!collection) {
          setLoading(false);
          return;
        }

        // Enrich with collection artwork
        const enriched = await Promise.all(
          (minted as any[]).map(async (mint: any) => {
            try {
              const metadata = await fetchCollectionMetadata(collection, mint.tokenId);
              const imageUrls = buildImageUrls(collection, mint.tokenId, metadata);
              return {
                tokenId: mint.tokenId,
                inscriptionId: mint.inscriptionId,
                imageUrls,
                name: buildTokenName(collection, mint.tokenId, metadata),
              } as ClaimedToken;
            } catch (err) {
              // Suppress metadata load errors
              return null;
            }
          })
        );

        const validClaims = enriched.filter((c): c is ClaimedToken => c !== null);
        setClaims(validClaims);

        // Preload images using race loading for first 6 items (above the fold)
        validClaims.slice(0, 6).forEach(async (claim) => {
          if (claim.imageUrls.length > 0) {
            try {
              const result = await loadImageWithRace({ urls: claim.imageUrls, timeout: 3000 });
              if (result.success && result.url) {
                setOptimalImageUrls((prev) => ({ ...prev, [claim.tokenId]: result.url! }));
                setImageLoaded((prev) => ({ ...prev, [claim.tokenId]: true }));
              }
            } catch (err) {
              // Suppress image preload errors
            }
          }
        });
      } catch (err) {
        console.error('Failed to fetch recent claims', err);
      } finally {
        setLoading(false);
      }
    };

    fetchClaims();
    // Refresh every 30 seconds
    const interval = setInterval(fetchClaims, 30000);
    return () => clearInterval(interval);
  }, [collectionSlug, limit]);

  const handleImageLoad = async (tokenId: number, urls: string[]) => {
    // If we already have an optimal URL from race loading, skip
    if (optimalImageUrls[tokenId]) {
      return;
    }

    // Otherwise, try race loading now
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

  const mintedBadge = (
    <div className="px-2 py-1 bg-gold-500/15 border border-gold-400/40 rounded-full flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
      </span>
      <span className="text-sm sm:text-base font-semibold text-gold-100">
        {totalCount.toLocaleString()} minted
      </span>
    </div>
  );

  const cardWidthClass = cardSize === 'sm' ? 'w-28 sm:w-32 md:w-36' : 'w-40 sm:w-48';

  const headerRow = title ? (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <h2 className="text-2xl font-bold text-gold-100 tracking-tight">{title}</h2>
      {mintedBadge}
    </div>
  ) : (
    <div className="flex items-center justify-end gap-4 flex-wrap">
      {mintedBadge}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {headerRow}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={`skeleton-${idx}`} className="aspect-square bg-black/20 border border-gold-500/10 rounded skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (claims.length === 0) {
    return (
      <div className="space-y-4">
        {headerRow}
        <div className="text-center py-12 text-gold-200/60">
          No claims yet. Be the first to claim!
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {headerRow}

      {/* Carousel */}
      <div className="relative overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-4 min-w-min">
          {claims.map((claim, idx) => {
            const isAboveFold = idx < 6;
            const imageUrl = optimalImageUrls[claim.tokenId] || claim.imageUrls[0];

            return (
              <div
                key={claim.inscriptionId}
                className={`flex-shrink-0 ${cardWidthClass} group`}
              >
                <div className="relative aspect-square overflow-hidden rounded border border-gold-500/20 bg-black/40 group-hover:border-gold-400/60 transition-all">
                  {!imageLoaded[claim.tokenId] && !imageError[claim.tokenId] && (
                    <div className="absolute inset-0 bg-black/30 skeleton" />
                  )}
                  {imageError[claim.tokenId] && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-gold-200/60">
                      Image unavailable
                    </div>
                  )}
                  {claim.imageUrls.length > 0 && (
                    <img
                      src={imageUrl}
                      alt={claim.name}
                      loading={isAboveFold ? undefined : 'lazy'}
                      fetchPriority={isAboveFold ? 'high' : undefined}
                      onLoad={() => {
                        setImageLoaded((prev) => ({ ...prev, [claim.tokenId]: true }));
                        // Trigger race loading for lazy-loaded images
                        if (!isAboveFold && !optimalImageUrls[claim.tokenId]) {
                          handleImageLoad(claim.tokenId, claim.imageUrls);
                        }
                      }}
                      onError={() => {
                        if (!optimalImageUrls[claim.tokenId]) {
                          handleImageLoad(claim.tokenId, claim.imageUrls);
                        } else {
                          setImageError((prev) => ({ ...prev, [claim.tokenId]: true }));
                        }
                      }}
                      className={`w-full h-full object-cover transition-opacity duration-300 ${imageLoaded[claim.tokenId] ? 'opacity-100' : 'opacity-0'
                        }`}
                    />
                  )}
                </div>
                <div className="mt-2 space-y-1">
                  <div className="text-sm font-semibold text-gold-100 truncate group-hover:text-gold-300 transition-colors">
                    {claim.name}
                  </div>
                  <div className="text-xs text-gold-200/60">#{claim.tokenId.toLocaleString()}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
