"use client";

import React, { useState, useEffect } from "react";
import { formatUSD } from "@/config/fees";

type LineItem = {
  label: string;
  hidden?: boolean;
  // numeric items contribute to the total and show zats + USD
  valueZats?: number;
  // info-only items render this string and are excluded from totals
  valueText?: string;
};

export type FeeOption = {
  key: string;
  label: string;
  perTx: number;
};

export function ConfirmTransaction(props: {
  isOpen: boolean;
  title?: string;
  items: LineItem[];
  disclaimer?: React.ReactNode;
  disclaimerExtra?: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
  confirmText?: string;
  feeOptions?: readonly FeeOption[];
  selectedFeeOption?: FeeOption;
  onFeeOptionChange?: (option: FeeOption) => void;
  extraContent?: React.ReactNode;
}) {
  const {
    isOpen,
    title = "Confirm Transaction",
    items,
    disclaimer,
    disclaimerExtra,
    onCancel,
    onConfirm,
    confirmText = "Confirm & Sign",
    feeOptions,
    selectedFeeOption,
    onFeeOptionChange,
    extraContent,
  } = props;
  const [zecPrice, setZecPrice] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);

  // Fetch ZEC price only when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const fetchPrice = async () => {
      setPriceLoading(true);
      try {
        const response = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd'
        );
        if (response.ok) {
          const data = await response.json();
          if (data?.zcash?.usd) {
            setZecPrice(data.zcash.usd);
          }
        }
      } catch (err) {
        console.error('Failed to fetch ZEC price:', err);
      } finally {
        setPriceLoading(false);
      }
    };

    fetchPrice();
  }, [isOpen]);

  if (!isOpen) return null;

  const visible = items.filter((i) => !i.hidden);
  const total = visible.reduce((s, i) => s + (typeof i.valueZats === 'number' && Number.isFinite(i.valueZats) ? i.valueZats : 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-black/90 border border-gold-500/30 rounded p-6">
        <h3 className="text-xl font-bold mb-4 text-gold-300">{title}</h3>
        <div className="space-y-2 text-sm">
          {extraContent ? <div className="mb-3">{extraContent}</div> : null}

          {visible.map((i, idx) => (
            <div key={idx} className="flex justify-between items-start">
              <span className="text-gold-400/70">{i.label}</span>
              <div className="text-right">
                {typeof i.valueZats === 'number' && Number.isFinite(i.valueZats) ? (
                  <>
                    <div className="font-mono text-gold-300">{i.valueZats.toLocaleString()} zats</div>
                    {zecPrice && !priceLoading && (
                      <div className="text-xs text-gold-400/60">{formatUSD(i.valueZats, zecPrice)}</div>
                    )}
                  </>
                ) : (
                  <div className="font-mono text-gold-300">{i.valueText ?? '-'}</div>
                )}
              </div>
            </div>
          ))}

          {/* Fee Selector */}
          {feeOptions && selectedFeeOption && onFeeOptionChange && (
            <div className="py-3">
              <label className="block text-xs text-gold-400/70 mb-2">Fee Rate</label>
              <div className="grid grid-cols-3 gap-2">
                {feeOptions.map((option) => (
                  <button
                    key={option.key}
                    onClick={() => onFeeOptionChange(option)}
                    className={`
                      px-2 py-2 rounded text-xs font-medium border transition-colors
                      ${selectedFeeOption.key === option.key
                        ? 'bg-gold-500/20 border-gold-500 text-gold-300'
                        : 'bg-black/40 border-gold-500/20 text-gold-400/60 hover:border-gold-500/40'
                      }
                    `}
                  >
                    <div className="font-bold">{option.label}</div>
                    <div className="opacity-70">{option.perTx.toLocaleString()}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="h-px bg-gold-500/20 my-3" />
          <div className="flex justify-between items-start text-lg font-bold">
            <span className="text-gold-200">Total</span>
            <div className="text-right">
              <div className="font-mono text-gold-300">{total.toLocaleString()} zats</div>
              {zecPrice && !priceLoading && (
                <div className="text-sm text-gold-400/70 font-normal">{formatUSD(total, zecPrice)}</div>
              )}
            </div>
          </div>
          <div className="text-xs text-gold-400/60 pt-3 space-y-2">
            <p>
              {disclaimer || "Your wallet will sign this transaction locally. Private keys never leave your device."}
            </p>
            {disclaimerExtra ? <div>{disclaimerExtra}</div> : null}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onCancel} className="px-5 py-2 bg-black/40 border border-gold-500/40 rounded text-sm text-gold-300 hover:border-gold-500/60">
            Cancel
          </button>
          <button onClick={onConfirm} className="px-6 py-2 bg-gold-500 text-black font-bold rounded text-sm hover:bg-gold-400 transition-colors">
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
