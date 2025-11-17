'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Wallet } from '@/lib/wallet';
import { hasKeystore, saveKeystore, loadKeystore, deleteKeystore } from '@/lib/keystore';

interface WalletContextType {
  wallet: Wallet | null;
  isConnected: boolean;
  isLocked: boolean;
  hasStoredKeystore: boolean;
  mounted: boolean;
  connectWallet: (wallet: Wallet) => void; // in-memory only
  saveEncrypted: (wallet: Wallet, password: string) => Promise<void>;
  unlockWallet: (password: string) => Promise<boolean>;
  lockWallet: () => void;
  disconnectWallet: () => void; // clears keystore and memory
  updateBalance: (confirmed: number, unconfirmed: number) => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hasStoredKeystore, setHasStoredKeystore] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      setHasStoredKeystore(hasKeystore());
      // Migrate legacy plaintext wallet if present
      try {
        const legacy = localStorage.getItem('zatoshi_wallet');
        if (legacy && !hasKeystore()) {
          const parsed = JSON.parse(legacy);
          const doMigrate = confirm('A legacy wallet was found in plaintext storage. Migrate it to encrypted storage now?');
          if (doMigrate) {
            const password = prompt('Set a password to encrypt your wallet (required):') || '';
            if (password.length >= 8) {
              // best-effort type assertion
              saveKeystore(parsed as Wallet, password).then(() => {
                localStorage.removeItem('zatoshi_wallet');
                setHasStoredKeystore(true);
                alert('Wallet migrated to encrypted storage. Use Unlock to access it.');
              }).catch((e) => {
                console.error('Migration failed:', e);
              });
            } else {
              alert('Migration skipped: password too short.');
            }
          }
        }
      } catch (e) {
        console.error('Legacy wallet migration error:', e);
      }
    }
  }, []);

  const connectWallet = (newWallet: Wallet) => {
    setWallet(newWallet);
    setIsConnected(true);
  };

  const saveEncrypted = async (newWallet: Wallet, password: string) => {
    await saveKeystore(newWallet, password);
    setHasStoredKeystore(true);
  };

  const unlockWallet = async (password: string) => {
    try {
      const unlocked = await loadKeystore(password);
      setWallet(unlocked);
      setIsConnected(true);
      return true;
    } catch (e) {
      console.error('Unlock failed:', e);
      return false;
    }
  };

  const lockWallet = () => {
    setWallet(null);
    setIsConnected(false);
  };

  const disconnectWallet = () => {
    setWallet(null);
    setIsConnected(false);
    deleteKeystore();
    setHasStoredKeystore(false);
  };

  const updateBalance = (_confirmed: number, _unconfirmed: number) => {
    // Placeholder for future balance state
  };

  return (
    <WalletContext.Provider
      value={{
        wallet,
        isConnected,
        isLocked: !wallet && hasStoredKeystore,
        hasStoredKeystore,
        mounted,
        connectWallet,
        saveEncrypted,
        unlockWallet,
        lockWallet,
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
