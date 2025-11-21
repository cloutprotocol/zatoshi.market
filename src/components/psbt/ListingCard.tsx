"use client";

import { Doc } from "../../../convex/_generated/dataModel";

interface ListingCardProps {
    listing: Doc<"psbtListings">;
    onBuy: (listing: Doc<"psbtListings">) => void;
}

export default function ListingCard({ listing, onBuy }: ListingCardProps) {
    const pricePerToken = listing.price / listing.tokenAmount;
    const timeAgo = new Date(listing.createdAt).toLocaleDateString();

    return (
        <div className="bg-black/40 border border-gold-500/20 rounded-xl overflow-hidden hover:border-gold-500/40 transition-all group relative flex flex-col">
            {/* Badge */}
            <div className="absolute top-3 right-3">
                <span className="bg-gold-500/10 text-gold-400 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider border border-gold-500/20">
                    ZRC20
                </span>
            </div>

            {/* Card Content */}
            <div className="p-5 flex-1 flex flex-col">
                {/* Token Header */}
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-full bg-gold-500 flex items-center justify-center text-black font-bold text-sm border-2 border-gold-400">
                        {listing.tokenTicker[0]}
                    </div>
                    <div>
                        <div className="text-lg font-black text-gold-100 leading-none mb-1">
                            {listing.tokenAmount.toLocaleString()} {listing.tokenTicker}
                        </div>
                        <div className="text-xs text-gold-300/60 font-medium">
                            Listed {timeAgo}
                        </div>
                    </div>
                </div>

                {/* Price Info */}
                <div className="mt-auto space-y-3">
                    <div className="bg-black/40 rounded-lg p-3 border border-gold-500/10">
                        <div className="flex justify-between items-baseline mb-1">
                            <span className="text-xs text-gold-300/60 font-bold uppercase tracking-wider">Price</span>
                            <span className="text-lg font-black text-gold-400">{listing.price} ZEC</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-gold-300/40 uppercase tracking-wider">Per Token</span>
                            <span className="text-xs text-gold-300/60 font-mono">
                                {(listing.price / listing.tokenAmount).toFixed(8)} ZEC
                            </span>
                        </div>
                    </div>

                    {/* Seller Info */}
                    <div className="flex items-center justify-between text-[10px] text-gold-300/40 px-1">
                        <span>Seller</span>
                        <span className="font-mono text-gold-300/60">
                            {listing.sellerAddress.slice(0, 4)}...{listing.sellerAddress.slice(-4)}
                        </span>
                    </div>

                    {/* Buy Button */}
                    <button
                        onClick={() => onBuy(listing)}
                        className="w-full py-2.5 bg-gold-500 hover:bg-gold-400 text-black font-bold rounded-lg transition-colors text-sm uppercase tracking-wide shadow-[0_0_15px_rgba(234,179,8,0.1)] hover:shadow-[0_0_20px_rgba(234,179,8,0.3)]"
                    >
                        Buy Now
                    </button>
                </div>
            </div>
        </div>
    );
}
