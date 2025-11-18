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
  const feeEnabled = (process.env.NEXT_PUBLIC_PLATFORM_FEE_ENABLED || '').toLowerCase() === 'true';
  const convexEnv = (process.env.NEXT_PUBLIC_CONVEX_ENV || (process.env.NEXT_PUBLIC_CONVEX_URL_PROD ? 'prod' : 'dev')).toUpperCase();

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
          <Link href="/mine" className="px-4 py-2 text-gold-400 hover:text-gold-300">
            MINE ZORE
          </Link>
          <Link href="/tokens" className="px-4 py-2 text-gold-400 hover:text-gold-300">
            ZRC20
          </Link>
          {!mounted ? (
            <button
              className="px-6 py-2 bg-gold-500 text-black font-bold rounded hover:bg-gold-400 transition-all"
            >
              CONNECT WALLET
            </button>
          ) : isConnected && wallet ? (
            <button
              onClick={() => setIsWalletOpen(true)}
              className="px-4 py-2 bg-gold-500/20 text-gold-400 border border-gold-500/30 rounded font-mono text-sm hover:bg-gold-500/30 transition-all"
            >
              {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
            </button>
          ) : (
            <button
              onClick={() => setIsWalletOpen(true)}
              className="px-6 py-2 bg-gold-500 text-black font-bold rounded hover:bg-gold-400 transition-all"
            >
              CONNECT WALLET
            </button>
          )}
          {/* Fee badge */}
          <span
            title={feeEnabled ? 'Platform fee is enabled' : 'Platform fee is disabled'}
            className={`px-2 py-1 text-xs rounded border ${feeEnabled ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-zinc-800/60 text-zinc-300 border-zinc-600/50'}`}
          >
            {feeEnabled ? 'FEE ON' : 'FEE OFF'}
          </span>
          {/* Env badge */}
          <span
            title={`Convex environment: ${convexEnv}`}
            className={`px-2 py-1 text-xs rounded border ${convexEnv==='PROD' ? 'bg-red-500/20 text-red-300 border-red-500/30' : 'bg-blue-500/20 text-blue-300 border-blue-500/30'}`}
          >
            {convexEnv}
          </span>
        </div>

        {/* Mobile Navigation */}
        <div className="flex lg:hidden items-center gap-3">
          {!mounted ? (
            <button
              className="px-4 py-2 bg-gold-500 text-black font-bold rounded text-sm"
            >
              CONNECT
            </button>
          ) : isConnected && wallet ? (
            <button
              onClick={() => setIsWalletOpen(true)}
              className="px-3 py-2 bg-gold-500/20 text-gold-400 border border-gold-500/30 rounded text-sm font-mono"
            >
              {wallet.address.slice(0, 4)}...
            </button>
          ) : (
            <button
              onClick={() => setIsWalletOpen(true)}
              className="px-4 py-2 bg-gold-500 text-black font-bold rounded text-sm"
            >
              CONNECT
            </button>
          )}
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
            className="fixed inset-0 bg-black/60 z-30 lg:hidden top-20"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="fixed top-20 left-0 right-0 z-40 lg:hidden backdrop-blur-xl bg-black/90 border-b border-gold-500/20">
            <div className="px-6 py-4 space-y-3">
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
              href="/mine"
              className="block px-4 py-3 text-gold-400 hover:bg-gold-500/10 rounded"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              MINE ZORE
            </Link>
            <Link
              href="/tokens"
              className="block px-4 py-3 text-gold-400 hover:bg-gold-500/10 rounded"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              ZRC20
            </Link>
          </div>
        </div>
        </>
      )}

      {/* Wallet Drawer */}
      <WalletDrawer isOpen={isWalletOpen} onClose={() => setIsWalletOpen(false)} />
    </>
  );
}
