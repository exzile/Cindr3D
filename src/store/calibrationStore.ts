import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CalibrationItemId =
  | 'bed-mesh'
  | 'pressure-advance'
  | 'input-shaper'
  | 'z-offset'
  | 'first-layer';

export type MaintenanceStatus = 'ok' | 'upcoming' | 'overdue' | 'never';

export interface CalibrationItemDefinition {
  id: CalibrationItemId;
  label: string;
  defaultIntervalDays: number;
}

export interface CalibrationRecord {
  itemId: CalibrationItemId;
  lastRunAt: number | null;
  intervalDays: number;
  note: string;
}

export interface WearComponent {
  id: string;
  printerId: string;
  name: string;
  category: 'belt' | 'bearing' | 'nozzle' | 'hotend' | 'build-plate' | 'other';
  installedAt: number;
  hoursOn: number;
  filamentKm: number;
  reminderHours: number | null;
  reminderFilamentKm: number | null;
  replacementCost: number | null;
  note: string;
}

export interface ServiceLogEntry {
  id: string;
  printerId: string;
  componentId: string | null;
  performedAt: number;
  summary: string;
  performedBy: string;
  cost: number | null;
}

export interface SpoolMoistureProfile {
  spoolId: string;
  openedAt: number | null;
  ambientHumidityPct: number;
  sensorLabel: string;
  lastUpdatedAt: number;
}

export interface CalibrationStatus {
  record: CalibrationRecord;
  definition: CalibrationItemDefinition;
  status: MaintenanceStatus;
  dueAt: number | null;
  daysUntilDue: number | null;
}

export interface ComponentStatus {
  component: WearComponent;
  status: MaintenanceStatus;
  hoursRemaining: number | null;
  filamentKmRemaining: number | null;
}

export interface MoistureStatus {
  profile: SpoolMoistureProfile;
  status: MaintenanceStatus;
  exposureDays: number | null;
  score: number;
}

interface CalibrationStore {
  calibrationByPrinterId: Record<string, Record<CalibrationItemId, CalibrationRecord>>;
  components: WearComponent[];
  serviceLog: ServiceLogEntry[];
  moistureBySpoolId: Record<string, SpoolMoistureProfile>;

