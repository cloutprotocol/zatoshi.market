"use client";

import React from "react";

type LineItem = { label: string; valueZats: number; hidden?: boolean };

export function ConfirmTransaction(props: {
  isOpen: boolean;
  title?: string;
  items: LineItem[];
  disclaimer?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
  confirmText?: string;
}) {
  const { isOpen, title = "Confirm Transaction", items, disclaimer, onCancel, onConfirm, confirmText = "Confirm & Sign" } = props;
  if (!isOpen) return null;
  const visible = items.filter((i) => !i.hidden);
  const total = visible.reduce((s, i) => s + (Number.isFinite(i.valueZats) ? i.valueZats : 0), 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-lg bg-black/90 border border-gold-500/30 rounded-xl p-5">
        <h3 className="text-lg font-bold mb-3">{title}</h3>
        <div className="space-y-2 text-sm">
          {visible.map((i, idx) => (
            <div key={idx} className="flex justify-between">
              <span className="text-gold-400/80">{i.label}</span>
              <span className="font-mono">{i.valueZats.toLocaleString()} zats</span>
            </div>
          ))}
          <div className="h-px bg-gold-500/20 my-2" />
          <div className="flex justify-between text-base">
            <span className="text-gold-200">Total</span>
            <span className="font-mono">{total.toLocaleString()} zats</span>
          </div>
          <p className="text-xs text-gold-400/70">
            {disclaimer || "Your wallet will sign this transaction locally. Private keys never leave your device."}
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 bg-black/40 border border-gold-500/40 rounded text-sm">
            Cancel
          </button>
          <button onClick={onConfirm} className="px-5 py-2 bg-gold-500 text-black font-bold rounded text-sm hover:bg-gold-400">
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

