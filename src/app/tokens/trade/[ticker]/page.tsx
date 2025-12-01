"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import NextDynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc } from "../../../../../convex/_generated/dataModel";
import { ordinalIndexAPI, type TokenSummary, type TokenIntegrity } from "@/services/ordinalIndex";
import ListingCard from "@/components/psbt/ListingCard";
import CreateListing from "@/components/psbt/CreateListing";
import FinalizeTrade from "@/components/psbt/FinalizeTrade";
import { useWallet } from "@/contexts/WalletContext";

const Dither = NextDynamic(() => import("@/components/Dither"), {
    ssr: false,
    loading: () => null,
});

const parseNumeric = (value?: number | string | null) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? undefined : parsed;
};

const formatNumber = (value?: number, options?: Intl.NumberFormatOptions) => {
    if (value === undefined || Number.isNaN(value)) return "--";
    return new Intl.NumberFormat("en-US", options).format(value);
};

const formatZec = (value?: number, fractionDigits = 2) => {
    if (value === undefined || Number.isNaN(value)) return "--";
    return `${value.toFixed(fractionDigits)} ZEC`;
};

export default function TokenTradePage({ params }: { params: { ticker: string } }) {
    const router = useRouter();
    const { wallet } = useWallet();
    const ticker = decodeURIComponent(params.ticker).toUpperCase();
    const listings = useQuery(api.psbt.listListingsByTicker, { ticker });
    const marketStatsData = useQuery(api.psbt.getMarketStats, { ticker });
    const tradeHistory = useQuery(api.psbt.listTradeHistory, { ticker, limit: 50 });

    const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
    const [sortOption, setSortOption] = useState<'price_asc' | 'price_desc' | 'newest'>('price_asc');

    const [tokenInfo, setTokenInfo] = useState<{ tick: string; name?: string; supply?: number; holders?: number; mintedAmount?: number; limit?: number; progress?: number; price?: number; priceChange24h?: number; volume24h?: number; description?: string; deployer?: string } | null>(null);
    const [loadingToken, setLoadingToken] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [selectedListing, setSelectedListing] = useState<Doc<"psbtListings"> | null>(null);

    useEffect(() => {
        let mounted = true;
        setLoadingToken(true);

        (async () => {
            try {
                const [summary, integrity, tokenDetails] = await Promise.all([
                    ordinalIndexAPI.getTokenSummary(ticker),
                    ordinalIndexAPI.getTokenIntegrity(ticker),
                    ordinalIndexAPI.getTokens(0, 1, ticker),
                ]);

                const dec = Number(summary?.dec ?? integrity?.dec ?? 0) || 0;
                const toUnits = (v: any) => {
                    const n = typeof v === 'string' ? Number(v) : v;
                    if (!Number.isFinite(n)) return undefined;
                    return dec > 0 ? n / 10 ** dec : n;
                };

                // Use max supply as limit, fallback to current supply if max is missing
                const limit = toUnits(summary?.max) ?? toUnits(integrity?.supply_base_units || summary?.supply_base_units);

                // Use available (circulating) supply for progress to exclude pending transfers
                const mintedAmount = toUnits(integrity?.sum_available_base_units ?? integrity?.sum_overall_base_units ?? undefined);

                const holders = Number(summary?.holders ?? integrity?.total_holders ?? 0) || undefined;
                const progress = mintedAmount !== undefined && limit ? Math.min(1, Math.max(0, mintedAmount / limit)) : undefined;

                if (mounted) {
                    setTokenInfo({
                        tick: ticker,
                        supply: limit,
                        holders,
                        mintedAmount,
                        limit,
                        progress,
                        deployer: tokenDetails.items.find(t => t.ticker.toUpperCase() === ticker)?.deployer,
                    });
                }
            } catch (error) {
                console.error("Failed to fetch token info", error);
            } finally {
                if (mounted) setLoadingToken(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, [ticker]);



    const marketStats = useMemo(() => {
        if (!listings) {
            return { floor: null as number | null, totalVolume: 0, count: 0 };
        }
        let floor = Number.POSITIVE_INFINITY;
        let totalVolume = 0;

        listings.forEach((listing) => {
            totalVolume += listing.price;
            if (!listing.tokenAmount) return;
            const perToken = listing.price / listing.tokenAmount;
            if (perToken < floor) {
                floor = perToken;
            }
        });

        return {
            floor: Number.isFinite(floor) ? floor : null,
            totalVolume,
            count: listings.length,
        };
    }, [listings]);

    const holderCount = parseNumeric(tokenInfo?.holders);
    const spotPrice = parseNumeric(marketStatsData?.spotPrice);
    const volume24h = parseNumeric(marketStatsData?.volume24h);
    const priceChange = parseNumeric(marketStatsData?.priceChange24h);


    const statsCards = [
        {
            label: "Floor Price",
            value: marketStats.floor ? `${marketStats.floor.toFixed(8)} ZEC` : "--",
            helper: "Marketplace floor",
        },
        {
            label: "24H Volume",
            value: volume24h !== undefined ? `${volume24h.toLocaleString(undefined, { maximumFractionDigits: 8 })} ZEC` : "--",
            helper: "Marketplace volume",
        },
        {
            label: "Holders",
            value: formatNumber(holderCount),
            helper: "Wallets w/ balance",
        },
        {
            label: "Active Listings",
            value: formatNumber(marketStats.count),
            helper: "Live PSBT orders",
        },
    ];

    return (
        <main className="relative min-h-screen pt-24 pb-16 text-gold-100 selection:bg-gold-500/30">
            <div className="fixed inset-0 w-full h-full bg-[#040404] -z-20" />
            <div className="fixed inset-0 w-full h-full bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-gold-900/10 via-transparent to-black opacity-80 -z-10" />
            <div className="fixed inset-0 opacity-30 -z-10">
                <Dither
                    waveColor={[0.9, 0.7, 0.2]}
                    disableAnimation={false}
                    enableMouseInteraction={false}
                    colorNum={4}
                    waveAmplitude={0.15}
                    waveFrequency={1.8}
                    waveSpeed={0.03}
                />
            </div>

            <div className="max-w-8xl mx-auto px-4 sm:px-6 -mt-5">
                <section className="mb-5 space-y-4">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.4em] text-gold-400/70">
                        <button
                            type="button"
                            onClick={() => router.push("/tokens")}
                            className="flex items-center gap-2 text-gold-300/70 tracking-normal font-bold hover:text-gold-100 transition-colors"
                        >
                            <span className="text-lg">←</span>
                            Back to tokens
                        </button>
                        <span className="px-3 py-1 rounded-full border border-gold-500/30 text-[10px] font-bold tracking-[0.5em] text-gold-300/70">
                            LIVE MARKET
                        </span>
                    </div>

                    <section className="relative overflow-hidden rounded-xl border border-gold-500/10 bg-black/40">
                        {/* Background decoration */}
                        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                            <div className="text-6xl md:text-9xl font-black text-gold-500 leading-none select-none">
                                {ticker.substring(0, 2)}
                            </div>
                        </div>

                        <div className="p-6 md:p-8 relative z-10">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.4em] text-gold-500/60 mb-2">
                                        ZRC-20 Asset
                                    </p>
                                    <h1 className="text-4xl md:text-5xl font-black text-gold-100 mb-2 tracking-tight">
                                        {ticker}
                                    </h1>
                                    {tokenInfo?.deployer && (
                                        <p className="text-sm text-gold-300/60 font-mono">
                                            Deployer: {tokenInfo.deployer.slice(0, 6)}...{tokenInfo.deployer.slice(-4)}
                                        </p>
                                    )}
                                </div>

                                <div className="flex flex-col items-end gap-3">

                                    <button
                                        onClick={() => window.location.reload()}
                                        className="px-4 py-2 border border-gold-500/20 text-gold-300/60 text-[10px] uppercase tracking-widest rounded hover:bg-gold-500/5 hover:text-gold-200 transition-all"
                                    >
                                        Refresh Data
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Divider */}
                        <div className="h-px w-full bg-gold-500/10" />

                        {/* Stats Row */}
                        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-gold-500/10 bg-black/20">
                            {statsCards.map((card) => {
                                const isZec = (card.label === 'Floor Price' || card.label === 'Spot Price' || card.label === '24H Volume') && typeof card.value === 'string' && card.value.includes('ZEC');
                                const numPart = isZec ? String(card.value).replace(/\s*ZEC\s*$/i, '') : card.value;
                                return (
                                    <div key={card.label} className="p-6 md:p-8">
                                        <p className="text-[10px] uppercase tracking-widest text-gold-300/60 font-bold mb-2">
                                            {card.label}
                                        </p>
                                        <div className="text-xl sm:text-2xl font-medium text-gold-100 uppercase tracking-wider font-mono whitespace-nowrap">
                                            {numPart}
                                            {isZec && <span className="text-sm ml-1 text-gold-400/70">ZEC</span>}
                                        </div>
                                        {card.helper && (
                                            <p className="text-[11px] text-gold-300/40 mt-1">{card.helper}</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                </section>

                <section className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                        <div className="flex items-center gap-4">
                            <p className="text-sm text-gold-300/70 font-mono">
                                {activeTab === 'active'
                                    ? (listings ? `${listings.length} live listing${listings.length === 1 ? "" : "s"}` : "Syncing...")
                                    : (tradeHistory ? `${tradeHistory.length} past trade${tradeHistory.length === 1 ? "" : "s"}` : "Loading history...")
                                }
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            {/* Sort Dropdown (only for active listings) */}
                            {activeTab === 'active' && (
                                <div className="relative group">
                                    <select
                                        value={sortOption}
                                        onChange={(e) => setSortOption(e.target.value as any)}
                                        className="appearance-none bg-black/40 border border-gold-500/20 text-gold-100 text-xs font-bold uppercase tracking-wider pl-4 pr-8 py-2 rounded-full hover:border-gold-500/40 focus:outline-none focus:border-gold-500/60 cursor-pointer"
                                    >
                                        <option value="price_asc">Price: Low to High</option>
                                        <option value="price_desc">Price: High to Low</option>
                                        <option value="newest">Newest Listed</option>
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gold-500/50">
                                        ▼
                                    </div>
                                </div>
                            )}

                            {/* Tabs */}
                            <div className="flex bg-black/40 rounded-full p-1 border border-gold-500/20">
                                <button
                                    onClick={() => setActiveTab('active')}
                                    className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${activeTab === 'active'
                                        ? 'bg-gold-500 text-black shadow-lg shadow-gold-500/20'
                                        : 'text-gold-400/60 hover:text-gold-200'
                                        }`}
                                >
                                    Active
                                </button>
                                <button
                                    onClick={() => setActiveTab('history')}
                                    className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${activeTab === 'history'
                                        ? 'bg-gold-500 text-black shadow-lg shadow-gold-500/20'
                                        : 'text-gold-400/60 hover:text-gold-200'
                                        }`}
                                >
                                    History
                                </button>
                            </div>

                            {/* Create Listing Button */}
                            <button
                                type="button"
                                onClick={() => {
                                    if (!wallet?.address) {
                                        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('zatoshi:open-wallet'));
                                        return;
                                    }
                                    setShowCreate(true);
                                }}
                                className="px-4 py-2 rounded-full border border-gold-500/30 text-xs font-bold uppercase tracking-widest text-gold-100 hover:border-gold-400 hover:text-white transition-colors bg-gold-500/5 hover:bg-gold-500/10"
                            >
                                + Create Listing
                            </button>
                        </div>
                    </div>

                    {activeTab === 'active' ? (
                        !listings ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {Array.from({ length: 10 }).map((_, idx) => (
                                    <div
                                        key={idx}
                                        className="h-[300px] bg-black/30 border border-gold-500/10 rounded-2xl animate-pulse"
                                    />
                                ))}
                            </div>
                        ) : listings.length === 0 ? (
                            <div className="text-center py-24 border border-dashed border-gold-500/30 rounded-3xl bg-black/20">
                                <p className="text-gold-200/70 font-medium">No active listings for {ticker} yet.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {[...listings]
                                    .sort((a, b) => {
                                        if (sortOption === 'newest') return b.createdAt - a.createdAt;
                                        if (sortOption === 'price_desc') return (b.price / (b.tokenAmount || 1)) - (a.price / (a.tokenAmount || 1));
                                        return (a.price / (a.tokenAmount || 1)) - (b.price / (b.tokenAmount || 1));
                                    })
                                    .map((listing) => (
                                        <ListingCard
                                            key={listing._id}
                                            listing={listing}
                                            onBuy={(item) => setSelectedListing(item)}
                                            floorPrice={marketStats?.floor ?? undefined}
                                        />
                                    ))}
                            </div>
                        )
                    ) : (
                        !tradeHistory ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {Array.from({ length: 5 }).map((_, idx) => (
                                    <div
                                        key={idx}
                                        className="h-[300px] bg-black/30 border border-gold-500/10 rounded-2xl animate-pulse"
                                    />
                                ))}
                            </div>
                        ) : tradeHistory.length === 0 ? (
                            <div className="text-center py-24 border border-dashed border-gold-500/30 rounded-3xl bg-black/20">
                                <p className="text-gold-200/70 font-medium">No trade history for {ticker} yet.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto rounded-2xl border border-gold-500/10">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-gold-500/5 border-b border-gold-500/10 text-[10px] uppercase tracking-widest text-gold-400/60 font-bold">
                                            <th className="p-4">Time</th>
                                            <th className="p-4">Type</th>
                                            <th className="p-4 text-right">Price (ZEC)</th>
                                            <th className="p-4 text-right">Amount</th>
                                            <th className="p-4 text-right">Price / Token</th>
                                            <th className="p-4 text-right">From</th>
                                            <th className="p-4 text-right">To</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gold-500/5 bg-black/20">
                                        {tradeHistory.map((listing) => {
                                            const pricePerToken = listing.price / (listing.tokenAmount || 1);
                                            return (
                                                <tr key={listing._id} className="hover:bg-gold-500/5 transition-colors">
                                                    <td className="p-4 text-xs text-gold-300/60 font-mono whitespace-nowrap">
                                                        {new Date(listing.createdAt).toLocaleString()}
                                                    </td>
                                                    <td className="p-4">
                                                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">
                                                            SALE
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-right text-sm font-mono text-gold-100 whitespace-nowrap">
                                                        {listing.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })} <span className="text-gold-500/50 text-xs">ZEC</span>
                                                    </td>
                                                    <td className="p-4 text-right text-sm font-mono text-gold-100 whitespace-nowrap">
                                                        {listing.tokenAmount?.toLocaleString() ?? '-'}
                                                    </td>
                                                    <td className="p-4 text-right text-xs font-mono text-gold-300/80 whitespace-nowrap">
                                                        {pricePerToken.toFixed(8)}
                                                    </td>
                                                    <td className="p-4 text-right text-xs font-mono text-gold-300/60 whitespace-nowrap">
                                                        {listing.sellerAddress.slice(0, 4)}...{listing.sellerAddress.slice(-4)}
                                                    </td>
                                                    <td className="p-4 text-right text-xs font-mono text-gold-300/60 whitespace-nowrap">
                                                        {listing.buyerAddress
                                                            ? `${listing.buyerAddress.slice(0, 4)}...${listing.buyerAddress.slice(-4)}`
                                                            : '-'
                                                        }
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )
                    )}
                </section>
            </div >

            {showCreate && (
                <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
                    <div className="w-full max-w-2xl bg-black/60 border border-gold-500/20 rounded-none p-8 backdrop-blur-md">
                        <CreateListing
                            ticker={ticker}
                            onCancel={() => setShowCreate(false)}
                            onSuccess={() => setShowCreate(false)}
                        />
                    </div>
                </div>
            )
            }

            {
                selectedListing && (
                    <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                        <div className="w-full max-w-md">
                            <FinalizeTrade
                                listing={selectedListing}
                                onCancel={() => setSelectedListing(null)}
                            />
                        </div>
                    </div>
                )
            }
        </main >
    );
}
