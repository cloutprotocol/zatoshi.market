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
        <div ref={ref} className="bg-black/40 border border-gold-500/20 rounded-xl overflow-hidden hover:border-gold-500/40 transition-all group relative flex flex-col">
            {/* Badge */}
            <div className="absolute top-3 right-3 z-10">
                <span className="bg-gold-500/10 text-gold-400 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider border border-gold-500/20 backdrop-blur-md">
                    #{listing.tokenId}
                </span>
            </div>

            {/* Image Area */}
            <div className="aspect-square relative bg-black/50 border-b border-gold-500/10 overflow-hidden">
                {resolved && !loading && !errored ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={resolved}
                        alt={`${listing.collectionSlug} #${listing.tokenId}`}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
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
            <div className="p-4 flex-1 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <div className="text-xs text-gold-300/60 font-bold uppercase tracking-wider mb-1">
                            {collection?.name || listing.collectionSlug}
                        </div>
                        <div className="text-lg font-black text-gold-100 leading-none">
                            {listing.price} ZEC
                        </div>
                    </div>
                </div>

                {/* Footer Info */}
                <div className="mt-auto space-y-3">
                    <div className="flex items-center justify-between text-[10px] text-gold-300/40">
                        <span>Listed {timeAgo}</span>
                        <span className="font-mono text-gold-300/60">
                            {listing.sellerAddress.slice(0, 4)}...{listing.sellerAddress.slice(-4)}
                        </span>
                    </div>

                    {/* Buy Button */}
                    <button
                        onClick={() => onBuy(listing)}
                        className="w-full py-2 bg-gold-500 hover:bg-gold-400 text-black font-bold rounded-lg transition-colors text-xs uppercase tracking-wide shadow-[0_0_15px_rgba(234,179,8,0.1)] hover:shadow-[0_0_20px_rgba(234,179,8,0.3)]"
                    >
                        Buy Now
                    </button>
                </div>
            </div>
        </div>
    );
}
