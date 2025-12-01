"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type ZecPriceContextValue = {
  price: number | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const ZecPriceContext = createContext<ZecPriceContextValue | undefined>(undefined);

const PRICE_POLL_INTERVAL_MS = 60_000;

export function ZecPriceProvider({ children }: { children: React.ReactNode }) {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchPrice = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const usd = data?.zcash?.usd;
      if (typeof usd === 'number') {
        setPrice(usd);
      } else {
        throw new Error('Invalid response payload');
      }
    } catch (err: any) {
      console.error('Failed to fetch ZEC price', err);
      setError(err?.message || 'Failed to fetch ZEC price');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrice();
    timerRef.current = setInterval(fetchPrice, PRICE_POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchPrice]);

  const value: ZecPriceContextValue = {
    price,
    loading,
    error,
    refresh: fetchPrice,
  };

  return <ZecPriceContext.Provider value={value}>{children}</ZecPriceContext.Provider>;
}

export function useZecPriceContext() {
  const ctx = useContext(ZecPriceContext);
  if (!ctx) throw new Error('useZecPriceContext must be used within a ZecPriceProvider');
  return ctx;
}
