'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { MintedTokenSummary } from '@/types/profile';

const VERIFIED_COLLECTIONS = new Set(['zgods']);

type Props = {
  items: MintedTokenSummary[];
  pinnedIds: string[];
  isOwner: boolean;
  onTogglePin: (inscriptionId: string) => void;
  onSelectPfp: (inscriptionId: string) => void;
  savingIds: string[];
};

const PinIcon = ({ active }: { active: boolean }) => (
  <svg
    className={`h-4 w-4 ${active ? 'text-gold-300' : 'text-gold-200/50'}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
  >
    <path
      d="M15.5 4.5h-7l.5 5c-1.5.5-2.5 1.5-2.5 3h11c0-1.5-1-2.5-2.5-3l.5-5Zm-3.5 8v7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function ProfileGallery({ items, pinnedIds, isOwner, onTogglePin, onSelectPfp, savingIds }: Props) {
  const pinned = items.filter((item) => item.inscriptionId && pinnedIds.includes(item.inscriptionId));
  const rest = items.filter((item) => !item.inscriptionId || !pinnedIds.includes(item.inscriptionId));

  const GalleryCard = ({ item }: { item: MintedTokenSummary }) => {
    const [imageLoaded, setImageLoaded] = useState(false);
    return (
      <div className="relative rounded-xl border border-gold-500/20 bg-black/40 p-3">
        <div className="relative w-full overflow-hidden rounded-sm border border-gold-500/10 bg-black/30 aspect-square">
          {item.imageUrls[0] ? (
            <>
              <Image
                src={item.imageUrls[0]}
                alt={item.name}
                fill
                unoptimized
                sizes="(max-width: 640px) 100vw, 33vw"
                className={`object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                onLoadingComplete={() => setImageLoaded(true)}
                onError={() => setImageLoaded(true)}
              />
              {!imageLoaded && <div className="absolute inset-0 animate-pulse bg-gold-500/10" />}
            </>
          ) : (
            <div className="h-full w-full bg-black/40" />
          )}
        </div>
        <div className="mt-3 space-y-1">
          <p className="text-sm uppercase tracking-wide text-gold-500/70 flex items-center gap-2">
            {item.collectionName}
            {VERIFIED_COLLECTIONS.has(item.collectionSlug) && (
              <Image
                src="/verified.png"
                alt="Verified collection"
                width={16}
                height={16}
                unoptimized
                title="Verified collection"
              />
            )}
          </p>
          <h4 className="text-lg font-semibold text-white">{item.name}</h4>
          <p className="text-xs text-gold-200/70">Token #{item.tokenId}</p>
        </div>
        {isOwner && item.inscriptionId && (
          <div className="mt-3 flex items-center justify-between gap-2 text-xs font-semibold">
            <button
              onClick={() => onSelectPfp(item.inscriptionId!)}
              className="flex-1 rounded-full border border-gold-500/30 px-3 py-1 text-gold-100 hover:bg-gold-500/10"
            >
              Set PFP
            </button>
            <button
              onClick={() => onTogglePin(item.inscriptionId!)}
              className="p-1.5 hover:text-gold-200/80 transition"
            >
              <PinIcon active={pinnedIds.includes(item.inscriptionId!)} />
            </button>
          </div>
        )}
        {savingIds.includes(item.inscriptionId || '') && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60 text-sm text-gold-100">
            Saving...
          </div>
        )}
      </div>
    );
  };

  const galleryItems = rest;

  return (
    <section className="space-y-8">
      {pinned.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold uppercase tracking-wide text-gold-200">Pinned Inscriptions</h3>
            <span className="text-xs text-gold-400/80">{pinned.length} selected</span>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {pinned.map((item) => (
              <div key={`pinned-${item.id}`} className="w-64 flex-shrink-0">
                <GalleryCard item={item} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold uppercase tracking-wide text-gold-200">Recent Inscriptions</h3>
          <span className="text-xs text-gold-400/80">{galleryItems.length} shown</span>
        </div>
        {galleryItems.length === 0 ? (
          <div className="rounded-xl border border-gold-500/20 bg-black/40 p-6 text-center text-gold-200/60">
            No inscriptions minted yet.
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {galleryItems.map((item) => (
              <GalleryCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
