'use client';

import { useZecPriceContext } from '@/contexts/ZecPriceContext';

export function useZecPrice() {
  return useZecPriceContext();
}
