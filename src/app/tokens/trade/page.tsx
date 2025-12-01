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
import { useWallet } from "@/contexts/WalletContext";
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

export default function TradePage() {
    const listings = useQuery(api.psbt.listListings, { limit: 200 });
    const [search, setSearch] = useState("");
    const [activeTicker, setActiveTicker] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [selectedListing, setSelectedListing] = useState<Doc<"psbtListings"> | null>(null);
    const { wallet } = useWallet();
    const { price: zecPrice } = useZecPrice();

    const stats = useMemo(() => {
        if (!listings) {
            return {
                activeListings: 0,
                totalVolume: 0,
                uniqueTickers: 0,
                floor: null as number | null,
                topTickers: [] as { ticker: string; count: number; floor: number }[],
            };
        }

        const tickerMap = new Map<string, { count: number; floor: number }>();
        let globalFloor = Number.POSITIVE_INFINITY;
        let totalVolume = 0;

        listings.forEach((listing) => {
            const ticker = listing.tokenTicker.toUpperCase();
            const perToken = listing.price / listing.tokenAmount;
            totalVolume += listing.price;
            if (perToken < globalFloor) {
                globalFloor = perToken;
            }

            if (!tickerMap.has(ticker)) {
                tickerMap.set(ticker, { count: 0, floor: perToken });
            }
            const entry = tickerMap.get(ticker)!;
            entry.count += 1;
            if (perToken < entry.floor) {
                entry.floor = perToken;
            }
        });

        const topTickers = Array.from(tickerMap.entries())
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 6)
            .map(([ticker, data]) => ({ ticker, ...data }));

        return {
            activeListings: listings.length,
            totalVolume,
            uniqueTickers: tickerMap.size,
            floor: Number.isFinite(globalFloor) ? globalFloor : null,
            topTickers,
        };
    }, [listings]);

    const filteredListings = useMemo(() => {
        if (!listings) return undefined;
        const query = search.trim().toLowerCase();
        return listings.filter((listing) => {
            const matchesTicker = activeTicker ? listing.tokenTicker.toUpperCase() === activeTicker : true;
            if (!query) return matchesTicker;
            return (
                matchesTicker &&
                (listing.tokenTicker.toLowerCase().includes(query) ||
                    listing.sellerAddress.toLowerCase().includes(query))
            );
        });
    }, [listings, search, activeTicker]);

    const isLoading = !filteredListings;
    const listingCount = filteredListings?.length ?? 0;

    return (
        <main className="relative min-h-screen pt-24 pb-16 text-gold-100 selection:bg-gold-500/30">
            <div className="fixed inset-0 w-full h-full bg-[#050505] -z-20" />
            <div className="fixed inset-0 w-full h-full bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-gold-900/10 via-transparent to-black opacity-80 -z-10" />
            <div className="fixed inset-0 opacity-30 -z-10">
                <Dither
                    waveColor={[0.9, 0.7, 0.2]}
                    disableAnimation={false}
                    enableMouseInteraction={false}
                    colorNum={4}
                    waveAmplitude={0.15}
                    waveFrequency={1.6}
                    waveSpeed={0.03}
                />
            </div>

            <div className="max-w-8xl mx-auto px-4 sm:px-6">
                <section className="mb-12">
                    <p className="text-sm font-bold uppercase tracking-[0.3em] text-gold-500/60 mb-4">
                        ZRC-20 PSBT MARKET
                    </p>
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                        <div>
                            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-gold-100">
                                Trade <span className="text-gold-500">Inscriptions</span> across Zcash
                            </h1>
                            <p className="mt-4 text-lg text-gold-200/70 max-w-2xl">
                                Browse curated Zcash inscription markets, plan sweeps, and track premium inventory in one immersive view.
                            </p>
                        </div>
                        <div className="bg-black/40 border border-gold-500/20 rounded-2xl p-5 w-full lg:w-[380px] shadow-[0_0_35px_rgba(234,179,8,0.08)]">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-gold-300/60 font-bold mb-1">
                                        Active Listings
                                    </div>
                                    <div className="text-2xl font-black text-gold-100">
                                        {formatNumber(stats.activeListings)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-gold-300/60 font-bold mb-1">
                                        Unique Ticks
                                    </div>
                                    <div className="text-2xl font-black text-gold-100">
                                        {formatNumber(stats.uniqueTickers)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-gold-300/60 font-bold mb-1">
                                        Global Floor
                                    </div>
                                    <div className="text-xl font-black text-gold-400">
                                        {stats.floor ? `${stats.floor.toFixed(8)} ZEC` : "--"}
                                    </div>
                                    <div className="text-[10px] text-gold-300/50">per token</div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-gold-300/60 font-bold mb-1">
                                        Live Volume
                                    </div>
                                    <div className="text-xl font-black text-gold-400">
                                        {formatZec(stats.totalVolume, 2)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="mb-10 space-y-6">
                    <div className="flex flex-col lg:flex-row gap-4 lg:items-center">
                        <div className="flex-1 relative">
                            <input
                                type="text"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Search ticker or seller address"
                                className="w-full rounded-2xl border border-gold-500/20 bg-black/30 px-5 py-3 text-gold-100 placeholder:text-gold-300/40 focus:outline-none focus:border-gold-400 transition-colors"
                            />
                            {search && (
                                <button
                                    onClick={() => setSearch("")}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gold-300/60 text-xs font-bold uppercase"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    if (!wallet?.address) {
                                        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('zatoshi:open-wallet'));
                                        return;
                                    }
                                    setShowCreate(true);
                                }}
                                className="px-5 py-3 rounded-2xl bg-gold-500 text-black font-bold text-sm tracking-wide hover:bg-gold-400 transition-colors shadow-[0_0_25px_rgba(234,179,8,0.25)]"
                            >
                                List Token
                            </button>
                            <Link
                                href="/tokens"
                                className="px-5 py-3 rounded-2xl border border-gold-500/30 text-gold-200/80 text-sm font-medium tracking-wide hover:border-gold-400 hover:text-gold-100 transition-colors"
                            >
                                Explore Tokens
                            </Link>
                        </div>
                    </div>

                    {stats.topTickers.length > 0 && (
                        <div className="flex flex-wrap gap-3">
                            <button
                                onClick={() => setActiveTicker(null)}
                                className={`px-4 py-2 rounded-full text-xs font-bold tracking-wide border ${activeTicker === null
                                    ? "bg-gold-500 text-black border-gold-500 shadow-[0_0_20px_rgba(234,179,8,0.3)]"
                                    : "border-gold-500/20 text-gold-300/70 hover:border-gold-400 hover:text-gold-100"
                                    }`}
                            >
                                All Tokens
                            </button>
                            {stats.topTickers.map((item) => (
                                <button
                                    key={item.ticker}
                                    onClick={() => setActiveTicker(item.ticker)}
                                    className={`px-4 py-2 rounded-full text-xs font-bold tracking-wide border ${activeTicker === item.ticker
                                        ? "bg-gold-500 text-black border-gold-500 shadow-[0_0_20px_rgba(234,179,8,0.3)]"
                                        : "border-gold-500/20 text-gold-200/80 hover:border-gold-400 hover:text-gold-100"
                                        }`}
                                >
                                    {item.ticker} · {item.count} listings
                                </button>
                            ))}
                        </div>
                    )}
                </section>

                <section className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <p className="text-sm text-gold-300/70 font-medium">
                            {isLoading
                                ? "Loading live listings..."
                                : `${listingCount} listing${listingCount === 1 ? "" : "s"}${activeTicker ? ` in ${activeTicker}` : ""
                                }`}
                        </p>
                        {activeTicker && (
                            <button
                                onClick={() => setActiveTicker(null)}
                                className="text-xs uppercase tracking-wider text-gold-400 hover:text-gold-200 font-bold"
                            >
                                Reset filter
                            </button>
                        )}
                    </div>

                    {!filteredListings ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                            {Array.from({ length: 8 }).map((_, idx) => (
                                <div
                                    key={idx}
                                    className="h-[320px] rounded-2xl border border-gold-500/10 bg-black/30 animate-pulse"
                                />
                            ))}
                        </div>
                    ) : filteredListings.length === 0 ? (
                        <div className="border border-dashed border-gold-500/30 rounded-2xl bg-black/20 py-20 text-center">
                            <p className="text-gold-200/70 mb-3 font-medium">
                                No listings match your filters.
                            </p>
                            <button
                                onClick={() => {
                                    setActiveTicker(null);
                                    setSearch("");
                                }}
                                className="text-sm font-bold text-gold-400 hover:text-gold-200"
                            >
                                Clear filters
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                            {filteredListings.map((listing) => (
                                <ListingCard
                                    key={listing._id}
                                    listing={listing}
                                    onBuy={(item) => setSelectedListing(item)}
                                    zecPrice={zecPrice}
                                />
                            ))}
                        </div>
                    )}
                </section>
            </div>

            {showCreate && (
                <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
                    <div className="w-full max-w-2xl bg-black/60 border border-gold-500/20 rounded-none p-8 backdrop-blur-md">
                        <CreateListing
                            onCancel={() => setShowCreate(false)}
                            onSuccess={() => setShowCreate(false)}
                        />
                    </div>
                </div>
            )}

            {selectedListing && (
                <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-md">
                        <FinalizeTrade
                            listing={selectedListing}
                            onCancel={() => setSelectedListing(null)}
                            zecPrice={zecPrice}
                        />
                    </div>
                </div>
            )}
        </main>
    );
}
