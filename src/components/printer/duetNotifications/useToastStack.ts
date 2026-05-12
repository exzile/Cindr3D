import { useState, useCallback, useEffect } from 'react';

export type ToastType = 'info' | 'warning' | 'error' | 'success';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
  timestamp: number;
}

export const TOAST_COLORS: Record<ToastType, { bg: string; border: string; text: string }> = {
  info:    { bg: 'rgba(59,130,246,0.15)',  border: 'rgba(59,130,246,0.4)',  text: 'var(--info)' },
  warning: { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)', text: 'var(--warning)' },
  error:   { bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.4)',  text: 'var(--error)' },
  success: { bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.4)',  text: 'var(--success)' },
};

const AUTO_DISMISS_MS = 5000;
let nextToastId = 1;

export function useToastStack() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = nextToastId++;
    setToasts((prev) => [...prev, { id, type, message, timestamp: Date.now() }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const now = Date.now();
    const nextExpiry = Math.min(...toasts.map((t) => t.timestamp + AUTO_DISMISS_MS));
    const delayMs = Math.max(0, nextExpiry - now) + 10;
    const timeout = window.setTimeout(() => {
      const cutoff = Date.now() - AUTO_DISMISS_MS;
      setToasts((prev) => prev.filter((t) => t.timestamp > cutoff));
    }, delayMs);
    return () => clearTimeout(timeout);
  }, [toasts]);

  return { toasts, addToast, removeToast };
}
