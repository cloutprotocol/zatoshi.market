// Marketplace fee policy (basis points: 1% = 100 bps)
export const MARKETPLACE_FEES = {
  BUYER_BPS: 0,    // 0% buyer fee
  SELLER_BPS: 200, // 2.0% seller fee
} as const;

export type FeeBreakdown = {
  priceZats: number;
  buyerFeeZats: number;
  sellerFeeZats: number;
  totalTreasuryZats: number;
  sellerPayoutZats: number;
  buyerTotalZats: number; // price + buyer fee
};

export function calcFees(priceZats: number): FeeBreakdown {
  const buyerFeeZats = Math.ceil((priceZats * MARKETPLACE_FEES.BUYER_BPS) / 10_000);
  const sellerFeeZats = Math.floor((priceZats * MARKETPLACE_FEES.SELLER_BPS) / 10_000);
  const totalTreasuryZats = buyerFeeZats + sellerFeeZats;
  const sellerPayoutZats = priceZats - sellerFeeZats;
  const buyerTotalZats = priceZats + buyerFeeZats;
  return { priceZats, buyerFeeZats, sellerFeeZats, totalTreasuryZats, sellerPayoutZats, buyerTotalZats };
}

// Minimum miner fee for marketplace purchases (zats)
// Tuned to a medium policy to avoid ZIP-317 unpaid action rejections
export const BUY_TX_FEE_FLOOR_ZATS = 50_000; // 0.0005 ZEC (floor), dynamic logic scales up
