"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc } from "../../../../../convex/_generated/dataModel";
import { zerdinalsAPI, ZerdinalsToken } from "@/services/zerdinals";
import ListingCard from "@/components/psbt/ListingCard";
import CreateListing from "@/components/psbt/CreateListing";
import FinalizeTrade from "@/components/psbt/FinalizeTrade";

const Dither = dynamic(() => import("@/components/Dither"), {
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
    const ticker = decodeURIComponent(params.ticker).toUpperCase();
    const listings = useQuery(api.psbt.listListingsByTicker, { ticker });

    const [tokenInfo, setTokenInfo] = useState<ZerdinalsToken | null>(null);
    const [loadingToken, setLoadingToken] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [selectedListing, setSelectedListing] = useState<Doc<"psbtListings"> | null>(null);

    useEffect(() => {
        let mounted = true;
        setLoadingToken(true);

        zerdinalsAPI
            .getToken(ticker)
            .then((info) => {
                if (mounted) {
                    setTokenInfo(info);
                }
            })
            .catch((error) => {
                console.error("Failed to fetch token info", error);
            })
            .finally(() => {
                if (mounted) {
                    setLoadingToken(false);
                }
            });

        return () => {
            mounted = false;
        };
    }, [ticker]);

    const mintStats = useMemo(() => {
        const mintedRaw = tokenInfo?.mintedAmount ?? tokenInfo?.minted;
        const limitRaw = tokenInfo?.limit ?? tokenInfo?.supply;

        const mintedAmount = parseNumeric(mintedRaw);
        const limit = parseNumeric(limitRaw);
        const progressFromToken = typeof tokenInfo?.progress === "number" ? tokenInfo.progress : undefined;
        const computedProgress =
            mintedAmount !== undefined && limit !== undefined && limit > 0 ? mintedAmount / limit : undefined;
        const progress = progressFromToken ?? computedProgress;
        const clampedProgress = progress !== undefined ? Math.min(1, Math.max(0, progress)) : undefined;

        return {
            mintedAmount,
            limit,
            progressPercent: clampedProgress !== undefined ? clampedProgress * 100 : undefined,
        };
    }, [tokenInfo]);

    const marketStats = useMemo(() => {
        if (!listings) {
            return { floor: null as number | null, totalVolume: 0, count: 0 };
        }
        let floor = Number.POSITIVE_INFINITY;
        let totalVolume = 0;

        listings.forEach((listing) => {
            const perToken = listing.price / listing.tokenAmount;
            totalVolume += listing.price;
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
    const spotPrice = parseNumeric(tokenInfo?.price);
    const volume24h = parseNumeric(tokenInfo?.volume24h);
    const priceChange = parseNumeric(tokenInfo?.priceChange24h);
    const mintedBarWidth = mintStats.progressPercent !== undefined ? Math.min(100, mintStats.progressPercent) : 0;

    const statsCards = [
        {
            label: "Floor Price",
            value: marketStats.floor ? `${marketStats.floor.toFixed(8)} ZEC` : "--",
            helper: "Marketplace floor",
        },
        {
            label: "Spot Price",
            value: spotPrice !== undefined ? formatZec(spotPrice, 4) : "--",
            helper: priceChange !== undefined ? `${priceChange > 0 ? "+" : ""}${priceChange.toFixed(2)}% / 24h` : "",
        },
        {
            label: "24H Volume",
            value: volume24h !== undefined ? `${volume24h.toLocaleString()} ZEC` : "--",
            helper: "Zerdinals feed",
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

            <div className="max-w-7xl mx-auto px-4 sm:px-6">
                <section className="mb-12 space-y-6">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.4em] text-gold-400/70">
                        <button
                            type="button"
                            onClick={() => router.push("/tokens/trade")}
                            className="flex items-center gap-2 text-gold-300/70 tracking-normal font-bold hover:text-gold-100 transition-colors"
                        >
                            <span className="text-lg">←</span>
                            Back to marketplace
                        </button>
                        <span className="px-3 py-1 rounded-full border border-gold-500/30 text-[10px] font-bold tracking-[0.5em] text-gold-300/70">
                            LIVE MARKET
                        </span>
                    </div>

                    <div className="bg-black/40 border border-gold-500/20 rounded-3xl p-6 md:p-8 shadow-[0_0_45px_rgba(234,179,8,0.15)] space-y-8">
                        <div className="flex flex-col lg:flex-row gap-6 lg:items-center lg:justify-between">
                            <div className="flex flex-col gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-16 h-16 rounded-full bg-gold-500 text-black font-black text-2xl flex items-center justify-center border-2 border-gold-300">
                                        {ticker[0]}
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-[0.5em] text-gold-300/60 mb-1">
                                            ZRC-20 ASSET
                                        </p>
                                        <h1 className="text-4xl font-black tracking-tight text-gold-100">
                                            {ticker}
                                        </h1>
                                        {tokenInfo?.name && (
                                            <p className="text-sm text-gold-200/70">{tokenInfo.name}</p>
                                        )}
                                    </div>
                                </div>
                                <p className="text-gold-200/80 max-w-2xl">
                                    {tokenInfo?.description ||
                                        `Live PSBT liquidity for ${ticker}, curated directly on the Zatoshi marketplace.`}
                                </p>
                            </div>

                            <div className="flex flex-col gap-3 w-full max-w-sm">
                                <button
                                    onClick={() => setShowCreate(true)}
                                    className="w-full px-5 py-3 rounded-2xl bg-gold-500 text-black font-bold tracking-wide text-sm shadow-[0_0_30px_rgba(234,179,8,0.25)] hover:bg-gold-400 transition-colors"
                                >
                                    List {ticker}
                                </button>
                                <button
                                    onClick={() => router.refresh()}
                                    className="w-full px-5 py-3 rounded-2xl border border-gold-500/30 text-gold-100/80 text-sm font-medium tracking-wide hover:border-gold-400 hover:text-gold-100 transition-colors"
                                >
                                    Refresh Data
                                </button>
                            </div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-[1.1fr_1.2fr]">
                            <div className="bg-black/40 border border-gold-500/20 rounded-2xl p-5">
                                <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-gold-300/60 font-bold">
                                    <span>Mint Progress</span>
                                    <span>
                                        {mintStats.progressPercent !== undefined
                                            ? `${mintStats.progressPercent.toFixed(1)}%`
                                            : loadingToken
                                                ? "Loading..."
                                                : "--"}
                                    </span>
                                </div>
                                <div className="mt-3 h-2 w-full rounded-full bg-gold-500/10 overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-gold-400 via-amber-300 to-yellow-200 transition-[width] duration-700"
                                        style={{ width: `${mintedBarWidth}%` }}
                                    />
                                </div>
                                <div className="mt-3 text-sm font-medium text-gold-100">
                                    {mintStats.mintedAmount !== undefined && mintStats.limit !== undefined
                                        ? `${mintStats.mintedAmount.toLocaleString()} / ${mintStats.limit.toLocaleString()} Minted`
                                        : "Supply data unavailable"}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
                                {statsCards.map((card) => (
                                    <div key={card.label} className="bg-black/40 border border-gold-500/20 rounded-2xl p-4">
                                        <p className="text-[10px] uppercase tracking-widest text-gold-300/60 font-bold mb-1">
                                            {card.label}
                                        </p>
                                        <div className="text-xl font-black text-gold-100">{card.value}</div>
                                        {card.helper && (
                                            <p className="text-[11px] text-gold-300/60 mt-1">{card.helper}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                            <h2 className="text-2xl font-black tracking-tight">Marketplace Orders</h2>
                            <p className="text-sm text-gold-300/70">
                                {listings
                                    ? `${listings.length} live listing${listings.length === 1 ? "" : "s"} for ${ticker}`
                                    : "Syncing listings..."}
                            </p>
                        </div>
                        <button
                            type="button"
                            disabled
                            className="px-4 py-2 rounded-full border border-gold-500/10 text-xs font-bold uppercase tracking-widest text-gold-200/30 cursor-not-allowed"
                        >
                            + Create Listing
                        </button>
                    </div>

                    {!listings ? (
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
                            {listings.map((listing) => (
                                <ListingCard
                                    key={listing._id}
                                    listing={listing}
                                    onBuy={(item) => setSelectedListing(item)}
                                />
                            ))}
                        </div>
                    )}
                </section>
            </div>

            {showCreate && (
                <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-lg bg-black border border-gold-500/30 rounded-2xl p-6 shadow-[0_0_60px_rgba(234,179,8,0.2)]">
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
                        />
                    </div>
                </div>
            )}
        </main>
    );
}
