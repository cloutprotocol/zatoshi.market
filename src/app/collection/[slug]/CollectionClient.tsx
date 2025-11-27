'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCollectionConfig } from '@/config/collections';
import {
  buildImageUrls,
  buildTokenName,
  fetchCollectionMetadata,
  CollectionTokenMetadata,
} from '@/lib/collectionAssets';
import type { MintedTokenSummary } from '@/types/profile';
import { getConvexClient } from '@/lib/convexClient';
import { loadImageWithRace, useIpfsImage } from '@/lib/imageLoader';
import { useInViewport } from '@/hooks/useInViewport';
import { api } from '../../../../convex/_generated/api';

type Props = { slug: string };
type ViewMode = 'grid' | 'compact' | 'list';
type StatusFilter = 'all' | 'minted' | 'locked';

type ClaimStats = {
  mintedCount: number;
  mintedIds: number[];
  mintedForAddress: { count: number; ids: number[] };
  reservedCount: number;
  reservedForAddress: { count: number; ids: number[] };
};

type TraitSummary = Record<string, { value: string; count: number }[]>;
type TraitGroup = { trait: string; values: { value: string; count: number }[] };

type CollectionToken = MintedTokenSummary & {
  minted: boolean;
  traits?: CollectionTokenMetadata['attributes'];
};

const VERIFIED_COLLECTIONS = new Set(['zgods']);
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'minted', label: 'Minted' },
  { value: 'locked', label: 'Locked' },
];

const VIEW_OPTIONS: { value: ViewMode; icon: JSX.Element }[] = [
  {
    value: 'grid',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <rect x="2" y="2" width="4" height="4" rx="1" />
        <rect x="10" y="2" width="4" height="4" rx="1" />
        <rect x="2" y="10" width="4" height="4" rx="1" />
        <rect x="10" y="10" width="4" height="4" rx="1" />
      </svg>
    ),
  },
  {
    value: 'compact',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <rect x="2" y="3" width="3" height="3" rx="1" />
        <rect x="7" y="3" width="3" height="3" rx="1" />
        <rect x="12" y="3" width="3" height="3" rx="1" />
        <rect x="2" y="10" width="3" height="3" rx="1" />
        <rect x="7" y="10" width="3" height="3" rx="1" />
        <rect x="12" y="10" width="3" height="3" rx="1" />
      </svg>
    ),
  },
  {
    value: 'list',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <rect x="2" y="3" width="2" height="2" rx="1" />
        <rect x="5" y="3" width="9" height="2" rx="1" />
        <rect x="2" y="7" width="2" height="2" rx="1" />
        <rect x="5" y="7" width="9" height="2" rx="1" />
        <rect x="2" y="11" width="2" height="2" rx="1" />
        <rect x="5" y="11" width="9" height="2" rx="1" />
      </svg>
    ),
  },
];

