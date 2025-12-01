"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

type ToastVariant = "success" | "error" | "info";

export type Toast = {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type ToastContextValue = {
  toasts: Toast[];
  dismiss: (id: string) => void;
  notify: (t: Omit<Toast, "id">) => void;
  success: (msg: string, description?: string) => void;
  error: (msg: string, description?: string) => void;
  info: (msg: string, description?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((t: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const toast: Toast = { id, durationMs: 4500, variant: "info", ...t };
    setToasts((prev) => [...prev, toast]);
    if (toast.durationMs && toast.durationMs > 0) {
      setTimeout(() => dismiss(id), toast.durationMs);
    }
  }, [dismiss]);

  const success = useCallback((msg: string, description?: string) => notify({ title: msg, description, variant: "success" }), [notify]);
  const error = useCallback((msg: string, description?: string) => notify({ title: msg, description, variant: "error" }), [notify]);
  const info = useCallback((msg: string, description?: string) => notify({ title: msg, description, variant: "info" }), [notify]);

  const value = useMemo(() => ({ toasts, dismiss, notify, success, error, info }), [toasts, dismiss, notify, success, error, info]);

  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