  getCalibrationRecords: (printerId: string) => CalibrationRecord[];
  recordCalibration: (printerId: string, itemId: CalibrationItemId, note?: string, when?: number) => void;
  updateCalibrationInterval: (printerId: string, itemId: CalibrationItemId, intervalDays: number) => void;
  addComponent: (component: Omit<WearComponent, 'id' | 'installedAt' | 'hoursOn' | 'filamentKm'> & Partial<Pick<WearComponent, 'installedAt' | 'hoursOn' | 'filamentKm'>>) => string;
  updateComponent: (id: string, patch: Partial<Omit<WearComponent, 'id'>>) => void;
  removeComponent: (id: string) => void;
  logService: (entry: Omit<ServiceLogEntry, 'id' | 'performedAt'> & Partial<Pick<ServiceLogEntry, 'performedAt'>>) => string;
  upsertMoistureProfile: (spoolId: string, patch: Partial<Omit<SpoolMoistureProfile, 'spoolId' | 'lastUpdatedAt'>>) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SERVICE_LOG_LIMIT = 200;

export const CALIBRATION_ITEMS: CalibrationItemDefinition[] = [
  { id: 'bed-mesh', label: 'Bed mesh', defaultIntervalDays: 14 },
  { id: 'pressure-advance', label: 'Pressure advance', defaultIntervalDays: 45 },
  { id: 'input-shaper', label: 'Input shaper', defaultIntervalDays: 90 },
  { id: 'z-offset', label: 'Z-offset check', defaultIntervalDays: 14 },
  { id: 'first-layer', label: 'First-layer test', defaultIntervalDays: 7 },
];

export const DEFAULT_COMPONENTS: Array<Pick<WearComponent, 'name' | 'category' | 'reminderHours' | 'reminderFilamentKm'>> = [
  { name: 'Nozzle', category: 'nozzle', reminderHours: null, reminderFilamentKm: 2 },
  { name: 'Belts', category: 'belt', reminderHours: 1200, reminderFilamentKm: null },
  { name: 'Linear bearings', category: 'bearing', reminderHours: 1800, reminderFilamentKm: null },
  { name: 'Hotend', category: 'hotend', reminderHours: 2500, reminderFilamentKm: null },
  { name: 'Build plate', category: 'build-plate', reminderHours: 800, reminderFilamentKm: null },
];

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultCalibrationRecord(item: CalibrationItemDefinition): CalibrationRecord {
  return {
    itemId: item.id,
    lastRunAt: null,
    intervalDays: item.defaultIntervalDays,
    note: '',
  };
}

function ensurePrinterRecords(records: Record<CalibrationItemId, CalibrationRecord> | undefined): Record<CalibrationItemId, CalibrationRecord> {
  return Object.fromEntries(
    CALIBRATION_ITEMS.map((item) => {
      const existing = records?.[item.id];
      return [item.id, existing ?? defaultCalibrationRecord(item)];
    }),
  ) as Record<CalibrationItemId, CalibrationRecord>;
}

function finiteNonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function finiteNullableNonNegative(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;
}

export function getCalibrationStatus(record: CalibrationRecord, now = Date.now()): MaintenanceStatus {
  if (record.lastRunAt == null) return 'never';
  const dueAt = record.lastRunAt + record.intervalDays * DAY_MS;
  const upcomingAt = dueAt - Math.max(1, Math.round(record.intervalDays * 0.2)) * DAY_MS;
  if (now >= dueAt) return 'overdue';
  if (now >= upcomingAt) return 'upcoming';
  return 'ok';
}

export function getCalibrationStatuses(records: CalibrationRecord[], now = Date.now()): CalibrationStatus[] {
  return records.map((record) => {
    const definition = CALIBRATION_ITEMS.find((item) => item.id === record.itemId) ?? CALIBRATION_ITEMS[0];
    const dueAt = record.lastRunAt == null ? null : record.lastRunAt + record.intervalDays * DAY_MS;
    const daysUntilDue = dueAt === null ? null : Math.ceil((dueAt - now) / DAY_MS);
    return {
      record,
      definition,
      dueAt,
      daysUntilDue,
      status: getCalibrationStatus(record, now),
    };
  });
}

export function getComponentStatus(component: WearComponent): ComponentStatus {
  const hoursRemaining = component.reminderHours === null ? null : component.reminderHours - component.hoursOn;
  const filamentKmRemaining = component.reminderFilamentKm === null ? null : component.reminderFilamentKm - component.filamentKm;
  const overdue = (hoursRemaining !== null && hoursRemaining <= 0) || (filamentKmRemaining !== null && filamentKmRemaining <= 0);
  const upcoming =
    (hoursRemaining !== null && hoursRemaining <= Math.max(10, component.reminderHours! * 0.15)) ||
    (filamentKmRemaining !== null && filamentKmRemaining <= Math.max(0.1, component.reminderFilamentKm! * 0.15));
  return {
    component,
    hoursRemaining,
    filamentKmRemaining,
    status: overdue ? 'overdue' : upcoming ? 'upcoming' : 'ok',
  };
}

export function getMoistureStatus(profile: SpoolMoistureProfile, now = Date.now()): MoistureStatus {
  if (profile.openedAt == null) {
    return { profile, status: 'never', exposureDays: null, score: 0 };
  }
  const exposureDays = Math.max(0, (now - profile.openedAt) / DAY_MS);
  const humidityFactor = Math.max(0.4, profile.ambientHumidityPct / 50);
  const score = exposureDays * humidityFactor;
  const status: MaintenanceStatus = score >= 18 ? 'overdue' : score >= 10 ? 'upcoming' : 'ok';
  return { profile, status, exposureDays, score };
}

export function summarizeMaintenance(
  calibrationRecords: CalibrationRecord[],
  components: WearComponent[],
  moistureProfiles: SpoolMoistureProfile[],
  now = Date.now(),
): { overdue: number; upcoming: number; ok: number; never: number } {
  const counts = { overdue: 0, upcoming: 0, ok: 0, never: 0 };
  for (const item of getCalibrationStatuses(calibrationRecords, now)) counts[item.status] += 1;
  for (const item of components.map(getComponentStatus)) counts[item.status] += 1;
  for (const item of moistureProfiles.map((profile) => getMoistureStatus(profile, now))) counts[item.status] += 1;
  return counts;
}

export const useCalibrationStore = create<CalibrationStore>()(
  persist(
    (set, get) => ({
      calibrationByPrinterId: {},
      components: [],
      serviceLog: [],
      moistureBySpoolId: {},

      getCalibrationRecords: (printerId) => Object.values(ensurePrinterRecords(get().calibrationByPrinterId[printerId])),

      recordCalibration: (printerId, itemId, note = '', when = Date.now()) => {
        set((state) => {
          const printerRecords = ensurePrinterRecords(state.calibrationByPrinterId[printerId]);
          return {
            calibrationByPrinterId: {
              ...state.calibrationByPrinterId,
              [printerId]: {
                ...printerRecords,
                [itemId]: {
                  ...printerRecords[itemId],
                  lastRunAt: when,
                  note,
                },
              },
            },
          };
        });
      },

      updateCalibrationInterval: (printerId, itemId, intervalDays) => {
        if (!Number.isFinite(intervalDays)) return;
        set((state) => {
          const printerRecords = ensurePrinterRecords(state.calibrationByPrinterId[printerId]);
          return {
            calibrationByPrinterId: {
              ...state.calibrationByPrinterId,
              [printerId]: {
                ...printerRecords,
                [itemId]: {
                  ...printerRecords[itemId],
                  intervalDays: Math.max(1, Math.round(intervalDays)),
                },
              },
            },
          };
        });
      },

      addComponent: (component) => {
        const id = uid('component');
        set((state) => ({
          components: [
            ...state.components,
            {
              ...component,
              id,
              installedAt: component.installedAt ?? Date.now(),
              hoursOn: finiteNonNegative(component.hoursOn ?? 0, 0),
              filamentKm: finiteNonNegative(component.filamentKm ?? 0, 0),
              reminderHours: finiteNullableNonNegative(component.reminderHours),
              reminderFilamentKm: finiteNullableNonNegative(component.reminderFilamentKm),
              replacementCost: finiteNullableNonNegative(component.replacementCost),
            },
          ],
        }));
        return id;
      },

      updateComponent: (id, patch) => {
        const cleanPatch = { ...patch };
        if (cleanPatch.hoursOn !== undefined) cleanPatch.hoursOn = finiteNonNegative(cleanPatch.hoursOn, 0);
        if (cleanPatch.filamentKm !== undefined) cleanPatch.filamentKm = finiteNonNegative(cleanPatch.filamentKm, 0);
        if (cleanPatch.reminderHours !== undefined) cleanPatch.reminderHours = finiteNullableNonNegative(cleanPatch.reminderHours);
        if (cleanPatch.reminderFilamentKm !== undefined) cleanPatch.reminderFilamentKm = finiteNullableNonNegative(cleanPatch.reminderFilamentKm);
        if (cleanPatch.replacementCost !== undefined) cleanPatch.replacementCost = finiteNullableNonNegative(cleanPatch.replacementCost);
        set((state) => ({
          components: state.components.map((component) => (
            component.id === id ? { ...component, ...cleanPatch } : component
          )),
        }));
      },

      removeComponent: (id) => {
        set((state) => ({
          components: state.components.filter((component) => component.id !== id),
          serviceLog: state.serviceLog.map((entry) => (
            entry.componentId === id ? { ...entry, componentId: null } : entry
          )),
        }));
      },

      logService: (entry) => {
        const id = uid('service');
        set((state) => ({
          serviceLog: [
            { ...entry, id, performedAt: entry.performedAt ?? Date.now(), cost: finiteNullableNonNegative(entry.cost) },
            ...state.serviceLog,
          ].slice(0, SERVICE_LOG_LIMIT),
        }));
        return id;
      },

      upsertMoistureProfile: (spoolId, patch) => {
        set((state) => {
          const existing = state.moistureBySpoolId[spoolId] ?? {
            spoolId,
            openedAt: null,
            ambientHumidityPct: 50,
            sensorLabel: '',
            lastUpdatedAt: Date.now(),
          };
          return {
            moistureBySpoolId: {
              ...state.moistureBySpoolId,
              [spoolId]: {
                ...existing,
                ...patch,
                lastUpdatedAt: Date.now(),
              },
            },
          };
        });
      },
    }),
    {
      name: 'cindr3d-calibration-lifecycle',
      version: 1,
    },
  ),
);
