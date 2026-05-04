import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_VISION_FAILURE_SETTINGS,
  type VisionCheckResult,
  type VisionFailureSettings,
  type VisionFrameSample,
} from '../services/vision/failureDetector';
import type { PrintDiagnosisResult } from '../services/vision/printDiagnostics';

export interface VisionFailureRecord {
  id: string;
  printerId: string;
  printerName: string;
  cameraId: string;
  cameraLabel: string;
  createdAt: number;
  result: VisionCheckResult;
}

export interface VisionFrameRecord {
  id: string;
  printerId: string;
  printerName: string;
  createdAt: number;
  frame: VisionFrameSample;
}

export interface PrintDiagnosisRecord {
  id: string;
  printerId: string;
  printerName: string;
  createdAt: number;
  result: PrintDiagnosisResult;
}

export interface VisionStore {
  failureSettings: VisionFailureSettings;
  recentChecks: VisionFailureRecord[];
  recentFrames: VisionFrameRecord[];
  recentDiagnoses: PrintDiagnosisRecord[];
  updateFailureSettings: (patch: Partial<VisionFailureSettings>) => void;
  recordCheck: (record: VisionFailureRecord) => void;
  recordFrame: (record: VisionFrameRecord) => void;
  recordDiagnosis: (record: PrintDiagnosisRecord) => void;
  clearRecentChecks: () => void;
}

export const useVisionStore = create<VisionStore>()(
  persist(
    (set) => ({
      failureSettings: DEFAULT_VISION_FAILURE_SETTINGS,
      recentChecks: [],
      recentFrames: [],
      recentDiagnoses: [],
      updateFailureSettings: (patch) => set((state) => ({
        failureSettings: { ...state.failureSettings, ...patch },
      })),
      recordCheck: (record) => set((state) => ({
        recentChecks: [record, ...state.recentChecks].slice(0, 25),
      })),
      recordFrame: (record) => set((state) => ({
        recentFrames: [record, ...state.recentFrames].slice(0, 25),
      })),
      recordDiagnosis: (record) => set((state) => ({
        recentDiagnoses: [record, ...state.recentDiagnoses].slice(0, 10),
      })),
      clearRecentChecks: () => set({ recentChecks: [] }),
    }),
    {
      name: 'cindr3d-vision',
      partialize: (state) => ({ failureSettings: state.failureSettings }),
    },
  ),
);
