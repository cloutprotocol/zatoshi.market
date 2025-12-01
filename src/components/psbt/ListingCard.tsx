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
}

export default function ListingCard({ listing, onBuy }: ListingCardProps) {
    const { wallet } = useWallet();
    const { success: toastSuccess, error: toastError } = useToast();
    const cancelListing = useMutation(api.psbt.cancelListing);
    const isSeller = Boolean(wallet?.address) && listing.sellerAddress.toLowerCase() === wallet!.address!.toLowerCase();

    const pricePerToken = listing.price / listing.tokenAmount;
    const timeAgo = new Date(listing.createdAt).toLocaleDateString();
    const priceZats = Math.round(listing.price * 1e8);
    const { buyerFeeZats, sellerFeeZats, buyerTotalZats } = calcFees(priceZats);
    const buyerTotal = buyerTotalZats / 1e8;
    const sellerNet = (priceZats - sellerFeeZats) / 1e8;
    const pctSeller = (MARKETPLACE_FEES.SELLER_BPS / 100).toFixed(1);

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
                <div className="mb-4">
                    <div className="text-lg font-black text-gold-100 leading-none mb-1">
                        {listing.tokenAmount.toLocaleString()} {listing.tokenTicker}
                    </div>
                    <div className="text-xs text-gold-300/60 font-medium">
                        Listed {timeAgo}
                    </div>
                </div>

                {/* Price Info */}
                <div className="mt-auto space-y-3">
                    <div className="bg-black/40 rounded-sm p-3 border border-gold-500/10">
                        <div className="flex justify-between items-baseline mb-1">
                            <span className="text-xs text-gold-300/60 font-bold uppercase tracking-wider">Price</span>
                            <span className="text-lg font-black text-gold-400">{listing.price} ZEC</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-gold-300/40 uppercase tracking-wider">Per Token</span>
                            <span className="text-xs text-gold-300/60 font-mono tabular-nums whitespace-nowrap">
                                {(listing.price / listing.tokenAmount).toFixed(8)} ZEC
                            </span>
                        </div>
                        <div className="mt-2 space-y-1 text-[11px] text-gold-300/70">
                            <div className="flex items-center justify-between">
                                <span className="pr-2">No buyer fee</span>
                                <span className="font-mono text-gold-200 tabular-nums whitespace-nowrap">{buyerTotal.toFixed(8)} ZEC</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="pr-2">Seller net (−{pctSeller}%)</span>
                                <span className="font-mono text-gold-200 tabular-nums whitespace-nowrap">{sellerNet.toFixed(8)} ZEC</span>
                            </div>
                        </div>
                    </div>

                    {/* Seller Info */}
                    <div className="flex items-center justify-between text-[10px] text-gold-300/40 px-1">
                        <span>Seller</span>
                        <span className="font-mono text-gold-300/60">
                            {listing.sellerAddress.slice(0, 4)}...{listing.sellerAddress.slice(-4)}
                        </span>
                    </div>

                    {/* Actions */}
                    {isSeller ? (
                        <button
                            onClick={onCancel}
                            className="w-full py-2.5 border border-gold-500/30 text-gold-300 hover:text-gold-100 hover:border-gold-400 font-bold rounded-sm transition-colors text-sm uppercase tracking-wide"
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
                            className="w-full py-2.5 bg-gold-500 hover:bg-gold-400 text-black font-bold rounded-sm transition-colors text-sm uppercase tracking-wide shadow-[0_0_15px_rgba(234,179,8,0.1)] hover:shadow-[0_0_20px_rgba(234,179,8,0.3)]"
                        >
                            Buy Now
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
