'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ordinalIndexAPI,
  type ZRC721Collection,
  type ZRC721Status,
  type ZRC721Token,
} from '@/services/ordinalIndex';

const Dither = dynamic(() => import('@/components/Dither'), {
  ssr: false,
  loading: () => null,
});

type CollectionDetail = {
  holdersCount?: number;
  topHolders?: { address: string; count: number }[];
  sampleTokens?: ZRC721Token[];
  loading: boolean;
  error?: string;
  fetchedAt?: number;
};

type SortKey = 'minted' | 'progress' | 'alphabetical';
type StatusFilter = 'all' | 'live' | 'completed';

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: 'Most Minted', value: 'minted' },
  { label: 'Progress', value: 'progress' },
  { label: 'Ticker', value: 'alphabetical' },
];

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Live', value: 'live' },
  { label: 'Completed', value: 'completed' },
];

const ROW_OPTIONS = [10, 20, 50];

const formatNumber = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat('en-US').format(value);
};

const formatPercent = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${(value * 100).toFixed(1)}%`;
};

const shortAddress = (address: string) =>
  address.length <= 12
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`;

interface EnrichedCollection {
  base: ZRC721Collection;
  minted: number;
  supply: number;
  royalty: number;
  progress: number;
}

export default function ZRC721CollectionsPage() {
  const [collections, setCollections] = useState<ZRC721Collection[]>([]);
  const [status, setStatus] = useState<ZRC721Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('minted');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null
  );
  const [detailMap, setDetailMap] = useState<Record<string, CollectionDetail>>(
    {}
  );

  const lastFetchRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchCollections() {
      try {
        setLoading(true);
        setError(null);
        const results: ZRC721Collection[] = [];
        const limit = 100;
        let page = 0;
        while (true) {
          const response = await ordinalIndexAPI.getZRC721Collections(
            page,
            limit
          );
          results.push(...response.collections);
          if (response.collections.length < limit) {
            break;
          }
          page += 1;
        }

        if (!cancelled) {
          setCollections(results);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError('Unable to load ZRC-721 collections. Please try again.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          lastFetchRef.current = Date.now();
        }
      }
    }

    fetchCollections();
    const interval = setInterval(fetchCollections, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const z721Status = await ordinalIndexAPI.getZRC721Status();
        if (!cancelled) {
          setStatus(z721Status);
        }
      } catch (err) {
        console.error('Failed to load zrc-721 status', err);
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, rowsPerPage]);

  const enrichedCollections: EnrichedCollection[] = useMemo(() => {
    return collections.map((collection) => {
      const minted = Number(collection.minted ?? 0);
      const supply = Number(collection.supply ?? 0);
      const royalty = Number(collection.royalty ?? 0) / 100;
      const progress = supply > 0 ? minted / supply : 0;

      return {
        base: collection,
        minted,
        supply,
        royalty,
        progress,
      };
    });
  }, [collections]);

  const filteredCollections = useMemo(() => {
    return enrichedCollections.filter((entry) => {
      const match =
        entry.base.collection.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.base.deployer.toLowerCase().includes(searchQuery.toLowerCase());
      if (!match) return false;

      if (statusFilter === 'live' && entry.progress >= 1) return false;
      if (statusFilter === 'completed' && entry.progress < 1) return false;
      return true;
    });
  }, [enrichedCollections, searchQuery, statusFilter]);

  const sortedCollections = useMemo(() => {
    const sorted = [...filteredCollections];
    sorted.sort((a, b) => {
      const direction = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'progress':
          if (a.progress === b.progress) return 0;
          return a.progress > b.progress ? direction : -direction;
        case 'alphabetical':
          return direction * a.base.collection.localeCompare(b.base.collection);
        case 'minted':
        default:
          if (a.minted === b.minted) return 0;
          return a.minted > b.minted ? direction : -direction;
      }
    });
    return sorted;
  }, [filteredCollections, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedCollections.length / rowsPerPage));
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedCollections = sortedCollections.slice(
    startIndex,
    startIndex + rowsPerPage
  );

  const selectedDetail =
    selectedCollection &&
    detailMap[selectedCollection.toLowerCase()];

  useEffect(() => {
    if (!selectedCollection) return;
    const key = selectedCollection.toLowerCase();
    const existing = detailMap[key];
    if (existing && !existing.error && !existing.loading) {
      return;
    }

    let cancelled = false;
    setDetailMap((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? {}),
        loading: true,
        error: undefined,
      },
    }));

    (async () => {
      const limit = 500;
      let page = 0;
      const ownerCounts = new Map<string, number>();
      const sampleTokens: ZRC721Token[] = [];
      const collectionInfo = collections.find(
        (item) => item.collection.toLowerCase() === key
      );
      const target = Number(collectionInfo?.minted ?? 0);
      let totalFetched = 0;
      const maxPages = 40;

      try {
        while ((target === 0 || totalFetched < target) && page < maxPages) {
          const response = await ordinalIndexAPI.getZRC721CollectionTokens(
            selectedCollection,
            page,
            limit
          );
          const tokens = response.tokens ?? [];
          if (!tokens.length) break;
          totalFetched += tokens.length;

          tokens.forEach((token) => {
            if (token.owner) {
              ownerCounts.set(
                token.owner,
                (ownerCounts.get(token.owner) ?? 0) + 1
              );
            }
          });

          if (sampleTokens.length < 20) {
            sampleTokens.push(
              ...tokens.slice(0, Math.max(0, 20 - sampleTokens.length))
            );
          }

          if (tokens.length < limit) {
            break;
          }

          page += 1;
        }

        if (cancelled) return;

        const holdersCount = ownerCounts.size;
        const topHolders = Array.from(ownerCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([address, count]) => ({ address, count }));

        setDetailMap((prev) => ({
          ...prev,
          [key]: {
            holdersCount,
            topHolders,
            sampleTokens,
            loading: false,
            fetchedAt: Date.now(),
          },
        }));
      } catch (err) {
        console.error('Failed to load collection detail', err);
        if (cancelled) return;
        setDetailMap((prev) => ({
          ...prev,
          [key]: {
            holdersCount: prev[key]?.holdersCount,
            topHolders: prev[key]?.topHolders,
            sampleTokens: prev[key]?.sampleTokens,
            loading: false,
            error:
              err instanceof Error
                ? err.message
                : 'Failed to load tokens for this collection',
            fetchedAt: prev[key]?.fetchedAt,
          },
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCollection, collections, detailMap]);

  const totalMinted = enrichedCollections.reduce(
    (sum, entry) => sum + entry.minted,
    0
  );
  const totalSupply = enrichedCollections.reduce(
    (sum, entry) => sum + entry.supply,
    0
  );

  return (
    <main className="relative min-h-screen text-gold-100 pt-20">
      <div className="fixed inset-0 w-full h-full opacity-20 -z-10">
        <Dither
          waveColor={[0.8, 0.6, 0.2]}
          disableAnimation={false}
          enableMouseInteraction={true}
          mouseRadius={0.3}
          colorNum={4}
          waveAmplitude={0.15}
          waveFrequency={2}
          waveSpeed={0.03}
        />
      </div>

      <div className="relative z-10 max-w-[1400px] mx-auto px-4 md:px-6 pb-16">
        <section className="mb-6">
          <FilterBar
            lastRefresh={lastFetchRef.current}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            sortKey={sortKey}
            onSortKeyChange={setSortKey}
            sortDir={sortDir}
            onSortDirChange={setSortDir}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={setRowsPerPage}
          />
        </section>

        {selectedCollection && (
          <CollectionDetailPanel
            collection={collections.find(
              (item) =>
                item.collection.toLowerCase() ===
                selectedCollection.toLowerCase()
            )}
            detail={selectedDetail}
            onClose={() => setSelectedCollection(null)}
          />
        )}

        {error ? (
          <div className="border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-64 text-gold-200/70">
            Loading collections…
          </div>
        ) : paginatedCollections.length === 0 ? (
          <div className="h-64 flex items-center justify-center border border-dashed border-gold-500/30 text-gold-300/60">
            No collections match your filters.
          </div>
        ) : (
          <CollectionsTable
            collections={paginatedCollections}
            startIndex={startIndex}
            totalCollections={sortedCollections.length}
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            rowsPerPage={rowsPerPage}
            detailMap={detailMap}
            selectedCollection={selectedCollection}
            onSelect={setSelectedCollection}
          />
        )}

        <CollectionsFooter
          status={status}
          totalCollections={collections.length}
          totalMinted={totalMinted}
          totalSupply={totalSupply}
        />
      </div>
    </main>
  );
}

interface FilterBarProps {
  lastRefresh?: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (value: StatusFilter) => void;
  sortKey: SortKey;
  onSortKeyChange: (value: SortKey) => void;
  sortDir: 'asc' | 'desc';
  onSortDirChange: (value: 'asc' | 'desc') => void;
  rowsPerPage: number;
  onRowsPerPageChange: (value: number) => void;
}

function FilterBar({
  lastRefresh,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortKey,
  onSortKeyChange,
  sortDir,
  onSortDirChange,
  rowsPerPage,
  onRowsPerPageChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-col gap-4 border border-gold-500/20 bg-black/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-black text-gold-200 tracking-tight">
          ZRC-721 Terminal
        </h2>
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => onStatusFilterChange(filter.value)}
            className={`px-3 py-1 text-xs font-bold tracking-[0.2em] uppercase transition ${
              statusFilter === filter.value
                ? 'bg-gold-500 text-black'
                : 'text-gold-200/70 border border-gold-500/30'
            }`}
          >
            {filter.label}
          </button>
        ))}
        <div className="ml-auto text-xs text-gold-300/70">
          Last refresh:{' '}
          {lastRefresh
            ? new Date(lastRefresh).toLocaleTimeString()
            : '—'}
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search collections or deployers..."
          className="flex-1 bg-black/40 border border-gold-500/30 px-4 py-3 text-sm tracking-wide placeholder:text-gold-300/50 focus:outline-none focus:ring focus:ring-gold-500/40"
        />
        <div className="flex items-center gap-2">
          <select
            value={sortKey}
            onChange={(event) => onSortKeyChange(event.target.value as SortKey)}
            className="bg-black/50 border border-gold-500/30 px-3 py-2 text-sm uppercase tracking-[0.2em]"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
            className="px-3 py-2 border border-gold-500/30 text-xs uppercase tracking-[0.3em]"
          >
            {sortDir === 'asc' ? 'ASC' : 'DESC'}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-gold-300/70 uppercase tracking-[0.3em]">
            Rows
          </label>
          <select
            value={rowsPerPage}
            onChange={(event) =>
              onRowsPerPageChange(Number(event.target.value))
            }
            className="bg-black/50 border border-gold-500/30 px-3 py-2 text-sm"
          >
            {ROW_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

interface CollectionsTableProps {
  collections: EnrichedCollection[];
  startIndex: number;
  totalCollections: number;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  rowsPerPage: number;
  detailMap: Record<string, CollectionDetail>;
  selectedCollection: string | null;
  onSelect: (collection: string) => void;
}

function CollectionsTable({
  collections,
  startIndex,
  totalCollections,
  currentPage,
  totalPages,
  onPageChange,
  rowsPerPage,
  detailMap,
  selectedCollection,
  onSelect,
}: CollectionsTableProps) {
  return (
    <div className="overflow-x-auto border border-gold-500/20 bg-black/20">
      <table className="min-w-full text-xs md:text-sm">
        <thead className="bg-black/40 text-gold-300/70 uppercase tracking-[0.3em]">
          <tr>
            <th className="px-4 py-3 text-left">#</th>
            <th className="px-4 py-3 text-left">Collection</th>
            <th className="px-4 py-3 text-left">Minted</th>
            <th className="px-4 py-3 text-left">Supply</th>
            <th className="px-4 py-3 text-left">Royalty</th>
            <th className="px-4 py-3 text-left">Progress</th>
            <th className="px-4 py-3 text-left">Holders</th>
            <th className="px-4 py-3 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {collections.map((entry, index) => {
            const key = entry.base.collection.toLowerCase();
            const detail = detailMap[key];
            const isSelected =
              selectedCollection?.toLowerCase() === key;
            return (
              <tr
                key={entry.base.collection}
                className={`border-b border-gold-500/10 cursor-pointer transition ${
                  isSelected ? 'bg-gold-500/10' : 'hover:bg-white/5'
                }`}
                onClick={() => onSelect(entry.base.collection)}
              >
                <td className="px-4 py-3 text-gold-300/70">
                  {startIndex + index + 1}
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold uppercase tracking-wide text-gold-50">
                    {entry.base.collection}
                  </div>
                  <div className="text-[11px] text-gold-300/60">
                    {entry.base.deployer || '—'}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-gold-100">
                  {formatNumber(entry.minted)}
                </td>
                <td className="px-4 py-3 font-mono text-gold-100">
                  {formatNumber(entry.supply)}
                </td>
                <td className="px-4 py-3">
                  {formatPercent(entry.royalty / 100)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono">
                      {formatPercent(entry.progress)}
                    </span>
                    <div className="flex-1 h-1.5 bg-gold-500/20">
                      <div
                        className="h-full bg-gold-400"
                        style={{
                          width: `${Math.min(entry.progress * 100, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {detail?.holdersCount !== undefined
                    ? formatNumber(detail.holdersCount)
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Link
                      href={`/collection/${entry.base.collection}`}
                      onClick={(event) => event.stopPropagation()}
                      className="px-3 py-1 text-xs font-bold border border-gold-400/60 text-gold-100 uppercase tracking-[0.3em]"
                    >
                      View
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-4 py-3 text-xs text-gold-300/70">
        <div>
          Showing {collections.length} of {totalCollections} collections
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1 border border-gold-500/30 disabled:opacity-40"
          >
            Prev
          </button>
          <div className="text-gold-100">
            Page {currentPage} / {totalPages}
          </div>
          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-1 border border-gold-500/30 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

interface CollectionDetailPanelProps {
  collection?: ZRC721Collection;
  detail?: CollectionDetail;
  onClose: () => void;
}

function CollectionDetailPanel({
  collection,
  detail,
  onClose,
}: CollectionDetailPanelProps) {
  if (!collection) return null;
  const minted = Number(collection.minted ?? 0);
  const supply = Number(collection.supply ?? 0);
  const progress = supply > 0 ? minted / supply : 0;
  const royalty = Number(collection.royalty ?? 0) / 100;

  return (
    <section className="border border-gold-500/30 bg-black/40 p-6 mb-8">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-gold-300/60">
            Collection Detail
          </p>
          <h2 className="text-3xl font-black text-gold-100">
            {collection.collection}
          </h2>
          <p className="text-sm text-gold-300/70">
            Deployer: {collection.deployer}
          </p>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1 border border-gold-500/30 text-xs uppercase tracking-[0.3em]"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        <div className="border border-gold-500/20 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-[0.3em] text-gold-300/70">
            Minted / Supply
          </div>
          <div className="text-2xl font-mono text-gold-100 mt-2">
            {formatNumber(minted)}
          </div>
          <div className="text-xs text-gold-300/60">
            of {formatNumber(supply)}
          </div>
        </div>
        <div className="border border-gold-500/20 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-[0.3em] text-gold-300/70">
            Royalty
          </div>
          <div className="text-2xl font-black text-gold-100 mt-2">
            {formatPercent(royalty / 100)}
          </div>
          <div className="text-xs text-gold-300/60">per secondary sale</div>
        </div>
        <div className="border border-gold-500/20 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-[0.3em] text-gold-300/70">
            Holders
          </div>
          <div className="text-2xl font-black text-gold-100 mt-2">
            {detail?.holdersCount !== undefined
              ? formatNumber(detail.holdersCount)
              : detail?.loading
                ? '…'
                : '—'}
          </div>
          <div className="text-xs text-gold-300/60">
            {detail?.loading ? 'Computing via tokens…' : 'Unique owners'}
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <div className="flex-1 h-2 bg-gold-500/20">
          <div
            className="h-full bg-gold-400"
            style={{ width: `${Math.min(progress * 100, 100)}%` }}
          />
        </div>
        <span className="font-mono text-gold-100">
          {formatPercent(progress)}
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-8">
        <div className="border border-gold-500/20 bg-black/30 p-4">
          <h3 className="text-sm font-bold uppercase tracking-[0.3em] text-gold-300/70 mb-3">
            Top Holders
          </h3>
          {detail?.loading ? (
            <div className="text-sm text-gold-300/60">Loading…</div>
          ) : detail?.topHolders?.length ? (
            <div className="space-y-2">
              {detail.topHolders.map((holder) => (
                <div
                  key={holder.address}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="font-mono text-gold-100">
                    {shortAddress(holder.address)}
                  </span>
                  <span className="text-gold-300/80">{holder.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gold-300/60">
              No holder data available.
            </div>
          )}
        </div>

        <div className="border border-gold-500/20 bg-black/30 p-4">
          <h3 className="text-sm font-bold uppercase tracking-[0.3em] text-gold-300/70 mb-3">
            Recent Tokens
          </h3>
          {detail?.sampleTokens?.length ? (
            <div className="space-y-2 text-sm">
              {detail.sampleTokens.map((token) => (
                <div
                  key={token.token_id}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="font-mono text-gold-100">
                    #{token.token_id}
                  </span>
                  <span className="text-gold-300/80">
                    {token.owner ? shortAddress(token.owner) : '—'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gold-300/60">
              {detail?.loading ? 'Loading tokens…' : 'No token samples yet.'}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

interface CollectionsFooterProps {
  status: ZRC721Status | null;
  totalCollections: number;
  totalMinted: number;
  totalSupply: number;
}

function CollectionsFooter({
  status,
  totalCollections,
  totalMinted,
  totalSupply,
}: CollectionsFooterProps) {
  const cards = [
    {
      label: 'Module Height',
      value: formatNumber(status?.height),
      hint: `Tip ${formatNumber(status?.chain_tip)}`,
    },
    {
      label: 'Collections Tracked',
      value: formatNumber(status?.collections ?? totalCollections),
      hint: 'Live deployments',
    },
    {
      label: 'Minted Tokens',
      value: formatNumber(status?.tokens ?? totalMinted),
      hint: `Across ${totalCollections} collections`,
    },
    {
      label: 'Global Supply',
      value: formatNumber(totalSupply),
      hint: 'Total configured supply',
    },
  ];

  return (
    <footer className="mt-10 border border-gold-500/20 bg-black/30 px-4 py-5">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
        <div className="text-xs uppercase tracking-[0.4em] text-gold-300/60">
          ZRC-721 Status
        </div>
        <div className="text-xs text-gold-300/60">
          Version {status?.version ?? '—'}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {cards.map((card) => (
          <div
            key={card.label}
            className="border border-gold-500/10 bg-black/40 px-4 py-3"
          >
            <div className="text-[10px] uppercase tracking-[0.3em] text-gold-300/60">
              {card.label}
            </div>
            <div className="text-xl font-bold text-gold-100 mt-1">
              {card.value}
            </div>
            <div className="text-[11px] text-gold-300/50 mt-1">{card.hint}</div>
          </div>
        ))}
      </div>
    </footer>
  );
}
