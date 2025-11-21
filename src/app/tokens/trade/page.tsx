"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import ListingCard from "@/components/psbt/ListingCard";
import CreateListing from "@/components/psbt/CreateListing";
import dynamic from "next/dynamic";

const Dither = dynamic(() => import("@/components/Dither"), {
    ssr: false,
    loading: () => null,
});

export default function TradePage() {
    const [view, setView] = useState<"buy" | "sell">("buy");
    const listings = useQuery(api.psbt.listListings, { limit: 50 });

    return (
        <main className="relative min-h-screen text-zinc-100 pt-20">
            {/* Dither Background */}
            <div className="fixed inset-0 w-full h-full opacity-20 -z-10">
                <Dither
                    waveColor={[0.8, 0.6, 0.2]}
                    disableAnimation={false}
                    enableMouseInteraction={true}
                    mouseRadius={0.3}
                    colorNum={4}
                    waveAmplitude={0.15}
                    waveFrequency={2}
                    waveSpeed={0.03}
                />
            </div>

            <div className="container mx-auto px-6 py-12 max-w-[1200px]">
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-4xl font-bold text-orange-500 mb-2">
                            Token Marketplace
                        </h1>
                        <p className="text-zinc-400">
                            Buy and sell ZRC-20 tokens using PSBTs.
                        </p>
                    </div>
                    <div className="flex gap-4">
                        <button
                            onClick={() => setView("buy")}
                            className={`px-6 py-2 rounded font-bold transition-colors ${view === "buy"
                                ? "bg-orange-600 text-white"
                                : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                                }`}
                        >
                            Buy
                        </button>
                        <button
                            onClick={() => setView("sell")}
                            className={`px-6 py-2 rounded font-bold transition-colors ${view === "sell"
                                ? "bg-orange-600 text-white"
                                : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                                }`}
                        >
                            Sell
                        </button>
                    </div>
                </div>

                {view === "sell" ? (
                    <div className="max-w-2xl mx-auto">
                        <CreateListing />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {listings === undefined ? (
                            <div className="col-span-full text-center py-12 text-zinc-500 animate-pulse">
                                Loading listings...
                            </div>
                        ) : listings.length === 0 ? (
                            <div className="col-span-full text-center py-12 text-zinc-500">
                                No active listings found. Be the first to list!
                            </div>
                        ) : (
                            listings.map((listing: any) => (
                                <ListingCard key={listing._id} listing={listing} />
                            ))
                        )}
                    </div>
                )}
            </div>
        </main>
    );
}
