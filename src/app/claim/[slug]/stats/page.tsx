'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getConvexClient } from '@/lib/convexClient';
import { api } from '../../../../../convex/_generated/api';
import { getCollectionConfig } from '@/config/collections';

type Counts = {
  mintedCount: number;
  reservedCount: number;
  failedCount: number;
  total: number;
};

type TopMinter = {
  address: string;
  count: number;
};

type RecentMint = {
  address: string;
  tokenId: number;
  inscriptionId?: string;
  txid?: string;
  createdAt: number;
};

type WhitelistEntry = {
  address: string;
  max: number;
  isVip: boolean;
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
  nextStart: number | null;
  entries: AllocationEntry[];
};

export default function ClaimStatsPage() {
  const params = useParams();
  const slug = String(params?.slug || '').toLowerCase();
  const collection = getCollectionConfig(slug);

  const [counts, setCounts] = useState<Counts | null>(null);
  const [topMinters, setTopMinters] = useState<TopMinter[]>([]);
  const [recentMints, setRecentMints] = useState<RecentMint[]>([]);
  const [whitelist, setWhitelist] = useState<Map<string, WhitelistEntry>>(new Map());
  const [allocationResult, setAllocationResult] = useState<AllocationResult | null>(null);
  const [allocationLoading, setAllocationLoading] = useState(true);
  const [allocationError, setAllocationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const convex = getConvexClient();
      if (!convex) throw new Error('Convex client unavailable');

      // Load whitelist
      let whitelistMap = new Map<string, WhitelistEntry>();
      if (collection?.claimWhitelistPath) {
        try {
          const res = await fetch(collection.claimWhitelistPath);
          if (res.ok) {
            const text = await res.text();
            const lines = text.trim().split('\n');
            for (let i = 1; i < lines.length; i++) {
              const cols = lines[i]?.split(',').map(c => c.trim());
              if (!cols || cols.length < 2) continue;
              const address = cols[0].toLowerCase();
              const max = Number(cols[1]) || 0;
              const isVip = cols[3]?.toLowerCase() === 'true';
              whitelistMap.set(address, { address: cols[0], max, isVip });
            }
          }
        } catch (e) {
          console.error('Failed to load whitelist:', e);
        }
      }
      setWhitelist(whitelistMap);

      const [countsRes, topMintersRes, recentMintsRes] = await Promise.all([
        convex.query((api as any).claimStats.getCollectionCounts, { collectionSlug: slug }),
        convex.query((api as any).claimStats.getTopMinters, { collectionSlug: slug, limit: 50 }),
        convex.query((api as any).claimStats.getRecentMints, { collectionSlug: slug, limit: 20 }),
      ]);

      setCounts(countsRes);
      setTopMinters(topMintersRes);
      setRecentMints(recentMintsRes);
    } catch (e) {
      console.error('Failed to load stats:', e);
    } finally {
      setLoading(false);
    }
  }, [slug, collection?.claimWhitelistPath]);

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
          limit: 25,
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
            {/* Progress Overview */}
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

              {/* Progress Bar */}
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

            {/* Top Minters Leaderboard */}
            {topMinters.length > 0 && (
              <div className="glass-card p-6 border border-gold-500/20 rounded-lg">
                <h2 className="text-2xl font-bold mb-4">Top Minters 🏆</h2>
                <div className="space-y-2">
                  {topMinters.slice(0, 20).map((minter, idx) => {
                    const wlEntry = whitelist.get(minter.address.toLowerCase());
                    const allocation = wlEntry?.max || 0;
                    const isOverAllocated = minter.count > allocation;
                    const isNotWhitelisted = !wlEntry;

                    return (
                      <div
                        key={minter.address}
                        className={`p-3 bg-black/30 border rounded-lg ${
                          isOverAllocated || isNotWhitelisted
                            ? 'border-red-500/40 bg-red-950/20'
                            : 'border-gold-500/20'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="text-xl font-bold text-gold-400 w-8 flex-shrink-0">
                              {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                            </div>
                            <div className="flex flex-col min-w-0 flex-1">
                              <div className="font-mono text-sm truncate">
                                {minter.address.slice(0, 8)}...{minter.address.slice(-8)}
                              </div>
                              {wlEntry?.isVip && (
                                <span className="text-xs text-gold-400">⭐ VIP</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="text-right">
                              <div className={`text-lg font-bold ${
                                isOverAllocated ? 'text-red-300' : 'text-gold-300'
                              }`}>
                                {minter.count}
                              </div>
                              <div className="text-xs text-gold-200/60">
                                {isNotWhitelisted ? (
                                  <span className="text-red-300">Not WL</span>
                                ) : (
                                  `/ ${allocation}`
                                )}
                              </div>
                            </div>
                            {isOverAllocated && (
                              <span className="text-red-400 text-xl" title="Over allocated">⚠️</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Recent Mints Feed */}
            {recentMints.length > 0 && (
              <div className="glass-card p-6 border border-gold-500/20 rounded-lg">
                <h2 className="text-2xl font-bold mb-4">Recent Mints 🔥</h2>
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

            <div className="glass-card p-6 border border-gold-500/20 rounded-lg">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-2xl font-bold">Allocation Inspector</h2>
                  <p className="text-gold-200/70 text-sm">
                    Inspect each wallet&apos;s minted count, open reservations, and remaining allocation.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-2 border border-gold-500/40 text-sm uppercase tracking-wide disabled:opacity-40"
                    onClick={() =>
                      loadAllocations(
                        Math.max((allocationResult?.start ?? 0) - (allocationResult?.limit ?? 25), 0)
                      )
                    }
                    disabled={
                      allocationLoading || !allocationResult || (allocationResult?.start ?? 0) === 0
                    }
                  >
                    ◀ Prev
                  </button>
                  <button
                    className="px-3 py-2 border border-gold-500/40 text-sm uppercase tracking-wide disabled:opacity-40"
                    onClick={() =>
                      allocationResult?.nextStart != null && loadAllocations(allocationResult.nextStart)
                    }
                    disabled={allocationLoading || !allocationResult || allocationResult.nextStart == null}
                  >
                    Next ▶
                  </button>
                  <button
                    className="px-3 py-2 border border-gold-500/40 text-sm uppercase tracking-wide disabled:opacity-40"
                    onClick={() => loadAllocations(allocationResult?.start ?? 0)}
                    disabled={allocationLoading}
                  >
                    Refresh
                  </button>
                </div>
              </div>
              {allocationError && (
                <div className="mb-4 text-red-400 text-sm">{allocationError}</div>
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
                        <th className="py-2 pr-4">Remaining</th>
                        <th className="py-2 pr-4">Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocationResult.entries.map((entry) => {
                        const shortened = `${entry.address.slice(0, 6)}...${entry.address.slice(-4)}`;
                        return (
                          <tr key={entry.address} className="border-b border-gold-500/10 last:border-none">
                            <td className="py-2 pr-4 font-mono text-xs">
                              <div className="flex items-center gap-2">
                                <span title={entry.address}>{shortened}</span>
                                {entry.isVip && <span className="text-xs text-gold-400">⭐ VIP</span>}
                              </div>
                            </td>
                            <td className="py-2 pr-4">{entry.max}</td>
                            <td
                              className="py-2 pr-4"
                              title={
                                entry.mintedTokenIds.length
                                  ? entry.mintedTokenIds.map((id) => `#${id}`).join(', ')
                                  : 'No mints yet'
                              }
                            >
                              {entry.mintedCount}
                            </td>
                            <td
                              className="py-2 pr-4"
                              title={
                                entry.reservedTokenIds.length
                                  ? entry.reservedTokenIds.map((id) => `#${id}`).join(', ')
                                  : 'No active reservations'
                              }
                            >
                              {entry.reservedCount}
                            </td>
                            <td className="py-2 pr-4">{entry.remaining}</td>
                            <td className="py-2 pr-4">
                              {entry.issues.length === 0 ? (
                                <span className="text-gold-400/60">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {entry.issues.map((issue) => (
                                    <span
                                      key={`${entry.address}-${issue}`}
                                      className="px-2 py-1 rounded-full text-xs bg-red-500/20 border border-red-400/40"
                                      title={
                                        issue === 'over_minted'
                                          ? 'Minted count exceeds allocation'
                                          : issue === 'over_reserved'
                                          ? 'Active reservations exceed remaining allocation'
                                          : `Duplicate token IDs detected: ${entry.duplicateTokenIds.join(', ')}`
                                      }
                                    >
                                      {issue.replace('_', ' ')}
                                    </span>
                                  ))}
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
          </div>
        )}
      </div>
    </main>
  );
}
