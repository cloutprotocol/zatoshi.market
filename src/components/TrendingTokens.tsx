'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ordinalIndexAPI, type OrdinalIndexToken } from '@/services/ordinalIndex';

// Helper to format numbers
const formatNumber = (value?: number) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '--';
    return new Intl.NumberFormat('en-US').format(value);
};

const formatPercent = (value?: number) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '--';
    return `${(value * 100).toFixed(1)}%`;
};

export function TrendingTokens() {
    const [tokens, setTokens] = useState<OrdinalIndexToken[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'minting' | 'holders'>('minting');

    useEffect(() => {
        async function fetchTokens() {
            try {
                // Fetch first few pages to get enough data
                // In a real app, we might want a specific endpoint for trending/top
                const pageSize = 50;
                const response = await ordinalIndexAPI.getTokens(0, pageSize);
                setTokens(response.items);
            } catch (err) {
                console.error('Failed to load tokens', err);
            } finally {
                setLoading(false);
            }
        }

        fetchTokens();
    }, []);

    const nowMinting = useMemo(() => {
        return tokens
            .filter(t => {
                const progress = typeof t.progress === 'number' ? t.progress : 0;
                return progress < 1 && progress > 0;
            })
            .sort((a, b) => (b.progress || 0) - (a.progress || 0))
            .slice(0, 5);
    }, [tokens]);

    const topHolders = useMemo(() => {
        // Note: holder count might need to be fetched separately if not in the list response
        // Assuming the list response might not have accurate holder counts without extra calls
        // but for now we'll use what we have or just list them.
        // Actually, the tokens list response usually has some basic info.
        // If 'holders' is not in OrdinalIndexToken, we might need to fetch stats.
        // Looking at tokens/page.tsx, it fetches stats separately.
        // For simplicity in this first pass, we'll just show the tokens and maybe skip holder count if missing,
        // or fetch stats for these specific tokens.
        // Let's just list them by supply or if we have holder data.
        // If we can't easily get holders, maybe we just show "Completed" or "Blue Chips"
        return tokens
            .filter(t => (t.progress || 0) >= 1)
            .slice(0, 5);
    }, [tokens]);

    // If we want real holder counts, we'd need to fetch them like in tokens/page.tsx
    // For now, let's just display the list.

    const displayTokens = activeTab === 'minting' ? nowMinting : topHolders;

    return (
        <div className="w-full max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gold-100">Trending ZRC-20s</h2>
                <div className="flex bg-black/40 rounded-sm p-1 border border-gold-500/20">
                    <button
                        onClick={() => setActiveTab('minting')}
                        className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded transition-all ${activeTab === 'minting'
                            ? 'bg-gold-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.2)]'
                            : 'text-gold-300/60 hover:text-gold-200'
                            }`}
                    >
                        Now Minting
                    </button>
                    <button
                        onClick={() => setActiveTab('holders')}
                        className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded transition-all ${activeTab === 'holders'
                            ? 'bg-gold-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.2)]'
                            : 'text-gold-300/60 hover:text-gold-200'
                            }`}
                    >
                        Top Completed
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="h-40 flex items-center justify-center text-gold-500/40 text-sm">
                    Loading market data...
                </div>
            ) : (
                <div className="grid gap-4">
                    {displayTokens.map((token) => (
                        <Link
                            key={token.ticker}
                            href={`/inscribe?tab=zrc20&tick=${token.ticker.toLowerCase()}`}
                            className="group block bg-black/40 border border-gold-500/10 hover:border-gold-500/30 hover:bg-gold-500/5 transition-all p-4 rounded-sm"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gold-500/20 to-black border border-gold-500/20 flex items-center justify-center text-sm font-bold text-gold-200 group-hover:scale-110 transition-transform">
                                        {token.ticker.slice(0, 1)}
                                    </div>
                                    <div>
                                        <div className="font-bold text-gold-100 text-lg tracking-wide group-hover:text-gold-400 transition-colors">
                                            {token.ticker}
                                        </div>
                                        <div className="text-xs text-gold-500/40 font-mono">
                                            {formatNumber(Number(token.supply))} / {formatNumber(Number(token.max))}
                                        </div>
                                    </div>
                                </div>

                                <div className="text-right">
                                    <div className="text-sm font-mono text-gold-200 mb-1">
                                        {formatPercent(token.progress)}
                                    </div>
                                    <div className="w-24 h-1.5 bg-black/50 rounded-full overflow-hidden border border-gold-500/10">
                                        <div
                                            className="h-full bg-gold-500"
                                            style={{ width: `${Math.min((token.progress || 0) * 100, 100)}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </Link>
                    ))}

                    {displayTokens.length === 0 && (
                        <div className="text-center py-8 text-gold-500/40 text-sm">
                            No tokens found for this category.
                        </div>
                    )}

                    <div className="mt-4 text-center">
                        <Link
                            href="/tokens"
                            className="inline-block text-xs font-bold text-gold-400 hover:text-gold-300 uppercase tracking-widest border-b border-gold-400/30 hover:border-gold-300 pb-1 transition-all"
                        >
                            View All Tokens
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
