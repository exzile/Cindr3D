import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type StepperMode = 'stealthchop' | 'spreadcycle';

export interface StepperAxisTuning {
  currentMa: number;
  microsteps: number;
  mode: StepperMode;
  driverIndex: number;
}

export interface StepperPreset {
  id: string;
  name: string;
  axes: Record<string, StepperAxisTuning>;
}

interface StepperTuningStore {
  printers: Record<string, Record<string, StepperAxisTuning>>;
  presets: Record<string, StepperPreset[]>;
  getAxisTuning: (printerId: string | null | undefined, axis: string, fallbackDriverIndex?: number) => StepperAxisTuning;
  updateAxisTuning: (printerId: string, axis: string, patch: Partial<StepperAxisTuning>) => void;
  savePreset: (printerId: string, name: string) => void;
  applyPreset: (printerId: string, presetId: string) => void;
  removePreset: (printerId: string, presetId: string) => void;
}

export const DEFAULT_STEPPER_TUNING: StepperAxisTuning = {
  currentMa: 800,
  microsteps: 16,
  mode: 'stealthchop',
  driverIndex: 0,
};

function cleanAxisTuning(value: Partial<StepperAxisTuning>, fallbackDriverIndex = 0): StepperAxisTuning {
  return {
    currentMa: clampNumber(value.currentMa, DEFAULT_STEPPER_TUNING.currentMa, 100, 3000),
    microsteps: clampNumber(value.microsteps, DEFAULT_STEPPER_TUNING.microsteps, 1, 256),
    mode: value.mode === 'spreadcycle' ? 'spreadcycle' : 'stealthchop',
    driverIndex: clampNumber(value.driverIndex, fallbackDriverIndex, 0, 255),
  };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const next = Math.round(Number(value));
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

function uid() {
  return `stepper-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useStepperTuningStore = create<StepperTuningStore>()(
  persist(
    (set, get) => ({
      printers: {},
      presets: {},

      getAxisTuning: (printerId, axis, fallbackDriverIndex = 0) => {
        if (!printerId) return cleanAxisTuning({ driverIndex: fallbackDriverIndex }, fallbackDriverIndex);
        return cleanAxisTuning(get().printers[printerId]?.[axis.toUpperCase()] ?? { driverIndex: fallbackDriverIndex }, fallbackDriverIndex);
      },

      updateAxisTuning: (printerId, axis, patch) => {
        const letter = axis.toUpperCase();
        set((state) => {
          const current = state.printers[printerId]?.[letter] ?? { ...DEFAULT_STEPPER_TUNING };
          return {
            printers: {
              ...state.printers,
              [printerId]: {
                ...(state.printers[printerId] ?? {}),
                [letter]: cleanAxisTuning({ ...current, ...patch }, current.driverIndex),
              },
            },
          };
        });
      },

      savePreset: (printerId, name) => {
        const trimmed = name.trim() || 'Stepper preset';
        const axes = get().printers[printerId] ?? {};
        set((state) => ({
          presets: {
            ...state.presets,
            [printerId]: [
              ...(state.presets[printerId] ?? []),
              { id: uid(), name: trimmed, axes: structuredClone(axes) },
            ],
          },
        }));
      },

      applyPreset: (printerId, presetId) => {
        const preset = get().presets[printerId]?.find((item) => item.id === presetId);
        if (!preset) return;
        set((state) => ({
          printers: {
            ...state.printers,
            [printerId]: structuredClone(preset.axes),
          },
        }));
      },

      removePreset: (printerId, presetId) => {
        set((state) => ({
          presets: {
            ...state.presets,
            [printerId]: (state.presets[printerId] ?? []).filter((preset) => preset.id !== presetId),
          },
        }));
      },
    }),
    { name: 'cindr3d-stepper-tuning-v1' },
  ),
);
