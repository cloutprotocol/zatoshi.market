"use client";

import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import NFTListingCard from "../../../../components/psbt/NFTListingCard";
import CreateListing from "../../../../components/psbt/CreateListing";
import FinalizeTrade from "../../../../components/psbt/FinalizeTrade";
import { Doc } from "../../../../../convex/_generated/dataModel";
import { getCollectionConfig } from "@/config/collections";
import Link from "next/link";

export default function CollectionTradePage({ params }: { params: { slug: string } }) {
    const slug = decodeURIComponent(params.slug);
    const collection = getCollectionConfig(slug);

    const listings = useQuery(api.psbt.listListingsByCollection, { slug });

    const [showCreate, setShowCreate] = useState(false);
    const [selectedListing, setSelectedListing] = useState<Doc<"psbtListings"> | null>(null);

    if (!collection) {
        return <div className="min-h-screen bg-black text-gold-100 flex items-center justify-center">Collection not found</div>;
    }

    // Calculate stats from listings
    const floorPrice = listings && listings.length > 0
        ? Math.min(...listings.map(l => l.price))
        : null;

    return (
        <div className="min-h-screen bg-black text-gold-100 font-sans selection:bg-gold-500/30">
            {/* Stats Dashboard */}
            <div className="border-b border-gold-500/20 bg-black/40 backdrop-blur-sm pt-24 pb-8 relative overflow-hidden">
                {/* Background decoration */}
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none select-none">
                    <div className="text-9xl font-black text-gold-500 leading-none">
                        {collection.name.substring(0, 2).toUpperCase()}
                    </div>
                </div>

                <div className="max-w-7xl mx-auto px-4 relative z-10">
                    <div className="flex flex-col gap-8">
                        {/* Header */}
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="w-16 h-16 rounded-sm bg-gold-500/20 flex items-center justify-center text-2xl font-bold text-gold-100 border border-gold-500/40 overflow-hidden shadow-[0_0_30px_rgba(234,179,8,0.2)] backdrop-blur-md">
                                    {collection.name.slice(0, 2)}
                                </div>
                                <div>
                                    <h1 className="text-5xl font-black tracking-tight text-gold-100 drop-shadow-lg">{collection.name}</h1>
                                    <div className="text-gold-300/60 font-medium mt-1 uppercase tracking-widest text-xs">Verified Collection</div>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <Link href={`/collection/${slug}`} className="px-6 py-3 bg-black/40 border border-gold-500/20 hover:bg-gold-500/10 rounded-sm text-sm font-bold transition-all hover:scale-105 text-gold-300 backdrop-blur-md uppercase tracking-wider">
                                    View Collection
                                </Link>
                            </div>
                        </div>

                        {/* Stats Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="bg-black/40 border border-gold-500/20 rounded-sm p-6 backdrop-blur-md shadow-lg group hover:border-gold-500/40 transition-all">
                                <div className="text-xs text-gold-200/60 font-bold uppercase tracking-wider mb-2">Floor Price</div>
                                <div className="text-3xl font-black text-gold-400">
                                    {floorPrice ? `${floorPrice} ZEC` : "-"}
                                </div>
                            </div>
                            <div className="bg-black/40 border border-gold-500/20 rounded-sm p-6 backdrop-blur-md shadow-lg group hover:border-gold-500/40 transition-all">
                                <div className="text-xs text-gold-200/60 font-bold uppercase tracking-wider mb-2">Active Listings</div>
                                <div className="text-3xl font-black text-gold-400">
                                    {listings ? listings.length : "-"}
                                </div>
                            </div>
                            {/* Hidden until we have real data */}
                            {/* 
                            <div className="bg-black/40 border border-gold-500/20 rounded-xl p-6 backdrop-blur-md shadow-lg group hover:border-gold-500/40 transition-all opacity-50">
                                <div className="text-xs text-gold-200/60 font-bold uppercase tracking-wider mb-2">Total Volume</div>
                                <div className="text-3xl font-black text-gold-400">-</div>
                            </div>
                            <div className="bg-black/40 border border-gold-500/20 rounded-xl p-6 backdrop-blur-md shadow-lg group hover:border-gold-500/40 transition-all opacity-50">
                                <div className="text-xs text-gold-200/60 font-bold uppercase tracking-wider mb-2">Total Trades</div>
                                <div className="text-3xl font-black text-gold-400">-</div>
                            </div>
                             */}
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="max-w-7xl mx-auto px-4 py-8">

                {/* Tabs & Controls */}
                <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                    <div className="flex gap-1 bg-black/40 p-1 rounded-sm border border-gold-500/20">
                        <button className="px-4 py-2 bg-gold-500 text-black rounded-sm text-sm font-bold shadow-sm">
                            Listings
                        </button>
                        <button className="px-4 py-2 text-gold-300/60 hover:text-gold-100 rounded-sm text-sm font-medium transition-colors">
                            My Listings
                        </button>
                        <button className="px-4 py-2 text-gold-300/60 hover:text-gold-100 rounded-sm text-sm font-medium transition-colors">
                            Trade History
                        </button>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={() => setShowCreate(!showCreate)}
                            className="px-4 py-2 bg-gold-500 hover:bg-gold-400 text-black rounded-sm text-sm font-bold transition-colors shadow-[0_0_20px_rgba(234,179,8,0.2)]"
                        >
                            {showCreate ? "Cancel Listing" : "List Item"}
                        </button>
                        <button className="px-4 py-2 bg-black/40 border border-gold-500/20 hover:bg-gold-500/10 text-gold-300 rounded-sm text-sm font-medium transition-colors flex items-center gap-2">
                            <span>Sweep</span>
                        </button>
                        <button className="px-4 py-2 bg-black/40 border border-gold-500/20 hover:bg-gold-500/10 text-gold-300 rounded-sm text-sm font-medium transition-colors">
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
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Listings Grid */}
                <div className="space-y-6">
                    <div className="text-sm text-gold-300/60 font-medium">
                        {listings ? `${listings.length} listings` : "Loading..."}
                    </div>

                    {!listings ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                                <div key={i} className="h-[300px] bg-black/40 rounded-xl border border-gold-500/10 animate-pulse" />
                            ))}
                        </div>
                    ) : listings.length === 0 ? (
                        <div className="text-center py-32 border border-dashed border-gold-500/20 rounded-xl bg-black/20">
                            <p className="text-gold-300/60 mb-4 font-medium">No active listings for {collection.name}</p>
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
                                <NFTListingCard
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
