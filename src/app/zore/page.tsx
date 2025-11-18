'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

// Client-only Dither to avoid SSR/hydration mismatch
const Dither = dynamic(() => import('@/components/Dither'), { ssr: false, loading: () => null });

export default function ZorePage() {
  const [blockHeight, setBlockHeight] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(60);

  // Fetch block height
  useEffect(() => {
    let cancelled = false;

    async function fetchBlockHeight() {
      try {
        const response = await fetch('https://api.blockchair.com/zcash/stats');
        const data = await response.json();
        if (!cancelled) {
          setBlockHeight(data.data.best_block_height);
          setCountdown(60);
        }
      } catch (error) {
        console.error('Failed to fetch block height:', error);
      }
    }

    fetchBlockHeight();
    const interval = setInterval(fetchBlockHeight, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 60));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

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

      {/* Subtle Grid Background */}
      <div className="fixed inset-0 -z-5" style={{
        backgroundImage: `
          linear-gradient(to right, rgba(212, 175, 55, 0.05) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(212, 175, 55, 0.05) 1px, transparent 1px)
        `,
        backgroundSize: '40px 40px'
      }}></div>

      {/* Content */}
      <div className="relative z-10 flex items-center justify-center">
        <div className="container mx-auto px-4 sm:px-6 py-12 md:py-16 text-center max-w-4xl">

          {/* Block Height Display */}
          <div className="inline-block mb-6 px-4 py-2 bg-black/30 backdrop-blur-sm border border-gold-500/20 text-xs text-gold-400/80 font-mono">
            {blockHeight ? (
              <>
                Current Block {blockHeight.toLocaleString()} <span className="text-gold-500/50 ml-2">·</span> <span className="text-gold-500/60">{countdown}s</span>
              </>
            ) : (
              <span className="inline-block w-48 h-3 bg-gold-500/10 animate-pulse rounded"></span>
            )}
          </div>

          {/* Coming Soon */}
          <h1 className="text-5xl md:text-7xl font-bold text-gold-400 mb-4">
            COMING SOON
          </h1>

          {/* Title with holographic effect */}
          <div className="relative mb-8">
            <style dangerouslySetInnerHTML={{__html: `
              @keyframes holographic {
                0% {
                  background-position: 0% 50%;
                }
                50% {
                  background-position: 100% 50%;
                }
                100% {
                  background-position: 0% 50%;
                }
              }
              .holographic-bg {
                background: linear-gradient(
                  45deg,
                  #ffffff,
                  #fffef0,
                  #ffd95b,
                  #ffffff,
                  #fffef0,
                  #ffeb3b,
                  #ffffff,
                  #fffef0,
                  #ffc837,
                  #ffffff
                );
                background-size: 400% 400%;
                animation: holographic 8s ease infinite;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
              }
            `}} />
            <h2 className="holographic-bg text-3xl md:text-4xl font-bold mb-0 leading-tight">
              MINE $ZORE
            </h2>
          </div>

          {/* Graphic Illustration */}
          <div className="p-6 md:p-8 bg-black/20 backdrop-blur-sm mb-8">
            <div className="flex items-center justify-center gap-4 md:gap-6 mb-5 flex-wrap">
              {/* Step 1: ZMAP */}
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 md:w-24 md:h-24 bg-black/40 border border-gold-500/30 flex items-center justify-center mb-2">
                  <span className="text-xl md:text-2xl font-bold text-gold-400">ZMAP</span>
                </div>
                <span className="text-xs text-gold-300/70 font-bold tracking-wide">INSCRIBE ZMAP</span>
              </div>

              {/* Arrow */}
              <div className="text-3xl md:text-4xl text-gold-500/50">→</div>

              {/* Step 2: Reward */}
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 md:w-24 md:h-24 bg-black/40 border border-gold-500/30 flex items-center justify-center mb-2">
                  <div className="w-12 h-12 md:w-16 md:h-16 bg-gradient-to-br from-gold-500 to-gold-600 border border-gold-400 rounded-full flex items-center justify-center">
                    <span className="text-2xl md:text-3xl font-bold text-black">Z</span>
                  </div>
                </div>
                <span className="text-xs text-gold-300/70 font-bold tracking-wide">MINE TOKENS</span>
              </div>
            </div>

            <div className="max-w-md mx-auto">
              <p className="text-gold-300/60 text-sm leading-relaxed">
                Once ZMAPs are inscribed, the owner can mine ZORE tokens on that plot of land. The more ZMAPs you own, the more ZORE tokens you can mine at once.
              </p>
            </div>
          </div>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/zmaps"
              className="px-8 py-3 bg-gold-500 text-black font-bold hover:bg-gold-400 transition-colors rounded"
            >
              EXPLORE ZMAPS
            </Link>
            <Link
              href="/"
              className="px-8 py-3 bg-gold-500/20 text-gold-400 font-bold border border-gold-500/30 hover:bg-gold-500/30 transition-colors rounded"
            >
              BACK TO HOME
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
