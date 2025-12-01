"use client";

export const dynamic = "force-dynamic";

import { useMemo, useState } from "react";
import Link from "next/link";
import NextDynamic from "next/dynamic";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc } from "../../../../convex/_generated/dataModel";
import ListingCard from "@/components/psbt/ListingCard";
import CreateListing from "@/components/psbt/CreateListing";
import FinalizeTrade from "@/components/psbt/FinalizeTrade";
import { useZecPrice } from "@/hooks/useZecPrice";

const Dither = NextDynamic(() => import("@/components/Dither"), {
  ssr: false,
  loading: () => null,
});

const formatNumber = (value?: number | null, options?: Intl.NumberFormatOptions) => {
  if (value === undefined || value === null || Number.isNaN(value)) return "--";
  return new Intl.NumberFormat("en-US", options).format(value);
};

const formatZec = (value?: number | null, fractionDigits: number = 2) => {
  if (value === undefined || value === null || Number.isNaN(value)) return "--";
  return `${value.toFixed(fractionDigits)} ZEC`;
};

const shortAddress = (address?: string | null, visible: number = 4) => {
  if (!address) return "--";
  return `${address.slice(0, visible)}...${address.slice(-visible)}`;
};

const formatTokenAmount = (amount?: number | null, ticker?: string | null) => {
  if (typeof amount !== "number" || Number.isNaN(amount)) return "--";
  const formatted = amount.toLocaleString();
  const label = ticker ? ticker.toUpperCase() : "";
  return label ? `${formatted} ${label}` : formatted;
};

