'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getConvexClient } from '@/lib/convexClient';
import { api } from '../../../../../convex/_generated/api';
import { getCollectionConfig } from '@/config/collections';

const PAGE_SIZE = 25;
const ISSUE_LABELS: Record<string, { label: string; hint: string }> = {
  over_minted: {
    label: 'Minted > Allocated',
    hint: 'Wallet minted more than its allowlist cap.',
  },
  over_reserved: {
    label: 'Reserved > Cap',
    hint: 'Active reservations exceed remaining allocation.',
  },
  duplicate_tokens: {
    label: 'Duplicate Tokens',
    hint: 'Same token id reserved/minted multiple times for this wallet.',
  },
  expired_reservations: {
    label: 'Expired Holds',
    hint: 'Wallet has reservations that expired before minting.',
  },
  failed_claims: {
    label: 'Failed Claims',
    hint: 'Wallet had failed claim attempts.',
  },
};

type Counts = {
  mintedCount: number;
  reservedCount: number;
  failedCount: number;
  total: number;
};

type RecentMint = {
  address: string;
  tokenId: number;
  inscriptionId?: string;
  txid?: string;
  createdAt: number;
};

type AllocationEntry = {
  address: string;
  max: number;
  isVip: boolean;
  mintedCount: number;
  reservedCount: number;
  reservedExpiredCount: number;
  failedCount: number;
  remaining: number;
  mintedTokenIds: number[];
  reservedTokenIds: number[];
  duplicateTokenIds: number[];
  issues: string[];
};

type AllocationResult = {
  total: number;
  start: number;
  limit: number;
  pageSize: number;
  nextStart: number | null;
  allowlistTotal: number;
  entries: AllocationEntry[];
};

