'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Dither from '@/components/Dither';

export default function MinePage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <main className="relative min-h-screen text-gold-100 pt-20">
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
      <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-5rem)]">
        <div className="container mx-auto px-6 text-center">
          <div className="max-w-3xl mx-auto space-y-8">
            {/* Title */}
            <h1 className="text-7xl md:text-9xl font-bold text-gold-400 animate-pulse">
              COMING SOON
            </h1>

            {/* Subtitle */}
            <p className="text-2xl md:text-3xl text-gold-300">
              MINE ZORE TOKENS
            </p>

            {/* Description */}
            <div className="p-8 bg-black/40 border border-gold-500/30 rounded-lg">
              <p className="text-xl text-gold-200/80 mb-4">
                Inscribe ZMAPs and mine ZORE tokens on the Zcash blockchain.
              </p>
              <p className="text-lg text-gold-200/60">
                Each ZMAP inscription earns you <span className="text-gold-400 font-bold">10,000 ZORE</span> tokens.
              </p>
            </div>

            {/* CTA */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-8">
              <Link
                href="/zmaps"
                className="px-8 py-4 bg-gold-500 text-black text-lg font-bold rounded hover:bg-gold-400 transition-all"
              >
                EXPLORE ZMAPS
              </Link>
              <Link
                href="/"
                className="px-8 py-4 bg-gold-500/10 text-gold-400 text-lg font-bold rounded border border-gold-500/30 hover:bg-gold-500/20 transition-all"
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
