"use client";

import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { zerdinalsAPI, ZerdinalsToken } from "../../../../services/zerdinals";
import ListingCard from "../../../../components/psbt/ListingCard";
import CreateListing from "../../../../components/psbt/CreateListing";
import FinalizeTrade from "../../../../components/psbt/FinalizeTrade";
import { Doc } from "../../../../../convex/_generated/dataModel";

export default function TokenTradePage({ params }: { params: { ticker: string } }) {
    const ticker = params.ticker.toUpperCase();
    const listings = useQuery(api.psbt.listListingsByTicker, { ticker });

    const [tokenInfo, setTokenInfo] = useState<ZerdinalsToken | null>(null);
    const [loadingToken, setLoadingToken] = useState(true);

    const [showCreate, setShowCreate] = useState(false);
    const [selectedListing, setSelectedListing] = useState<Doc<"psbtListings"> | null>(null);

    useEffect(() => {
        const fetchToken = async () => {
            setLoadingToken(true);
            try {
                const info = await zerdinalsAPI.getToken(ticker);
                setTokenInfo(info);
            } catch (e) {
                console.error("Failed to fetch token info", e);
                // Fallback or show error
            } finally {
                setLoadingToken(false);
            }
        };
        fetchToken();
    }, [ticker]);

    return (
        <div className="min-h-screen bg-black text-gold-100 font-sans selection:bg-gold-500/30">
            {/* Stats Dashboard */}
            <div className="border-b border-gold-500/20 bg-black/40 backdrop-blur-sm pt-24 pb-8">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="flex flex-col gap-8">
                        {/* Header */}
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-gold-500 flex items-center justify-center text-xl font-bold text-black border-2 border-gold-400">
                                    {ticker[0]}
                                </div>
                                <h1 className="text-4xl font-black tracking-tight text-gold-100">{ticker}</h1>
                            </div>
                            <div className="flex gap-3">
                                <button className="px-4 py-2 bg-black/40 border border-gold-500/20 hover:bg-gold-500/10 rounded-lg text-sm font-medium transition-colors text-gold-300">
                                    Website
                                </button>
                                <button className="px-4 py-2 bg-black/40 border border-gold-500/20 hover:bg-gold-500/10 rounded-lg text-sm font-medium transition-colors text-gold-300">
                                    Discord
                                </button>
                            </div>
                        </div>

                        {/* Stats Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="bg-black/40 border border-gold-500/20 rounded-xl p-5">
                                <div className="text-xs text-gold-200/60 font-bold uppercase tracking-wider mb-1">Floor Price</div>
                                <div className="text-2xl font-black text-gold-400">
                                    {tokenInfo?.price ? `${tokenInfo.price} ZEC` : "-"}
                                </div>
                                <div className="text-xs text-green-400 mt-1 font-medium">+2.06%</div>
                            </div>
                            <div className="bg-black/40 border border-gold-500/20 rounded-xl p-5">
                                <div className="text-xs text-gold-200/60 font-bold uppercase tracking-wider mb-1">Total Volume</div>
                                <div className="text-2xl font-black text-gold-400">
                                    {tokenInfo?.volume24h ? `${tokenInfo.volume24h.toLocaleString()} ZEC` : "-"}
                                </div>
                                <div className="text-xs text-gold-300/60 mt-1 font-medium">$332,297.64</div>
                            </div>
                            <div className="bg-black/40 border border-gold-500/20 rounded-xl p-5">
                                <div className="text-xs text-gold-200/60 font-bold uppercase tracking-wider mb-1">Total Trades</div>
                                <div className="text-2xl font-black text-gold-400">2,479</div>
                            </div>
                            <div className="bg-black/40 border border-gold-500/20 rounded-xl p-5">
                                <div className="text-xs text-gold-200/60 font-bold uppercase tracking-wider mb-1">Active Listings</div>
                                <div className="text-2xl font-black text-gold-400">
                                    {listings ? listings.length : "-"}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="max-w-7xl mx-auto px-4 py-8">

                {/* Tabs & Controls */}
                <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                    <div className="flex gap-1 bg-black/40 p-1 rounded-lg border border-gold-500/20">
                        <button className="px-4 py-2 bg-gold-500 text-black rounded-md text-sm font-bold shadow-sm">
                            Listings
                        </button>
                        <button className="px-4 py-2 text-gold-300/60 hover:text-gold-100 rounded-md text-sm font-medium transition-colors">
                            My Listings
                        </button>
                        <button className="px-4 py-2 text-gold-300/60 hover:text-gold-100 rounded-md text-sm font-medium transition-colors">
                            Trade History
                        </button>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={() => setShowCreate(!showCreate)}
                            className="px-4 py-2 bg-gold-500 hover:bg-gold-400 text-black rounded-lg text-sm font-bold transition-colors shadow-[0_0_20px_rgba(234,179,8,0.2)]"
                        >
                            {showCreate ? "Cancel Listing" : "List Item"}
                        </button>
                        <button className="px-4 py-2 bg-black/40 border border-gold-500/20 hover:bg-gold-500/10 text-gold-300 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                            <span>Sweep</span>
                        </button>
                        <button className="px-4 py-2 bg-black/40 border border-gold-500/20 hover:bg-gold-500/10 text-gold-300 rounded-lg text-sm font-medium transition-colors">
                            Refresh
                        </button>
                    </div>
                </div>

                {/* Create Listing Modal */}
                {showCreate && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                        <div className="bg-black border border-gold-500/30 rounded-xl p-6 w-full max-w-md relative animate-in zoom-in-95 duration-200 shadow-[0_0_50px_rgba(234,179,8,0.1)]">
                            <CreateListing
                                onCancel={() => setShowCreate(false)}
                                onSuccess={() => {
                                    setShowCreate(false);
                                    // Ideally trigger a refetch here if needed, but Convex is reactive
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Listings Grid */}
                <div className="space-y-6">
                    <div className="text-sm text-gold-300/60 font-medium">
                        {listings ? `${listings.length} ${ticker} listings` : "Loading..."}
                    </div>

                    {!listings ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                                <div key={i} className="h-[300px] bg-black/40 rounded-xl border border-gold-500/10 animate-pulse" />
                            ))}
                        </div>
                    ) : listings.length === 0 ? (
                        <div className="text-center py-32 border border-dashed border-gold-500/20 rounded-xl bg-black/20">
                            <p className="text-gold-300/60 mb-4 font-medium">No active listings for {ticker}</p>
                            <button
                                onClick={() => setShowCreate(true)}
                                className="text-gold-500 hover:text-gold-400 font-bold"
                            >
                                List one now
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {listings.map((listing) => (
                                <ListingCard
                                    key={listing._id}
                                    listing={listing}
                                    onBuy={() => setSelectedListing(listing)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Buy Modal */}
            {selectedListing && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="w-full max-w-md animate-in zoom-in-95 duration-200">
                        <FinalizeTrade
                            listing={selectedListing}
                            onCancel={() => setSelectedListing(null)}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
