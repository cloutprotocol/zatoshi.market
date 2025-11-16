'use client';

import { WalletProvider } from '@/contexts/WalletContext';
import Header from './Header';

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <Header />
      {children}
    </WalletProvider>
  );
}
