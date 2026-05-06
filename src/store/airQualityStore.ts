import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AirQualitySensorKey = 'voc' | 'pm25' | 'co2';

export interface AirQualityReading {
  value: number | null;
  updatedAt: number | null;
}

export interface AirQualitySensorConfig {
  topic: string;
  warnAt: number;
  pauseAt: number;
}

export interface AirQualityPrinterConfig {
  enabled: boolean;
  pauseOnCritical: boolean;
  sensors: Record<AirQualitySensorKey, AirQualitySensorConfig>;
  readings: Record<AirQualitySensorKey, AirQualityReading>;
}

interface AirQualityStore {
  printers: Record<string, AirQualityPrinterConfig>;
  getPrinterAirQuality: (printerId: string | null | undefined) => AirQualityPrinterConfig;
  updateAirQualityConfig: (printerId: string, patch: Partial<Omit<AirQualityPrinterConfig, 'readings'>>) => void;
  updateAirQualitySensor: (printerId: string, sensor: AirQualitySensorKey, patch: Partial<AirQualitySensorConfig>) => void;
  setAirQualityReading: (printerId: string, sensor: AirQualitySensorKey, value: number | null, updatedAt?: number) => void;
}

export const AIR_QUALITY_SENSOR_LABELS: Record<AirQualitySensorKey, string> = {
  voc: 'VOC',
  pm25: 'PM2.5',
  co2: 'CO2',
};

export const DEFAULT_AIR_QUALITY_CONFIG: AirQualityPrinterConfig = {
  enabled: false,
  pauseOnCritical: true,
  sensors: {
    voc: { topic: '', warnAt: 500, pauseAt: 1000 },
    pm25: { topic: '', warnAt: 35, pauseAt: 75 },
    co2: { topic: '', warnAt: 1000, pauseAt: 2000 },
  },
  readings: {
    voc: { value: null, updatedAt: null },
    pm25: { value: null, updatedAt: null },
    co2: { value: null, updatedAt: null },
  },
};

function cloneDefault(): AirQualityPrinterConfig {
  return {
    enabled: DEFAULT_AIR_QUALITY_CONFIG.enabled,
    pauseOnCritical: DEFAULT_AIR_QUALITY_CONFIG.pauseOnCritical,
    sensors: {
      voc: { ...DEFAULT_AIR_QUALITY_CONFIG.sensors.voc },
      pm25: { ...DEFAULT_AIR_QUALITY_CONFIG.sensors.pm25 },
      co2: { ...DEFAULT_AIR_QUALITY_CONFIG.sensors.co2 },
    },
    readings: {
      voc: { ...DEFAULT_AIR_QUALITY_CONFIG.readings.voc },
      pm25: { ...DEFAULT_AIR_QUALITY_CONFIG.readings.pm25 },
      co2: { ...DEFAULT_AIR_QUALITY_CONFIG.readings.co2 },
    },
  };
}

function cleanSensorConfig(sensor: AirQualitySensorKey, value: Partial<AirQualitySensorConfig>): AirQualitySensorConfig {
  const defaults = DEFAULT_AIR_QUALITY_CONFIG.sensors[sensor];
  return {
    topic: value.topic?.trim() ?? defaults.topic,
    warnAt: clampNumber(value.warnAt, defaults.warnAt, 0, 100000),
    pauseAt: clampNumber(value.pauseAt, defaults.pauseAt, 0, 100000),
  };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

export function cleanAirQualityConfig(value: Partial<AirQualityPrinterConfig>): AirQualityPrinterConfig {
  const current = cloneDefault();
  return {
    enabled: value.enabled ?? current.enabled,
    pauseOnCritical: value.pauseOnCritical ?? current.pauseOnCritical,
    sensors: {
      voc: cleanSensorConfig('voc', { ...current.sensors.voc, ...value.sensors?.voc }),
      pm25: cleanSensorConfig('pm25', { ...current.sensors.pm25, ...value.sensors?.pm25 }),
      co2: cleanSensorConfig('co2', { ...current.sensors.co2, ...value.sensors?.co2 }),
    },
    readings: {
      voc: cleanReading(value.readings?.voc),
      pm25: cleanReading(value.readings?.pm25),
      co2: cleanReading(value.readings?.co2),
    },
  };
}

function cleanReading(value: Partial<AirQualityReading> | undefined): AirQualityReading {
  return {
    value: typeof value?.value === 'number' && Number.isFinite(value.value) ? value.value : null,
    updatedAt: typeof value?.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : null,
  };
}

export const useAirQualityStore = create<AirQualityStore>()(
  persist(
    (set, get) => ({
      printers: {},

      getPrinterAirQuality: (printerId) => {
        if (!printerId) return cloneDefault();
        return get().printers[printerId] ?? cloneDefault();
      },

      updateAirQualityConfig: (printerId, patch) => {
        set((state) => {
          const current = state.printers[printerId] ?? cloneDefault();
          return {
            printers: {
              ...state.printers,
              [printerId]: cleanAirQualityConfig({ ...current, ...patch }),
            },
          };
        });
      },

      updateAirQualitySensor: (printerId, sensor, patch) => {
        set((state) => {
          const current = state.printers[printerId] ?? cloneDefault();
          return {
            printers: {
              ...state.printers,
              [printerId]: cleanAirQualityConfig({
                ...current,
                sensors: {
                  ...current.sensors,
                  [sensor]: cleanSensorConfig(sensor, { ...current.sensors[sensor], ...patch }),
                },
              }),
            },
          };
        });
      },

      setAirQualityReading: (printerId, sensor, value, updatedAt = Date.now()) => {
        set((state) => {
          const current = state.printers[printerId] ?? cloneDefault();
          return {
            printers: {
              ...state.printers,
              [printerId]: cleanAirQualityConfig({
                ...current,
                readings: {
                  ...current.readings,
                  [sensor]: {
                    value: typeof value === 'number' && Number.isFinite(value) ? value : null,
                    updatedAt,
                  },
                },
              }),
            },
          };
        });
      },
    }),
    {
      name: 'cindr3d-air-quality-v1',
      merge: (persisted, current) => {
        const value = persisted as Partial<AirQualityStore> | undefined;
        return {
          ...current,
          printers: Object.fromEntries(
            Object.entries(value?.printers ?? {}).map(([printerId, config]) => [printerId, cleanAirQualityConfig(config)]),
          ),
        };
      },
    },
  ),
);
