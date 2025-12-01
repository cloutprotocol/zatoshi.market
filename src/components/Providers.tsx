'use client';

import '@/polyfills';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ZecPriceProvider } from '@/contexts/ZecPriceContext';
import Toaster from '@/components/Toaster';
import { ConvexProvider, ConvexReactClient } from 'convex/react';

export default function Providers({ children }: { children: React.ReactNode }) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const content = (
    <WalletProvider>
      <ToastProvider>
        <ZecPriceProvider>
          {children}
          <Toaster />
        </ZecPriceProvider>
      </ToastProvider>
    </WalletProvider>
  );
  if (!url) {
    return content;
  }
  const convex = new ConvexReactClient(url);
  return (
    <ConvexProvider client={convex}>
      {content}
    </ConvexProvider>
  );
}
