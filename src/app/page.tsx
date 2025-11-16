'use client';

import dynamic from 'next/dynamic';

const Dither = dynamic(() => import('@/components/Dither'), {
  ssr: false,
});

export default function Home() {
  return (
    <main className="relative min-h-screen">
      {/* Dither Background */}
      <div className="fixed inset-0 w-full h-full">
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
        <nav className="px-6 py-8 flex justify-between items-center">
          <div className="text-2xl font-bold tracking-tight text-gold-400 animate-glow">
            ZATOSHI.MARKET
          </div>
          <div className="flex gap-6">
            <button className="px-6 py-2 border-2 border-gold-500 text-gold-400 hover:bg-gold-500 hover:text-black transition-all relative overflow-hidden group">
              <span className="relative z-10">EXPLORE</span>
              <div className="absolute inset-0 bg-liquid-glass opacity-0 group-hover:opacity-100 transition-opacity"></div>
            </button>
            <button className="px-6 py-2 bg-gold-500 text-black border-2 border-gold-500 hover:bg-liquid-glass transition-all relative overflow-hidden animate-glow">
              CONNECT
            </button>
          </div>
        </nav>

        {/* Hero Section */}
        <div className="container mx-auto px-6 py-24 md:py-32">
          <div className="max-w-4xl">
            <h1 className="text-6xl md:text-8xl font-bold mb-8 leading-none text-gold-300 drop-shadow-[0_0_20px_rgba(255,200,55,0.5)]">
              THE PREMIERE
              <br />
              MARKETPLACE
              <br />
              FOR <span className="text-gold-400 animate-glow">ZERDINALS</span>
            </h1>
            <p className="text-xl md:text-2xl mb-12 max-w-2xl opacity-90 text-gold-100">
              Discover, trade, and mint ZRC20 tokens on Zcash.
              Built with privacy and security at its core.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <button className="px-8 py-4 bg-gold-500 text-black text-lg font-semibold border-2 border-gold-500 hover:bg-liquid-glass transition-all relative overflow-hidden group animate-glow">
                <span className="relative z-10 font-bold">START EXPLORING</span>
              </button>
              <button className="px-8 py-4 border-2 border-gold-500 text-gold-400 text-lg font-semibold hover:bg-gold-500 hover:text-black transition-all relative overflow-hidden group">
                <span className="relative z-10">LEARN MORE</span>
                <div className="absolute inset-0 bg-liquid-glass opacity-0 group-hover:opacity-100 transition-opacity"></div>
              </button>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="container mx-auto px-6 py-24">
          <div className="grid md:grid-cols-3 gap-8">
            <div className="border-2 border-gold-600 p-8 hover:bg-liquid-glass transition-all bg-black/40 backdrop-blur-sm relative overflow-hidden group">
              <div className="text-4xl mb-4">🔒</div>
              <h3 className="text-2xl font-bold mb-4 text-gold-400">PRIVATE</h3>
              <p className="opacity-80 text-gold-100">
                Built on Zcash, the privacy-focused blockchain. Your transactions, your business.
              </p>
              <div className="absolute inset-0 border-2 border-gold-400 opacity-0 group-hover:opacity-100 transition-opacity animate-glow"></div>
            </div>

            <div className="border-2 border-gold-600 p-8 hover:bg-liquid-glass transition-all bg-black/40 backdrop-blur-sm relative overflow-hidden group">
              <div className="text-4xl mb-4">⚡</div>
              <h3 className="text-2xl font-bold mb-4 text-gold-400">FAST</h3>
              <p className="opacity-80 text-gold-100">
                Lightning-fast transactions with low fees. Trade Zerdinals without the wait.
              </p>
              <div className="absolute inset-0 border-2 border-gold-400 opacity-0 group-hover:opacity-100 transition-opacity animate-glow"></div>
            </div>

            <div className="border-2 border-gold-600 p-8 hover:bg-liquid-glass transition-all bg-black/40 backdrop-blur-sm relative overflow-hidden group">
              <div className="text-4xl mb-4">🎨</div>
              <h3 className="text-2xl font-bold mb-4 text-gold-400">UNIQUE</h3>
              <p className="opacity-80 text-gold-100">
                Discover one-of-a-kind digital artifacts inscribed directly on Zcash.
              </p>
              <div className="absolute inset-0 border-2 border-gold-400 opacity-0 group-hover:opacity-100 transition-opacity animate-glow"></div>
            </div>
          </div>
        </div>

        {/* Stats Section */}
        <div className="container mx-auto px-6 py-24">
          <div className="border-2 border-gold-600 p-12 bg-black/40 backdrop-blur-sm relative overflow-hidden">
            <div className="absolute inset-0 bg-liquid-glass opacity-30"></div>
            <div className="grid md:grid-cols-4 gap-8 text-center relative z-10">
              <div>
                <div className="text-5xl font-bold mb-2 text-gold-400">0</div>
                <div className="opacity-80 text-gold-200 text-sm">TOTAL INSCRIPTIONS</div>
              </div>
              <div>
                <div className="text-5xl font-bold mb-2 text-gold-400">0</div>
                <div className="opacity-80 text-gold-200 text-sm">ZRC20 TOKENS</div>
              </div>
              <div>
                <div className="text-5xl font-bold mb-2 text-gold-400">0</div>
                <div className="opacity-80 text-gold-200 text-sm">TOTAL VOLUME</div>
              </div>
              <div>
                <div className="text-5xl font-bold mb-2 text-gold-400">0</div>
                <div className="opacity-80 text-gold-200 text-sm">ACTIVE TRADERS</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="container mx-auto px-6 py-12 border-t-2 border-gold-600">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="text-2xl font-bold text-gold-400">ZATOSHI.MARKET</div>
            <div className="flex gap-6 opacity-80 text-gold-300">
              <a href="#" className="hover:opacity-100 hover:text-gold-400 transition-all">DOCS</a>
              <a href="#" className="hover:opacity-100 hover:text-gold-400 transition-all">GITHUB</a>
              <a href="#" className="hover:opacity-100 hover:text-gold-400 transition-all">TWITTER</a>
              <a href="#" className="hover:opacity-100 hover:text-gold-400 transition-all">DISCORD</a>
            </div>
          </div>
          <div className="text-center mt-8 opacity-60 text-gold-200">
            Built with privacy and security on Zcash
          </div>
        </footer>
      </div>
    </main>
  );
}
