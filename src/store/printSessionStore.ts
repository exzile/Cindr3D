import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MachineStatus } from '../types/duet';

export interface PrintSessionSnapshot {
  printerId: string;
  printerName: string;
  fileName: string;
  filePath: string;
  status: MachineStatus;
  startedAt: number;
  lastSeenAt: number;
  sourceDeviceLabel: string;
  layer: number | null;
  progress: number | null;
}

interface PrintSessionStore {
  activeSession: PrintSessionSnapshot | null;
  setActiveSession: (session: PrintSessionSnapshot) => void;
  clearActiveSession: (printerId?: string) => void;
}

export const usePrintSessionStore = create<PrintSessionStore>()(
  persist(
    (set) => ({
      activeSession: null,
      setActiveSession: (session) => set({ activeSession: session }),
      clearActiveSession: (printerId) => set((state) => (
        !printerId || state.activeSession?.printerId === printerId
          ? { activeSession: null }
          : state
      )),
    }),
    {
      name: 'cindr3d-print-session',
      version: 1,
    },
  ),
);
