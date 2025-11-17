'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Dither from '@/components/Dither';
import { zcashRPC } from '@/services/zcash';

export default function Home() {
  const [blockHeight, setBlockHeight] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
        {mounted && (
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
        )}
      </div>

      {/* Content */}
      <div className="relative z-10">
        {/* Hero Section */}
        <div className="container mx-auto px-6 py-24 md:py-32">
          <div className="max-w-4xl">
            <h1 className="text-6xl md:text-8xl font-bold mb-8 leading-none text-gold-300">
              ZORDINALS
              <br />
              MARKETPLACE
              <br />
              ON <span className="text-gold-400">ZCASH</span>
            </h1>
            <p className="text-xl md:text-2xl mb-12 max-w-2xl text-gold-100/80">
              Host and trade ZRC20 tokens, ZMAPS, and Zerdinal inscriptions on Zcash.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/zmaps"
                className="px-8 py-4 bg-gold-500 text-black text-lg font-bold text-center"
              >
                EXPLORE ZMAPS
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
                Host and trade ZRC20 tokens on Zcash. ZORE token mining through ZMAPS inscriptions.
              </p>
            </div>

            <div className="p-8 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
              <h3 className="text-2xl font-bold mb-4 text-gold-400">ZMAPS</h3>
              <p className="text-gold-100/80">
                Each ZMAP represents 100 Zcash blocks. Inscribe ZMAPs for 0.0015 ZEC and receive 10,000 ZORE tokens.
              </p>
            </div>

            <div className="p-8 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
              <h3 className="text-2xl font-bold mb-4 text-gold-400">ZERDINAL INSCRIPTIONS</h3>
              <p className="text-gold-100/80">
                Browse and trade Zerdinal inscriptions. Digital artifacts permanently inscribed on Zcash blockchain.
              </p>
            </div>
          </div>
        </div>

        {/* Stats Section - Live Data */}
        <div className="container mx-auto px-6 py-24">
          <div className="p-12 bg-black/40 relative overflow-hidden">
            <div className="absolute inset-0 bg-liquid-glass opacity-30"></div>
            <div className="grid md:grid-cols-4 gap-8 text-center relative z-10">
              <div>
                <div className="text-5xl font-bold mb-2 text-gold-400">
                  {loading ? '...' : blockHeight.toLocaleString()}
                </div>
                <div className="text-gold-200/80 text-sm">ZCASH BLOCKS</div>
              </div>
              <div>
                <div className="text-5xl font-bold mb-2 text-gold-400">
                  {loading ? '...' : totalZmaps.toLocaleString()}
                </div>
                <div className="text-gold-200/80 text-sm">TOTAL ZMAPS</div>
              </div>
              <div>
                <div className="text-5xl font-bold mb-2 text-gold-400">150</div>
                <div className="text-gold-200/80 text-sm">INSCRIBED ZMAPS</div>
              </div>
              <div>
                <div className="text-5xl font-bold mb-2 text-gold-400">10K</div>
                <div className="text-gold-200/80 text-sm">ZORE PER ZMAP</div>
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
            ZRC20 tokens, ZMAPS, and Zerdinal inscriptions on Zcash
          </div>
        </footer>
      </div>
    </main>
  );
}
