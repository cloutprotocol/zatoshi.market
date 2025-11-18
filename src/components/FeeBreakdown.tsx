import { formatZEC } from '@/config/fees';

interface FeeBreakdownProps {
  platformFee: number;
  networkFee: number;
  inscriptionOutput: number;
  total: number;
  label?: string;
}

export function FeeBreakdown({
  platformFee,
  networkFee,
  inscriptionOutput,
  total,
  label = 'Cost Breakdown',
}: FeeBreakdownProps) {
  return (
    <div className="p-4 bg-black/40 border border-gold-500/20 rounded">
      <div className="text-xs text-gold-400/50 mb-3">{label}</div>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span className="text-gold-400/50 text-xs">Network Fee (est.)</span>
          <div className="text-right">
            <div className="font-mono text-xs text-gold-400/70">{formatZEC(networkFee)}</div>
          </div>
        </div>
        <div className="flex justify-between">
          <span className="text-gold-400/50 text-xs">Inscription Output</span>
          <div className="text-right">
            <div className="font-mono text-xs text-gold-400/70">{formatZEC(inscriptionOutput)}</div>
          </div>
        </div>
        <div className="flex justify-between">
          <span className="text-gold-400/50 text-xs">Platform Fee</span>
          <div className="text-right">
            <div className="font-mono text-xs text-gold-400/70">{formatZEC(platformFee)}</div>
          </div>
        </div>
        <div className="pt-3 mt-1 border-t border-gold-500/20 flex justify-between text-lg font-bold">
          <span className="text-gold-300">Total</span>
          <div className="text-right">
            <div className="text-gold-300 font-mono">{formatZEC(total)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
