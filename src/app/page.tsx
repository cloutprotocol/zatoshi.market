'use client';

import { useEffect, useState } from 'react';

export default function BRBPage() {
  const [blockHeight, setBlockHeight] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });

  useEffect(() => {
    // Hide header/nav globally
    const nav = document.querySelector('nav');
    if (nav) {
      (nav as HTMLElement).style.display = 'none';
    }

    // Fetch Zcash block height
    async function fetchBlockHeight() {
      try {
        // Use Blockchair API (same as the rest of the app)
        const response = await fetch('https://api.blockchair.com/zcash/stats');
        const data = await response.json();
        setBlockHeight(data.data.best_block_height);
      } catch (error) {
        console.error('Failed to fetch block height:', error);
        // Fallback estimation
        const estimatedBlock = 3138817 + Math.floor((Date.now() - 1731906683000) / 150000);
        setBlockHeight(estimatedBlock);
      }
    }
    fetchBlockHeight();
    const blockInterval = setInterval(fetchBlockHeight, 30000); // Every 30 seconds

    // Update countdown timer
    function updateCountdown() {
      // Target date: NOV 18 2025 12:00PM PST
      const targetDate = new Date('2025-11-18T20:00:00Z'); // 12PM PST = 8PM UTC
      const now = new Date();
      const diff = targetDate.getTime() - now.getTime();

      if (diff > 0) {
        setTimeRemaining({
          days: Math.floor(diff / (1000 * 60 * 60 * 24)),
          hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
          minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
          seconds: Math.floor((diff % (1000 * 60)) / 1000),
        });
      } else {
        setTimeRemaining({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      }
    }
    updateCountdown();
    const countdownInterval = setInterval(updateCountdown, 1000);

    return () => {
      clearInterval(blockInterval);
      clearInterval(countdownInterval);
      // Restore nav on cleanup
      if (nav) {
        (nav as HTMLElement).style.display = '';
      }
    };
  }, []);

  return (
    <main className="relative min-h-screen w-full overflow-hidden">
      {/* Full Screen Video Background */}
      <div className="fixed inset-0 w-full h-full -z-10">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-40"
        >
          <source src="/zordi.mp4" type="video/mp4" />
        </video>

        {/* Gold Grid Overlay */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255, 200, 55, 0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255, 200, 55, 0.3) 1px, transparent 1px)
            `,
            backgroundSize: '100px 100px',
          }}
        />

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/80" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex items-center justify-center min-h-screen px-6">
        <div className="max-w-4xl w-full">
          {/* Main Glass Container */}
          <div className="relative overflow-hidden rounded-none border border-gold-500/30 bg-black/60 backdrop-blur-xl p-12 md:p-16">
            {/* Liquid Glass Effect */}
            <div className="absolute inset-0 bg-liquid-glass opacity-30" />

            {/* Content */}
            <div className="relative z-10">
              {/* Logo/Brand */}
              <div className="text-center mb-12">
                <h1 className="text-5xl md:text-7xl font-bold text-gold-300 mb-4 tracking-wider">
                  ZATOSHI.MARKET
                </h1>
              </div>

              {/* Zcash Block Height */}
              <div className="text-center mb-12 p-6 bg-black/40 border border-gold-500/20 rounded-none">
                <div className="text-gold-200/60 text-sm uppercase tracking-widest mb-2">
                  Current Zcash Block
                </div>
                <div className="text-4xl md:text-5xl font-bold text-gold-400 font-mono">
                  {blockHeight !== null ? blockHeight.toLocaleString() : 'Loading...'}
                </div>
              </div>

              {/* Countdown Timer */}
              <div className="text-center">
                <div className="text-gold-200/60 text-sm uppercase tracking-widest mb-6">
                  Launching In
                </div>
                <div className="grid grid-cols-4 gap-4 md:gap-8">
                  {/* Days */}
                  <div className="bg-black/60 border border-gold-500/30 p-6 rounded-none backdrop-blur-sm">
                    <div className="text-4xl md:text-6xl font-bold text-gold-400 font-mono mb-2">
                      {String(timeRemaining.days).padStart(2, '0')}
                    </div>
                    <div className="text-gold-200/60 text-xs md:text-sm uppercase tracking-wider">
                      Days
                    </div>
                  </div>

                  {/* Hours */}
                  <div className="bg-black/60 border border-gold-500/30 p-6 rounded-none backdrop-blur-sm">
                    <div className="text-4xl md:text-6xl font-bold text-gold-400 font-mono mb-2">
                      {String(timeRemaining.hours).padStart(2, '0')}
                    </div>
                    <div className="text-gold-200/60 text-xs md:text-sm uppercase tracking-wider">
                      Hours
                    </div>
                  </div>

                  {/* Minutes */}
                  <div className="bg-black/60 border border-gold-500/30 p-6 rounded-none backdrop-blur-sm">
                    <div className="text-4xl md:text-6xl font-bold text-gold-400 font-mono mb-2">
                      {String(timeRemaining.minutes).padStart(2, '0')}
                    </div>
                    <div className="text-gold-200/60 text-xs md:text-sm uppercase tracking-wider">
                      Minutes
                    </div>
                  </div>

                  {/* Seconds */}
                  <div className="bg-black/60 border border-gold-500/30 p-6 rounded-none backdrop-blur-sm">
                    <div className="text-4xl md:text-6xl font-bold text-gold-400 font-mono mb-2">
                      {String(timeRemaining.seconds).padStart(2, '0')}
                    </div>
                    <div className="text-gold-200/60 text-xs md:text-sm uppercase tracking-wider">
                      Seconds
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Bottom Accent */}
          <div className="mt-8 text-center">
            <div className="inline-flex items-center gap-2 text-gold-300/40 text-xs uppercase tracking-widest">
              <div className="w-8 h-px bg-gold-500/40" />
              <span>Preparing Something Special</span>
              <div className="w-8 h-px bg-gold-500/40" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