export function CollectionClient({ slug }: Props) {
  const collection = getCollectionConfig(slug);
  const [tokens, setTokens] = useState<CollectionToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimStats, setClaimStats] = useState<ClaimStats | null>(null);
  const [mintedTotal, setMintedTotal] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedTraits, setSelectedTraits] = useState<Record<string, string[]>>({});
  const [traitSearch, setTraitSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(36);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!collection) {
        setLoading(false);
        setClaimStats(null);
        return;
      }
      const convex = getConvexClient();
      if (!convex) {
        setLoading(false);
        setClaimStats(null);
        return;
      }
      setLoading(true);
      setClaimStats(null);
      setMintedTotal(0);
      try {
        const supplyLimit = typeof collection.supply === 'number' ? collection.supply : 10000;
        const [mintedDocs, stats, metadataMap] = await Promise.all([
          convex.query(api.collectionClaims.listMinted, {
            collectionSlug: collection.slug,
            limit: supplyLimit,
          }) as Promise<any[]>,
          convex.query(api.collectionClaims.getClaimStats, {
            collectionSlug: collection.slug,
          }) as Promise<ClaimStats>,
          (async () => {
            try {
              const res = await fetch(`/api/collections/${collection.slug}/metadata`);
              if (!res.ok) throw new Error('metadata fetch failed');
              const json = (await res.json()) as Record<string, CollectionTokenMetadata>;
              const entries: Record<number, CollectionTokenMetadata> = {};
              Object.entries(json).forEach(([key, value]) => {
                const tokenId = Number(key);
                if (!Number.isNaN(tokenId)) {
                  entries[tokenId] = value;
                }
              });
              return entries;
            } catch (err) {
              console.warn('Metadata index unavailable, falling back to per-token fetch', err);
              return null;
            }
          })(),
        ]);
        const mapped: CollectionToken[] = [];
        const BATCH = 25;
        for (let i = 0; i < mintedDocs.length; i += BATCH) {
          const batch = mintedDocs.slice(i, i + BATCH);
          const enriched = await Promise.all(
            batch.map(async (doc) => {
              const metadata =
                metadataMap?.[doc.tokenId] ?? (await fetchCollectionMetadata(collection, doc.tokenId));
              const imageUrls = buildImageUrls(collection, doc.tokenId, metadata);
              return {
                id: `${collection.slug}-${doc.tokenId}`,
                collectionSlug: collection.slug,
                collectionName: collection.name,
                tokenId: doc.tokenId,
                inscriptionId: doc.inscriptionId,
                imageUrls,
                name: buildTokenName(collection, doc.tokenId, metadata),
                createdAt: doc.createdAt ?? 0,
                ownerAddress: doc.address,
                minted: true,
                traits: metadata?.attributes ?? [],
              } as CollectionToken;
            })
          );
          mapped.push(...enriched);
        }
        const mintedMap = new Map<number, CollectionToken>();
        let highestTokenId = -1;
        for (const entry of mapped) {
          mintedMap.set(entry.tokenId, entry);
          highestTokenId = Math.max(highestTokenId, entry.tokenId);
        }
        let combined: CollectionToken[] = [...mapped];
        if (metadataMap && Object.keys(metadataMap).length > 0) {
          const metadataIds = Object.keys(metadataMap)
            .map((id) => Number(id))
            .filter((id) => !Number.isNaN(id))
            .sort((a, b) => a - b);
          const metaMaxId = metadataIds.length ? metadataIds[metadataIds.length - 1] : -1;
          const metaSupply = metaMaxId >= 0 ? metaMaxId + 1 : 0;
          const supplyCap = Math.max(
            typeof collection.supply === 'number' ? collection.supply : 0,
            metaSupply,
            highestTokenId + 1
          );
          const placeholderTokens: CollectionToken[] = [];
          const idsToRender = metadataIds.length > 0 ? metadataIds : Array.from({ length: supplyCap }, (_, i) => i);
          for (const tokenId of idsToRender) {
            const mintedToken = mintedMap.get(tokenId);
            if (mintedToken) {
              placeholderTokens.push(mintedToken);
            } else {
              const metadata = metadataMap[tokenId];
              placeholderTokens.push({
                id: `${collection.slug}-${tokenId}-locked`,
                collectionSlug: collection.slug,
                collectionName: collection.name,
                tokenId,
                inscriptionId: undefined,
                imageUrls: metadata ? buildImageUrls(collection, tokenId, metadata) : [],
                name: metadata?.name ?? `${collection.name} ${tokenId}`,
                createdAt: undefined,
                ownerAddress: undefined,
                minted: false,
                traits: metadata?.attributes ?? [],
              });
            }
            if (placeholderTokens.length >= supplyCap) break;
          }
          combined = placeholderTokens;
        }
        if (!cancelled) {
          setTokens(combined);
          setMintedTotal(mapped.length);
          setClaimStats(stats);
        }
      } catch (err) {
        console.error('Failed to load collection', err);
        if (!cancelled) {
          setTokens([]);
          setMintedTotal(0);
          setClaimStats(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [collection]);

  const activeTraits = useMemo(() => {
    return Object.fromEntries(
      Object.entries(selectedTraits).filter(([, values]) => values.length > 0)
    );
  }, [selectedTraits]);

  const filteredTokens = useMemo(() => {
    const query = search.trim().toLowerCase();
    const traitEntries = Object.entries(activeTraits);
    return tokens.filter((token) => {
      if (statusFilter === 'minted' && !token.minted) return false;
      if (statusFilter === 'locked' && token.minted) return false;

      if (query) {
        const idMatch = token.tokenId.toString().includes(query);
        const nameMatch = token.name?.toLowerCase().includes(query);
        const ownerMatch = token.ownerAddress?.toLowerCase().includes(query);
        if (!idMatch && !nameMatch && !ownerMatch) return false;
      }

      if (traitEntries.length > 0) {
        if (!token.traits || token.traits.length === 0) return false;
        const matchesAll = traitEntries.every(([trait, values]) => {
          const tokenValues = token.traits!
            .filter((attr) => attr.trait_type === trait)
            .map((attr) => String(attr.value));
          if (tokenValues.length === 0) return false;
          return values.some((value) => tokenValues.includes(value));
        });
        if (!matchesAll) return false;
      }

      return true;
    });
  }, [tokens, search, statusFilter, activeTraits]);

  const sortedTokens = useMemo(() => {
    const copy = [...filteredTokens];
    copy.sort((a, b) => {
      if (a.minted !== b.minted) {
        return a.minted ? -1 : 1;
      }
      return sortOrder === 'asc' ? a.tokenId - b.tokenId : b.tokenId - a.tokenId;
    });
    return copy;
  }, [filteredTokens, sortOrder]);

  const mintedTokens = useMemo(() => tokens.filter((token) => token.minted), [tokens]);

  const traitSummary: TraitSummary = useMemo(() => {
    const summary: Record<string, Record<string, number>> = {};
    tokens.forEach((token) => {
      (token.traits ?? []).forEach((attr) => {
        const trait = attr.trait_type?.trim();
        const value = attr.value;
        if (!trait || value === undefined || value === null) return;
        const normalizedValue = String(value).trim();
        if (!normalizedValue) return;
        if (!summary[trait]) summary[trait] = {};
        summary[trait][normalizedValue] = (summary[trait][normalizedValue] ?? 0) + 1;
      });
    });
    const sorted: TraitSummary = {};
    Object.entries(summary).forEach(([trait, values]) => {
      sorted[trait] = Object.entries(values)
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
    });
    return sorted;
  }, [tokens]);

  const traitGroups: TraitGroup[] = useMemo(
    () =>
      Object.entries(traitSummary)
        .map(([trait, values]) => ({ trait, values }))
        .sort((a, b) => a.trait.localeCompare(b.trait)),
    [traitSummary]
  );

  const filteredTraitGroups = useMemo(() => {
    const query = traitSearch.trim().toLowerCase();
    if (!query) return traitGroups;
    return traitGroups
      .map((group) => {
        if (group.trait.toLowerCase().includes(query)) return group;
        const values = group.values.filter((option) => option.value.toLowerCase().includes(query));
        return { ...group, values };
      })
      .filter((group) => group.values.length > 0);
  }, [traitGroups, traitSearch]);

  const activeTraitCount = useMemo(
    () => Object.values(selectedTraits).reduce((total, entries) => total + entries.length, 0),
    [selectedTraits]
  );

  useEffect(() => {
    setVisibleCount(36);
  }, [sortedTokens.length, viewMode]);

  useEffect(() => {
    const ref = scrollRef.current;
    if (!ref) return;
    const handleScroll = () => {
      if (ref.scrollTop + ref.clientHeight >= ref.scrollHeight - 200) {
        setVisibleCount((prev) => Math.min(prev + 36, sortedTokens.length));
      }
    };
    ref.addEventListener('scroll', handleScroll);
    return () => ref.removeEventListener('scroll', handleScroll);
  }, [sortedTokens.length]);

  const displayedTokens = sortedTokens.slice(0, visibleCount);
  const ownerCount = useMemo(() => {
    const owners = new Set(
      mintedTokens
        .filter((t) => t.ownerAddress)
        .map((t) => t.ownerAddress!.toLowerCase())
    );
    return owners.size;
  }, [mintedTokens]);

  const toggleTrait = (trait: string, value: string) => {
    setSelectedTraits((prev) => {
      const next = { ...prev };
      const current = next[trait] ?? [];
      const exists = current.includes(value);
      const updated = exists ? current.filter((item) => item !== value) : [...current, value];
      if (updated.length === 0) {
        delete next[trait];
      } else {
        next[trait] = updated;
      }
      return next;
    });
  };

  const clearAllTraits = () => setSelectedTraits({});
  const activeFilterCount = activeTraitCount + (statusFilter === 'all' ? 0 : 1);

  if (!collection) {
    return <div className="text-gold-200/80 py-16 text-center">Collection not found.</div>;
  }

  const mintedValue = claimStats
    ? claimStats.mintedCount.toLocaleString()
    : loading
      ? '…'
      : mintedTotal.toLocaleString();
  const ownersValue = ownerCount > 0 ? ownerCount.toLocaleString() : loading ? '…' : '0';
  const supplyValue = (collection.supply ?? claimStats?.mintedIds?.length ?? tokens.length).toLocaleString();

  const headerImage =
    collection.slug === 'zgods'
      ? '/collections/zgods/3vUZmMCg.gif'
      : mintedTokens.find((token) => token.imageUrls?.length)?.imageUrls?.[0] ??
      displayedTokens[0]?.imageUrls?.[0];

  return (
    <section className="flex flex-col gap-6 pb-20">
      <div className="rounded-3xl border border-gold-500/30 bg-gradient-to-r from-black/70 via-black/40 to-black/10 p-6 shadow-[0_0_40px_rgba(255,223,127,0.1)] space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 rounded-2xl border border-gold-500/40 overflow-hidden bg-black/60 flex items-center justify-center">
              {headerImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={headerImage} alt={collection.name} className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl text-gold-200">{collection.name.slice(0, 2)}</span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold text-white uppercase tracking-[0.2em]">{collection.name}</h1>
                {/* Verified icon reused */}
                <img src="/verified.png" alt="Verified" className="h-5 w-5" />
              </div>
              <p className="text-sm text-gold-200/80">
                {collection.description || 'Official verified collection.'}
              </p>
              <div className="mt-4">
                <a
                  href={`/collection/${collection.slug}/trade`}
                  className="inline-flex items-center justify-center px-4 py-2 text-sm font-bold bg-gold-500 hover:bg-gold-400 text-black uppercase tracking-wider rounded-sm transition-all shadow-lg shadow-gold-500/20"
                >
                  Trade Collection
                </a>
              </div>
            </div>
          </div>
          <div className="grid gap-3 text-center sm:grid-cols-4">
            <Stat label="Minted" value={mintedValue} />
            <Stat label="Owners" value={ownersValue} />
            <Stat label="Supply" value={supplyValue} />
            <Stat label="Floor (ZEC)" value="—" />
          </div>
        </div>
        <p className="text-sm text-gold-200/80 max-w-5xl">
          Browse every verified inscription pulled directly from the claim records. Use the sidebar to dial in rare
          traits, lock to minted IDs, or plan your next mint from the remaining supply.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <FilterSidebar
          traitGroups={filteredTraitGroups}
          selectedTraits={selectedTraits}
          onToggleTrait={toggleTrait}
          onClearTraits={clearAllTraits}
          traitSearch={traitSearch}
          setTraitSearch={setTraitSearch}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          activeTraitCount={activeTraitCount}
          activeFilterCount={activeFilterCount}
        />

        <div className="rounded-2xl border border-gold-500/20 bg-black/30 shadow-lg p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center rounded-xl border border-gold-500/20 overflow-hidden">
              {VIEW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setViewMode(option.value)}
                  className={`px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] ${viewMode === option.value ? 'bg-gold-500/20 text-gold-100' : 'text-gold-400'
                    }`}
                >
                  {option.icon}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 flex-1 justify-end">
              <input
                type="text"
                placeholder="Search by ID, name, owner"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full max-w-sm rounded-full border border-gold-500/30 bg-black/40 px-4 py-2 text-sm text-gold-100 placeholder:text-gold-300/60 focus:outline-none focus:border-gold-400"
              />
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                className="rounded-full border border-gold-500/30 bg-black/40 px-4 py-2 text-sm text-gold-100 focus:outline-none"
              >
                <option value="asc">ID: Low → High</option>
                <option value="desc">ID: High → Low</option>
              </select>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="max-h-[70vh] overflow-y-auto pr-1"
            style={{ scrollBehavior: 'smooth' }}
          >
            {loading ? (
              <GallerySkeleton viewMode={viewMode} />
            ) : displayedTokens.length === 0 ? (
              <div className="rounded-xl border border-gold-500/20 bg-black/40 p-6 text-center text-gold-200/60">
                No items match your filters.
              </div>
            ) : (
              <GalleryContent tokens={displayedTokens} viewMode={viewMode} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

type FilterSidebarProps = {
  traitGroups: TraitGroup[];
  selectedTraits: Record<string, string[]>;
  onToggleTrait: (trait: string, value: string) => void;
  onClearTraits: () => void;
  traitSearch: string;
  setTraitSearch: (value: string) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (value: StatusFilter) => void;
  activeTraitCount: number;
  activeFilterCount: number;
};

function FilterSidebar({
  traitGroups,
  selectedTraits,
  onToggleTrait,
  onClearTraits,
  traitSearch,
  setTraitSearch,
  statusFilter,
  setStatusFilter,
  activeTraitCount,
  activeFilterCount,
}: FilterSidebarProps) {
  const clearAll = () => {
    onClearTraits();
    setStatusFilter('all');
  };
  return (
    <aside className="rounded-3xl border border-gold-500/20 bg-black/40 p-4 shadow-inner space-y-6 lg:sticky lg:top-28 lg:max-h-[calc(100vh-150px)] lg:overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-gold-200">Filters</h2>
          <p className="text-xs text-gold-300/70">{activeFilterCount} active</p>
        </div>
        {activeFilterCount > 0 && (
          <button
            onClick={clearAll}
            className="text-xs uppercase tracking-[0.3em] text-gold-300 hover:text-gold-100 transition"
          >
            Clear all
          </button>
        )}
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-[0.3em] text-gold-300/70 mb-2">Status</div>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              onClick={() => setStatusFilter(option.value)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.2em] ${statusFilter === option.value
                ? 'border-gold-400 bg-gold-500/10 text-gold-100'
                : 'border-gold-500/20 text-gold-300/70 hover:border-gold-400/50'
                }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] uppercase tracking-[0.3em] text-gold-300/70">Traits</div>
          {activeTraitCount > 0 && (
            <button
              onClick={onClearTraits}
              className="text-[10px] uppercase tracking-[0.3em] text-gold-300/80 hover:text-gold-100"
            >
              Clear ({activeTraitCount})
            </button>
          )}
        </div>
        <input
          type="text"
          placeholder="Search traits"
          value={traitSearch}
          onChange={(e) => setTraitSearch(e.target.value)}
          className="w-full rounded-full border border-gold-500/20 bg-black/50 px-3 py-1.5 text-sm text-gold-100 placeholder:text-gold-300/50 focus:outline-none focus:border-gold-400"
        />
        <div className="mt-4 space-y-4">
          {traitGroups.length === 0 ? (
            <p className="text-xs text-gold-200/60">Trait metadata not available.</p>
          ) : (
            traitGroups.map((group) => (
              <div key={group.trait}>
                <div className="text-[11px] uppercase tracking-[0.3em] text-gold-400/80 mb-2">{group.trait}</div>
                <div className="space-y-1.5">
                  {group.values.map((option) => {
                    const selected = selectedTraits[group.trait]?.includes(option.value);
                    return (
                      <button
                        key={`${group.trait}-${option.value}`}
                        onClick={() => onToggleTrait(group.trait, option.value)}
                        className={`w-full rounded-xl border px-3 py-2 text-left text-sm flex items-center justify-between ${selected
                          ? 'border-gold-400 bg-gold-500/10 text-gold-100'
                          : 'border-gold-500/10 text-gold-200/80 hover:border-gold-400/40'
                          }`}
                      >
                        <span>{option.value}</span>
                        <span className="text-xs text-gold-300/80">{option.count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gold-500/20 bg-black/30 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.3em] text-gold-300/70">{label}</div>
      <div className="text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function GalleryContent({ tokens, viewMode }: { tokens: CollectionToken[]; viewMode: ViewMode }) {
  if (viewMode === 'list') {
    return (
      <div className="space-y-3">
        {tokens.map((token) =>
          token.minted ? <ListRow key={token.id} token={token} /> : <ListLockedRow key={token.id} tokenId={token.tokenId} />
        )}
      </div>
    );
  }

  const gridClass =
    viewMode === 'grid'
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
      : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6';

  return (
    <div className={`grid gap-5 ${gridClass}`}>
      {tokens.map((token) => (token.minted ? <GridCard key={token.id} token={token} /> : <LockedCard key={token.id} tokenId={token.tokenId} />))}
    </div>
  );
}

function GallerySkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === 'list') {
    return (
      <div className="space-y-3">
        {Array.from({ length: 10 }).map((_, idx) => (
          <ListSkeletonRow key={`list-skel-${idx}`} />
        ))}
      </div>
    );
  }

  const gridClass =
    viewMode === 'grid'
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
      : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6';
  const count = viewMode === 'grid' ? 12 : 18;

  return (
    <div className={`grid gap-5 ${gridClass}`}>
      {Array.from({ length: count }).map((_, idx) => (
        <GridSkeletonCard key={`grid-skel-${idx}`} />
      ))}
    </div>
  );
}

function GridSkeletonCard() {
  return (
    <article className="rounded-2xl border border-gold-500/20 bg-black/35 p-3 flex flex-col gap-3 shadow-lg">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-gold-500/10 bg-black/30">
        <div className="absolute inset-0 animate-pulse bg-gold-500/10" />
        <div className="absolute top-2 left-2 h-6 w-12 rounded-full bg-black/40 animate-pulse" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-2/3 rounded bg-gold-500/10 animate-pulse" />
        <div className="h-3 w-1/2 rounded bg-gold-500/5 animate-pulse" />
        <div className="h-3 w-1/3 rounded bg-gold-500/5 animate-pulse" />
      </div>
    </article>
  );
}

function ListSkeletonRow() {
  return (
    <article className="grid grid-cols-[72px_1fr_auto] gap-4 items-center rounded-2xl border border-gold-500/20 bg-black/35 p-3">
      <div className="h-16 w-16 rounded-sm border border-gold-500/10 bg-gold-500/10 animate-pulse" />
      <div className="space-y-2">
        <div className="h-3 w-1/3 rounded bg-gold-500/10 animate-pulse" />
        <div className="h-3 w-2/3 rounded bg-gold-500/5 animate-pulse" />
        <div className="h-3 w-1/2 rounded bg-gold-500/5 animate-pulse" />
      </div>
      <div className="h-3 w-12 rounded bg-gold-500/10 animate-pulse" />
    </article>
  );
}

const formatOwnerAddress = (address?: string) => {
  if (!address) return '';
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
};

function GridCard({ token }: { token: CollectionToken }) {
  const { ref, inView } = useInViewport<HTMLDivElement>();
  const cacheKey = `${token.collectionSlug}-${token.tokenId}`;
  const { resolved, loading, errored } = useIpfsImage(token.imageUrls, inView, cacheKey);
  return (
    <article ref={ref} className="rounded-2xl border border-gold-500/20 bg-black/35 p-3 flex flex-col gap-3 shadow-lg">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-gold-500/10 bg-black/30">
        {resolved && !loading && !errored && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={resolved} alt={token.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        )}
        {(loading || !resolved || errored) && (
          <div className="absolute inset-0 animate-pulse bg-gold-500/10 backdrop-blur-sm" />
        )}
        <div className="absolute top-2 left-2 rounded-full bg-black/70 px-2 py-1 text-xs font-semibold text-gold-100">
          #{token.tokenId}
        </div>
      </div>
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-gold-400/80">
          {token.collectionName}
          {VERIFIED_COLLECTIONS.has(token.collectionSlug) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/verified.png" alt="Verified collection" className="h-3.5 w-3.5" loading="lazy" />
          )}
        </p>
        <h3 className="text-base font-semibold text-white line-clamp-1">{token.name}</h3>
        <p className="text-xs font-mono text-gold-200/70" title={token.ownerAddress ?? 'Unclaimed'}>
          {token.ownerAddress ? `Owner ${formatOwnerAddress(token.ownerAddress)}` : 'Unclaimed'}
        </p>
      </div>
    </article>
  );
}

function ListRow({ token }: { token: CollectionToken }) {
  const { ref, inView } = useInViewport<HTMLDivElement>();
  const cacheKey = `${token.collectionSlug}-${token.tokenId}`;
  const { resolved, loading, errored } = useIpfsImage(token.imageUrls, inView, cacheKey);
  return (
    <article
      ref={ref}
      className="grid grid-cols-[72px_1fr_auto] gap-4 items-center rounded-2xl border border-gold-500/20 bg-black/35 p-3"
    >
      <div className="relative h-16 w-16 overflow-hidden rounded-sm border border-gold-500/10 bg-black/30">
        {resolved && !loading && !errored && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={resolved} alt={token.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        )}
        {(loading || !resolved || errored) && <div className="absolute inset-0 animate-pulse bg-gold-500/10" />}
      </div>
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-[0.3em] text-gold-400/70">{token.collectionName}</p>
        <h4 className="text-sm font-semibold text-white line-clamp-1">{token.name}</h4>
        <p className="text-xs font-mono text-gold-200/70" title={token.ownerAddress ?? 'Unclaimed'}>
          {token.ownerAddress ? formatOwnerAddress(token.ownerAddress) : 'Unclaimed'}
        </p>
      </div>
      <div className="text-sm font-mono text-gold-100">#{token.tokenId}</div>
    </article>
  );
}

function LockedCard({ tokenId }: { tokenId: number }) {
  return (
    <article className="rounded-2xl border border-gold-500/15 bg-black/40 p-3 flex flex-col gap-3 shadow-inner">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-gold-500/30 bg-gradient-to-br from-gold-500/15 via-black/50 to-black">
        <div className="absolute inset-0 backdrop-blur-xl" />
        <div className="absolute inset-0 border border-gold-500/30 rounded-xl opacity-70" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-gold-100/80">
          <span className="text-[10px] uppercase tracking-[0.3em]">Mint Locked</span>
          <span className="text-lg font-semibold font-mono">#{tokenId}</span>
          <span className="text-xs text-gold-200/80">Reveals after mint</span>
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-[0.3em] text-gold-400/70">Unminted Allocation</p>
        <p className="text-sm text-gold-200/70">Artwork will display once this ID finalizes on-chain.</p>
      </div>
    </article>
  );
}

function ListLockedRow({ tokenId }: { tokenId: number }) {
  return (
    <article className="grid grid-cols-[72px_1fr_auto] gap-4 items-center rounded-2xl border border-gold-500/20 bg-black/30 p-3">
      <div className="relative h-16 w-16 overflow-hidden rounded-sm border border-gold-500/20 bg-gradient-to-br from-gold-500/20 via-black/60 to-black">
        <div className="absolute inset-0 backdrop-blur-lg" />
        <div className="absolute inset-0 border border-gold-500/30 rounded-sm opacity-70" />
        <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-[0.3em] text-gold-200/80">
          Locked
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-[0.3em] text-gold-400/70">Unminted Allocation</p>
        <p className="text-xs text-gold-200/70">Hidden until mint completes.</p>
      </div>
      <div className="text-sm font-mono text-gold-300/90">#{tokenId}</div>
    </article>
  );
}