const formatRelativeTime = (timestamp?: number | null) => {
  if (!timestamp) return "--";
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export default function TradePage() {
  const listings = useQuery(api.psbt.listListings, { limit: 200 });
  const [search, setSearch] = useState("");
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedListing, setSelectedListing] = useState<Doc<"psbtListings"> | null>(null);
  const { price: zecPrice } = useZecPrice();

  const globalStats = useQuery(api.psbt.getGlobalStats);

  const stats = useMemo(() => {
    if (!listings) {
      return {
        activeListings: 0,
        totalVolume: 0,
        uniqueTickers: 0,
        floor: null as number | null,
        allTickers: [] as { ticker: string; count: number; floor: number; volume: number }[],
      };
    }

    const tickerMap = new Map<string, { count: number; floor: number; volume: number }>();
    listings.forEach((listing) => {
      const ticker = listing.tokenTicker.toUpperCase();
      const perToken = listing.price / listing.tokenAmount;
      if (!tickerMap.has(ticker)) {
        tickerMap.set(ticker, { count: 0, floor: perToken, volume: 0 });
      }
      const entry = tickerMap.get(ticker)!;
      entry.count += 1;
      entry.volume += listing.price;
      if (perToken < entry.floor) entry.floor = perToken;
    });

    const allTickers = Array.from(tickerMap.entries())
      .sort((a, b) => b[1].volume - a[1].volume)
      .map(([ticker, data]) => ({ ticker, ...data }));

    return {
      activeListings: listings.length,
      totalVolume: 0,
      uniqueTickers: tickerMap.size,
      floor: null,
      allTickers,
    };
  }, [listings]);

  const heroStats = useMemo(() => {
    // Prefer computing 24h volume from recent trades (more robust when market summaries are sparse)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let v24 = 0;
    if (globalStats?.recentTrades?.length) {
      v24 = globalStats.recentTrades.reduce((sum, t) => {
        return sum + ((t?.createdAt ?? 0) >= cutoff ? (t?.price || 0) : 0);
      }, 0);
    } else if (globalStats?.marketSummaries?.length) {
      v24 = globalStats.marketSummaries.reduce((sum, m) => sum + (m.volume24h || 0), 0);
    }

    return {
      activeListings: globalStats?.activeListings ?? stats.activeListings,
      uniqueTickers: globalStats?.uniqueTickers ?? stats.uniqueTickers,
      globalFloor: globalStats?.globalFloor ?? stats.floor,
      totalVolumeAllTime: globalStats?.totalVolume ?? stats.totalVolume,
      totalVolume24h: v24,
    };
  }, [globalStats, stats]);

  const marketEntries = useMemo(() => {
    if (globalStats?.marketSummaries?.length) return globalStats.marketSummaries;
    return stats.allTickers.map((market) => ({
      ticker: market.ticker,
      floor: market.floor,
      activeListings: market.count,
      volumeAllTime: market.volume,
      volume24h: 0,
      trades24h: 0,
      tradeCount: 0,
      lastTradeAt: null as number | null,
    }));
  }, [globalStats, stats.allTickers]);

  // Enrich market entries with 24h volume computed from recentTrades (more accurate than summaries in some states)
  const enrichedMarketEntries = useMemo(() => {
    const base = (marketEntries || []).map((m: any) => ({ ...m }));
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const volMap = new Map<string, number>();
    const lastMap = new Map<string, number>();
    const trades = globalStats?.recentTrades || [];
    for (const t of trades) {
      const ts = t?.createdAt ?? 0;
      if (ts < cutoff) continue;
      const tick = (t?.ticker || '').toUpperCase();
      if (!tick) continue;
      volMap.set(tick, (volMap.get(tick) || 0) + (t?.price || 0));
      lastMap.set(tick, Math.max(lastMap.get(tick) || 0, ts));
    }
    base.forEach((m) => {
      const tick = (m?.ticker || '').toUpperCase();
      if (!tick) return;
      const v = volMap.get(tick);
      if (typeof v === 'number') m.volume24h = v;
      const lt = lastMap.get(tick);
      if (typeof lt === 'number' && lt > 0) m.lastTradeAt = lt;
    });
    return base;
  }, [marketEntries, globalStats?.recentTrades]);

  const [viewMode, setViewMode] = useState<'markets' | 'listings'>('markets');
  const [listTab, setListTab] = useState<'markets' | 'fills'>('markets');
  const [tmPage, setTmPage] = useState(1);
  const [fillsPage, setFillsPage] = useState(1);
  const PAGE_SIZE = 10;

  const lastUpdatedAt = useMemo(() => {
    const fromTrades = globalStats?.recentTrades?.[0]?.createdAt ?? null;
    const fromMarkets = (globalStats?.marketSummaries || []).reduce<number>((max, m) => {
      if (!m.lastTradeAt) return max;
      return Math.max(max, m.lastTradeAt);
    }, 0);
    const ts = Math.max(fromTrades ?? 0, fromMarkets ?? 0);
    return ts || null;
  }, [globalStats]);

  const activeMarketsCount = useMemo(() => {
    if (globalStats?.marketSummaries) {
      return globalStats.marketSummaries.filter((m) => (m.activeListings || 0) > 0).length;
    }
    return stats.allTickers.length;
  }, [globalStats, stats.allTickers.length]);

  const filteredListings = useMemo(() => {
    if (!listings) return undefined;
    const query = search.trim().toLowerCase();
    return listings.filter((listing) => {
      const matchesTicker = activeTicker ? listing.tokenTicker.toUpperCase() === activeTicker : true;
      if (!query) return matchesTicker;
      return (
        matchesTicker &&
        (listing.tokenTicker.toLowerCase().includes(query) || listing.sellerAddress.toLowerCase().includes(query))
      );
    });
  }, [listings, search, activeTicker]);

  const isLoading = !listings;

  const filteredMarketEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = enrichedMarketEntries || [];
    if (!q) return base;
    return base.filter((m) => m.ticker.toLowerCase().includes(q));
  }, [enrichedMarketEntries, search]);

  return (
    <main className="relative min-h-screen pt-24 pb-16 text-gold-100 selection:bg-gold-500/30">
      <div className="fixed inset-0 w-full h-full bg-[#050505] -z-20" />
      <div className="fixed inset-0 w-full h-full bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-gold-900/10 via-transparent to-black opacity-80 -z-10" />
      <div className="fixed inset-0 opacity-30 -z-10">
        <Dither waveColor={[0.9, 0.7, 0.2]} disableAnimation={false} enableMouseInteraction={false} colorNum={4} waveAmplitude={0.15} waveFrequency={1.6} waveSpeed={0.03} />
      </div>

      <div className="max-w-8xl mx-auto px-4 sm:px-6">
        {/* Hero */}
        <section className="mb-8">
          <div className="relative w-full overflow-hidden rounded-2xl border border-gold-500/20 bg-black/70 backdrop-blur-xl">
            <div className="absolute inset-0 -z-10">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-gold-500/10 via-transparent to-transparent opacity-50" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-gold-400/10 via-transparent to-transparent opacity-40" />
            </div>

            <div className="relative px-6 sm:px-8 py-8 sm:py-10 space-y-6">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-gold-500/10 border border-gold-400/30 rounded-full">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-gold-500"></span>
                  </span>
                  <span className="text-[10px] sm:text-xs font-bold text-gold-200 uppercase tracking-widest">Live Markets</span>
                </div>

                <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight">
                  <span className="bg-gradient-to-r from-gold-400 via-gold-300 to-gold-500 bg-clip-text text-transparent">Live ZRC-20 markets</span>
                  <span className="text-white"> on Zcash</span>
                </h1>

                {/* Removed descriptive tagline per design request */}
              </div>

              {/* Snapshot row (integrated) */}
              <div>
                <div className="overflow-hidden rounded-xl border border-gold-500/20">
                  <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-gold-500/10 bg-black/20">
                    {/* Snapshot card */}
                    <div className="p-5 sm:p-6">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] uppercase tracking-widest text-gold-300/60 font-bold">Marketplace snapshot (24h)</p>
                        <span className="text-[10px] text-gold-300/50">{lastUpdatedAt ? `Updated ${formatRelativeTime(lastUpdatedAt)}` : 'Updated just now'}</span>
                      </div>
                      <div className="text-xl sm:text-2xl md:text-3xl font-black text-gold-400">{formatZec(heroStats.totalVolume24h || 0, 3)}</div>
                      <div className="text-[11px] text-gold-300/60 uppercase tracking-widest">trading volume</div>
                    </div>
                    <div className="p-5 sm:p-6">
                      <p className="text-[10px] uppercase tracking-widest text-gold-300/60 font-bold mb-2">Active markets</p>
                      <div className="text-xl sm:text-2xl font-medium text-gold-100 uppercase tracking-wider font-mono">{formatNumber(activeMarketsCount)}</div>
                      <p className="text-[11px] text-gold-300/40 mt-1">Live PSBT markets</p>
                    </div>
                    <div className="p-5 sm:p-6">
                      <p className="text-[10px] uppercase tracking-widest text-gold-300/60 font-bold mb-2">Active listings</p>
                      <div className="text-xl sm:text-2xl font-medium text-gold-100 uppercase tracking-wider font-mono">{formatNumber(heroStats.activeListings)}</div>
                      <p className="text-[11px] text-gold-300/40 mt-1">Open orders</p>
                    </div>
                    <div className="p-5 sm:p-6">
                      <p className="text-[10px] uppercase tracking-widest text-gold-300/60 font-bold mb-2">Global floor</p>
                      <div className="text-xl sm:text-2xl font-medium text-gold-100 uppercase tracking-wider font-mono whitespace-nowrap">
                        {heroStats.globalFloor !== null && heroStats.globalFloor !== undefined ? heroStats.globalFloor.toFixed(8) : '--'}
                        {heroStats.globalFloor !== null && heroStats.globalFloor !== undefined && (<span className="text-sm ml-1 text-gold-400/70">ZEC</span>)}
                      </div>
                      <p className="text-[11px] text-gold-300/40 mt-1">ZEC / token</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Top markets / Recent fills inside hero */}
              <div className="bg-black/40 border border-gold-500/10 rounded-2xl p-5">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                  <div className="flex bg-black/40 p-1 rounded-xl border border-gold-500/20 w-fit">
                    <button onClick={() => setListTab('markets')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${listTab === 'markets' ? 'bg-gold-500 text-black shadow-lg' : 'text-gold-400 hover:text-gold-200'}`}>Top markets (24h)</button>
                    <button onClick={() => setListTab('fills')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${listTab === 'fills' ? 'bg-gold-500 text-black shadow-lg' : 'text-gold-400 hover:text-gold-200'}`}>Recent fills</button>
                  </div>
                  <div className="text-[10px] text-gold-300/50">{lastUpdatedAt ? `Updated ${formatRelativeTime(lastUpdatedAt)}` : 'Updated just now'}</div>
                </div>

                {listTab === 'markets' ? (
                  !enrichedMarketEntries ? (
                    <div className="space-y-3">{Array.from({ length: 10 }).map((_, idx) => (<div key={idx} className="h-10 bg-gold-500/5 animate-pulse rounded" />))}</div>
                  ) : enrichedMarketEntries.length === 0 ? (
                    <div className="text-sm text-gold-500/50">No markets with completed trades yet.</div>
                  ) : (
                    (() => {
                      const all = (enrichedMarketEntries || []).slice().sort((a: any, b: any) => {
                        const va = a?.volume24h || 0;
                        const vb = b?.volume24h || 0;
                        if (vb !== va) return vb - va;
                        const vba = b?.volumeAllTime || 0;
                        const vaa = a?.volumeAllTime || 0;
                        return vba - vaa;
                      });
                      const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
                      const page = Math.min(tmPage, totalPages);
                      const start = (page - 1) * PAGE_SIZE;
                      const slice = all.slice(start, start + PAGE_SIZE);
                      return (
                        <>
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-gold-400/60 border-b border-gold-500/10 py-2 px-2 grid grid-cols-12">
                              <div className="col-span-12 sm:col-span-6">Market</div>
                              <div className="col-span-12 sm:col-span-6 grid grid-cols-3 gap-4 text-right">
                                <div>Floor</div>
                                <div>24h Vol</div>
                                <div className="whitespace-nowrap">Last trade</div>
                              </div>
                            </div>
                            <div className="divide-y divide-gold-500/10">
                              {slice.map((market) => (
                                <Link key={market.ticker} href={`/tokens/trade/${market.ticker}`} className="grid grid-cols-12 items-center py-3 px-2 hover:bg-gold-500/5 transition-colors">
                                  <div className="col-span-12 sm:col-span-6">
                                    <div className="font-black text-gold-100">{market.ticker}</div>
                                    <div className="text-[10px] uppercase tracking-widest text-gold-400/60">{formatNumber(market.activeListings)} listings</div>
                                  </div>
                                  <div className="col-span-12 sm:col-span-6 grid grid-cols-3 gap-4 text-right">
                                    <div className="font-mono">{market.floor !== null && market.floor !== undefined ? `${market.floor.toFixed(8)} ZEC` : '--'}</div>
                                    <div className="font-mono whitespace-nowrap">{formatZec(market.volume24h || 0, 3)}</div>
                                    <div className="text-gold-400/70 whitespace-nowrap">{market.lastTradeAt ? formatRelativeTime(market.lastTradeAt) : '—'}</div>
                                  </div>
                                </Link>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-3">
                            <div className="text-[10px] text-gold-300/60">Page {page} of {totalPages}</div>
                            <div className="flex gap-2">
                              <button onClick={() => setTmPage(Math.max(1, page - 1))} disabled={page <= 1} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border ${page <= 1 ? 'border-gold-500/10 text-gold-500/30 cursor-not-allowed' : 'border-gold-500/30 text-gold-200 hover:text-gold-100'}`}>Prev</button>
                              <button onClick={() => setTmPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border ${page >= totalPages ? 'border-gold-500/10 text-gold-500/30 cursor-not-allowed' : 'border-gold-500/30 text-gold-200 hover:text-gold-100'}`}>Next</button>
                            </div>
                          </div>
                        </>
                      );
                    })()
                  )
                ) : (
                  !globalStats?.recentTrades ? (
                    <div className="space-y-3">{Array.from({ length: 10 }).map((_, idx) => (<div key={idx} className="h-12 bg-gold-500/5 animate-pulse rounded" />))}</div>
                  ) : globalStats.recentTrades.length === 0 ? (
                    <div className="text-sm text-gold-500/50">No filled trades yet. Be the first mover.</div>
                  ) : (
                    (() => {
                      const all = globalStats.recentTrades || [];
                      const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
                      const page = Math.min(fillsPage, totalPages);
                      const start = (page - 1) * PAGE_SIZE;
                      const slice = all.slice(start, start + PAGE_SIZE);
                      return (
                        <>
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-gold-400/60 border-b border-gold-500/10 py-2 px-2 grid grid-cols-12">
                              <div className="col-span-12 sm:col-span-6">Ticker</div>
                              <div className="col-span-12 sm:col-span-6 grid grid-cols-3 gap-4 text-right">
                                <div>Price</div>
                                <div>Amount</div>
                                <div className="whitespace-nowrap">Price / Token</div>
                              </div>
                            </div>
                            <div className="divide-y divide-gold-500/10">
                              {slice.map((trade) => {
                                const hasAmount = typeof trade.tokenAmount === 'number' && trade.tokenAmount > 0;
                                const unitPrice = hasAmount ? trade.price / trade.tokenAmount : null;
                                return (
                                  <div key={`universal-${trade.id}`} className="grid grid-cols-12 items-center py-3 px-2">
                                    <div className="col-span-12 sm:col-span-6">
                                      <div className="font-black text-gold-100">{trade.ticker}</div>
                                      <div className="text-[10px] uppercase tracking-widest text-gold-400/60">{formatRelativeTime(trade.createdAt)} · S: {shortAddress(trade.sellerAddress)} · B: {shortAddress(trade.buyerAddress)}</div>
                                    </div>
                                    <div className="col-span-12 sm:col-span-6 grid grid-cols-3 gap-4 text-right">
                                      <div className="font-mono">{formatZec(trade.price, 4)}</div>
                                      <div className="font-mono">{hasAmount ? formatTokenAmount(trade.tokenAmount, trade.ticker) : "--"}</div>
                                      <div className="font-mono">{unitPrice !== null ? unitPrice.toFixed(8) : "--"}</div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-3">
                            <div className="text-[10px] text-gold-300/60">Page {page} of {totalPages}</div>
                            <div className="flex gap-2">
                              <button onClick={() => setFillsPage(Math.max(1, page - 1))} disabled={page <= 1} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border ${page <= 1 ? 'border-gold-500/10 text-gold-500/30 cursor-not-allowed' : 'border-gold-500/30 text-gold-200 hover:text-gold-100'}`}>Prev</button>
                              <button onClick={() => setFillsPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border ${page >= totalPages ? 'border-gold-500/10 text-gold-500/30 cursor-not-allowed' : 'border-gold-500/30 text-gold-200 hover:text-gold-100'}`}>Next</button>
                            </div>
                          </div>
                        </>
                      );
                    })()
                  )
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Controls & View Toggle */}
        <section className="mb-4 flex flex-col md:flex-row gap-4 md:items-center justify-between">
          <div className="flex bg-black/40 p-1 rounded-xl border border-gold-500/20 w-fit">
            <button onClick={() => setViewMode('markets')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${viewMode === 'markets' ? 'bg-gold-500 text-black shadow-lg' : 'text-gold-400 hover:text-gold-200'}`}>Markets</button>
            <button onClick={() => setViewMode('listings')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${viewMode === 'listings' ? 'bg-gold-500 text-black shadow-lg' : 'text-gold-400 hover:text-gold-200'}`}>All Listings</button>
          </div>
        </section>

        {/* Content Area */}
        <section id="markets">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div key={idx} className="h-[320px] rounded-2xl border border-gold-500/10 bg-black/30 animate-pulse" />
              ))}
            </div>
          ) : viewMode === 'markets' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                            {filteredMarketEntries.map((market) => (
                                <Link key={market.ticker} href={`/tokens/trade/${market.ticker}`} className="group relative bg-black/40 border border-gold-500/10 rounded-2xl p-6 hover:border-gold-500/30 transition-all duration-300 hover:shadow-[0_0_30px_rgba(234,179,8,0.1)] flex flex-col">
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-gold-500/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <div className="text-3xl font-black text-gold-100 tracking-tight group-hover:text-gold-400 transition-colors">{market.ticker}</div>
                      <div className="text-xs font-bold text-gold-500/50 uppercase tracking-widest mt-1">ZRC-20</div>
                    </div>
                    <div className="px-3 py-1 rounded-lg bg-gold-500/10 border border-gold-500/20 text-xs font-bold text-gold-400">{market.activeListings} Listings</div>
                  </div>
                  <div className="space-y-3 mt-auto">
                    <div className="flex justify-between items-end">
                      <div className="text-[10px] uppercase tracking-wider text-gold-300/40 font-bold">Floor Price</div>
                      <div className="text-lg font-mono font-bold text-gold-200">{formatZec(market.floor, 8)}</div>
                    </div>
                    <div className="flex justify-between items-end">
                      <div className="text-[10px] uppercase tracking-wider text-gold-300/40 font-bold">24H Volume</div>
                      <div className="text-lg font-mono font-bold text-gold-200">{formatZec(market.volume24h ?? 0, 3)}</div>
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-gold-300/40 font-bold flex justify-between"><span>All-Time Volume</span><span className="font-mono text-gold-200">{formatZec(market.volumeAllTime ?? 0, 2)}</span></div>
                  </div>
                </Link>
              ))}
                            {(enrichedMarketEntries.length === 0) && (
                              <div className="col-span-full py-20 text-center border border-dashed border-gold-500/20 rounded-2xl">
                                <p className="text-gold-300/60">No active markets found.</p>
                              </div>
                            )}
            </div>
                    ) : (
                        <section id="listings">
              {!filteredListings || filteredListings.length === 0 ? (
                <div className="border border-dashed border-gold-500/30 rounded-2xl bg-black/20 py-20 text-center">
                  <p className="text-gold-200/70 mb-3 font-medium">No listings match your filters.</p>
                  <button onClick={() => { setActiveTicker(null); setSearch(""); }} className="text-sm font-bold text-gold-400 hover:text-gold-200">Clear filters</button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {filteredListings.map((listing) => (
                    <ListingCard key={listing._id} listing={listing} onBuy={(item) => setSelectedListing(item)} zecPrice={zecPrice} />
                  ))}
                </div>
              )}
            </section>
          )}
        </section>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-2xl bg-black/60 border border-gold-500/20 rounded-none p-8 backdrop-blur-md">
            <CreateListing onCancel={() => setShowCreate(false)} onSuccess={() => setShowCreate(false)} />
          </div>
        </div>
      )}

      {selectedListing && (
        <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            <FinalizeTrade listing={selectedListing} onCancel={() => setSelectedListing(null)} zecPrice={zecPrice} />
          </div>
        </div>
      )}
    </main>
  );
}
