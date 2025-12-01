"use client";

import { Doc, Id } from "../../../convex/_generated/dataModel";
import { useWallet } from "@/contexts/WalletContext";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useToast } from "@/contexts/ToastContext";
import { formatUSD } from "@/config/fees";
import { formatZecAmount } from "@/utils/format";

interface ListingCardProps {
    listing: Doc<"psbtListings">;
    onBuy: (listing: Doc<"psbtListings">) => void;
    floorPrice?: number;
    zecPrice?: number | null;
}

function formatRelativeTime(timestamp: number): string {
    const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    const units: [number, string][] = [
        [60 * 60 * 24 * 365, 'y'],
        [60 * 60 * 24 * 30, 'mo'],
        [60 * 60 * 24, 'd'],
        [60 * 60, 'h'],
        [60, 'm'],
    ];
    for (const [seconds, label] of units) {
        if (diffSeconds >= seconds) {
            const value = Math.floor(diffSeconds / seconds);
            return `${value}${label} ago`;
        }
    }
    return diffSeconds <= 5 ? 'just now' : `${diffSeconds}s ago`;
}

export default function ListingCard({ listing, onBuy, floorPrice, zecPrice }: ListingCardProps) {
    const { wallet } = useWallet();
    const { success: toastSuccess, error: toastError } = useToast();
    const cancelListing = useMutation(api.psbt.cancelListing);
    const isSeller = Boolean(wallet?.address) && listing.sellerAddress.toLowerCase() === wallet!.address!.toLowerCase();

    const tokenCount = listing.tokenAmount || 1;
    const pricePerToken = listing.price / tokenCount;
    const timeAgo = formatRelativeTime(listing.createdAt);
    const priceZats = Math.round(listing.price * 1e8);
    const priceUsd = zecPrice ? formatUSD(priceZats, zecPrice) : null;
    const perTokenZats = Math.round(pricePerToken * 1e8);
    const perTokenUsd = zecPrice ? formatUSD(perTokenZats, zecPrice) : null;

    // Calculate floor difference
    let floorDelta = null;
    let floorDeltaColor = "text-zinc-500";

    if (floorPrice && floorPrice > 0) {
        const delta = ((pricePerToken - floorPrice) / floorPrice) * 100;
        const isPositive = delta > 0;
        // Only show if difference is significant (> 0.1%)
        if (Math.abs(delta) > 0.1) {
            floorDelta = `${isPositive ? '+' : ''}${delta.toFixed(1)}% floor`;
            floorDeltaColor = isPositive ? "text-gold-400" : "text-emerald-400";
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
            <div className="p-5 flex-1 flex flex-col gap-4">
                {/* Header: Amount & Ticker */}
                <div className="flex justify-between items-start">
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
                <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-widest text-gold-300/40 font-bold">
                        Total Price
                    </div>

                    {/* Main Price Row */}
                    <div className="flex justify-between items-baseline">
                        <div className="text-xl font-bold font-mono text-gold-100 tracking-tight">
                            {formatZecAmount(listing.price)} <span className="text-base text-gold-500/60">ZEC</span>
                        </div>
                        {priceUsd && (
                            <div className="text-base font-medium text-gold-200 tracking-tight">
                                {priceUsd}
                            </div>
                        )}
                    </div>

                    {/* Secondary Price Row */}
                    <div className="flex justify-between items-center pt-1">
                        <div className="text-[11px] text-gold-300/50 font-mono">
                            {formatZecAmount(pricePerToken)} ZEC / token
                        </div>
                        {floorDelta && (
                            <div className={`text-[10px] font-bold ${floorDeltaColor} uppercase tracking-wider bg-white/5 px-1.5 py-0.5 rounded`}>
                                {floorDelta}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Info */}
                <div className="mt-2">
                    <div className="h-px bg-gold-500/10 w-full mb-3" />
                    <div className="flex items-center justify-between text-[11px] text-gold-300/40 font-mono uppercase tracking-wider">
                        <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-gold-500/20" />
                            {listing.sellerAddress.slice(0, 4)}...{listing.sellerAddress.slice(-4)}
                        </span>
                        <span>{timeAgo}</span>
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
