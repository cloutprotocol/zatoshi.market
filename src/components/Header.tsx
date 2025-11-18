'use client';

import { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useWallet } from '@/contexts/WalletContext';

// Load WalletDrawer only on the client to avoid pulling crypto/WASM libs server-side
const WalletDrawer = dynamic(() => import('./WalletDrawer'), { ssr: false });

export default function Header() {
  const { wallet, isConnected, mounted } = useWallet();
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-3 flex justify-between items-center backdrop-blur-xl bg-black/30 border-b border-gold-500/20">
        <Link href="/" className="h-10 w-10 border-2 border-gold-500 text-gold-400 flex items-center justify-center text-2xl font-bold hover:border-gold-400 transition-colors">
          Z
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden lg:flex gap-6 items-center">
          <Link href="/zmaps" className="px-4 py-2 text-gold-400 hover:text-gold-300">
            ZMAPS
          </Link>
          <Link href="/inscribe" className="px-4 py-2 text-gold-400 hover:text-gold-300">
            INSCRIBE
          </Link>
          <Link href="/zore" className="px-4 py-2 text-gold-400 hover:text-gold-300">
            ZORE
          </Link>
          <Link href="/tokens" className="px-4 py-2 text-gold-400 hover:text-gold-300">
            ZRC20
          </Link>
          {!mounted ? (
            <button
              className="px-6 py-2 bg-gold-500/20 text-gold-400 border border-gold-500/30 font-bold hover:bg-gold-500/30 transition-all"
            >
              CONNECT WALLET
            </button>
          ) : isConnected && wallet ? (
            <button
              onClick={() => setIsWalletOpen(!isWalletOpen)}
              className="px-4 py-2 bg-gold-500/20 text-gold-400 border border-gold-500/30 font-mono text-sm hover:bg-gold-500/30 transition-all"
            >
              {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
            </button>
          ) : (
            <button
              onClick={() => setIsWalletOpen(!isWalletOpen)}
              className="px-6 py-2 bg-gold-500/20 text-gold-400 border border-gold-500/30 font-bold hover:bg-gold-500/30 transition-all"
            >
              CONNECT WALLET
            </button>
          )}
        </div>

        {/* Mobile Navigation */}
        <div className="flex lg:hidden items-center gap-3">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="text-gold-400 text-2xl p-2"
          >
            ☰
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-30 lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="fixed top-20 -mt-5 left-0 right-0 bottom-0 z-40 lg:hidden backdrop-blur-xl bg-black/90">
            <div className="h-full flex flex-col">
              <div className="flex-1 px-6 py-4 space-y-2 pt-20">
                <Link
                  href="/zmaps"
                  className="block px-4 py-3 text-gold-400 hover:bg-gold-500/10 rounded"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  ZMAPS
                </Link>
                <Link
                  href="/inscribe"
                  className="block px-4 py-3 text-gold-400 hover:bg-gold-500/10 rounded"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  INSCRIBE
                </Link>
                <Link
                  href="/zore"
                  className="block px-4 py-3 text-gold-400 hover:bg-gold-500/10 rounded"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  ZORE
                </Link>
                <Link
                  href="/tokens"
                  className="block px-4 py-3 text-gold-400 hover:bg-gold-500/10 rounded"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  ZRC20
                </Link>
              </div>

              {/* Wallet Button - Bottom of screen on mobile */}
              <div className="flex justify-center px-6 pb-8 pt-4" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
                {isConnected && wallet ? (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      setIsWalletOpen(true);
                    }}
                    className="w-[90%] max-w-md py-4 bg-gold-500/20 backdrop-blur-xl text-gold-400 border border-gold-500/30 font-mono active:bg-gold-500/40 transition-all rounded-xl text-sm shadow-lg"
                  >
                    {wallet.address.slice(0, 8)}...{wallet.address.slice(-8)}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      setIsWalletOpen(true);
                    }}
                    className="w-[90%] max-w-md py-4 bg-gold-500/20 backdrop-blur-xl text-gold-400 border border-gold-500/30 font-bold active:bg-gold-500/40 transition-all rounded-xl text-base shadow-lg"
                  >
                    CONNECT WALLET
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Wallet Drawer */}
      <WalletDrawer isOpen={isWalletOpen} onClose={() => setIsWalletOpen(false)} />
    </>
  );
}
