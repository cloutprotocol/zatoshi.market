'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { Wallet } from '@/lib/wallet';
import { hasKeystore, saveKeystore, loadKeystore, deleteKeystore } from '@/lib/keystore';
import { getConvexClient } from '@/lib/convexClient';
import { api } from '../../convex/_generated/api';

export interface UserBadge {
  badgeSlug: string;
  label: string;
  description?: string;
  icon?: string;
  level?: number;
  source?: string;
  reason?: string;
  createdAt: number;
}

export interface UserPointsSummary {
  total: number;
  minted: number;
  updatedAt: number;
}

interface WalletContextType {
  wallet: Wallet | null;
  isConnected: boolean;
  isLocked: boolean;
  hasStoredKeystore: boolean;
  mounted: boolean;
  badges: UserBadge[];
  points: UserPointsSummary | null;
  connectWallet: (wallet: Wallet) => void; // in-memory only, no session storage
  saveEncrypted: (wallet: Wallet, password: string) => Promise<void>;
  unlockWallet: (password: string) => Promise<boolean>;
  lockWallet: () => void;
  disconnectWallet: () => void; // clears keystore and memory
  updateBalance: (confirmed: number, unconfirmed: number) => void;
  refreshBadges: (address?: string) => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hasStoredKeystore, setHasStoredKeystore] = useState(false);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [points, setPoints] = useState<UserPointsSummary | null>(null);

  const refreshBadges = useCallback(async (address?: string) => {
    const addr = address ?? wallet?.address;
    if (!addr) {
      setBadges([]);
      setPoints(null);
      return;
    }
    const convex = getConvexClient();
    if (!convex) return;
    try {
      const res = await convex.query(api.badges.getUserStatus, { address: addr });
      setBadges(res?.badges ?? []);
      setPoints(
        res?.points
          ? {
            total: typeof res.points.total === 'number' ? res.points.total : 0,
            minted: typeof res.points.minted === 'number' ? res.points.minted : 0,
            updatedAt: typeof res.points.updatedAt === 'number' ? res.points.updatedAt : Date.now(),
          }
          : { total: 0, minted: 0, updatedAt: Date.now() }
      );
    } catch (e) {
      console.error('Badge fetch failed:', e);
    }
  }, [wallet?.address]);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      setHasStoredKeystore(hasKeystore());

      // Wallet is kept in-memory only for security.
      // No session storage restore to prevent secret leaks.

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
  }, [refreshBadges]);

  const connectWallet = (newWallet: Wallet) => {
    setWallet(newWallet);
    setIsConnected(true);
    refreshBadges(newWallet.address);
    // In-memory only - do not persist to session storage
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
      refreshBadges(unlocked.address);
      // In-memory only - do not persist to session storage
      return true;
    } catch (e) {
      console.error('Unlock failed:', e);
      return false;
    }
  };

  const lockWallet = () => {
    setWallet(null);
    setIsConnected(false);
    setBadges([]);
    setPoints(null);
  };

  const disconnectWallet = () => {
    setWallet(null);
    setIsConnected(false);
    setBadges([]);
    setPoints(null);
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
        badges,
        points,
        connectWallet,
        saveEncrypted,
        unlockWallet,
        lockWallet,
        disconnectWallet,
        updateBalance,
        refreshBadges,
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
