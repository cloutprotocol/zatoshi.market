"use client";

import { Doc, Id } from "../../../convex/_generated/dataModel";
import { calcFees, MARKETPLACE_FEES } from "@/config/marketplace";
import { useWallet } from "@/contexts/WalletContext";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useToast } from "@/contexts/ToastContext";

interface ListingCardProps {
    listing: Doc<"psbtListings">;
    onBuy: (listing: Doc<"psbtListings">) => void;
    floorPrice?: number;
}

export default function ListingCard({ listing, onBuy, floorPrice }: ListingCardProps) {
    const { wallet } = useWallet();
    const { success: toastSuccess, error: toastError } = useToast();
    const cancelListing = useMutation(api.psbt.cancelListing);
    const isSeller = Boolean(wallet?.address) && listing.sellerAddress.toLowerCase() === wallet!.address!.toLowerCase();

    const pricePerToken = listing.price / (listing.tokenAmount || 1);
    const timeAgo = new Date(listing.createdAt).toLocaleDateString();

    // Calculate floor difference
    let floorDelta = null;
    let floorDeltaColor = "text-zinc-500";

    if (floorPrice && floorPrice > 0) {
        const delta = ((pricePerToken - floorPrice) / floorPrice) * 100;
        const isPositive = delta > 0;
        // Only show if difference is significant (> 0.1%)
        if (Math.abs(delta) > 0.1) {
            floorDelta = `${isPositive ? '+' : ''}${delta.toFixed(1)}% floor`;
            floorDeltaColor = isPositive ? "text-red-400" : "text-green-400";
        } else {
            floorDelta = "At Floor";
            floorDeltaColor = "text-gold-400";
        }
    }

    const onCancel = async () => {
        if (!wallet?.address) return;
        try {
            await cancelListing({ listingId: listing._id as Id<"psbtListings">, requester: wallet.address });
            toastSuccess('Listing cancelled');
        } catch (e: any) {
            toastError('Cancel failed', e?.message || String(e));
        }
    };

    return (
        <div className="bg-black/40 border border-gold-500/10 rounded-xl overflow-hidden hover:border-gold-500/30 transition-all duration-300 group relative flex flex-col h-full">
            {/* Top accent line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-gold-500/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

            {/* Card Content */}
            <div className="p-5 flex-1 flex flex-col">
                {/* Header: Amount & Ticker */}
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <div className="text-2xl font-black text-gold-100 leading-none tracking-tight">
                            {(listing.tokenAmount || 0).toLocaleString()}
                        </div>
                        <div className="text-sm font-bold text-gold-500/80 mt-1 tracking-wide">
                            {listing.tokenTicker}
                        </div>
                    </div>
                    <div className="px-2 py-1 rounded bg-gold-500/5 border border-gold-500/10 text-[10px] font-bold text-gold-400/60 uppercase tracking-wider">
                        ZRC-20
                    </div>
                </div>

                {/* Price Section */}
                <div className="mt-auto space-y-4 pb-4">
                    <div>
                        <div className="flex justify-between items-end mb-1">
                            <div className="text-[10px] uppercase tracking-widest text-gold-300/40 font-bold">
                                Total Price
                            </div>
                            {floorDelta && (
                                <div className={`text-[10px] font-bold ${floorDeltaColor} bg-black/40 px-1.5 py-0.5 rounded`}>
                                    {floorDelta}
                                </div>
                            )}
                        </div>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-2xl font-medium font-mono text-gold-100 tracking-tight">
                                {listing.price}
                            </span>
                            <span className="text-sm font-bold text-gold-500/60">ZEC</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-gold-300/40 uppercase tracking-wider">
                                {pricePerToken.toFixed(8)} ZEC / token
                            </span>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="h-px bg-gold-500/10 w-full" />

                    {/* Footer Info */}
                    <div className="flex items-center justify-between text-[10px] text-gold-300/40">
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/50" />
                            <span>Listed {timeAgo}</span>
                        </div>
                        <div className="font-mono text-gold-300/60">
                            by {listing.sellerAddress.slice(0, 4)}...{listing.sellerAddress.slice(-4)}
                        </div>
                    </div>
                </div>
            </div>

            {/* Tab Button Actions */}
            {isSeller ? (
                <button
                    onClick={onCancel}
                    className="w-full py-4 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 font-bold transition-all text-xs uppercase tracking-widest border-t border-zinc-700/50 hover:border-zinc-600"
                >
                    Cancel Listing
                </button>
            ) : (
                <button
                    onClick={() => {
                        if (!wallet?.address) {
                            if (typeof window !== 'undefined') {
                                window.dispatchEvent(new CustomEvent('zatoshi:open-wallet'));
                            }
                            return;
                        }
                        onBuy(listing);
                    }}
                    className="w-full py-4 bg-gold-500 hover:bg-gold-400 text-black font-bold transition-all text-xs uppercase tracking-widest border-t border-gold-400/50"
                >
                    Buy Now
                </button>
            )}
        </div>
    );
}
