'use client';

import '@/polyfills';
import { WalletProvider } from '@/contexts/WalletContext';
import { ConvexProvider, ConvexReactClient } from 'convex/react';

export default function Providers({ children }: { children: React.ReactNode }) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    // Fallback: work without Convex if not configured
    return <WalletProvider>{children}</WalletProvider>;
  }
  const convex = new ConvexReactClient(url);
  return (
    <ConvexProvider client={convex}>
      <WalletProvider>{children}</WalletProvider>
    </ConvexProvider>
  );
}
