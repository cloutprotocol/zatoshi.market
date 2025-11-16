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
          waveColor={[0.6, 0.4, 0.8]}
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
          <div className="text-2xl font-bold tracking-tight">
            ZORDINALS.MARKET
          </div>
          <div className="flex gap-6">
            <button className="px-6 py-2 border-2 border-current hover:bg-white hover:text-black transition-all">
              EXPLORE
            </button>
            <button className="px-6 py-2 bg-white text-black border-2 border-white hover:bg-transparent hover:text-white transition-all">
              CONNECT
            </button>
          </div>
        </nav>

        {/* Hero Section */}
        <div className="container mx-auto px-6 py-24 md:py-32">
          <div className="max-w-4xl">
            <h1 className="text-6xl md:text-8xl font-bold mb-8 leading-none">
              THE PREMIERE
              <br />
              MARKETPLACE
              <br />
              FOR ZERDINALS
            </h1>
            <p className="text-xl md:text-2xl mb-12 max-w-2xl opacity-90">
              Discover, trade, and mint ZRC20 tokens on Zcash.
              Built with privacy and security at its core.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <button className="px-8 py-4 bg-white text-black text-lg font-semibold border-2 border-white hover:bg-transparent hover:text-white transition-all">
                START EXPLORING
              </button>
              <button className="px-8 py-4 border-2 border-current text-lg font-semibold hover:bg-white hover:text-black transition-all">
                LEARN MORE
              </button>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="container mx-auto px-6 py-24">
          <div className="grid md:grid-cols-3 gap-8">
            <div className="border-2 border-current p-8 hover:bg-white hover:bg-opacity-10 transition-all">
              <div className="text-4xl mb-4">🔒</div>
              <h3 className="text-2xl font-bold mb-4">PRIVATE</h3>
              <p className="opacity-80">
                Built on Zcash, the privacy-focused blockchain. Your transactions, your business.
              </p>
            </div>

            <div className="border-2 border-current p-8 hover:bg-white hover:bg-opacity-10 transition-all">
              <div className="text-4xl mb-4">⚡</div>
              <h3 className="text-2xl font-bold mb-4">FAST</h3>
              <p className="opacity-80">
                Lightning-fast transactions with low fees. Trade Zerdinals without the wait.
              </p>
            </div>

            <div className="border-2 border-current p-8 hover:bg-white hover:bg-opacity-10 transition-all">
              <div className="text-4xl mb-4">🎨</div>
              <h3 className="text-2xl font-bold mb-4">UNIQUE</h3>
              <p className="opacity-80">
                Discover one-of-a-kind digital artifacts inscribed directly on Zcash.
              </p>
            </div>
          </div>
        </div>

        {/* Stats Section */}
        <div className="container mx-auto px-6 py-24">
          <div className="border-2 border-current p-12">
            <div className="grid md:grid-cols-4 gap-8 text-center">
              <div>
                <div className="text-5xl font-bold mb-2">0</div>
                <div className="opacity-80">TOTAL INSCRIPTIONS</div>
              </div>
              <div>
                <div className="text-5xl font-bold mb-2">0</div>
                <div className="opacity-80">ZRC20 TOKENS</div>
              </div>
              <div>
                <div className="text-5xl font-bold mb-2">0</div>
                <div className="opacity-80">TOTAL VOLUME</div>
              </div>
              <div>
                <div className="text-5xl font-bold mb-2">0</div>
                <div className="opacity-80">ACTIVE TRADERS</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="container mx-auto px-6 py-12 border-t-2 border-current">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="text-2xl font-bold">ZORDINALS.MARKET</div>
            <div className="flex gap-6 opacity-80">
              <a href="#" className="hover:opacity-100 transition-opacity">DOCS</a>
              <a href="#" className="hover:opacity-100 transition-opacity">GITHUB</a>
              <a href="#" className="hover:opacity-100 transition-opacity">TWITTER</a>
              <a href="#" className="hover:opacity-100 transition-opacity">DISCORD</a>
            </div>
          </div>
          <div className="text-center mt-8 opacity-60">
            Built with privacy and security on Zcash
          </div>
        </footer>
      </div>
    </main>
  );
}
