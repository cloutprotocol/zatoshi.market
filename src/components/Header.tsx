'use client';

import Link from 'next/link';
import { useWallet } from '@/contexts/WalletContext';
import { useRouter } from 'next/navigation';

export default function Header() {
  const { wallet, isConnected, disconnectWallet } = useWallet();
  const router = useRouter();

  const handleWalletClick = () => {
    if (isConnected) {
      // If connected, show disconnect option
      const shouldDisconnect = confirm('Disconnect wallet?');
      if (shouldDisconnect) {
        disconnectWallet();
        router.push('/');
      }
    } else {
      // If not connected, go to wallet page
      router.push('/wallet');
    }
  };

  return (
    <nav className="px-6 py-8 flex justify-between items-center bg-black/90">
      <Link href="/" className="text-2xl text-gold-400">
        ZATOSHI.MARKET
      </Link>
      <div className="flex gap-6 items-center">
        {isConnected && wallet ? (
          <button
            onClick={handleWalletClick}
            className="px-4 py-2 bg-gold-500/20 text-gold-400 border border-gold-500/30 rounded font-mono text-sm hover:bg-gold-500/30 transition-all"
          >
            {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
          </button>
        ) : (
          <button
            onClick={handleWalletClick}
            className="px-6 py-2 bg-gold-500 text-black font-bold rounded hover:bg-gold-400 transition-all"
          >
            CONNECT WALLET
          </button>
        )}
        <a
          href="https://zerdinals.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="px-6 py-2 text-gold-400"
        >
          EXPLORER
        </a>
        <Link href="/zmaps" className="px-6 py-2 text-gold-400">
          ZMAPS
        </Link>
        <Link href="/token/zore" className="px-6 py-2 text-gold-400">
          ZORE TOKEN
        </Link>
      </div>
    </nav>
  );
}
