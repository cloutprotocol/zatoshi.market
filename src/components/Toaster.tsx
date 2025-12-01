"use client";

import { useToast } from "@/contexts/ToastContext";

export default function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-3 w-[min(92vw,360px)]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            "rounded-2xl border backdrop-blur-sm shadow-lg",
            "bg-black/70 border-gold-500/30",
            "text-gold-100",
          ].join(" ")}
        >
          <div className="p-3.5">
            {t.title && (
              <div className="text-sm font-bold tracking-wide">
                {t.title}
              </div>
            )}
            {t.description && (
              <div className="mt-1 text-xs text-gold-300/80 leading-relaxed">
                {t.description}
              </div>
            )}
            <div className="mt-2 flex items-center justify-end">
              <button
                onClick={() => dismiss(t.id)}
                className="text-[11px] uppercase tracking-wider text-gold-300/70 hover:text-gold-100 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
          <div
            className={[
              "h-0.5 rounded-b-2xl",
              t.variant === "success" ? "bg-emerald-400/60" :
              t.variant === "error" ? "bg-red-400/70" :
              "bg-gold-400/60",
            ].join(" ")}
          />
        </div>
      ))}
    </div>
  );
}

