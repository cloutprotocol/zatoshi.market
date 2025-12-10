'use client';
/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import type { CollectionConfig } from '@/config/collections';
import { ZgodsOnchainView } from '@/components/ZgodsOnchainView';
import { zrc721IndexAPI, type ZRC721Collection } from '@/services/zrc721Index';

type Props = {
    collection: CollectionConfig;
};

export function ClaimClientOnchain({ collection }: Props) {
    const { wallet, mounted } = useWallet();
    const [collectionData, setCollectionData] = useState<ZRC721Collection | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchCollectionData = async () => {
            try {
                const data = await zrc721IndexAPI.getCollection(collection.name.toLowerCase());
                setCollectionData(data);
            } catch (err) {
                console.error('Failed to fetch collection data', err);
            } finally {
                setLoading(false);
            }
        };

        fetchCollectionData();
        // Poll every 30 seconds
        const interval = setInterval(fetchCollectionData, 30000);
        return () => clearInterval(interval);
    }, [collection.name]);

    const mintProgress = (collectionData && collectionData.minted && collectionData.supply)
        ? ((collectionData.minted / Number(collectionData.supply)) * 100).toFixed(1)
        : '0';

    return (
        <main className="min-h-screen bg-black text-gold-100">
            <div className="container mt-14 mx-auto px-6 py-28 max-w-6xl">
                <div className="flex flex-col gap-4 mb-12">
                    <div className="flex items-center gap-5">
                        <img
                            src="/collections/zgods/3vUZmMCg.gif"
                            alt="ZGODS"
                            className="w-28 h-28 rounded border border-gold-500/40"
                        />
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight">{collection.name}</h1>
                            {collection.supply ? (
                                <span className="text-xs sm:text-sm text-gold-300/80 border border-gold-500/30 rounded-full px-2 sm:px-3 py-1">
                                    Supply {collection.supply.toLocaleString()}
                                </span>
                            ) : null}
                        </div>
                    </div>
                    {collection.description && (
                        <p className="text-gold-200/70">
                            The first ZRC-721 Inscription Collection on the Zcash blockchain. View the onchain index of all minted tokens.
                        </p>
                    )}
                </div>

                {/* Claim Status Notice */}
                <div className="glass-card p-6 border border-gold-500/20 rounded-sm mb-6 bg-amber-500/5">
                    <div className="flex items-start gap-4">
                        <div className="text-3xl">ℹ️</div>
                        <div className="flex-1 space-y-3">
                            <h2 className="text-xl font-bold text-gold-100">Claim System Paused</h2>
                            <p className="text-gold-200/80">
                                The ZGODS claim system has been temporarily paused. We have transitioned to using the onchain ZRC-721 index
                                for displaying all minted tokens. This provides a more reliable and decentralized source of truth.
                            </p>
                            <p className="text-gold-200/80">

                            </p>
                        </div>
                    </div>
                </div>

                {/* Collection Stats */}
                <div className="glass-card p-6 border border-gold-500/20 rounded-sm mb-6">
                    <h2 className="text-xl font-semibold mb-4">Collection Stats</h2>
                    {loading ? (
                        <div className="text-sm text-gold-200/70">Loading collection data...</div>
                    ) : (collectionData && typeof collectionData.minted === 'number' && collectionData.supply) ? (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="bg-black/40 border border-gold-500/10 rounded p-4">
                                <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">Total Supply</div>
                                <div className="text-2xl font-bold text-gold-100">{Number(collectionData.supply).toLocaleString()}</div>
                            </div>
                            <div className="bg-black/40 border border-gold-500/10 rounded p-4">
                                <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">Minted</div>
                                <div className="text-2xl font-bold text-gold-100">{collectionData.minted.toLocaleString()}</div>
                            </div>
                            <div className="bg-black/40 border border-gold-500/10 rounded p-4">
                                <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">Progress</div>
                                <div className="text-2xl font-bold text-gold-100">{mintProgress}%</div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-sm text-red-300">Failed to load collection data</div>
                    )}
                </div>

                {/* Wallet Connection */}
                <div className="glass-card p-6 border border-gold-500/20 rounded-sm mb-6">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="space-y-2">
                            <div className="text-sm text-gold-200/70">Connected wallet</div>
                            <div className="font-mono text-lg">
                                {mounted
                                    ? wallet?.address ?? 'Not connected'
                                    : '...'}
                            </div>
                        </div>
                    </div>
                    {wallet?.address && (
                        <div className="mt-4 text-sm text-gold-200/70">
                            Your owned tokens are shown below
                        </div>
                    )}
                </div>

                {/* My Tokens (if wallet connected) */}
                {wallet?.address && (
                    <div className="glass-card p-6 border border-gold-500/20 rounded-sm mb-6">
                        <h3 className="text-xl font-semibold mb-4">My {collection.name} Tokens</h3>
                        <ZgodsOnchainView
                            collectionSlug={collection.slug}
                            limit={50}
                            showForAddress={wallet.address}
                            cardSize="md"
                        />
                    </div>
                )}

                {/* All Tokens */}
                <div className="glass-card p-6 border border-gold-500/20 rounded-sm">
                    <h3 className="text-xl font-semibold mb-4">Recent Mints</h3>
                    <ZgodsOnchainView
                        collectionSlug={collection.slug}
                        limit={24}
                        cardSize="md"
                    />
                    <div className="mt-6 text-center">
                        <a
                            href="http://135.181.6.234:3333/collections"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block px-6 py-3 bg-gold-500/10 border border-gold-500/30 rounded text-gold-100 hover:bg-gold-500/20 transition-colors"
                        >
                            View Explorer
                        </a>
                    </div>
                </div>
            </div>
        </main>
    );
}