export default function ClaimStatsPage() {
  const params = useParams();
  const slug = String(params?.slug || '').toLowerCase();
  const collection = getCollectionConfig(slug);

  const [counts, setCounts] = useState<Counts | null>(null);
  const [recentMints, setRecentMints] = useState<RecentMint[]>([]);
  const [allocationResult, setAllocationResult] = useState<AllocationResult | null>(null);
  const [allocationLoading, setAllocationLoading] = useState(true);
  const [allocationError, setAllocationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const allocationSummary = useMemo(() => {
    if (!allocationResult) return null;
    return allocationResult.entries.reduce(
      (acc, entry) => {
        const claimed = entry.mintedCount + entry.reservedCount;
        acc.claimed += claimed;
        acc.unclaimed += entry.remaining;
        acc.issues += entry.issues.length > 0 ? 1 : 0;
        return acc;
      },
      { claimed: 0, unclaimed: 0, issues: 0 }
    );
  }, [allocationResult]);
  const collectionTotals = useMemo(() => {
    if (!allocationResult || !counts) return null;
    const claimed = counts.mintedCount + counts.reservedCount;
    const totalCapacity = allocationResult.allowlistTotal;
    const unclaimed = Math.max(totalCapacity - claimed, 0);
    return { claimed, unclaimed };
  }, [allocationResult, counts]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const convex = getConvexClient();
      if (!convex) throw new Error('Convex client unavailable');

      const [countsRes, recentMintsRes] = await Promise.all([
        convex.query((api as any).claimStats.getCollectionCounts, { collectionSlug: slug }),
        convex.query((api as any).claimStats.getRecentMints, { collectionSlug: slug, limit: 20 }),
      ]);

      setCounts(countsRes);
      setRecentMints(recentMintsRes);
    } catch (e) {
      console.error('Failed to load stats:', e);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  const loadAllocations = useCallback(
    async (start = 0) => {
      setAllocationLoading(true);
      setAllocationError(null);
      try {
        const convex = getConvexClient();
        if (!convex) throw new Error('Convex client unavailable');

        const res = await convex.query((api as any).claimStats.getAllocationStatus, {
          collectionSlug: slug,
          start,
          limit: PAGE_SIZE,
        });
        setAllocationResult(res as AllocationResult);
      } catch (err) {
        console.error('Failed to load allocations:', err);
        setAllocationError(err instanceof Error ? err.message : 'Failed to load allocation data');
      } finally {
        setAllocationLoading(false);
      }
    },
    [slug]
  );

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [loadStats]);

  useEffect(() => {
    loadAllocations(0);
  }, [loadAllocations]);

  const handlePrevPage = useCallback(() => {
    if (allocationLoading || !allocationResult) return;
    if (allocationResult.start === 0) return;
    loadAllocations(Math.max(allocationResult.start - PAGE_SIZE, 0));
  }, [allocationLoading, allocationResult, loadAllocations]);

  const handleNextPage = useCallback(() => {
    if (allocationLoading || !allocationResult) return;
    if (allocationResult.nextStart == null) return;
    loadAllocations(allocationResult.nextStart);
  }, [allocationLoading, allocationResult, loadAllocations]);

  const handleRefreshAllocations = useCallback(() => {
    if (allocationLoading) return;
    loadAllocations(allocationResult?.start ?? 0);
  }, [allocationLoading, allocationResult, loadAllocations]);

  const handleRefreshRecent = useCallback(() => {
    loadStats();
  }, [loadStats]);

  if (!collection) {
    return (
      <main className="min-h-screen bg-black text-gold-100 p-6 pt-24">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold mb-6">Collection not found</h1>
          <Link href="/" className="text-gold-400 hover:text-gold-300 underline">
            ← Back to home
          </Link>
        </div>
      </main>
    );
  }

  const supply = collection.supply || 1000;
  const mintProgress = counts ? (counts.mintedCount / supply) * 100 : 0;

  return (
    <main className="min-h-screen bg-black text-gold-100 p-6 pt-24">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">{collection.name} - Claim Stats</h1>
            <p className="text-gold-200/70 mt-2">{collection.description}</p>
          </div>
          <Link
            href={`/claim/${slug}`}
            className="px-4 py-2 bg-gold-500 text-black rounded-lg hover:bg-gold-400 transition-colors font-semibold"
          >
            ← Back to Claim
          </Link>
        </div>

        {loading && !counts && (
          <div className="text-gold-200/70">Loading stats...</div>
        )}

        {counts && (
          <div className="space-y-6">
            <div className="glass-card p-6 border border-gold-500/20 rounded-lg">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-2xl font-bold">Allocation Inspector</h2>
                  <p className="text-gold-200/70 text-sm">
                    Review every wallet&apos;s minted tokens, reservations, and remaining allocation.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-2 border border-gold-500/40 text-sm uppercase tracking-wide disabled:opacity-40"
                    onClick={handlePrevPage}
                    disabled={allocationLoading || !allocationResult || allocationResult.start === 0}
                  >
                    ◀ Prev
                  </button>
                  <button
                    className="px-3 py-2 border border-gold-500/40 text-sm uppercase tracking-wide disabled:opacity-40"
                    onClick={handleNextPage}
                    disabled={
                      allocationLoading || !allocationResult || allocationResult.nextStart == null
                    }
                  >
                    Next ▶
                  </button>
                  <button
                    className="px-3 py-2 border border-gold-500/40 text-sm uppercase tracking-wide disabled:opacity-40"
                    onClick={handleRefreshAllocations}
                    disabled={allocationLoading}
                  >
                    Refresh
                  </button>
                </div>
              </div>
              {allocationError && (
                <div className="mb-4 text-red-400 text-sm">{allocationError}</div>
              )}
              {(collectionTotals || allocationSummary) && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                  {collectionTotals && (
                    <div className="p-3 bg-black/30 border border-gold-500/20 rounded">
                      <div className="text-xs text-gold-200/60 mb-1">Collection claimed</div>
                      <div className="text-2xl font-bold text-gold-100">
                        {collectionTotals.claimed.toLocaleString()}
                      </div>
                      <p className="text-xs text-gold-200/50 mt-1">
                        Minted + reserved across full allowlist
                      </p>
                      {allocationSummary && (
                        <p className="text-xs text-gold-200/60 mt-1">
                          In view: {allocationSummary.claimed.toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}
                  {collectionTotals && (
                    <div className="p-3 bg-black/30 border border-gold-500/20 rounded">
                      <div className="text-xs text-gold-200/60 mb-1">Collection unclaimed</div>
                      <div className="text-2xl font-bold text-emerald-300">
                        {collectionTotals.unclaimed.toLocaleString()}
                      </div>
                      <p className="text-xs text-gold-200/50 mt-1">
                        Remaining allocation (total allowlist)
                      </p>
                      {allocationSummary && (
                        <p className="text-xs text-gold-200/60 mt-1">
                          In view: {allocationSummary.unclaimed.toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}
                  {allocationSummary && (
                    <div className="p-3 bg-black/20 border border-gold-500/10 rounded">
                      <div className="text-xs text-gold-200/60 mb-1">Rows with issues</div>
                      <div className="text-xl font-semibold text-red-300">
                        {allocationSummary.issues.toLocaleString()}
                      </div>
                      <p className="text-xs text-gold-200/50 mt-1">Over-claims, duplicates, expirations</p>
                    </div>
                  )}
                </div>
              )}
              {allocationResult && allocationResult.total > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-gold-300/70 border-b border-gold-500/20">
                        <th className="py-2 pr-4">Address</th>
                        <th className="py-2 pr-4">Allocated</th>
                        <th className="py-2 pr-4">Minted</th>
                        <th className="py-2 pr-4">Reserved</th>
                        <th className="py-2 pr-4">Unclaimed</th>
                        <th className="py-2 pr-4">Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocationResult.entries.map((entry) => {
                        const shortened = `${entry.address.slice(0, 6)}...${entry.address.slice(-4)}`;
                        const mintedTitle =
                          entry.mintedTokenIds.length > 0
                            ? entry.mintedTokenIds.map((id) => `#${id}`).join(', ')
                            : 'No mints yet';
                        const reservedTitle =
                          entry.reservedTokenIds.length > 0
                            ? entry.reservedTokenIds.map((id) => `#${id}`).join(', ')
                            : 'No active reservations';
                        return (
                          <tr key={entry.address} className="border-b border-gold-500/10 last:border-none">
                            <td className="py-2 pr-4 font-mono text-xs">
                              <div className="flex items-center gap-2">
                                <span title={entry.address}>{shortened}</span>
                                {entry.isVip && <span className="text-xs text-gold-400">⭐ VIP</span>}
                              </div>
                            </td>
                            <td className="py-2 pr-4">{entry.max}</td>
                            <td className="py-2 pr-4 text-gold-100" title={mintedTitle}>
                              {entry.mintedCount}
                            </td>
                            <td className="py-2 pr-4 text-amber-100" title={reservedTitle}>
                              {entry.reservedCount}
                            </td>
                            <td className="py-2 pr-4 text-emerald-200">
                              {entry.remaining}
                            </td>
                            <td className="py-2 pr-4">
                              {entry.issues.length === 0 ? (
                                <span className="text-gold-400/60">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {entry.issues.map((issue) => {
                                    const meta = ISSUE_LABELS[issue] ?? {
                                      label: issue.replace('_', ' '),
                                      hint: 'Review entry for details.',
                                    };
                                    const hint =
                                      issue === 'duplicate_tokens' && entry.duplicateTokenIds.length
                                        ? `Duplicate token IDs detected: ${entry.duplicateTokenIds.join(', ')}`
                                        : issue === 'expired_reservations'
                                        ? `${entry.reservedExpiredCount} expired reservations`
                                        : issue === 'failed_claims'
                                        ? `${entry.failedCount} failed attempts`
                                        : meta.hint;
                                    return (
                                      <span
                                        key={`${entry.address}-${issue}`}
                                        className="px-2 py-1 rounded-full text-xs bg-red-500/20 border border-red-400/40"
                                        title={hint}
                                      >
                                        {meta.label}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="text-xs text-gold-200/60 mt-3">
                    Showing {allocationResult.start + 1}–
                    {allocationResult.start + allocationResult.entries.length} of {allocationResult.total} addresses
                  </div>
                </div>
              ) : allocationLoading ? (
                <div className="text-gold-200/70">Loading allocation data...</div>
              ) : (
                <div className="text-gold-200/70">No allowlist entries found.</div>
              )}
            </div>

            <div className="glass-card p-6 border border-gold-500/20 rounded-lg">
              <h2 className="text-2xl font-bold mb-4">Collection Progress</h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-black/30 border border-gold-500/20 rounded-lg">
                  <div className="text-sm text-gold-200/60 mb-1">Minted</div>
                  <div className="text-3xl font-bold text-gold-300">{counts.mintedCount.toLocaleString()}</div>
                </div>
                <div className="p-4 bg-black/30 border border-gold-500/20 rounded-lg">
                  <div className="text-sm text-gold-200/60 mb-1">Supply</div>
                  <div className="text-3xl font-bold">{supply.toLocaleString()}</div>
                </div>
                <div className="p-4 bg-black/30 border border-gold-500/20 rounded-lg">
                  <div className="text-sm text-gold-200/60 mb-1">Reserved</div>
                  <div className="text-3xl font-bold text-gold-400">{counts.reservedCount.toLocaleString()}</div>
                </div>
                <div className="p-4 bg-black/30 border border-gold-500/20 rounded-lg">
                  <div className="text-sm text-gold-200/60 mb-1">Progress</div>
                  <div className="text-3xl font-bold text-gold-200">{mintProgress.toFixed(1)}%</div>
                </div>
              </div>
              <div className="w-full h-4 bg-black/60 border border-gold-500/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-gold-500 to-gold-300 transition-all duration-500"
                  style={{ width: `${Math.min(100, mintProgress)}%` }}
                />
              </div>
              <div className="text-center mt-2 text-sm text-gold-200/60">
                {counts.mintedCount} / {supply} minted
              </div>
            </div>

            {recentMints.length > 0 && (
              <div className="glass-card p-6 border border-gold-500/20 rounded-lg">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-2xl font-bold">Recent Mints 🔥</h2>
                    <p className="text-gold-200/70 text-sm">
                      Live feed of the latest minted tokens for this collection.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="px-3 py-2 border border-gold-500/40 text-sm uppercase tracking-wide"
                      onClick={handleRefreshRecent}
                    >
                      Refresh
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {recentMints.map((mint) => (
                    <div
                      key={`${mint.address}-${mint.tokenId}`}
                      className="p-3 bg-black/30 border border-gold-500/20 rounded-lg"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-mono text-sm text-gold-200">
                          {mint.address.slice(0, 8)}...{mint.address.slice(-8)}
                        </div>
                        <div className="text-xs text-gold-200/60">
                          {new Date(mint.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gold-400">Token #{mint.tokenId}</span>
                        {mint.inscriptionId && (
                          <a
                            href={`https://zerdinals.com/zerdinals/${mint.inscriptionId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-gold-300 hover:text-gold-200 underline"
                          >
                            View Inscription →
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
