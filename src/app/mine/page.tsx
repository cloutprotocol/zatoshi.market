'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

// Client-only Dither to avoid SSR/hydration mismatch
const Dither = dynamic(() => import('@/components/Dither'), { ssr: false, loading: () => null });

export default function MinePage() {
  const [mounted, setMounted] = useState(true);

  return (
    <main className="relative min-h-screen text-gold-100">
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

      {/* Full Screen Glass Overlay */}
      <div className="absolute inset-0 z-10">
        {/* Multi-layer glass effect */}
        <div className="absolute inset-0 backdrop-blur-2xl bg-black/70"></div>
        <div className="absolute inset-0 bg-liquid-glass opacity-40"></div>
        <div className="absolute inset-0 bg-gradient-to-br from-black/50 via-transparent to-black/50"></div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex items-center justify-center min-h-screen pt-20">
        <div className="container mx-auto px-6 py-12 md:py-16 text-center">
          <div className="max-w-4xl mx-auto">

            {/* Coming Soon */}
            <h1 className="text-6xl md:text-8xl font-bold text-gold-400 mb-6">
              COMING SOON
            </h1>

            {/* Title with holographic effect */}
            <div className="relative mb-10">
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
              <h2 className="holographic-bg text-4xl md:text-5xl font-bold mb-0 leading-tight">
                MINE $ZORE
              </h2>
            </div>

              {/* Graphic Illustration */}
              <div className="p-8 md:p-10 backdrop-blur-xl bg-black/40 border border-gold-700/30 relative overflow-hidden mb-10">
                <div className="absolute inset-0 bg-liquid-glass opacity-20"></div>

                <div className="relative flex items-center justify-center gap-6 md:gap-8 mb-6 flex-wrap">
                  {/* Step 1: ZMAP */}
                  <div className="flex flex-col items-center">
                    <div className="w-24 h-24 bg-gradient-to-br from-gold-500/20 to-gold-700/20 border-2 border-gold-500/50 flex items-center justify-center mb-3 relative overflow-hidden backdrop-blur-sm">
                      <div className="absolute inset-0 bg-liquid-glass opacity-20"></div>
                      <span className="relative text-2xl font-bold text-gold-400">ZMAP</span>
                    </div>
                    <span className="text-xs text-gold-300/80 font-bold tracking-wide">INSCRIBE ZMAP</span>
                  </div>

                  {/* Arrow */}
                  <div className="text-4xl text-gold-500/60">→</div>

                  {/* Step 2: Reward */}
                  <div className="flex flex-col items-center">
                    <div className="w-24 h-24 bg-gradient-to-br from-gold-500/20 to-gold-700/20 border-2 border-gold-500/50 flex items-center justify-center mb-3 relative overflow-hidden backdrop-blur-sm">
                      <div className="absolute inset-0 bg-liquid-glass opacity-20"></div>
                      <div className="relative w-16 h-16 bg-gradient-to-br from-gold-500 to-gold-600 border-2 border-gold-400 rounded-full flex items-center justify-center shadow-sm shadow-gold-500/50">
                        <span className="text-3xl font-bold text-black">Z</span>
                      </div>
                    </div>
                    <span className="text-xs text-gold-300/80 font-bold tracking-wide">MINE TOKENS</span>
                  </div>
                </div>

                <div className="relative max-w-md mx-auto">
                  <p className="text-gold-300/70 text-sm leading-relaxed">
                    Once ZMAPs are inscribed, the owner can mine ZORE tokens on that plot of land, the more ZMAPs you own, the more ZORE tokens you can mine at once.
                  </p>
                </div>
              </div>

            {/* CTA */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/zmaps"
                className="px-8 py-4 bg-gold-500 text-black text-lg font-bold hover:bg-gold-400 transition-all"
              >
                EXPLORE ZMAPS
              </Link>
              <Link
                href="/"
                className="px-8 py-4 backdrop-blur-sm bg-gold-500/5 text-gold-400 text-lg font-bold border border-gold-500/30 hover:bg-gold-500/10 transition-all"
              >
                BACK TO HOME
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
