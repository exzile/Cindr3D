import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DoorSensorSource = 'manual' | 'rrf' | 'klipper' | 'mqtt';

export interface DoorSensorConfig {
  enabled: boolean;
  source: DoorSensorSource;
  mqttTopic: string;
  openPayload: string;
  closedPayload: string;
  isOpen: boolean;
  pauseOnOpen: boolean;
  preventPrintStart: boolean;
  updatedAt: number | null;
}

interface DoorSensorStore {
  printers: Record<string, DoorSensorConfig>;
  getDoorSensor: (printerId: string | null | undefined) => DoorSensorConfig;
  updateDoorSensor: (printerId: string, patch: Partial<DoorSensorConfig>) => void;
  setDoorOpen: (printerId: string, isOpen: boolean, updatedAt?: number) => void;
}

export const DEFAULT_DOOR_SENSOR: DoorSensorConfig = {
  enabled: false,
  source: 'manual',
  mqttTopic: '',
  openPayload: 'open',
  closedPayload: 'closed',
  isOpen: false,
  pauseOnOpen: true,
  preventPrintStart: true,
  updatedAt: null,
};

function cleanDoorSensor(value: Partial<DoorSensorConfig>): DoorSensorConfig {
  const source = value.source ?? DEFAULT_DOOR_SENSOR.source;
  return {
    enabled: value.enabled ?? DEFAULT_DOOR_SENSOR.enabled,
    source: source === 'rrf' || source === 'klipper' || source === 'mqtt' || source === 'manual' ? source : 'manual',
    mqttTopic: value.mqttTopic?.trim() ?? DEFAULT_DOOR_SENSOR.mqttTopic,
    openPayload: value.openPayload?.trim() || DEFAULT_DOOR_SENSOR.openPayload,
    closedPayload: value.closedPayload?.trim() || DEFAULT_DOOR_SENSOR.closedPayload,
    isOpen: value.isOpen ?? DEFAULT_DOOR_SENSOR.isOpen,
    pauseOnOpen: value.pauseOnOpen ?? DEFAULT_DOOR_SENSOR.pauseOnOpen,
    preventPrintStart: value.preventPrintStart ?? DEFAULT_DOOR_SENSOR.preventPrintStart,
    updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : null,
  };
}

function defaultDoorSensor(): DoorSensorConfig {
  return { ...DEFAULT_DOOR_SENSOR };
}

export const useDoorSensorStore = create<DoorSensorStore>()(
  persist(
    (set, get) => ({
      printers: {},

      getDoorSensor: (printerId) => {
        if (!printerId) return defaultDoorSensor();
        return get().printers[printerId] ?? defaultDoorSensor();
      },

      updateDoorSensor: (printerId, patch) => {
        set((state) => {
          const current = state.printers[printerId] ?? defaultDoorSensor();
          return {
            printers: {
              ...state.printers,
              [printerId]: cleanDoorSensor({ ...current, ...patch }),
            },
          };
        });
      },

      setDoorOpen: (printerId, isOpen, updatedAt = Date.now()) => {
        set((state) => {
          const current = state.printers[printerId] ?? defaultDoorSensor();
          return {
            printers: {
              ...state.printers,
              [printerId]: cleanDoorSensor({ ...current, isOpen, updatedAt }),
            },
          };
        });
      },
    }),
    {
      name: 'cindr3d-door-sensor-v1',
      merge: (persisted, current) => {
        const value = persisted as Partial<DoorSensorStore> | undefined;
        return {
          ...current,
          printers: Object.fromEntries(
            Object.entries(value?.printers ?? {}).map(([printerId, config]) => [printerId, cleanDoorSensor(config)]),
          ),
        };
      },
    },
  ),
);
