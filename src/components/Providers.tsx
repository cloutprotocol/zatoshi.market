'use client';

import { WalletProvider } from '@/contexts/WalletContext';
// Convex temporarily disabled until npx convex dev is run in interactive terminal
// import { ConvexProvider, ConvexReactClient } from "convex/react";
// const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL || "");

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>{children}</WalletProvider>
  );
}
