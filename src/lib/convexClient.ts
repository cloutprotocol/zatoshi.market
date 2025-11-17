"use client";

import { ConvexReactClient } from 'convex/react';

let client: ConvexReactClient | null = null;

export function getConvexClient(): ConvexReactClient | null {
  if (typeof window === 'undefined') return null;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  if (!client) client = new ConvexReactClient(url);
  return client;
}

