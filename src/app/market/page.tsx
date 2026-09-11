'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { zcashRPC } from '@/services/zcash';
import { ZgodsOnchainView } from '@/components/ZgodsOnchainView';
import { ordinalIndexAPI, type OrdinalIndexToken } from '@/services/ordinalIndex';
import { zrc721IndexAPI } from '@/services/zrc721Index';

// Helper to format numbers
const formatNumber = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
};

const formatPercent = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${(value * 100).toFixed(1)}%`;
};

export default function Home() {
  const [blockHeight, setBlockHeight] = useState<number>(0);
  const [loadingHeight, setLoadingHeight] = useState(true);
  const [tokens, setTokens] = useState<OrdinalIndexToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch recent names
  const recentNames = useQuery(api.names.listNamesRecent, { limit: 10 });

  // Fetch top holders stats
  const topHolders = useQuery(api.tokenStats.getTopHolders, { limit: 50, minHolders: 100 });

  useEffect(() => {
    async function fetchData() {
      try {
        const height = await zcashRPC.getBlockCount();
        setBlockHeight(height);
      } catch (error) {
        console.error('Failed to fetch block height:', error);
      } finally {
        setLoadingHeight(false);
      }
    }
    fetchData();
    const interval = setInterval(fetchData, 120000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function fetchTokens() {
      try {
        // Fetch enough tokens to get a good mix
        const response = await ordinalIndexAPI.getTokens(0, 200);
        setTokens(response.items);
      } catch (err) {
        console.error('Failed to load tokens', err);
      } finally {
        setLoadingTokens(false);
      }
    }
    fetchTokens();
  }, []);

  // 1. Live Mints: Progress < 100%
  const liveMints = useMemo(() => {
    return tokens
      .filter(t => {
        const p = t.progress || 0;
        return p < 1 && p > 0;
      })
      .sort((a, b) => (b.progress || 0) - (a.progress || 0))
      .slice(0, 8);
  }, [tokens]);

  const liveMintTickers = useMemo(() => liveMints.map(t => t.ticker), [liveMints]);
  const liveMintHolders = useQuery(api.tokenStats.getLatestHolderCounts, { ticks: liveMintTickers });

  const enrichedLiveMints = useMemo(() => {
    if (!liveMintHolders) return liveMints;
    const holderMap = new Map(liveMintHolders.map(h => [h.tick, h.holders]));
    return liveMints.map(t => ({
      ...t,
      holderCount: holderMap.get(t.ticker.toLowerCase()) ?? 0
    }));
  }, [liveMints, liveMintHolders]);


  // 3. Trending Tokens: Combined "Established" (>500 holders) and "Trending" (>100 holders & >40% mint)
  const trendingTokens = useMemo(() => {
    if (!topHolders) return [];

    // Create a map of holders for easy access
    const holderMap = new Map(topHolders.map(h => [h.tick, h.holders]));

    return tokens
      .filter(t => {
        const holders = holderMap.get(t.ticker.toLowerCase()) || 0;
        const p = t.progress || 0;
        // Include if established OR significant progress with some traction
        return holders > 500 || (holders > 100 && p >= 0.4);
      })
      .map(t => {
        const holders = holderMap.get(t.ticker.toLowerCase()) || 0;
        const p = t.progress || 0;
        let statLabel = '';

        // Determine the "why"
        let statIcon;
        if (holders > 500) {
          statLabel = `${formatNumber(holders)} Holders`;
          statIcon = <UsersIcon className="w-3 h-3" />;
        } else if (p >= 0.8) {
          statLabel = `${formatPercent(p)} Minted`;
          statIcon = <FlameIcon className="w-3 h-3" />;
        } else {
          statLabel = `Trending`;
          statIcon = <TrendingUpIcon className="w-3 h-3" />;
        }

        return { ...t, statLabel, statIcon, holderCount: holders };
      })
      .sort((a, b) => b.holderCount - a.holderCount) // Sort by holders for now
      .slice(0, 10);
  }, [tokens, topHolders]);

  return (
    <main className="relative min-h-screen pt-24 pb-16">
      {/* Background */}
      <div className="fixed inset-0 w-full h-full bg-[#0a0a0a] -z-20"></div>
      <div className="fixed inset-0 w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gold-900/10 via-black to-black -z-10"></div>

      <div className="container mx-auto px-4 sm:px-6 max-w-7xl">
        {/* Hero / Search Section */}
        <section className="mb-12 text-center">
          <h1 className="text-4xl md:text-6xl font-black text-gold-100 mb-6 tracking-tight">
            ZCASH <span className="text-gold-500">INSCRIPTION MARKETPLACE</span>
          </h1>

          <div className="mx-auto mt-8 max-w-5xl rounded-full border border-gold-500/10 bg-black/40 px-6 py-3 backdrop-blur-md">
            <div className="flex items-center justify-between text-xs md:text-sm gap-3 overflow-x-auto">
              <div className="flex flex-col items-center gap-1 md:flex-row md:gap-2 shrink-0">
                <span className="text-gold-500/60 uppercase tracking-wider font-bold whitespace-nowrap">Block Height</span>
                <span className="font-mono text-gold-100 font-bold">{loadingHeight ? '...' : blockHeight.toLocaleString()}</span>
              </div>
              <div className="h-8 w-px bg-gold-500/10"></div>
              <div className="flex flex-col items-center gap-1 md:flex-row md:gap-2 shrink-0">
                <span className="text-gold-500/60 uppercase tracking-wider font-bold whitespace-nowrap">Inscriptions</span>
                <span className="font-mono text-gold-100 font-bold">
                  <StatsValue type="inscriptions" />
                </span>
              </div>
              <div className="h-8 w-px bg-gold-500/10"></div>
              <div className="flex flex-col items-center gap-1 md:flex-row md:gap-2 shrink-0">
                <span className="text-gold-500/60 uppercase tracking-wider font-bold whitespace-nowrap">ZRC-20</span>
                <span className="font-mono text-gold-100 font-bold">
                  <StatsValue type="tokens" />
                </span>
              </div>
              <div className="h-8 w-px bg-gold-500/10"></div>
              <div className="flex flex-col items-center gap-1 md:flex-row md:gap-2 shrink-0">
                <span className="text-gold-500/60 uppercase tracking-wider font-bold whitespace-nowrap">ZRC-721</span>
                <span className="font-mono text-gold-100 font-bold">
                  <StatsValue type="zrc721_collections" />
                </span>
              </div>
            </div>
          </div>

          {/* Recent Names Condensed Header */}
          {recentNames && recentNames.items && recentNames.items.length > 0 && (
            <div className="max-w-4xl mx-auto mt-8">
              <div className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2 px-4 bg-white/5 border border-gold-500/10 rounded-full backdrop-blur-md">
                <span className="text-xs font-bold text-gold-500 uppercase tracking-wider whitespace-nowrap">Recent Names:</span>
                {recentNames.items.map((name: any) => (
                  <Link key={name._id} href={`/names?q=${name.name}`} className="flex items-center gap-1.5 px-3 py-1 bg-black/40 rounded-full border border-gold-500/5 hover:border-gold-500/30 transition-colors group shrink-0">
                    <span className="text-xs font-mono text-gold-200 group-hover:text-gold-100">{name.name}.{name.tld}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Live Inscriptions Feed */}
        <section className="mb-16">
          <LiveInscriptionsFeed />
        </section>

        {/* ZGODS Claim + Activity */}
        <section className="mb-16">
          <div className="group relative block w-full overflow-hidden rounded-2xl border border-gold-500/20 bg-black/40 p-6 sm:p-8 transition-all hover:border-gold-500/40 hover:bg-white/5">
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-gold-500/10 via-transparent to-transparent opacity-50 transition-opacity group-hover:opacity-100" />

            <div className="flex flex-col gap-8">
              <div className="flex flex-col items-center gap-8 md:flex-row md:gap-10">
                <div className="shrink-0">
                  <div className="relative h-32 w-32 overflow-hidden rounded-xl border border-gold-500/30 bg-black/60 shadow-2xl shadow-gold-900/20 transition-transform duration-500 group-hover:scale-105 md:h-40 md:w-40">
                    <Image
                      src="/collections/zgods/3vUZmMCg.gif"
                      alt="ZGODS"
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 128px, 160px"
                      priority
                    />
                  </div>
                </div>

                <div className="flex flex-1 flex-col text-center md:text-left gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.5em] text-gold-300/60 mb-1">ZGODS DROP</p>
                    <h3 className="text-3xl font-black tracking-tight text-gold-100 md:text-4xl">
                      Claim Your <span className="text-gold-500">ZGODS</span>
                    </h3>
                  </div>
                  <p className="text-lg text-gold-300/80 max-w-xl mx-auto md:mx-0">
                    View all minted ZGODS from the onchain ZRC-721 index. Check your owned tokens.
                  </p>
                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <Link
                      href="/claim/zgods"
                      className="inline-flex items-center justify-center rounded-sm bg-gold-500 px-8 py-3 text-sm font-bold uppercase tracking-wider text-black transition-all hover:bg-gold-400 hover:shadow-[0_0_20px_rgba(234,179,8,0.3)]"
                    >
                      View Collection
                    </Link>
                  </div>
                </div>
              </div>

              <div className="border-t border-gold-500/10 pt-6">
                <ZgodsOnchainView collectionSlug="zgods" limit={10} title="Recent Mints" cardSize="sm" />
              </div>
            </div>
          </div>
        </section>

        {/* Live Mints Grid */}
        <section className="mb-16">
          <SectionHeader title="Live ZRC-20 Mints" link="/tokens?filter=live" />
          <LiveMintsList tokens={enrichedLiveMints} loading={loadingTokens} />
        </section>

        {/* ZRC-20 Marketplace Hero Banner */}
        <section className="mb-16 -mx-4 sm:-mx-6">
          <div className="relative w-full overflow-hidden rounded-none sm:rounded-2xl border-y sm:border border-gold-500/20 bg-black/60 backdrop-blur-xl">
            {/* Liquid Glass Background Effect */}
            <div className="absolute inset-0 -z-10">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-gold-500/20 via-transparent to-transparent opacity-60" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-gold-400/15 via-transparent to-transparent opacity-60" />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-pulse" />
            </div>

            <div className="relative px-6 sm:px-12 py-10 sm:py-12 md:py-14">
              <div className="max-w-5xl mx-auto text-center space-y-4">
                {/* Badge */}
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-gold-500/10 border border-gold-400/30 rounded-full backdrop-blur-sm">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-gold-500"></span>
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-gold-200 uppercase tracking-widest">Now Live</span>
                </div>

                {/* Title */}
                <h2 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black tracking-tight">
                  <span className="text-white">ZRC-20</span>
                  <br />
                  <span className="bg-gradient-to-r from-gold-400 via-gold-300 to-gold-500 bg-clip-text text-transparent">
                    MARKETPLACE
                  </span>
                </h2>

                {/* Subtitle with inline stats */}
                <p className="text-lg sm:text-xl md:text-2xl text-gold-100/80 font-medium max-w-3xl mx-auto">
                  Trade <span className="font-black text-gold-400"><StatsValue type="tokens" /></span> tokens. Decentralized, trustless, <span className="font-black text-gold-400">24/7</span> trading on Zcash.
                </p>

                {/* CTA Button */}
                <div className="pt-2">
                  <Link
                    href="/tokens/trade"
                    className="group inline-flex items-center justify-center gap-3 px-8 sm:px-12 py-4 sm:py-5 bg-gradient-to-r from-gold-500 to-gold-400 text-black rounded-sm text-base sm:text-lg font-black uppercase tracking-widest transition-all hover:shadow-[0_0_40px_rgba(234,179,8,0.5)] hover:scale-105 active:scale-95"
                  >
                    <span>Start Trading</span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-5 h-5 sm:w-6 sm:h-6 transition-transform group-hover:translate-x-1"
                    >
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trending Tokens (Combined) */}
        <section className="mb-16">
          <SectionHeader title="Trending Tokens" link="/tokens" />
          <TokenGrid tokens={trendingTokens} loading={loadingTokens} />
        </section>

        {/* Footer */}
        <footer className="border-t border-gold-500/10 pt-12 mt-12">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="text-2xl font-black text-gold-500 tracking-tighter">zatoshi.market</div>
            <div className="flex gap-6 text-sm font-medium text-gold-300/60">
              <a href="https://mempool.zatoshi.market" target="_blank" rel="noopener noreferrer" className="hover:text-gold-300 transition-colors">
                Mempool
              </a>
              <a href="https://twitter.com/zatoshimarket" target="_blank" rel="noopener noreferrer" className="hover:text-gold-300 transition-colors">
                Twitter
              </a>
              <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-gold-500/10">
                <div className={`w-1.5 h-1.5 rounded-full ${loadingHeight ? 'bg-gold-500/50' : 'bg-green-500'}`}></div>
                <span className="font-mono text-xs text-gold-400">{loadingHeight ? '...' : blockHeight.toLocaleString()}</span>
              </div>
            </div>
          </div>
          <div className="text-center mt-8 text-gold-500/20 text-xs">
            © 2024 Zatoshi Market. Built on Zcash.
          </div>
        </footer>
      </div>
    </main>
  );
}

function SectionHeader({ title, link }: { title: string; link: string }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h2 className="text-2xl font-bold text-gold-100 tracking-tight">{title}</h2>
      <Link href={link} className="text-xs font-bold text-gold-500 hover:text-gold-300 uppercase tracking-wider">
        View All
      </Link>
    </div>
  );
}

function StatsValue({ type }: { type: 'inscriptions' | 'tokens' | 'zrc721_collections' | 'zrc721_tokens' }) {
  const [value, setValue] = useState<number | null>(null);

  useEffect(() => {
    if (type === 'zrc721_collections' || type === 'zrc721_tokens') {
      zrc721IndexAPI.getStatus().then(status => {
        if (type === 'zrc721_collections') setValue(status.collections || 0);
        if (type === 'zrc721_tokens') setValue(status.tokens || 0);
      }).catch(() => { });
    } else {
      ordinalIndexAPI.getStatus().then(status => {
        if (type === 'inscriptions') setValue(status.inscriptions || 0);
        if (type === 'tokens') setValue(status.tokens || 0);
      }).catch(() => { });
    }
  }, [type]);

  if (value === null) return <span className="animate-pulse">...</span>;
  // Show both collections and tokens for ZRC-721
  if (type === 'zrc721_tokens' || type === 'zrc721_collections') {
    return <span>{value.toLocaleString()}</span>;
  }
  return <span>{value.toLocaleString()}</span>;
}

function LiveInscriptionsFeed() {
  const inscriptions = useQuery(api.inscriptions.getRecentInscriptions, { limit: 10 });

  if (!inscriptions) return null;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <h2 className="text-sm font-bold text-gold-100 tracking-tight">LIVE INSCRIPTIONS</h2>
        </div>

        <Link
          href="/inscribe"
          className="ml-auto flex items-center justify-center px-3 py-1.5 bg-gold-500 text-black rounded-sm text-xs font-bold uppercase tracking-wide hover:bg-gold-400 transition-colors sm:ml-0"
        >
          Inscribe
        </Link>
      </div>

      <div className="flex gap-4 overflow-x-auto no-scrollbar pb-4">
        {inscriptions.map((insc) => {
          const isZrc20 = insc.type === 'zrc20';
          const op = (insc.zrc20Op || '').toLowerCase();
          const badge = (() => {
            if (!isZrc20) {
              if (insc.type === 'text') return { label: 'TEXT', style: 'bg-gold-500/20 text-gold-300' };
              return { label: insc.type?.toUpperCase?.() || 'INSCRIPTION', style: 'bg-purple-500/20 text-purple-300' };
            }
            if (op === 'transfer') return { label: 'ZRC20-TRANSFER', style: 'bg-purple-500/20 text-purple-200' };
            if (op === 'deploy') return { label: 'ZRC20-DEPLOY', style: 'bg-rose-500/20 text-rose-200' };
            return { label: 'ZRC20-MINT', style: 'bg-blue-500/20 text-blue-300' };
          })();

          return (
            <div key={insc._id} className="shrink-0 w-64 bg-black/40 border border-gold-500/10 rounded-xl p-4 hover:bg-white/5 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${badge.style}`}>
                  {badge.label}
                </span>
                <span className="text-[10px] font-mono text-gold-500/50">
                  {new Date(insc.createdAt).toLocaleTimeString()}
                </span>
              </div>

              <div className="mb-2">
                {isZrc20 ? (
                  <div className="font-bold text-gold-100">
                    {insc.zrc20Amount || '—'} <span className="text-gold-400">{insc.zrc20Tick}</span>
                  </div>
                ) : (
                  <div className="font-mono text-xs text-gold-200 truncate">
                    {insc.contentPreview || 'Binary Data'}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 text-[10px] text-gold-500/40 font-mono">
                <div className="h-4 w-4 rounded-full bg-gradient-to-br from-gold-500/20 to-black border border-gold-500/20 flex items-center justify-center text-[8px]">
                  {(insc.address || '').slice(0, 2)}
                </div>
                <span>
                  {(insc.address || '').slice(0, 6)}...
                  {(insc.address || '').slice(-4)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TokenGrid({ tokens, loading }: { tokens: any[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-32 bg-white/5 rounded-sm animate-pulse border border-gold-500/5"></div>
        ))}
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <div className="text-center py-12 text-gold-500/40 border border-dashed border-gold-500/10 rounded-sm">
        No tokens found for this category.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {tokens.map((token) => (
        <TokenCard key={token.ticker} token={token} />
      ))}
    </div>
  );
}

function TokenCard({ token }: { token: any }) {
  const progress = token.progress || 0;
  const isCompleted = progress >= 0.999;
  const statLabel = token.statLabel;

  return (
    <div className="group relative bg-black/40 border border-gold-500/10 rounded-sm p-4 hover:border-gold-500/30 hover:bg-white/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-gold-900/10 flex flex-col justify-between h-full">
      <div className="flex justify-between items-start mb-3">
        <div className="w-8 h-8 rounded-sm bg-gradient-to-br from-gold-500/20 to-black border border-gold-500/20 flex items-center justify-center text-sm font-bold text-gold-100 group-hover:scale-105 transition-transform duration-300">
          {token.ticker.slice(0, 1).toUpperCase()}
        </div>
        {isCompleted ? (
          <span className="px-2 py-0.5 bg-black/30 border border-gold-500/30 text-gold-200/70 text-[9px] font-bold uppercase tracking-wider rounded">
            Completed
          </span>
        ) : (
          <Link
            href={`/inscribe?tab=zrc20&tick=${token.ticker.toLowerCase()}`}
            className="relative z-20 px-2 py-0.5 bg-gold-500 text-black text-[9px] font-bold uppercase tracking-wider rounded hover:bg-gold-400 transition-colors shadow-lg shadow-gold-500/20"
          >
            Mint
          </Link>
        )}
      </div>

      <div className="mb-3">
        <h3 className="text-lg font-black text-gold-100 tracking-tight mb-0.5 group-hover:text-gold-400 transition-colors">{token.ticker}</h3>
        <div className="text-[10px] text-gold-500/50 font-mono">
          Supply: {formatNumber(Number(token.supply))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-[10px] text-gold-300/70 font-medium">
          <span>Progress</span>
          <span className={isCompleted ? "text-green-300 font-bold" : "text-gold-100"}>
            {isCompleted ? "Completed" : formatPercent(progress)}
          </span>
        </div>
        <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isCompleted ? 'bg-green-500/80' : 'bg-gradient-to-r from-gold-600 to-gold-400'}`}
            style={{ width: `${Math.min(progress * 100, 100)}%` }}
          />
        </div>
        {statLabel && (
          <div className="pt-1 text-[10px] font-bold text-gold-400/80 uppercase tracking-wider flex items-center gap-1">
            {token.statIcon}
            {statLabel}
          </div>
        )}
      </div>

      <Link
        href={`/tokens?tick=${token.ticker.toLowerCase()}`}
        className="absolute inset-0 z-10"
      >
        <span className="sr-only">View {token.ticker}</span>
      </Link>
    </div>
  );
}

function LiveMintsList({ tokens, loading }: { tokens: any[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="border border-gold-500/10 rounded-2xl bg-black/30 divide-y divide-gold-500/10">
        {[...Array(4)].map((_, idx) => (
          <div key={idx} className="flex flex-col sm:grid sm:grid-cols-[1.4fr,0.8fr,0.8fr,1fr,0.8fr] gap-4 px-4 py-4 animate-pulse text-gold-400/40">
            <div className="h-8 bg-white/5 rounded" />
            <div className="h-8 bg-white/5 rounded" />
            <div className="h-8 bg-white/5 rounded" />
            <div className="h-8 bg-white/5 rounded" />
            <div className="h-8 bg-white/5 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <div className="text-center py-12 text-gold-500/40 border border-dashed border-gold-500/10 rounded-2xl bg-black/30">
        No live mints right now.
      </div>
    );
  }

  return (
    <div className="border border-gold-500/10 rounded-2xl bg-black/30 overflow-hidden">
      <div className="hidden sm:grid grid-cols-[1.4fr,0.8fr,0.8fr,1fr,0.8fr] text-[10px] uppercase tracking-[0.4em] text-gold-300/60 px-4 py-3 border-b border-gold-500/10">
        <span>Token</span>
        <span>Supply</span>
        <span>Holders</span>
        <span>Progress</span>
        <span className="text-right">Action</span>
      </div>
      <div className="divide-y divide-gold-500/10">
        {tokens.map((token) => {
          const progress = Math.min((token.progress || 0) * 100, 100);
          const completed = progress >= 99.9;
          const holders = token.holderCount ?? token.holders ?? 0;
          return (
            <div key={token.ticker} className="flex flex-col sm:grid sm:grid-cols-[1.4fr,0.8fr,0.8fr,1fr,0.8fr] gap-4 px-4 py-4 items-center">
              <div className="flex items-center gap-3 w-full">
                <div className="w-10 h-10 rounded-sm bg-gradient-to-br from-gold-500/20 to-black border border-gold-500/20 flex items-center justify-center text-base font-bold text-gold-100">
                  {token.ticker.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-black text-gold-100 truncate">
                    {token.ticker}
                  </div>
                  <div className="text-xs text-gold-400/70 font-mono truncate flex items-center gap-1">
                    {token.statIcon}
                    {token.statLabel || 'Live ZRC-20'}
                  </div>
                </div>
              </div>
              <div className="w-full text-sm text-gold-300/70 font-mono">
                {formatNumber(Number(token.supply))}
              </div>
              <div className="w-full text-sm text-gold-300/70 font-mono">
                {holders > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-gold-500/50"><UsersIcon className="w-3 h-3" /></span>
                    <span>{formatNumber(holders)}</span>
                  </div>
                ) : (
                  <span className="text-gold-500/20">--</span>
                )}
              </div>
              <div className="w-full space-y-1">
                <div className="flex justify-between text-[10px] text-gold-300/70 font-medium">
                  <span>Progress</span>
                  <span className={completed ? 'text-green-300 font-bold' : 'text-gold-100'}>
                    {completed ? 'Completed' : `${progress.toFixed(1)}%`}
                  </span>
                </div>
                <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${completed ? 'bg-green-500/80' : 'bg-gradient-to-r from-gold-600 to-gold-400'}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
              <div className="w-full flex justify-end">
                {completed ? (
                  <span className="px-3 py-1 rounded-full border border-gold-500/20 text-xs font-bold uppercase tracking-widest text-gold-300/70">
                    Completed
                  </span>
                ) : (
                  <Link
                    href={`/inscribe?tab=zrc20&tick=${token.ticker.toLowerCase()}`}
                    className="px-3 py-1 rounded-full bg-gold-500 text-black text-xs font-bold uppercase tracking-widest hover:bg-gold-400 transition-colors"
                  >
                    Mint
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function FlameIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.1.2-2.2.6-3.3.7 3.7 4.4 4.5 4.5 4.5Z" />
    </svg>
  );
}

function TrendingUpIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

function ZRC721Collections() {
  const [collections, setCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCollections() {
      try {
        const data = await zrc721IndexAPI.getCollections(0, 20);
        // Ensure data is an array
        const collectionsArray = Array.isArray(data) ? data : [];
        setCollections(collectionsArray);
      } catch (err) {
        console.error('Failed to fetch ZRC-721 collections', err);
        setCollections([]);
      } finally {
        setLoading(false);
      }
    }
    fetchCollections();
    // Poll every 60 seconds
    const interval = setInterval(fetchCollections, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-white/5 rounded-sm animate-pulse border border-gold-500/5"></div>
        ))}
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <div className="text-center py-12 text-gold-500/40 border border-dashed border-gold-500/10 rounded-sm">
        No ZRC-721 collections deployed yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {collections.map((collection) => {
        const progress = collection.supply > 0 ? (collection.minted / collection.supply) * 100 : 0;
        const isCompleted = progress >= 99.9;

        return (
          <div
            key={collection.collection}
            className="group relative bg-black/40 border border-gold-500/10 rounded-sm p-5 hover:border-gold-500/30 hover:bg-white/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-gold-900/10"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h3 className="text-xl font-black text-gold-100 tracking-tight mb-1 group-hover:text-gold-400 transition-colors">
                  {collection.collection}
                </h3>
                <div className="flex items-center gap-2 text-xs text-gold-500/60">
                  <span className="font-mono">{collection.minted.toLocaleString()} / {collection.supply.toLocaleString()}</span>
                </div>
              </div>
              {isCompleted ? (
                <span className="px-2 py-1 bg-green-500/20 text-green-300 text-[9px] font-bold uppercase tracking-wider rounded border border-green-500/30">
                  Complete
                </span>
              ) : (
                <span className="px-2 py-1 bg-gold-500/20 text-gold-300 text-[9px] font-bold uppercase tracking-wider rounded border border-gold-500/30">
                  Minting
                </span>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-[10px] text-gold-300/70 font-medium">
                <span>Progress</span>
                <span className={isCompleted ? 'text-green-300 font-bold' : 'text-gold-100'}>
                  {progress.toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${isCompleted ? 'bg-green-500/80' : 'bg-gradient-to-r from-gold-600 to-gold-400'}`}
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            </div>

            {collection.meta && (
              <div className="mt-3 pt-3 border-t border-gold-500/10">
                <div className="text-[10px] text-gold-400/60 uppercase tracking-wider mb-1">Metadata</div>
                <div className="text-xs text-gold-200/70 font-mono truncate">{collection.meta}</div>
              </div>
            )}

            {collection.collection.toUpperCase() === 'ZGODS' && (
              <Link
                href="/claim/zgods"
                className="absolute inset-0 z-10"
              >
                <span className="sr-only">View {collection.collection}</span>
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
