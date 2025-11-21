'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
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
      <div className="relative z-10 container mx-auto px-4 sm:px-6 max-w-7xl">
        {/* Hero Section */}
        <section className="py-16 md:py-20">
          <div className="max-w-4xl">
            <h1 className="text-6xl md:text-8xl font-bold mb-8 leading-none text-gold-300">
              INSCRIPTION
              <br />
              MARKETPLACE
              <br />
              ON <span className="text-gold-400">ZCASH</span>
            </h1>
            <p className="text-xl md:text-2xl mb-12 max-w-2xl text-gold-100/80">
             DEPLOY and MINT ZRC20 tokens | ZMAPS | .ZEC .ZCASH Names | Now Inscribing on Zcash
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/inscribe"
                className="px-8 py-4 bg-gold-500 text-black text-lg font-bold text-center"
              >
                INSCRIBE
              </Link>
              <Link
                href="/claim/zgods"
                className="px-8 py-4 bg-gold-500/20 text-gold-400 border border-gold-500/40 text-lg font-bold text-center"
              >
                CLAIM ZGODS
              </Link>
            </div>
          </div>
        </section>

        {/* Claim CTA */}
        <section className="py-16">
          <Link
            href="/claim/zgods"
            className="block p-8 md:p-12 bg-black/60 border border-gold-500/20 hover:border-gold-400/60 transition-all relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-liquid-glass opacity-40" />
            <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
              <div className="shrink-0 w-full md:w-48">
                <div className="relative aspect-square w-full overflow-hidden border border-gold-500/30 bg-black/40">
                  <Image src="/collections/zgods/3vUZmMCg.gif" alt="ZGODS" fill className="object-cover" sizes="192px" priority />
                </div>
              </div>

              <div className="flex-1 space-y-3 text-center md:text-left">
                <p className="text-sm tracking-[0.2em] text-gold-300/70">CLAIM IS LIVE</p>
                <h3 className="text-3xl md:text-4xl font-bold text-gold-300">Claim ZGODS</h3>
                <p className="text-gold-100/80 text-base md:text-lg">
                  Claim your allocated ZGODS using the same wallet you used in the pre-sale!
                </p>
              </div>

              <div className="w-full md:w-auto">
                <div className="inline-flex items-center justify-center px-8 py-4 bg-gold-500 text-black text-lg font-bold text-center">
                  CLAIM NOW
                </div>
              </div>
            </div>
          </Link>
        </section>

        {/* Features Grid */}
        <section className="py-16">
          <div className="grid md:grid-cols-3 gap-6 md:gap-8">
            <div className="p-6 md:p-8 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
              <h3 className="text-2xl font-bold mb-4 text-gold-400">ZRC20 TOKENS</h3>
              <p className="text-gold-100/80">
                Deploy, mint & trade ZRC20 tokens, the fungible token standard on Zcash.
              </p>
            </div>

            <div className="p-6 md:p-8 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
              <h3 className="text-2xl font-bold mb-4 text-gold-400">MARKETPLACE</h3>
              <p className="text-gold-100/80">
                Trade Zcash inscriptions and discover new drops.
              </p>
            </div>

            <div className="p-6 md:p-8 bg-black/40 relative overflow-hidden group hover:bg-liquid-glass transition-all">
              <h3 className="text-2xl font-bold mb-4 text-gold-400">INSCRIPTIONS</h3>
              <p className="text-gold-100/80">
                Digital art inscriptions on Zcash. Launchpad and trading coming soon.
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-12 mt-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="text-2xl text-gold-400">zatoshi.market</div>
            <div className="flex gap-4 md:gap-6 text-sm md:text-base text-gold-300/80">
              <Link href="/inscribe" className="hover:text-gold-400 transition-all">
                INSCRIBE
              </Link>
              <Link href="/tokens" className="hover:text-gold-400 transition-all">
                ZRC20
              </Link>
              <a href="https://mempool.zatoshi.market" target="_blank" rel="noopener noreferrer" className="hover:text-gold-400 transition-all">
                MEMPOOL
              </a>
              <a href="https://twitter.com/zatoshimarket" target="_blank" rel="noopener noreferrer" className="hover:text-gold-400 transition-all">
                TWITTER
              </a>
              <span className="hidden md:inline text-gold-200/70">|</span>
              <div className="flex items-center gap-2 text-gold-200/80 text-xs md:text-sm">
                <span>LIVE ZCASH BLOCKS</span>
                <span className="text-gold-400 font-mono">{loading ? '...' : blockHeight.toLocaleString()}</span>
              </div>
            </div>
          </div>
          <div className="text-center mt-8 text-gold-200/60 text-sm">
            © zatoshi
          </div>
        </footer>
      </div>
    </main>
  );
}
