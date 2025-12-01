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
            "border backdrop-blur-sm shadow-lg",
            "bg-black/80 border-gold-500/20",
            "text-gold-100",
          ].join(" ")}
        >
          <div className="p-3">
            {t.title && (
              <div className="text-sm font-bold tracking-wide font-mono uppercase">
                {t.title}
              </div>
            )}
            {t.description && (
              <div className="mt-1 text-xs text-gold-300/80 leading-relaxed font-mono">
                {t.description}
              </div>
            )}
            <div className="mt-2 flex items-center justify-end">
              <button
                onClick={() => dismiss(t.id)}
                className="text-[10px] uppercase tracking-widest text-gold-500 hover:text-gold-300 transition-colors font-bold"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

