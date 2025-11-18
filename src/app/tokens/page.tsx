'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { zerdinalsAPI } from '@/services/zerdinals';

const Dither = dynamic(() => import('@/components/Dither'), { ssr: false, loading: () => null });

interface TokenListItem {
  tick: string;
  supply: number;
  limit: number;
  mintedAmount: number;
  isMinted: boolean;
  inscription_id: string;
  holders: number;
  deployer: string;
  time: number;
  block: number;
  completedBlock: number;
  txid: string;
}

export default function TokenListPage() {
  const [tokens, setTokens] = useState<TokenListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const tokensPerPage = 20;

  useEffect(() => {
    async function fetchTokens() {
      try {
        setLoading(true);
        const response = await zerdinalsAPI.getTokens(1000, 0);
        setTokens(response.results as any);
        setError(null);
      } catch (err) {
        setError('check back later');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchTokens();
    // Refresh every 60 seconds
    const interval = setInterval(fetchTokens, 60000);
    return () => clearInterval(interval);
  }, []);

  const filteredTokens = tokens.filter(token =>
    token.tick.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Pagination
  const totalPages = Math.ceil(filteredTokens.length / tokensPerPage);
  const startIndex = (currentPage - 1) * tokensPerPage;
  const paginatedTokens = filteredTokens.slice(startIndex, startIndex + tokensPerPage);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  const getMintProgress = (token: TokenListItem) => {
    return ((token.mintedAmount / token.supply) * 100).toFixed(1);
  };

  return (
    <main className="relative min-h-screen text-gold-100 pt-20">
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

      {/* Content */}
      <div className="relative z-10">
        <div className="container mx-auto px-6 py-12 max-w-[1600px]">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl md:text-5xl font-bold text-gold-300 mb-3">
              ZRC-20 TOKEN LIST
            </h1>
            <p className="text-lg text-gold-100/80">
              Discover all ZRC-20 tokens deployed on the Zcash blockchain
            </p>
          </div>

          {/* Search Bar */}
          <div className="mb-8">
            <input
              type="text"
              placeholder="Search tokens by ticker..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full max-w-md px-6 py-4 bg-black/60 border border-gold-500/30 text-gold-100 placeholder-gold-300/40 focus:outline-none focus:border-gold-500/60 rounded-none"
            />
          </div>

          {/* Stats Summary */}
          {!loading && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              <div className="p-6 bg-black/40 border border-gold-500/20">
                <div className="text-gold-200/60 text-sm uppercase tracking-widest mb-2">
                  Total Tokens
                </div>
                <div className="text-4xl font-bold text-gold-400">
                  {formatNumber(tokens.length)}
                </div>
              </div>
              <div className="p-6 bg-black/40 border border-gold-500/20">
                <div className="text-gold-200/60 text-sm uppercase tracking-widest mb-2">
                  Fully Minted
                </div>
                <div className="text-4xl font-bold text-gold-400">
                  {formatNumber(tokens.filter(t => t.isMinted).length)}
                </div>
              </div>
              <div className="p-6 bg-black/40 border border-gold-500/20">
                <div className="text-gold-200/60 text-sm uppercase tracking-widest mb-2">
                  Total Holders
                </div>
                <div className="text-4xl font-bold text-gold-400">
                  {formatNumber(tokens.reduce((sum, t) => sum + t.holders, 0))}
                </div>
              </div>
            </div>
          )}

          {/* Token List */}
          {loading ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-2xl text-gold-400 animate-pulse">Loading tokens...</div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-xl text-gold-400">{error}</div>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {paginatedTokens.map((token) => (
                  <div
                    key={token.tick}
                    className="bg-black/40 border border-gold-500/20 hover:bg-liquid-glass hover:border-gold-500/40 transition-all group"
                  >
                    {/* Desktop Grid Layout */}
                    <div className="hidden md:grid md:grid-cols-12 gap-4 items-center p-6">
                      {/* Token Info */}
                      <div className="md:col-span-2">
                        <Link href={`/token/${token.tick.toLowerCase()}`}>
                          <div className="flex items-center gap-3 cursor-pointer">
                            <div className="size-10 bg-gold-500 rounded-full flex items-center justify-center border-2 border-gold-400 group-hover:animate-glow">
                              <span className="text-base font-bold text-black">
                                {token.tick.substring(0, 2).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <div className="text-xl font-bold text-gold-300 uppercase">
                                {token.tick}
                              </div>
                              {token.isMinted && (
                                <div className="text-xs text-green-400">✓ Complete</div>
                              )}
                            </div>
                          </div>
                        </Link>
                      </div>

                      {/* Supply Info */}
                      <div className="md:col-span-2">
                        <div className="text-gold-200/60 text-xs uppercase tracking-wider mb-1">
                          Supply
                        </div>
                        <div className="text-base font-bold text-gold-400">
                          {formatNumber(token.supply)}
                        </div>
                        <div className="text-xs text-gold-300/60">
                          Limit: {formatNumber(token.limit)}
                        </div>
                      </div>

                      {/* Mint Progress */}
                      <div className="md:col-span-3">
                        <div className="text-gold-200/60 text-xs uppercase tracking-wider mb-1">
                          Minted
                        </div>
                        <div className="text-base font-bold text-gold-400">
                          {getMintProgress(token)}%
                        </div>
                        <div className="w-full bg-gold-900/30 rounded-full h-2 border border-gold-700/50 mt-1">
                          <div
                            className="bg-gold-500 h-full rounded-full transition-all"
                            style={{ width: `${getMintProgress(token)}%` }}
                          />
                        </div>
                      </div>

                      {/* Holders */}
                      <div className="md:col-span-2">
                        <div className="text-gold-200/60 text-xs uppercase tracking-wider mb-1">
                          Holders
                        </div>
                        <div className="text-base font-bold text-gold-400">
                          {formatNumber(token.holders)}
                        </div>
                      </div>

                      {/* Deploy Block */}
                      <div className="md:col-span-2">
                        <div className="text-gold-200/60 text-xs uppercase tracking-wider mb-1">
                          Block
                        </div>
                        <div className="text-xs font-bold text-gold-400">
                          {formatNumber(token.block)}
                        </div>
                      </div>

                      {/* Mint Button */}
                      <div className="md:col-span-1 flex items-center justify-end">
                        {token.isMinted ? (
                          <button
                            disabled
                            className="px-8 py-2.5 bg-gray-700 text-gray-500 font-bold cursor-not-allowed opacity-50 whitespace-nowrap text-sm"
                          >
                            MINT
                          </button>
                        ) : (
                          <Link
                            href={`/inscribe?tab=zrc20&op=mint&tick=${token.tick.toLowerCase()}&amount=${token.limit}`}
                            className="px-8 py-2.5 bg-gold-500 text-black text-center font-bold hover:bg-gold-400 transition-all whitespace-nowrap text-sm"
                          >
                            MINT
                          </Link>
                        )}
                      </div>
                    </div>

                    {/* Mobile Card Layout */}
                    <div className="md:hidden">
                      {/* Card Header with Token Info */}
                      <div className="p-4">
                        <div className="flex items-start justify-between mb-4">
                          <Link href={`/token/${token.tick.toLowerCase()}`}>
                            <div className="flex items-center gap-3 cursor-pointer">
                              <div className="size-12 bg-gold-500 rounded-full flex items-center justify-center border-2 border-gold-400">
                                <span className="text-lg font-bold text-black">
                                  {token.tick.substring(0, 2).toUpperCase()}
                                </span>
                              </div>
                              <div>
                                <div className="text-xl font-bold text-gold-300 uppercase">
                                  {token.tick}
                                </div>
                                {token.isMinted && (
                                  <div className="text-xs text-green-400">✓ Complete</div>
                                )}
                              </div>
                            </div>
                          </Link>
                          {token.isMinted ? (
                            <button
                              disabled
                              className="px-6 py-2 bg-gray-700 text-gray-500 font-bold cursor-not-allowed opacity-50 whitespace-nowrap text-sm"
                            >
                              MINT
                            </button>
                          ) : (
                            <Link
                              href={`/inscribe?tab=zrc20&op=mint&tick=${token.tick.toLowerCase()}&amount=${token.limit}`}
                              className="px-6 py-2 bg-gold-500 text-black text-center font-bold hover:bg-gold-400 transition-all whitespace-nowrap text-sm"
                            >
                              MINT
                            </Link>
                          )}
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <div className="text-gold-200/60 text-xs uppercase tracking-wider mb-1">
                              Supply
                            </div>
                            <div className="text-sm font-bold text-gold-400">
                              {formatNumber(token.supply)}
                            </div>
                            <div className="text-xs text-gold-300/60">
                              {formatNumber(token.limit)}
                            </div>
                          </div>
                          <div>
                            <div className="text-gold-200/60 text-xs uppercase tracking-wider mb-1">
                              Holders
                            </div>
                            <div className="text-sm font-bold text-gold-400">
                              {formatNumber(token.holders)}
                            </div>
                          </div>
                          <div>
                            <div className="text-gold-200/60 text-xs uppercase tracking-wider mb-1">
                              Block
                            </div>
                            <div className="text-sm font-bold text-gold-400">
                              {formatNumber(token.block)}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Minted Section - Bottom with separator */}
                      <div className="border-t border-gold-500/20 p-4 shadow-[0_-2px_8px_rgba(0,0,0,0.3)]">
                        <div className="text-gold-200/60 text-xs uppercase tracking-wider mb-2">
                          Minted
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-gold-900/30 rounded-full h-2 border border-gold-700/50">
                            <div
                              className="bg-gold-500 h-full rounded-full transition-all"
                              style={{ width: `${getMintProgress(token)}%` }}
                            />
                          </div>
                          <div className="text-sm font-bold text-gold-400 min-w-[3rem] text-right">
                            {getMintProgress(token)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

              {paginatedTokens.length === 0 && !loading && (
                <div className="text-center py-12 text-gold-300/60">
                  No tokens found matching &quot;{searchQuery}&quot;
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-8">
                <div className="text-center text-gold-300/60 text-sm mb-4">
                  Showing {startIndex + 1}-{Math.min(startIndex + tokensPerPage, filteredTokens.length)} of {filteredTokens.length} tokens
                </div>
                <div className="flex justify-center items-center gap-4">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-6 py-3 bg-black/40 border border-gold-500/20 text-gold-400 font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gold-500/10 transition-all"
                >
                  ← PREV
                </button>

                <div className="flex gap-2">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`px-4 py-3 font-bold transition-all ${
                          currentPage === pageNum
                            ? 'bg-gold-500 text-black'
                            : 'bg-black/40 border border-gold-500/20 text-gold-400 hover:bg-gold-500/10'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-6 py-3 bg-black/40 border border-gold-500/20 text-gold-400 font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gold-500/10 transition-all"
                >
                  NEXT →
                </button>
              </div>
            </div>
            )}
          </>
          )}
        </div>
      </div>
    </main>
  );
}
