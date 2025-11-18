'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { zcashRPC } from '@/services/zcash';

// Load Dither only on the client to avoid SSR/hydration issues
const Dither = dynamic(() => import('@/components/Dither'), { ssr: false, loading: () => null });

export default function Home() {
  const [blockHeight, setBlockHeight] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const height = await zcashRPC.getBlockCount();
        setBlockHeight(height);
      } catch (error) {
        console.error('Failed to fetch block height:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    // Refresh every 2 minutes
    const interval = setInterval(fetchData, 120000);
    return () => clearInterval(interval);
  }, []);

  const totalZmaps = Math.ceil(blockHeight / 100);

  return (
    <main className="relative min-h-screen pt-20">
      {/* Dither Background */}
      <div className="fixed inset-0 w-full h-full -z-10">
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

      {/* Glass Overlay */}
      <div className="fixed inset-0 w-full h-full bg-liquid-glass opacity-20 -z-8"></div>

      {/* Subtle Dark Overlay */}
      <div className="fixed inset-0 w-full h-full bg-black/15 -z-5"></div>

      {/* Content */}
      <div className="relative z-10">
        {/* Hero Section */}
        <div className="container mx-auto px-6 py-24 md:py-20">
          <div className="max-w-4xl">
            <h1 className="text-6xl md:text-8xl font-bold mb-8 leading-none text-gold-300">
              INSCRIPTION
              <br />
              MARKETPLACE
              <br />
              ON <span className="text-gold-400">ZCASH</span>
            </h1>
            <p className="text-xl md:text-2xl mb-12 max-w-2xl text-gold-100/80">
             DEPLOY & MINT ZRC20 tokens, ZMAPS, .ZEC NAMES. Now Inscribing on Zcash.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/inscribe"
                className="px-8 py-4 bg-gold-500 text-black text-lg font-bold text-center"
              >
                INSCRIBE
              </Link>
              <a
                href="https://zerdinals.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-4 bg-gold-500/10 text-gold-400 text-lg font-bold text-center"
              >
                VIEW EXPLORER
              </a>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="container mx-auto px-6 py-24">
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-8 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
              <h3 className="text-2xl font-bold mb-4 text-gold-400">ZRC20 TOKENS</h3>
              <p className="text-gold-100/80">
                Deploy, mint & trade ZRC20 tokens, the fungible token standard of Zerdinals.
              </p>
            </div>

            <div className="p-8 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
              <h3 className="text-2xl font-bold mb-4 text-gold-400">ZMAPS</h3>
              <p className="text-gold-100/80">
                Each ZMAP represents 100 Zcash blocks and can be used to mine ZORE tokens.
              </p>
            </div>

            <div className="p-8 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
              <h3 className="text-2xl font-bold mb-4 text-gold-400">INSCRIPTIONS</h3>
              <p className="text-gold-100/80">
                Digital art inscriptions on Zcash coming soon.
              </p>
            </div>
          </div>
        </div>

        {/* Stats Section - Live Data */}
        <div className="container mx-auto px-6 py-24">
          <div className="p-8 md:p-12 bg-black/40 relative overflow-hidden">
            <div className="absolute inset-0 bg-liquid-glass opacity-60"></div>
            <div className="grid md:grid-cols-4 gap-6 md:gap-4 lg:gap-8 text-center relative z-10">
              <div>
                <div className="text-2xl md:text-3xl lg:text-5xl font-bold mb-2 text-gold-400">
                  {loading ? '...' : blockHeight.toLocaleString()}
                </div>
                <div className="text-gold-200/80 text-xs">ZCASH BLOCKS</div>
              </div>
              <div>
                <div className="text-2xl md:text-3xl lg:text-5xl font-bold mb-2 text-gold-400">
                  {loading ? '...' : totalZmaps.toLocaleString()}
                </div>
                <div className="text-gold-200/80 text-xs">TOTAL ZMAPS</div>
              </div>
              <div>
                <div className="text-2xl md:text-3xl lg:text-5xl font-bold mb-2 text-gold-400">...</div>
                <div className="text-gold-200/80 text-xs">INSCRIBED ZMAPS</div>
              </div>
              <div>
                <div className="text-2xl md:text-3xl lg:text-5xl font-bold mb-2 text-gold-400">0.002</div>
                <div className="text-gold-200/80 text-xs">ZEC PER ZMAP</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="container mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="text-2xl text-gold-400">zatoshi.market</div>
            <div className="flex gap-6 text-gold-300/80">
              <Link href="/wallet" className="hover:text-gold-400 transition-all">
                WALLET
              </Link>
              <a href="https://zerdinals.com/" target="_blank" rel="noopener noreferrer" className="hover:text-gold-400 transition-all">
                EXPLORER
              </a>
              <Link href="/zmaps" className="hover:text-gold-400 transition-all">
                ZMAPS
              </Link>
              <Link href="/token/zore" className="hover:text-gold-400 transition-all">
                ZORE
              </Link>
              <a href="https://twitter.com/zatoshimarket" target="_blank" rel="noopener noreferrer" className="hover:text-gold-400 transition-all">
                TWITTER
              </a>
            </div>
          </div>
          <div className="text-center mt-8 text-gold-200/60">
            ZRC20 tokens, ZMAPS, and inscriptions on Zcash
          </div>
        </footer>
      </div>
    </main>
  );
}
