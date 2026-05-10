import { create } from 'zustand';

export type ToastKind = 'gcode' | 'macro' | 'info' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  /** Primary text — the command or macro name */
  label: string;
  /** Optional short subtitle */
  sub?: string;
  /** Inline action buttons — toast stays until acted on or dismissed */
  actions?: ToastAction[];
  /** Whether the toast is sliding out */
  exiting: boolean;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (kind: ToastKind, label: string, sub?: string, actions?: ToastAction[], durationMs?: number) => string;
  dismissToast: (id: string) => void;
}

const DURATION_MS = 2800;
/** Action toasts stay visible much longer so the user can read and click */
const ACTION_DURATION_MS = 10_000;
const EXIT_MS     = 300;
const MAX_TOASTS  = 5;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (kind, label, sub, actions, durationMs) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const toast: Toast = { id, kind, label, sub: sub ?? undefined, actions, exiting: false };
    const duration = durationMs ?? (actions?.length ? ACTION_DURATION_MS : DURATION_MS);

    set((s) => ({
      toasts: [...s.toasts, toast].slice(-MAX_TOASTS),
    }));

    // Begin exit animation just before removal
    setTimeout(() => {
      set((s) => ({
        toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
      }));
    }, duration - EXIT_MS);

    // Remove from DOM after animation
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, duration);

    return id;
  },

  dismissToast: (id) => {
    set((s) => ({
      toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, EXIT_MS);
  },
}));

/** Convenience helper — callable outside React (from store actions). */
export function addToast(
  kind: ToastKind,
  label: string,
  sub?: string,
  actions?: ToastAction[],
  durationMs?: number,
): string {
  return useToastStore.getState().addToast(kind, label, sub, actions, durationMs);
}
