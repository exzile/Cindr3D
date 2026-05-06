import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ChamberTemperatureSource = 'auto' | 'rrf' | 'klipper' | 'mqtt';

export interface ChamberControlConfig {
  enabled: boolean;
  source: ChamberTemperatureSource;
  mqttTopic: string;
  externalTemperatureC: number | null;
  targetTemperatureC: number;
  rampEnabled: boolean;
  rampStartTemperatureC: number;
  rampStepC: number;
  rampStepMinutes: number;
  rampActive: boolean;
  rampStartedAt: number | null;
  rampLastCommandedC: number | null;
  preheatBeforePrint: boolean;
  cooldownOnDone: boolean;
  cooldownOnDoorOpen: boolean;
  doorOpen: boolean;
}

interface ChamberControlStore extends ChamberControlConfig {
  updateChamberControl: (patch: Partial<ChamberControlConfig>) => void;
  setExternalTemperature: (temperatureC: number | null) => void;
  startRamp: (startedAt?: number) => void;
  stopRamp: () => void;
}

export const DEFAULT_CHAMBER_CONTROL: ChamberControlConfig = {
  enabled: false,
  source: 'auto',
  mqttTopic: '',
  externalTemperatureC: null,
  targetTemperatureC: 45,
  rampEnabled: false,
  rampStartTemperatureC: 30,
  rampStepC: 5,
  rampStepMinutes: 10,
  rampActive: false,
  rampStartedAt: null,
  rampLastCommandedC: null,
  preheatBeforePrint: true,
  cooldownOnDone: true,
  cooldownOnDoorOpen: true,
  doorOpen: false,
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

export function cleanChamberControlConfig(config: Partial<ChamberControlConfig>): ChamberControlConfig {
  const source = config.source ?? DEFAULT_CHAMBER_CONTROL.source;
  return {
    enabled: config.enabled ?? DEFAULT_CHAMBER_CONTROL.enabled,
    source: source === 'rrf' || source === 'klipper' || source === 'mqtt' || source === 'auto' ? source : 'auto',
    mqttTopic: config.mqttTopic?.trim() ?? DEFAULT_CHAMBER_CONTROL.mqttTopic,
    externalTemperatureC: typeof config.externalTemperatureC === 'number' && Number.isFinite(config.externalTemperatureC)
      ? clampNumber(config.externalTemperatureC, 0, -40, 180)
      : null,
    targetTemperatureC: clampNumber(config.targetTemperatureC, DEFAULT_CHAMBER_CONTROL.targetTemperatureC, 0, 120),
    rampEnabled: config.rampEnabled ?? DEFAULT_CHAMBER_CONTROL.rampEnabled,
    rampStartTemperatureC: clampNumber(config.rampStartTemperatureC, DEFAULT_CHAMBER_CONTROL.rampStartTemperatureC, 0, 120),
    rampStepC: clampNumber(config.rampStepC, DEFAULT_CHAMBER_CONTROL.rampStepC, 1, 30),
    rampStepMinutes: clampNumber(config.rampStepMinutes, DEFAULT_CHAMBER_CONTROL.rampStepMinutes, 1, 120),
    rampActive: config.rampActive ?? DEFAULT_CHAMBER_CONTROL.rampActive,
    rampStartedAt: typeof config.rampStartedAt === 'number' && Number.isFinite(config.rampStartedAt) ? config.rampStartedAt : null,
    rampLastCommandedC: typeof config.rampLastCommandedC === 'number' && Number.isFinite(config.rampLastCommandedC)
      ? clampNumber(config.rampLastCommandedC, 0, 0, 120)
      : null,
    preheatBeforePrint: config.preheatBeforePrint ?? DEFAULT_CHAMBER_CONTROL.preheatBeforePrint,
    cooldownOnDone: config.cooldownOnDone ?? DEFAULT_CHAMBER_CONTROL.cooldownOnDone,
    cooldownOnDoorOpen: config.cooldownOnDoorOpen ?? DEFAULT_CHAMBER_CONTROL.cooldownOnDoorOpen,
    doorOpen: config.doorOpen ?? DEFAULT_CHAMBER_CONTROL.doorOpen,
  };
}

export const useChamberControlStore = create<ChamberControlStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_CHAMBER_CONTROL,

      updateChamberControl: (patch) => {
        set((state) => cleanChamberControlConfig({ ...state, ...patch }));
      },

      setExternalTemperature: (temperatureC) => {
        set((state) => cleanChamberControlConfig({ ...state, externalTemperatureC: temperatureC }));
      },

      startRamp: (startedAt = Date.now()) => {
        set((state) => cleanChamberControlConfig({
          ...state,
          rampEnabled: true,
          rampActive: true,
          rampStartedAt: startedAt,
          rampLastCommandedC: null,
        }));
      },

      stopRamp: () => {
        const state = get();
        set(cleanChamberControlConfig({
          ...state,
          rampActive: false,
          rampStartedAt: null,
          rampLastCommandedC: null,
        }));
      },
    }),
    {
      name: 'cindr3d-chamber-control-v1',
      merge: (persisted, current) => {
        const value = persisted as Partial<ChamberControlStore> | undefined;
        return {
          ...current,
          ...cleanChamberControlConfig({ ...DEFAULT_CHAMBER_CONTROL, ...value }),
        };
      },
    },
  ),
);
