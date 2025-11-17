"use client";

import { ConvexReactClient } from 'convex/react';

let client: ConvexReactClient | null = null;

export function getConvexClient(): ConvexReactClient | null {
  if (typeof window === 'undefined') return null;
  const env = (process.env.NEXT_PUBLIC_CONVEX_ENV || '').toLowerCase();
  const url =
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    (env === 'prod' ? process.env.NEXT_PUBLIC_CONVEX_URL_PROD : process.env.NEXT_PUBLIC_CONVEX_URL_DEV) ||
    process.env.NEXT_PUBLIC_CONVEX_URL_DEV ||
    process.env.NEXT_PUBLIC_CONVEX_URL_PROD ||
    '';
  if (!url) return null;
  if (!client) client = new ConvexReactClient(url);
  return client;
}
