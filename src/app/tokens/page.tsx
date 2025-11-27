'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useAction, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import {
  ordinalIndexAPI,
  type OrdinalIndexToken,
  type OrdinalIndexStatus,
  type OrdinalIndexBalanceEntry,
  type TokenIntegrity,
  type TokenSummary,
  type ZRC20Status,
  type HealthSnapshot,
} from '@/services/ordinalIndex';

const Dither = dynamic(() => import('@/components/Dither'), {
  ssr: false,
  loading: () => null,
});

type TokenStats = {
  holders?: number;
  transfersCompleted?: number;
  summary?: TokenSummary;
  integrity?: TokenIntegrity;
  updatedAt: number;
};

type TokenDetailState = {
  holders?: OrdinalIndexBalanceEntry[];
  loading: boolean;
  error?: string;
  fetchedAt?: number;
};

type SortKey = 'holders' | 'progress' | 'recent' | 'ticker';
type StatusFilter = 'all' | 'live' | 'minted' | 'upcoming';

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: 'Most Holders', value: 'holders' },
  { label: 'Mint Progress', value: 'progress' },
  { label: 'Newest', value: 'recent' },
  { label: 'Ticker', value: 'ticker' },
];

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Live Mint', value: 'live' },
  { label: 'Completed', value: 'minted' },
  { label: 'Upcoming', value: 'upcoming' },
];

const ROW_OPTIONS = [10, 20, 50];
const STATS_TTL_MS = 2 * 60 * 1000;

const numberFormatter = new Intl.NumberFormat('en-US');

const formatNumber = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return numberFormatter.format(value);
};

const formatPercent = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${(value * 100).toFixed(1)}%`;
};

const formatBaseUnits = (value?: string, dec = 18) => {
  if (!value) return '--';
  try {
    const divisor = 10 ** dec;
    const asNumber = Number(BigInt(value)) / divisor;
    if (!Number.isFinite(asNumber)) return '--';
    return numberFormatter.format(asNumber);
  } catch {
    return '--';
  }
};

const shortAddress = (address: string) =>
  address.length <= 12
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`;

interface EnrichedToken {
  base: OrdinalIndexToken;
  holders?: number;
  transfersCompleted?: number;
  integrity?: TokenIntegrity;
  mintedSupply: number;
  maxSupply: number;
  limitPerMint: number;
  progress: number;
  summary?: TokenSummary;
  creationIndex: number;
}



