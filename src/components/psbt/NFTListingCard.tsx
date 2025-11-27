"use client";

import { Doc } from "../../../convex/_generated/dataModel";
import { useIpfsImage } from "@/lib/imageLoader";
import { useInViewport } from "@/hooks/useInViewport";
import { buildImageUrls } from "@/lib/collectionAssets";
import { getCollectionConfig } from "@/config/collections";

interface NFTListingCardProps {
    listing: Doc<"psbtListings">;
    onBuy: (listing: Doc<"psbtListings">) => void;
}

export default function NFTListingCard({ listing, onBuy }: NFTListingCardProps) {
    const timeAgo = new Date(listing.createdAt).toLocaleDateString();
    const collection = listing.collectionSlug ? getCollectionConfig(listing.collectionSlug) : null;

    // We need to construct image URLs. 
    // Ideally the listing should store the image URL or we fetch metadata.
    // For now, let's try to build it if we have collection config.
    // Note: This might be limited if we don't have full metadata here.
    // But usually buildImageUrls just needs slug and tokenId for IPFS/Cloudflare.
    const imageUrls = (collection && listing.tokenId !== undefined)
        ? buildImageUrls(collection, listing.tokenId, undefined)
        : [];

    const { ref, inView } = useInViewport<HTMLDivElement>();
    const cacheKey = `${listing.collectionSlug}-${listing.tokenId}`;
    const { resolved, loading, errored } = useIpfsImage(imageUrls, inView, cacheKey);

    return (
        <div ref={ref} className="bg-black/40 backdrop-blur-sm border border-gold-500/20 rounded-sm overflow-hidden hover:border-gold-500/40 transition-all group relative flex flex-col shadow-lg hover:shadow-gold-500/10">
            {/* Background decoration - Name Background */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80 z-10 pointer-events-none" />

            {/* Large background text for liquid look */}
            <div className="absolute -top-4 -right-4 p-4 opacity-[0.03] pointer-events-none z-0 rotate-12">
                <div className="text-9xl font-black text-gold-500 leading-none select-none">
                    #{listing.tokenId}
                </div>
            </div>

            {/* Badge */}
            <div className="absolute top-3 right-3 z-20">
                <span className="bg-black/60 text-gold-400 text-[10px] font-bold px-2 py-1 rounded-sm uppercase tracking-wider border border-gold-500/20 backdrop-blur-md">
                    #{listing.tokenId}
                </span>
            </div>

            {/* Image Area */}
            <div className="aspect-square relative bg-black/50 border-b border-gold-500/10 overflow-hidden z-0">
                {resolved && !loading && !errored ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={resolved ?? undefined}
                        alt={`${listing.collectionSlug} #${listing.tokenId}`}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gold-500/20">
                        {loading ? (
                            <div className="animate-pulse bg-gold-500/10 w-full h-full" />
                        ) : (
                            <span className="text-4xl font-black opacity-20">?</span>
                        )}
                    </div>
                )}
            </div>

            {/* Card Content */}
            <div className="p-4 flex-1 flex flex-col relative z-20">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <div className="text-[10px] text-gold-300/60 font-bold uppercase tracking-widest mb-1">
                            {collection?.name || listing.collectionSlug}
                        </div>
                        <div className="text-xl font-black text-gold-100 leading-none tracking-tight">
                            {listing.price} ZEC
                        </div>
                    </div>
                </div>

                {/* Footer Info */}
                <div className="mt-auto space-y-3">
                    <div className="flex items-center justify-between text-[10px] text-gold-300/40 font-mono">
                        <span>{timeAgo}</span>
                        <span>
                            {listing.sellerAddress.slice(0, 4)}...{listing.sellerAddress.slice(-4)}
                        </span>
                    </div>

                    {/* Buy Button */}
                    <button
                        onClick={() => onBuy(listing)}
                        className="w-full py-2.5 bg-gold-500 hover:bg-gold-400 text-black font-bold rounded-sm transition-all text-xs uppercase tracking-widest shadow-[0_0_20px_rgba(234,179,8,0.15)] hover:shadow-[0_0_30px_rgba(234,179,8,0.3)] hover:-translate-y-0.5"
                    >
                        Buy Now
                    </button>
                </div>
            </div>
        </div>
    );
}
