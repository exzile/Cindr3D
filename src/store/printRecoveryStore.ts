import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PrintRecoverySnapshot {
  printerId: string;
  printerName: string;
  fileName: string;
  filePosition: number;
  z: number | null;
  layer: number | null;
  bedTemp: number | null;
  toolTemp: number | null;
  status: string;
  updatedAt: number;
}

interface PrintRecoveryStore {
  snapshots: Record<string, PrintRecoverySnapshot>;
  dismissed: Record<string, number>;
  saveSnapshot: (snapshot: PrintRecoverySnapshot) => void;
  clearSnapshot: (printerId: string) => void;
  dismissSnapshot: (printerId: string) => void;
  getRecoverableSnapshot: (printerId: string | null, currentStatus: string) => PrintRecoverySnapshot | null;
}

const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

function isRecoverable(snapshot: PrintRecoverySnapshot, dismissedAt: number | undefined, currentStatus: string): boolean {
  if (!snapshot.fileName || snapshot.filePosition <= 0) return false;
  if (Date.now() - snapshot.updatedAt > SNAPSHOT_TTL_MS) return false;
  if (dismissedAt && dismissedAt >= snapshot.updatedAt) return false;
  return currentStatus === 'idle' || currentStatus === 'halted';
}

export const usePrintRecoveryStore = create<PrintRecoveryStore>()(
  persist(
    (set, get) => ({
      snapshots: {},
      dismissed: {},

      saveSnapshot: (snapshot) => {
        set((state) => ({
          snapshots: { ...state.snapshots, [snapshot.printerId]: snapshot },
        }));
      },

      clearSnapshot: (printerId) => {
        set((state) => {
          const snapshots = { ...state.snapshots };
          delete snapshots[printerId];
          return { snapshots };
        });
      },

      dismissSnapshot: (printerId) => {
        set((state) => ({
          dismissed: { ...state.dismissed, [printerId]: Date.now() },
        }));
      },

      getRecoverableSnapshot: (printerId, currentStatus) => {
        if (!printerId) return null;
        const snapshot = get().snapshots[printerId];
        return snapshot && isRecoverable(snapshot, get().dismissed[printerId], currentStatus) ? snapshot : null;
      },
    }),
    { name: 'cindr3d-print-recovery-v1' },
  ),
);
