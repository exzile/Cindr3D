import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { usePrinterStore } from '../store/printerStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastType = 'info' | 'warning' | 'error' | 'success';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const TOAST_COLORS: Record<ToastType, { bg: string; border: string; text: string }> = {
  info:    { bg: 'rgba(59,130,246,0.15)',  border: 'rgba(59,130,246,0.4)',  text: 'var(--info)' },
  warning: { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)', text: 'var(--warning)' },
  error:   { bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.4)',  text: 'var(--error)' },
  success: { bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.4)',  text: 'var(--success)' },
};

const AUTO_DISMISS_MS = 5000;

// ---------------------------------------------------------------------------
// Web Audio beep helper
// ---------------------------------------------------------------------------

function playBeep(frequency: number, durationMs: number) {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);

    // Fade out at end to avoid clicks
    const endTime = audioCtx.currentTime + durationMs / 1000;
    gainNode.gain.exponentialRampToValueAtTime(0.001, endTime);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(endTime);

    // Clean up after done
    oscillator.onended = () => {
      oscillator.disconnect();
      gainNode.disconnect();
      audioCtx.close();
    };
  } catch {
    // Silently fail if Web Audio is unavailable
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

let nextToastId = 1;

export default function DuetNotifications() {
  const model = usePrinterStore((s) => s.model);
  const connected = usePrinterStore((s) => s.connected);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Track previous values for change detection
  const prevBeepRef = useRef<{ duration: number; frequency: number } | undefined>(undefined);
  const prevDisplayMessageRef = useRef<string>('');
  const prevStatusRef = useRef<string>('');
  const prevConnectedRef = useRef<boolean>(false);
  const prevHeaterStatesRef = useRef<string[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = nextToastId++;
    setToasts((prev) => [...prev, { id, type, message, timestamp: Date.now() }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Auto-dismiss timer
  useEffect(() => {
    if (toasts.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.timestamp < AUTO_DISMISS_MS));
    }, 500);

    return () => clearInterval(interval);
  }, [toasts.length]);

  // Watch for beep
  useEffect(() => {
    const beep = model.state?.beep;
    if (beep && (beep.frequency !== prevBeepRef.current?.frequency || beep.duration !== prevBeepRef.current?.duration)) {
      playBeep(beep.frequency, beep.duration);
    }
    prevBeepRef.current = beep;
  }, [model.state?.beep]);

  // Watch for display message changes
  useEffect(() => {
    const msg = model.state?.displayMessage ?? '';
    if (msg && msg !== prevDisplayMessageRef.current) {
      addToast('info', msg);
    }
    prevDisplayMessageRef.current = msg;
  }, [model.state?.displayMessage, addToast]);

  // Watch for status transitions
  useEffect(() => {
    const status = model.state?.status ?? 'disconnected';
    const prev = prevStatusRef.current;

    if (prev && prev !== status) {
      // Print completed
      if (prev === 'processing' && status === 'idle') {
        addToast('success', 'Print completed successfully');
      }
      // Print paused
      if (status === 'paused' && prev !== 'paused') {
        addToast('warning', 'Print paused - requires attention');
      }
    }

    prevStatusRef.current = status;
  }, [model.state?.status, addToast]);

  // Watch for connection lost
  useEffect(() => {
    if (prevConnectedRef.current && !connected) {
      addToast('error', 'Connection lost to printer');
    }
    prevConnectedRef.current = connected;
  }, [connected, addToast]);

  // Watch for heater faults
  useEffect(() => {
    const heaters = model.heat?.heaters ?? [];
    const currentStates = heaters.map((h) => h?.state ?? 'off');
    const prevStates = prevHeaterStatesRef.current;

    if (prevStates.length > 0) {
      currentStates.forEach((state, i) => {
        if (state === 'fault' && prevStates[i] !== 'fault') {
          addToast('error', `Heater ${i} fault detected`);
        }
      });
    }

    prevHeaterStatesRef.current = currentStates;
  }, [model.heat?.heaters, addToast]);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 8,
        maxWidth: 360,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => {
        const colors = TOAST_COLORS[toast.type];
        return (
          <div
            key={toast.id}
            style={{
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 12,
              color: colors.text,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              pointerEvents: 'auto',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              fontFamily: "'Inter', 'Segoe UI', sans-serif",
              animation: 'duetToastSlideIn 0.2s ease-out',
            }}
          >
            <span style={{ flex: 1, lineHeight: 1.4 }}>{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              style={{
                background: 'none',
                border: 'none',
                color: colors.text,
                cursor: 'pointer',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
                opacity: 0.7,
                flexShrink: 0,
              }}
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}

      {/* Inline animation keyframes */}
      <style>{`
        @keyframes duetToastSlideIn {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}
