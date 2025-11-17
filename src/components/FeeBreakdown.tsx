import { formatZEC, formatUSD } from '@/config/fees';

interface FeeBreakdownProps {
  platformFee: number;
  networkFee: number;
  inscriptionOutput: number;
  total: number;
  zecPrice: number | null;
  priceLoading?: boolean;
  priceError?: string | null;
  label?: string;
}

export function FeeBreakdown({
  platformFee,
  networkFee,
  inscriptionOutput,
  total,
  zecPrice,
  priceLoading = false,
  priceError = null,
  label = 'Cost Breakdown',
}: FeeBreakdownProps) {
  return (
    <div className="p-6 bg-black/40 border border-gold-500/20 rounded-xl">
      <div className="text-sm text-gold-400/60 mb-4">{label}</div>
      <div className="space-y-3">
        <div className="flex justify-between text-lg">
          <span className="text-gold-400/80">Platform Fee</span>
          <div className="text-right">
            <div className="font-mono">{formatZEC(platformFee)}</div>
            {zecPrice && <div className="text-xs text-gold-400/50">{formatUSD(platformFee, zecPrice)}</div>}
          </div>
        </div>
        <div className="flex justify-between">
          <span className="text-gold-400/60 text-sm">Network Fee (est.)</span>
          <div className="text-right">
            <div className="font-mono text-sm">{formatZEC(networkFee)}</div>
            {zecPrice && <div className="text-xs text-gold-400/50">{formatUSD(networkFee, zecPrice)}</div>}
          </div>
        </div>
        <div className="flex justify-between">
          <span className="text-gold-400/60 text-sm">Inscription Output</span>
          <div className="text-right">
            <div className="font-mono text-sm">{formatZEC(inscriptionOutput)}</div>
            {zecPrice && <div className="text-xs text-gold-400/50">{formatUSD(inscriptionOutput, zecPrice)}</div>}
          </div>
        </div>
        <div className="pt-3 border-t border-gold-500/20 flex justify-between text-xl font-bold">
          <span>Total</span>
          <div className="text-right">
            <div className="text-gold-300">{formatZEC(total)}</div>
            {zecPrice && <div className="text-sm text-gold-400/60 font-normal">{formatUSD(total, zecPrice)}</div>}
          </div>
        </div>
      </div>

      {/* Live Price Indicator */}
      <div className="mt-4 pt-4 border-t border-gold-500/10">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gold-400/50">Live ZEC Price</span>
          <div className="flex items-center gap-2">
            {priceLoading && (
              <>
                <div className="size-1.5 rounded-full bg-yellow-400 animate-pulse" />
                <span className="text-gold-400/60 font-mono">Loading...</span>
              </>
            )}
            {priceError && (
              <>
                <div className="size-1.5 rounded-full bg-red-400" />
                <span className="text-red-400 font-mono text-[10px]">Price unavailable</span>
              </>
            )}
            {zecPrice && !priceLoading && (
              <>
                <div className="size-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-gold-300 font-mono">${zecPrice.toFixed(2)}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
