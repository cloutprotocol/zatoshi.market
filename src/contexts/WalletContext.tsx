'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Wallet } from '@/lib/wallet';

interface WalletContextType {
  wallet: Wallet | null;
  isConnected: boolean;
  connectWallet: (wallet: Wallet) => void;
  disconnectWallet: () => void;
  updateBalance: (confirmed: number, unconfirmed: number) => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const WALLET_STORAGE_KEY = 'zatoshi_wallet';

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Load wallet from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(WALLET_STORAGE_KEY);
      if (stored) {
        try {
          const parsedWallet = JSON.parse(stored);
          setWallet(parsedWallet);
          setIsConnected(true);
        } catch (error) {
          console.error('Failed to load wallet from storage:', error);
          localStorage.removeItem(WALLET_STORAGE_KEY);
        }
      }
    }
  }, []);

  const connectWallet = (newWallet: Wallet) => {
    setWallet(newWallet);
    setIsConnected(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(newWallet));
    }
  };

  const disconnectWallet = () => {
    setWallet(null);
    setIsConnected(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(WALLET_STORAGE_KEY);
    }
  };

  const updateBalance = (confirmed: number, unconfirmed: number) => {
    // This can be used to update wallet balance without re-saving full wallet
    // For now, we'll just keep it simple
  };

  return (
    <WalletContext.Provider
      value={{
        wallet,
        isConnected,
        connectWallet,
        disconnectWallet,
        updateBalance,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
