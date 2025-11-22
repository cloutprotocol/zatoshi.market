'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getConvexClient } from '@/lib/convexClient';
import { api } from '../../convex/_generated/api';
import { getCollectionConfig } from '@/config/collections';
import { buildImageUrls, buildTokenName, fetchCollectionMetadata } from '@/lib/collectionAssets';

type ClaimedToken = {
  tokenId: number;
  inscriptionId: string;
  imageUrls: string[];
  name: string;
};

type RecentClaimsProps = {
  collectionSlug: string;
  limit?: number;
};

export function RecentClaims({ collectionSlug, limit = 12 }: RecentClaimsProps) {
  const [claims, setClaims] = useState<ClaimedToken[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [imageLoaded, setImageLoaded] = useState<Record<number, boolean>>({});
  const [imageError, setImageError] = useState<Record<number, boolean>>({});

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
              console.error(`Failed to load metadata for token ${mint.tokenId}`, err);
              return null;
            }
          })
        );

        setClaims(enriched.filter((c): c is ClaimedToken => c !== null));
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

  const handleImageError = (img: HTMLImageElement, urls: string[], tokenId: number) => {
    const currentIndex = Number(img.dataset.index || '0');
    const nextIndex = currentIndex + 1;
    if (nextIndex < urls.length) {
      img.dataset.index = String(nextIndex);
      img.src = urls[nextIndex];
      setImageLoaded((prev) => ({ ...prev, [tokenId]: false }));
      setImageError((prev) => ({ ...prev, [tokenId]: false }));
    } else {
      img.onerror = null;
      setImageError((prev) => ({ ...prev, [tokenId]: true }));
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={`skeleton-${idx}`} className="aspect-square bg-black/20 border border-gold-500/10 rounded skeleton" />
        ))}
      </div>
    );
  }

  if (claims.length === 0) {
    return (
      <div className="text-center py-12 text-gold-200/60">
        No claims yet. Be the first to claim!
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Count Badge */}
      <div className="flex items-center justify-end gap-4 flex-wrap">
        <div className="px-4 py-2 bg-gold-500/15 border border-gold-400/40 rounded-full flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
          </span>
          <span className="text-sm sm:text-base font-semibold text-gold-100">
            {totalCount.toLocaleString()} minted
          </span>
        </div>
      </div>

      {/* Carousel */}
      <div className="relative overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-4 min-w-min">
          {claims.map((claim) => (
            <Link
              key={claim.inscriptionId}
              href={`/inscription/${claim.inscriptionId}`}
              className="flex-shrink-0 w-40 sm:w-48 group"
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
                    src={claim.imageUrls[0]}
                    data-index={0}
                    alt={claim.name}
                    loading="lazy"
                    onLoad={() => setImageLoaded((prev) => ({ ...prev, [claim.tokenId]: true }))}
                    onError={(e) => handleImageError(e.currentTarget, claim.imageUrls, claim.tokenId)}
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
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