function RefreshTopTokensButton() {
  const refreshTop = useAction(api.tokenStats.refreshTopTokens);
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        try {
          await refreshTop({ pages: 5, limit: 100 });
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
      className="group relative flex items-center gap-2 px-3 py-1.5 border border-gold-500/20 rounded hover:bg-gold-500/10 transition-all disabled:opacity-50"
      title="Refresh Top Tokens"
    >
      <div className="relative flex h-2 w-2">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 ${busy ? 'hidden' : ''}`}></span>
        <span className={`relative inline-flex rounded-full h-2 w-2 ${busy ? 'bg-gold-500 animate-pulse' : 'bg-green-500'}`}></span>
      </div>
      <span className="text-[10px] uppercase tracking-wider font-bold text-gold-300 group-hover:text-gold-100">
        {busy ? 'Syncing' : 'Live'}
      </span>
    </button>
  );
}

export default function TokenListPage() {
  const [tokens, setTokens] = useState<OrdinalIndexToken[]>([]);
  const [totalFromApi, setTotalFromApi] = useState<number>(0);
  const [tokenStats, setTokenStats] = useState<Record<string, TokenStats>>({});
  const [status, setStatus] = useState<OrdinalIndexStatus | null>(null);
  const [zrc20Status, setZrc20Status] = useState<ZRC20Status | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [minHolders, setMinHolders] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('holders');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [selectedTick, setSelectedTick] = useState<string | null>(null);
  const [tokenDetails, setTokenDetails] = useState<Record<string, TokenDetailState>>({});

  const lastFetchRef = useRef<number>(0);
  const hydrationInFlight = useRef<Set<string>>(new Set());
  const refreshCounts = useAction(api.tokenStats.refreshHolderCounts);

  const [visibleCount, setVisibleCount] = useState(50);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const hasLoadedTokens = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchTokens() {
      try {
        setLoading(true);
        // Don't clear error here if we have tokens, to avoid flashing
        if (!hasLoadedTokens.current) setError(null);

        // Fetch all tokens (up to limit) to allow client-side filtering/sorting
        const pageSize = 100;
        const maxPages = 20; // Limit to 2000 tokens for now
        let page = 0;
        let apiHasMore = true;
        const collected: OrdinalIndexToken[] = [];

        while (apiHasMore && page < maxPages) {
          if (cancelled) return;
          const response = await ordinalIndexAPI.getTokens(page, pageSize);
          if (page === 0) setTotalFromApi(response.total);
          collected.push(...response.items);
          apiHasMore = response.has_more && response.items.length > 0;
          page += 1;
        }

        if (!cancelled) {
          setTokens(collected);
          if (collected.length > 0) {
            hasLoadedTokens.current = true;
          }
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          // Only show error if we have no tokens (initial load failed)
          // If this is a background refresh, just log it to avoid disrupting the user
          if (!hasLoadedTokens.current) {
            setError('Unable to load ZRC-20 tokens. Please try again shortly.');
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          lastFetchRef.current = Date.now();
        }
      }
    }

    fetchTokens();
    const interval = setInterval(fetchTokens, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []); // Only fetch on mount and interval, filtering is client-side

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(50);
  }, [searchQuery, statusFilter, minHolders, sortKey, sortDir]);



  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const [globalStatus, moduleStatus, healthSnapshot] = await Promise.all([
          ordinalIndexAPI.getStatus(),
          ordinalIndexAPI.getZRC20Status(),
          ordinalIndexAPI.getHealth(),
        ]);

        if (!cancelled) {
          setStatus(globalStatus);
          setZrc20Status(moduleStatus);
          setHealth(healthSnapshot);
        }
      } catch (err) {
        console.error('Failed to load status', err);
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);




  const enrichedTokens: EnrichedToken[] = useMemo(() => {
    return tokens.map((token) => {
      const stats = tokenStats[token.ticker.toLowerCase()];
      const holderCount = stats?.holders;
      const mintedSupply = Number(token.supply ?? 0);
      const maxSupply = Number(token.max ?? 0);
      const limitPerMint = Number(token.lim ?? 0);
      const progress =
        typeof token.progress === 'number'
          ? token.progress
          : maxSupply > 0
            ? mintedSupply / maxSupply
            : 0;

      return {
        base: token,
        holders: holderCount,
        transfersCompleted: stats?.transfersCompleted,
        integrity: stats?.integrity,
        mintedSupply,
        maxSupply,
        limitPerMint,
        progress,
        summary: stats?.summary,
        creationIndex: totalFromApi > 0 ? totalFromApi - 1 - tokens.indexOf(token) : 0,
      };
    });
  }, [tokens, tokenStats]);

  // Client-side filtering/sorting is still applied to the loaded set
  // Ideally, filtering/sorting should be server-side for true infinite scroll
  // But for now we apply it to the accumulated list
  const filteredTokens = useMemo(() => {
    return enrichedTokens.filter((entry) => {
      const matchesQuery = entry.base.ticker
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      if (!matchesQuery) return false;

      const holders = entry.holders ?? 0;
      if (holders < minHolders) return false;

      if (statusFilter === 'live' && entry.progress >= 1) return false;
      if (statusFilter === 'minted' && entry.progress < 1) return false;
      if (statusFilter === 'upcoming' && entry.mintedSupply > 0) return false;

      return true;
    });
  }, [enrichedTokens, searchQuery, statusFilter, minHolders]);

  const sortedTokens = useMemo(() => {
    const sorted = [...filteredTokens];
    sorted.sort((a, b) => {
      const direction = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'holders': {
          const holdersA = a.holders ?? 0;
          const holdersB = b.holders ?? 0;
          if (holdersA === holdersB) return 0;
          return holdersA > holdersB ? direction : -direction;
        }
        case 'progress': {
          if (a.progress === b.progress) return 0;
          return a.progress > b.progress ? direction : -direction;
        }
        case 'recent': {
          const supplyA = a.base.supply_base_units
            ? Number(a.base.supply_base_units)
            : a.mintedSupply;
          const supplyB = b.base.supply_base_units
            ? Number(b.base.supply_base_units)
            : b.mintedSupply;
          if (supplyA === supplyB) return 0;
          return supplyA > supplyB ? direction : -direction;
        }
        case 'ticker':
        default: {
          return direction * a.base.ticker.localeCompare(b.base.ticker);
        }
      }
    });
    return sorted;
  }, [filteredTokens, sortKey, sortDir]);

  const loadMore = () => {
    if (loadingMore || visibleCount >= sortedTokens.length) return;
    setLoadingMore(true);
    // Simulate a small delay for better UX or just update state
    setTimeout(() => {
      setVisibleCount((prev) => prev + 50);
      setLoadingMore(false);
    }, 300);
  };

  useEffect(() => {
    if (!tokens.length) return;
    const now = Date.now();

    const targets = tokens.filter((token) => {
      const tick = token.ticker.toLowerCase();
      if (hydrationInFlight.current.has(tick)) return false;
      const stats = tokenStats[tick];
      if (!stats) return true;
      return now - stats.updatedAt > STATS_TTL_MS;
    });

    if (!targets.length) return;

    let cancelled = false;
    const hydrateBatch = async (batch: OrdinalIndexToken[]) => {
      const ticks = batch.map((t) => t.ticker.toLowerCase());
      ticks.forEach((t) => hydrationInFlight.current.add(t));
      try {
        const result = await refreshCounts({ ticks });
        if (cancelled || !result) return;
        setTokenStats((prev) => {
          const next = { ...prev } as Record<string, TokenStats>;
          (result as any[]).forEach((value: any) => {
            const t = (value?.tick || '').toLowerCase();
            if (!t) return;
            next[t] = {
              holders: value?.holders ?? prev[t]?.holders,
              transfersCompleted:
                (value?.summary?.transfers_completed as number | undefined) ??
                prev[t]?.transfersCompleted,
              summary: value?.summary,
              integrity: value?.integrity,
              updatedAt: value?.updatedAt ?? Date.now(),
            };
          });
          return next;
        });
      } catch (err) {
        console.error('Failed to refresh holder counts batch', err);
      } finally {
        ticks.forEach((t) => hydrationInFlight.current.delete(t));
      }
    };

    (async () => {
      const batchSize = 6;
      for (let i = 0; i < targets.length && !cancelled; i += batchSize) {
        const slice = targets.slice(i, i + batchSize);
        await hydrateBatch(slice);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tokens, tokenStats]);

  useEffect(() => {
    if (!sortedTokens.length) return;

    let cancelled = false;
    const staleThreshold = Date.now() - 2 * 60 * 1000;
    const targets = sortedTokens
      .map((entry) => entry.base)
      .filter((token) => {
        const tick = token.ticker.toLowerCase();
        const stats = tokenStats[tick];
        if (!stats) return true;
        return stats.updatedAt < staleThreshold;
      });

    if (!targets.length) return;

    const hydrateBatch = async (batch: OrdinalIndexToken[]) => {
      try {
        const ticks = batch.map((t) => t.ticker.toLowerCase());
        const result = await refreshCounts({ ticks });
        if (cancelled || !result) return;
        setTokenStats((prev) => {
          const next = { ...prev } as Record<string, TokenStats>;
          (result as any[]).forEach((value: any) => {
            const t = (value?.tick || '').toLowerCase();
            if (!t) return;
            next[t] = {
              holders: value?.holders ?? prev[t]?.holders,
              transfersCompleted:
                (value?.summary?.transfers_completed as number | undefined) ??
                prev[t]?.transfersCompleted,
              summary: value?.summary,
              integrity: value?.integrity,
              updatedAt: value?.updatedAt ?? Date.now(),
            };
          });
          return next;
        });
      } catch (err) {
        console.error('Failed to refresh holder counts batch', err);
      }
    };

    (async () => {
      const batchSize = 4;
      for (let i = 0; i < targets.length && !cancelled; i += batchSize) {
        const slice = targets.slice(i, i + batchSize);
        await hydrateBatch(slice);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sortedTokens, tokenStats]);

  // Seed current page from cached Convex latest counts to render faster
  const paginatedTicks = useMemo(
    () => sortedTokens.map((e) => e.base.ticker.toLowerCase()),
    [sortedTokens]
  );
  const latestCounts = useQuery(api.tokenStats.getLatestHolderCounts, {
    ticks: paginatedTicks,
  });
  useEffect(() => {
    if (!latestCounts) return;
    setTokenStats((prev) => {
      const next = { ...prev } as Record<string, TokenStats>;
      (latestCounts as any[]).forEach((data: any) => {
        if (!data) return;
        const t = (data.tick || '').toLowerCase();
        if (!t) return;
        const current = prev[t];
        if (!current || (current.updatedAt ?? 0) < data.updatedAt) {
          next[t] = {
            ...(current || { updatedAt: 0 }),
            holders: data.holders,
            updatedAt: data.updatedAt,
          } as TokenStats;
        }
      });
      return next;
    });
  }, [latestCounts]);

  const selectedToken = selectedTick
    ? tokens.find(
      (token) => token.ticker.toLowerCase() === selectedTick.toLowerCase()
    )
    : undefined;
  const selectedStats = selectedTick
    ? tokenStats[selectedTick.toLowerCase()]
    : undefined;
  const selectedDetail = selectedTick
    ? tokenDetails[selectedTick.toLowerCase()]
    : undefined;

  // Holder snapshots for selected token (used for sparkline)
  const snapshotsSince = useMemo(() => Date.now() - 7 * 24 * 60 * 60 * 1000, []);
  const snapshots = useQuery(api.tokenStats.getHolderSnapshots, {
    tick: (selectedTick || '__none__').toLowerCase(),
    since: snapshotsSince,
    limit: 120,
  });

  useEffect(() => {
    if (!selectedTick) return;
    const lower = selectedTick.toLowerCase();
    const detail = selectedDetail;
    if (detail?.holders?.length && !detail.error) {
      return;
    }

    let cancelled = false;
    setTokenDetails((prev) => ({
      ...prev,
      [lower]: { ...(prev[lower] ?? {}), loading: true, error: undefined },
    }));

    ordinalIndexAPI
      .getTokenBalances(selectedTick, 0, 15)
      .then((response) => {
        if (cancelled) return;
        setTokenDetails((prev) => ({
          ...prev,
          [lower]: {
            holders: response.holders ?? [],
            loading: false,
            fetchedAt: Date.now(),
          },
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        setTokenDetails((prev) => ({
          ...prev,
          [lower]: {
            holders: prev[lower]?.holders,
            loading: false,
            error:
              err instanceof Error
                ? err.message
                : 'Failed to load top holders',
            fetchedAt: prev[lower]?.fetchedAt,
          },
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTick, selectedDetail]);

  const totalMinted = enrichedTokens.reduce(
    (sum, entry) => sum + entry.mintedSupply,
    0
  );
  const totalHolders = tokens.reduce((sum, token) => {
    const tick = token.ticker.toLowerCase();
    return sum + (tokenStats[tick]?.holders ?? 0);
  }, 0);
  const liveMints = enrichedTokens.filter((entry) => entry.progress < 1).length;

  return (
    <main className="relative min-h-screen text-gold-100 pt-20">
      <div className="fixed inset-0 w-full h-full opacity-15 -z-10">
        <Dither
          waveColor={[0.8, 0.6, 0.2]}
          disableAnimation={false}
          enableMouseInteraction={true}
          mouseRadius={0.3}
          colorNum={4}
          waveAmplitude={0.15}
          waveFrequency={2.2}
          waveSpeed={0.035}
        />
      </div>

      <div className="relative z-10 max-w-[1800px] mx-auto px-2 md:px-2 pb-16">
        <section className="mb-6">
          <FiltersBar
            lastRefresh={lastFetchRef.current}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            sortKey={sortKey}
            onSortKeyChange={setSortKey}
            sortDir={sortDir}
            onSortDirChange={setSortDir}
            minHolders={minHolders}
            onMinHoldersChange={setMinHolders}
          />
        </section>

        {error && (
          <div className="mb-6 rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}



        {loading && tokens.length === 0 ? (
          <TokensTableSkeleton rows={15} />
        ) : sortedTokens.length === 0 ? (
          <div className="h-64 flex items-center justify-center border border-dashed border-gold-500/30 text-gold-300/60">
            No tokens match your filters.
          </div>
        ) : (
          <TokensTable
            tokens={sortedTokens.slice(0, visibleCount)}
            totalTokens={sortedTokens.length}
            selectedTick={selectedTick}
            onSelect={setSelectedTick}
            onLoadMore={loadMore}
            hasMore={visibleCount < sortedTokens.length}
            loadingMore={loadingMore}
            tokenDetails={tokenDetails}
            tokenStats={tokenStats}
            snapshots={snapshots}
          />
        )}

        <StatsFooter
          status={status}
          zrc20Status={zrc20Status}
          health={health}
          totalTokens={tokens.length}
          totalMinted={totalMinted}
          totalHolders={totalHolders}
          liveMints={liveMints}
          loading={!status && !health}
        />
      </div>
    </main>
  );
}

function HoldersSparkline({ data }: { data: { holders?: number; capturedAt?: number }[] }) {
  const points = (data || []).map((d) => ({
    x: d.capturedAt ?? 0,
    y: typeof d.holders === 'number' ? d.holders : 0,
  }));
  if (!points.length) return <div className="text-gold-300/60 text-xs">No data</div>;
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const w = 600;
  const h = 80;
  const pad = 4;
  const scaleX = (x: number) => pad + ((x - minX) / Math.max(1, maxX - minX)) * (w - 2 * pad);
  const scaleY = (y: number) => h - pad - ((y - minY) / Math.max(1, maxY - minY)) * (h - 2 * pad);
  const dAttr = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(p.x).toFixed(2)} ${scaleY(p.y).toFixed(2)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20">
      <path d={dAttr} stroke="#f5d487" strokeWidth={2} fill="none" />
      {maxY !== minY && (
        <>
          <text x={w - 4} y={12} textAnchor="end" className="fill-current text-[10px]" fill="#c2a96a">
            {formatNumber(maxY)}
          </text>
          <text x={w - 4} y={h - 4} textAnchor="end" className="fill-current text-[10px]" fill="#c2a96a">
            {formatNumber(minY)}
          </text>
        </>
      )}
    </svg>
  );
}

interface StatsFooterProps {
  status: OrdinalIndexStatus | null;
  zrc20Status: ZRC20Status | null;
  health: HealthSnapshot | null;
  totalTokens: number;
  totalMinted: number;
  totalHolders: number;
  liveMints: number;
  loading: boolean;
}

function StatsFooter({
  status,
  zrc20Status,
  health,
  totalTokens,
  totalMinted,
  totalHolders,
  liveMints,
  loading,
}: StatsFooterProps) {
  const cards = [
    {
      label: 'Indexer Height',
      value: formatNumber(status?.height ?? health?.height),
      hint: status?.synced ? 'Synced' : 'Catching up',
    },
    {
      label: 'Chain Tip',
      value: formatNumber(status?.chain_tip ?? health?.chain_tip),
      hint: `ZRC-20 Height ${formatNumber(zrc20Status?.height)}`,
    },
    {
      label: 'Tracked Tokens',
      value: formatNumber(status?.tokens ?? totalTokens),
      hint: `${formatNumber(liveMints)} active mints`,
    },
    {
      label: 'Total Holders',
      value: formatNumber(totalHolders),
      hint: `${formatNumber(totalMinted)} minted`,
    },
  ];

  return (
    <footer className="mt-10 border border-gold-500/20 bg-black/30 px-4 py-5">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
        <div className="text-xs uppercase tracking-[0.4em] text-gold-300/60">
          Network Snapshot
        </div>
        <div className="text-xs text-gold-300/60">
          {loading
            ? 'Fetching status…'
            : `Core height ${formatNumber(status?.height ?? health?.height)} • Tip ${formatNumber(
              status?.chain_tip ?? health?.chain_tip
            )}`}
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

interface FiltersBarProps {
  lastRefresh?: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (value: StatusFilter) => void;
  sortKey: SortKey;
  onSortKeyChange: (value: SortKey) => void;
  sortDir: 'asc' | 'desc';
  onSortDirChange: (value: 'asc' | 'desc') => void;
  minHolders: number;
  onMinHoldersChange: (value: number) => void;
}

function FiltersBar({
  lastRefresh,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortKey,
  onSortKeyChange,
  sortDir,
  onSortDirChange,
  minHolders,
  onMinHoldersChange,
}: FiltersBarProps) {
  return (
    <div className="sticky top-20 z-30 mb-4 flex flex-col md:flex-row items-center gap-3 p-3 border border-gold-500/10 bg-black/80 backdrop-blur-md rounded-lg shadow-xl">
      {/* Left: Title & Refresh */}
      <div className="flex items-center gap-4 mr-auto">
        <h2 className="text-lg font-bold text-gold-100 tracking-tight whitespace-nowrap">
          ZRC-20
        </h2>
        <div className="h-4 w-px bg-gold-500/20" />
        <RefreshTopTokensButton />
        <span className="text-[10px] text-gold-500/40 font-mono hidden md:inline-block">
          {lastRefresh ? new Date(lastRefresh).toLocaleTimeString() : '—'}
        </span>
      </div>

      {/* Center: Search */}
      <div className="flex-1 w-full md:w-auto max-w-md relative group">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
          <svg className="w-3.5 h-3.5 text-gold-500/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search ticker..."
          className="w-full bg-black/40 border border-gold-500/20 rounded pl-9 pr-3 py-1.5 text-xs text-gold-100 placeholder:text-gold-500/30 focus:outline-none focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/20 transition-all"
        />
      </div>

      {/* Right: Filters & Sort */}
      <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto no-scrollbar">
        <div className="flex items-center bg-black/40 rounded border border-gold-500/10 p-0.5">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => onStatusFilterChange(filter.value)}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-all whitespace-nowrap ${statusFilter === filter.value
                ? 'bg-gold-500 text-black shadow-sm'
                : 'text-gold-500/50 hover:text-gold-300 hover:bg-white/5'
                }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-gold-500/20 hidden md:block" />

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-black/40 border border-gold-500/10 rounded px-2 py-1">
            <span className="text-[10px] text-gold-500/50 uppercase font-bold">Holders &gt;</span>
            <input
              type="number"
              min={0}
              value={minHolders}
              onChange={(event) => onMinHoldersChange(Number(event.target.value))}
              className="w-12 bg-transparent text-right text-xs text-gold-100 focus:outline-none"
            />
          </div>

          <select
            value={sortKey}
            onChange={(event) => onSortKeyChange(event.target.value as SortKey)}
            className="bg-black/40 border border-gold-500/20 rounded px-2 py-1.5 text-xs text-gold-200 focus:outline-none focus:border-gold-500/40 cursor-pointer"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
            className="p-1.5 border border-gold-500/20 rounded hover:bg-gold-500/10 text-gold-300 transition-colors"
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sortDir === 'asc' ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h5m4 0l4-4m0 0l4 4m-4-4v12" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TokensTableProps {
  tokens: EnrichedToken[];
  totalTokens: number;
  selectedTick: string | null;
  onSelect: (tick: string | null) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  tokenDetails: Record<string, TokenDetailState>;
  tokenStats: Record<string, TokenStats>;
  snapshots: any; // Using any for now to match existing usage, ideally typed
}

function TokensTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gold-500/10 bg-black/40 backdrop-blur-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs md:text-sm">
          <thead className="bg-black/40 border-b border-gold-500/20">
            <tr>
              {['#', 'Token', 'Minted', 'Holders', 'Limit', 'Progress', 'Status', 'Actions'].map((h) => (
                <th key={h} className="px-6 py-4 text-left text-[10px] uppercase tracking-[0.2em] text-gold-400/80 font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gold-500/5">
            {Array.from({ length: rows }).map((_, i) => (
              <tr key={i} className="animate-pulse">
                <td className="px-6 py-4"><div className="h-3 w-4 bg-gold-500/10 rounded" /></td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-gold-500/10" />
                    <div className="space-y-1">
                      <div className="h-3 w-12 bg-gold-500/10 rounded" />
                      <div className="h-2 w-16 bg-gold-500/5 rounded" />
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4"><div className="h-3 w-20 bg-gold-500/10 rounded" /></td>
                <td className="px-6 py-4"><div className="h-3 w-12 bg-gold-500/10 rounded" /></td>
                <td className="px-6 py-4"><div className="h-3 w-12 bg-gold-500/10 rounded" /></td>
                <td className="px-6 py-4"><div className="h-1.5 w-24 bg-gold-500/10 rounded-full" /></td>
                <td className="px-6 py-4"><div className="h-4 w-12 bg-gold-500/10 rounded-full" /></td>
                <td className="px-6 py-4"><div className="h-6 w-24 bg-gold-500/10 rounded ml-auto" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}



function TokensTable({
  tokens,
  totalTokens,
  selectedTick,
  onSelect,
  onLoadMore,
  hasMore,
  loadingMore,
  tokenDetails,
  tokenStats,
  snapshots,
}: TokensTableProps) {
  const observerTarget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => {
      if (observerTarget.current) {
        observer.unobserve(observerTarget.current);
      }
    };
  }, [hasMore, loadingMore, onLoadMore]);

  return (
    <div className="overflow-hidden rounded-lg border border-gold-500/10 bg-black/40 backdrop-blur-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs md:text-sm">
          <thead className="bg-black/40 border-b border-gold-500/20 sticky top-0 z-20 backdrop-blur-md">
            <tr>
              <th className="px-6 py-4 text-left text-[10px] uppercase tracking-[0.2em] text-gold-400/80 font-bold">Token</th>
              <th className="px-6 py-4 text-left text-[10px] uppercase tracking-[0.2em] text-gold-400/80 font-bold">Minted</th>
              <th className="px-6 py-4 text-left text-[10px] uppercase tracking-[0.2em] text-gold-400/80 font-bold">Holders</th>
              <th className="px-6 py-4 text-center text-[10px] uppercase tracking-[0.2em] text-gold-400/80 font-bold w-1/4">Progress</th>
              <th className="px-6 py-4 text-left text-[10px] uppercase tracking-[0.2em] text-gold-400/80 font-bold">Status</th>
              <th className="px-6 py-4 text-right text-[10px] uppercase tracking-[0.2em] text-gold-400/80 font-bold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gold-500/5">
            {tokens.map((entry, index) => {
              const { base } = entry;
              const isSelected = selectedTick?.toLowerCase() === base.ticker.toLowerCase();
              return (
                <React.Fragment key={base.ticker}>
                  <tr
                    onClick={() => onSelect(isSelected ? null : base.ticker)}
                    className={`group cursor-pointer transition-all duration-200 border-b border-gold-500/5 ${isSelected ? 'bg-gold-500/10' : 'bg-black/20 hover:bg-gold-500/5'
                      }`}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="font-bold text-gold-100 tracking-wide text-lg">
                            {base.ticker}
                          </div>
                          <div className="text-[10px] text-gold-500/40 font-mono truncate max-w-[100px]">
                            {base.deployer ? shortAddress(base.deployer) : '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-mono text-gold-200 text-sm">
                        {formatNumber(entry.mintedSupply)}
                      </div>
                      <div className="text-[10px] text-gold-500/40">
                        of {formatNumber(entry.maxSupply)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-mono text-gold-200">
                        {formatNumber(entry.holders)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-2 w-full max-w-md mx-auto">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-gold-200 font-mono">{formatPercent(entry.progress)}</span>
                          <span className="text-gold-500/40 text-[9px] uppercase tracking-wider">
                            {entry.progress >= 1 ? 'Completed' : 'Minting'}
                          </span>
                        </div>
                        <div className="h-2 w-full bg-black/50 rounded-full overflow-hidden border border-gold-500/10 shadow-inner">
                          <div
                            className={`h-full bg-gradient-to-r from-gold-600 to-gold-400 rounded-full transition-all duration-500 ${entry.progress < 1 ? 'shine-effect' : ''}`}
                            style={{ width: `${Math.min(entry.progress * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {entry.integrity ? (
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${entry.integrity.consistent ? 'bg-green-500/50' : 'bg-red-500/50'}`} />
                          <span className={`text-[10px] font-medium ${entry.integrity.consistent ? 'text-green-500/70' : 'text-red-500/70'}`}>
                            {entry.integrity.consistent ? 'OK' : 'Check'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-gold-500/20 text-[10px]">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/inscribe?tab=zrc20&tick=${base.ticker.toLowerCase()}&op=mint`}
                          onClick={(event) => event.stopPropagation()}
                          className="px-3 py-1.5 text-[10px] font-bold border border-gold-500/30 hover:border-gold-400 hover:bg-gold-500/10 text-gold-200 uppercase tracking-wider rounded transition-all"
                        >
                          Mint
                        </Link>
                        <Link
                          href={`/tokens/trade/${base.ticker.toLowerCase()}`}
                          onClick={(event) => event.stopPropagation()}
                          className="px-3 py-1.5 text-[10px] font-bold bg-gold-500 hover:bg-gold-400 text-black uppercase tracking-wider rounded transition-all shadow-lg shadow-gold-500/20"
                        >
                          Trade
                        </Link>
                      </div>
                    </td>
                  </tr>
                  {
                    isSelected && (
                      <tr className="bg-black/40 border-b border-gold-500/10">
                        <td colSpan={6} className="p-0">
                          <div className="overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
                            <TokenDetailPanel
                              token={base}
                              stats={tokenStats[base.ticker.toLowerCase()]}
                              detailState={tokenDetails[base.ticker.toLowerCase()]}
                              snapshots={snapshots}
                              onClose={() => onSelect(null)}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  }
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {
        hasMore && (
          <div ref={observerTarget} className="py-8 flex justify-center">
            {loadingMore ? (
              <div className="text-gold-500/50 text-xs animate-pulse">Loading more tokens...</div>
            ) : (
              <div className="h-4" />
            )}
          </div>
        )
      }

      <div className="px-6 py-2 border-t border-gold-500/10 bg-black/20 text-[10px] text-gold-500/30 font-mono text-center">
        Showing {tokens.length} of {totalTokens} tokens
      </div>
    </div >
  );
}

interface TokenDetailPanelProps {
  token: OrdinalIndexToken;
  stats?: TokenStats;
  detailState?: TokenDetailState;
  snapshots?: { holders: number; capturedAt: number }[] | null | undefined;
  onClose: () => void;
}

function TokenDetailPanel({
  token,
  stats,
  detailState,
  snapshots,
  onClose,
}: TokenDetailPanelProps) {
  const holders = stats?.holders;
  const progress =
    typeof token.progress === 'number'
      ? token.progress
      : Number(token.max ?? 0) > 0
        ? Number(token.supply ?? 0) / Number(token.max ?? 0)
        : 0;
  const burned = stats?.integrity?.burned_base_units;

  return (
    <section className="mt-10 border border-gold-500/10 bg-black/40 p-6 relative overflow-hidden group rounded-lg">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
        <div className="text-9xl font-black text-gold-500 leading-none select-none">
          {token.ticker.substring(0, 2)}
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 relative z-10">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-zinc-500 mb-1">
            Token Detail
          </p>
          <h2 className="text-3xl font-black text-zinc-100">
            {token.ticker}
          </h2>
          <p className="text-sm text-zinc-400">
            Deployer: {shortAddress(token.deployer)}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-xs uppercase tracking-[0.3em] text-zinc-500 hover:text-zinc-300 transition-colors px-3 py-1"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-6 relative z-10">
        <Link
          href={`/inscribe?tab=zrc20&tick=${token.ticker.toLowerCase()}&op=mint`}
          className="flex items-center justify-center px-4 py-3 text-sm font-bold border border-gold-500/20 hover:border-gold-500/40 hover:bg-gold-500/5 text-gold-200 uppercase tracking-wider rounded transition-all"
        >
          Mint
        </Link>
        <Link
          href={`/tokens/trade/${token.ticker.toLowerCase()}`}
          className="flex items-center justify-center px-4 py-3 text-sm font-bold bg-gold-500 hover:bg-gold-400 text-black uppercase tracking-wider rounded transition-all shadow-lg shadow-gold-500/20"
        >
          Trade
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 relative z-10">
        <div className="border border-white/5 bg-black/20 p-4 rounded">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-1">
            Minted / Max
          </div>
          <div className="text-2xl font-mono text-zinc-200">
            {formatNumber(Number(token.supply))}
          </div>
          <div className="text-xs text-zinc-600">
            of {formatNumber(Number(token.max))}
          </div>
        </div>
        <div className="border border-white/5 bg-black/20 p-4 rounded">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-1">
            Holders
          </div>
          <div className="text-2xl font-mono text-zinc-200">
            {formatNumber(holders)}
          </div>
          {stats?.transfersCompleted !== undefined && (
            <div className="text-xs text-zinc-600">
              Transfers: {formatNumber(stats.transfersCompleted)}
            </div>
          )}
        </div>
        {stats?.integrity && (
          <div className="border border-white/5 bg-black/20 p-4 rounded">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-1">
              Integrity
            </div>
            <div
              className={`text-xl font-bold mt-1 ${stats.integrity.consistent ? 'text-green-400' : 'text-red-400'
                }`}
            >
              {stats.integrity.consistent ? 'Healthy' : 'Check ledger'}
            </div>
            {burned !== undefined && (
              <div className="text-xs text-zinc-600 mt-1">
                Burned: {formatBaseUnits(burned)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 relative z-10">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-gold-600 to-gold-400 rounded-full"
              style={{ width: `${Math.min(progress * 100, 100)}%` }}
            />
          </div>
          <span className="font-mono text-zinc-400 text-sm">
            {formatPercent(progress)}
          </span>
        </div>
        <div className="text-xs text-zinc-600 mt-2 flex justify-between font-mono">
          <span>Limit: {formatNumber(Number(token.lim))}</span>
          <span>Decimals: {token.dec}</span>
        </div>
        <div className="mt-4">
          <div className="text-xs uppercase tracking-[0.3em] text-gold-300/70 mb-2">
            Holders (7d)
          </div>
          <HoldersSparkline data={(snapshots as any) || []} />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="border border-gold-500/20 bg-black/30 p-4">
          <h3 className="text-sm font-bold uppercase tracking-[0.3em] text-gold-300/70 mb-3">
            Top Holders
          </h3>
          {detailState?.loading ? (
            <div className="text-gold-300/60 text-sm">Loading holders…</div>
          ) : detailState?.error ? (
            <div className="text-red-300 text-sm">{detailState.error}</div>
          ) : detailState?.holders && detailState.holders.length > 0 ? (
            <div className="space-y-2">
              {detailState.holders.map((holder) => (
                <div
                  key={holder.address}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <div className="text-gold-100 font-mono">
                    {shortAddress(holder.address)}
                  </div>
                  <div className="text-gold-300/80 font-mono">
                    {formatBaseUnits(holder.overall)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gold-300/60 text-sm">No holder data.</div>
          )}
        </div>

        {/* Debug Stats - Only show if integrity data exists */}
        {stats?.integrity && (
          <div className="border border-gold-500/20 bg-black/30 p-4 space-y-3 text-sm text-gold-300/80">
            <div className="flex justify-between">
              <span>Inscription</span>
              <span className="font-mono truncate max-w-[60%]">
                {token.inscription_id || '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Integrity supply</span>
              <span className="font-mono">
                {formatBaseUnits(stats.integrity.supply_base_units)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Sum of holders</span>
              <span className="font-mono">
                {formatBaseUnits(stats.integrity.sum_overall_base_units)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Available sum</span>
              <span className="font-mono">
                {formatBaseUnits(stats.integrity.sum_available_base_units)}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
