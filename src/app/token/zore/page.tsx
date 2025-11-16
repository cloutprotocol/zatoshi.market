'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { zerdinalsAPI, type ZerdinalsToken } from '@/services/zerdinals';

const Dither = dynamic(() => import('@/components/Dither'), {
  ssr: false,
});

export default function ZORETokenPage() {
  const [tokenData, setTokenData] = useState<ZerdinalsToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTokenData() {
      try {
        setLoading(true);
        const data = await zerdinalsAPI.getZOREToken();
        setTokenData(data);
      } catch (err) {
        setError('Failed to load token data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchTokenData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchTokenData, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatNumber = (num: number | string | undefined) => {
    if (!num) return '0';
    return Number(num).toLocaleString();
  };

  const formatPrice = (price: number | undefined) => {
    if (!price) return '$0.00';
    return `$${price.toFixed(4)}`;
  };

  return (
    <main className="relative min-h-screen bg-black text-gold-100">
      {/* Dither Background */}
      <div className="fixed inset-0 w-full h-full opacity-20">
        <Dither
          waveColor={[0.8, 0.6, 0.2]}
          disableAnimation={false}
          enableMouseInteraction={true}
          mouseRadius={0.3}
          colorNum={4}
          waveAmplitude={0.3}
          waveFrequency={3}
          waveSpeed={0.05}
        />
      </div>

      {/* Content */}
      <div className="relative z-10">
        {/* Navigation */}
        <nav className="px-6 py-8 flex justify-between items-center bg-black/90">
          <Link href="/" className="text-2xl font-bold tracking-tight text-gold-400 animate-glow hover:text-gold-300 transition-colors">
            ZATOSHI.MARKET
          </Link>
          <div className="flex gap-4">
            <Link
              href="/zmaps"
              className="px-6 py-2 text-gold-400 hover:text-gold-300 transition-all"
            >
              ZMAPS
            </Link>
          </div>
        </nav>

        <div className="container mx-auto px-6 py-12 max-w-6xl">
          {loading ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-3xl text-gold-400 animate-pulse">Loading ZORE data...</div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-2xl text-red-400">{error}</div>
            </div>
          ) : tokenData ? (
            <>
              {/* Token Header */}
              <div className="mb-12">
                <div className="flex items-center gap-4 mb-4">
                  <div className="size-16 bg-gold-500 rounded-full flex items-center justify-center border-2 border-gold-400 animate-glow">
                    <span className="text-2xl font-bold text-black">{tokenData.tick}</span>
                  </div>
                  <div>
                    <h1 className="text-5xl font-bold text-gold-400 mb-2 animate-glow">
                      {tokenData.name || tokenData.tick}
                    </h1>
                    <p className="text-xl text-gold-300/80">{tokenData.description}</p>
                  </div>
                </div>
              </div>

              {/* Price Stats */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                {/* Price */}
                <div className="p-6 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity animate-glow"></div>
                  <div className="relative">
                    <div className="text-gold-300/60 text-sm mb-2">PRICE</div>
                    <div className="text-3xl font-bold text-gold-400">
                      {formatPrice(tokenData.price)}
                    </div>
                    {tokenData.priceChange24h !== undefined && (
                      <div
                        className={`text-sm mt-1 ${
                          tokenData.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {tokenData.priceChange24h >= 0 ? '↑' : '↓'}{' '}
                        {Math.abs(tokenData.priceChange24h).toFixed(2)}%
                      </div>
                    )}
                  </div>
                </div>

                {/* Market Cap */}
                <div className="p-6 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity animate-glow"></div>
                  <div className="relative">
                    <div className="text-gold-300/60 text-sm mb-2">MARKET CAP</div>
                    <div className="text-3xl font-bold text-gold-400">
                      ${formatNumber(tokenData.marketCap)}
                    </div>
                  </div>
                </div>

                {/* Volume 24h */}
                <div className="p-6 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity animate-glow"></div>
                  <div className="relative">
                    <div className="text-gold-300/60 text-sm mb-2">VOLUME 24H</div>
                    <div className="text-3xl font-bold text-gold-400">
                      ${formatNumber(tokenData.volume24h)}
                    </div>
                  </div>
                </div>

                {/* Holders */}
                <div className="p-6 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity animate-glow"></div>
                  <div className="relative">
                    <div className="text-gold-300/60 text-sm mb-2">HOLDERS</div>
                    <div className="text-3xl font-bold text-gold-400">
                      {formatNumber(tokenData.holders)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Supply Info */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
                {/* Minting Progress */}
                <div className="p-8 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity animate-glow"></div>
                  <div className="relative">
                    <h3 className="text-2xl font-bold text-gold-400 mb-6">Minting Progress</h3>
                    <div className="mb-4">
                      <div className="flex justify-between text-lg mb-2">
                        <span className="text-gold-300">Minted</span>
                        <span className="text-gold-400 font-bold">
                          {formatNumber(tokenData.minted)} / {formatNumber(tokenData.supply)}
                        </span>
                      </div>
                      <div className="w-full bg-gold-900/30 rounded-full h-4 border border-gold-700">
                        <div
                          className="bg-gold-500 h-full rounded-full transition-all animate-glow"
                          style={{ width: `${tokenData.progress || 0}%` }}
                        ></div>
                      </div>
                      <div className="text-right mt-2 text-gold-300">
                        {tokenData.progress?.toFixed(1)}% Complete
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mt-6">
                      <div>
                        <div className="text-gold-300/60 text-sm">Mint Limit</div>
                        <div className="text-xl text-gold-400 font-bold">
                          {formatNumber(tokenData.limit)}
                        </div>
                      </div>
                      <div>
                        <div className="text-gold-300/60 text-sm">Decimals</div>
                        <div className="text-xl text-gold-400 font-bold">{tokenData.decimals}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Token Stats */}
                <div className="p-8 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity animate-glow"></div>
                  <div className="relative">
                    <h3 className="text-2xl font-bold text-gold-400 mb-6">Token Information</h3>
                    <div className="space-y-4">
                      <div className="flex justify-between py-3 border-b border-gold-700/30">
                        <span className="text-gold-300">Total Supply</span>
                        <span className="text-gold-400 font-bold">
                          {formatNumber(tokenData.supply)}
                        </span>
                      </div>
                      <div className="flex justify-between py-3 border-b border-gold-700/30">
                        <span className="text-gold-300">Transactions</span>
                        <span className="text-gold-400 font-bold">
                          {formatNumber(tokenData.transactions)}
                        </span>
                      </div>
                      <div className="flex justify-between py-3 border-b border-gold-700/30">
                        <span className="text-gold-300">Deploy Block</span>
                        <span className="text-gold-400 font-bold">
                          {formatNumber(tokenData.deployBlock)}
                        </span>
                      </div>
                      <div className="flex justify-between py-3">
                        <span className="text-gold-300">Deploy Time</span>
                        <span className="text-gold-400 font-bold">
                          {tokenData.deployTime
                            ? new Date(tokenData.deployTime).toLocaleDateString()
                            : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ZMAPS Mining Info */}
              <div className="p-8 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity animate-glow"></div>
                <div className="relative">
                  <h3 className="text-3xl font-bold text-gold-400 mb-4 animate-glow">
                    Mine ZORE on ZMAPS
                  </h3>
                  <p className="text-xl text-gold-300 mb-6">
                    Claim your block on ZMAPS and mine ZORE tokens. Each block costs{' '}
                    {formatPrice(tokenData.price)} and represents a piece of Zcash blockchain
                    history.
                  </p>
                  <Link
                    href="/zmaps"
                    className="inline-block px-8 py-4 bg-gold-500 text-black text-xl font-bold rounded-md hover:bg-liquid-glass hover:text-gold-900 transition-all animate-glow"
                  >
                    EXPLORE ZMAPS →
                  </Link>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
