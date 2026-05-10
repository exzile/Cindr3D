import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CalibrationItemId =
  | 'bed-mesh'
  | 'pressure-advance'
  | 'input-shaper'
  | 'z-offset'
  | 'first-layer'
  | 'firmware-health';

export interface WizardSession {
  id: string;
  printerId: string;
  testType: string;
  step: number;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  spoolId: string;
  /** Filament material selected in step 1, e.g. 'PLA', 'PETG'. */
  filamentMaterial?: string;
  status: 'active' | 'completed';
}

export type MaintenanceStatus = 'ok' | 'upcoming' | 'overdue' | 'never';

export interface CalibrationItemDefinition {
  id: CalibrationItemId;
  label: string;
  defaultIntervalDays: number;
}

export type CalibrationResult = {
  id: string;
  recordedAt: number;
  appliedValue: number | null;
  measurements: Record<string, number>;
  photoIds: string[];
  aiConfidence: number | null;
  note: string;
  /** Firmware type at calibration time (e.g. 'duet', 'klipper'). */
  firmwareType?: string;
  /** Firmware version from the live board at calibration time (e.g. '3.5.4'). */
  firmwareVersion?: string;
  /** Spool / filament ID used during this calibration run. */
  spoolId?: string;
};

export interface CalibrationRecord {
  itemId: CalibrationItemId;
  lastRunAt: number | null;
  intervalDays: number;
  note: string;
  results?: CalibrationResult[];
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
  wizardSessions: WizardSession[];
  /** One active wizard session per printer (keyed by printerId). Null = no session. */
  activeWizardSessions: Record<string, WizardSession | null>;

  getCalibrationRecords: (printerId: string) => CalibrationRecord[];
  addCalibrationResult: (printerId: string, itemId: CalibrationItemId, result: Omit<CalibrationResult, 'id'>) => void;
  getCalibrationResults: (printerId: string, itemId: CalibrationItemId) => CalibrationResult[];
  recordCalibration: (printerId: string, itemId: CalibrationItemId, note?: string, when?: number) => void;
  updateCalibrationInterval: (printerId: string, itemId: CalibrationItemId, intervalDays: number) => void;
  addComponent: (component: Omit<WearComponent, 'id' | 'installedAt' | 'hoursOn' | 'filamentKm'> & Partial<Pick<WearComponent, 'installedAt' | 'hoursOn' | 'filamentKm'>>) => string;
  updateComponent: (id: string, patch: Partial<Omit<WearComponent, 'id'>>) => void;
  removeComponent: (id: string) => void;
  logService: (entry: Omit<ServiceLogEntry, 'id' | 'performedAt'> & Partial<Pick<ServiceLogEntry, 'performedAt'>>) => string;
  upsertMoistureProfile: (spoolId: string, patch: Partial<Omit<SpoolMoistureProfile, 'spoolId' | 'lastUpdatedAt'>>) => void;
  createWizardSession: (printerId: string, testType: string, spoolId?: string) => string;
  updateWizardSessionById: (id: string, patch: Partial<Pick<WizardSession, 'step' | 'spoolId' | 'filamentMaterial' | 'status'>>) => void;
  completeWizardSession: (id: string) => void;
  deleteWizardSession: (id: string) => void;
  startWizardSession: (printerId: string, testType: string, spoolId?: string) => void;
  updateWizardSession: (printerId: string, step: number, spoolId?: string) => void;
  endWizardSession: (printerId: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SERVICE_LOG_LIMIT = 200;
const CALIBRATION_RESULTS_LIMIT = 5;
const WIZARD_SESSION_LIMIT = 50;

export const CALIBRATION_ITEMS: CalibrationItemDefinition[] = [
  { id: 'bed-mesh', label: 'Bed mesh', defaultIntervalDays: 14 },
  { id: 'pressure-advance', label: 'Pressure advance', defaultIntervalDays: 45 },
  { id: 'input-shaper', label: 'Input shaper', defaultIntervalDays: 90 },
  { id: 'z-offset', label: 'Z-offset check', defaultIntervalDays: 14 },
  { id: 'first-layer', label: 'First-layer test', defaultIntervalDays: 7 },
  { id: 'firmware-health', label: 'Firmware health', defaultIntervalDays: 30 },
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
    results: [],
  };
}

function normalizeWizardSession(
  session: Partial<WizardSession> & Pick<WizardSession, 'testType' | 'startedAt' | 'spoolId'>,
  printerId: string,
): WizardSession {
  const now = Date.now();
  return {
    id: session.id ?? uid('calib-session'),
    printerId: session.printerId ?? printerId,
    testType: session.testType,
    step: Number.isFinite(session.step) ? Math.min(8, Math.max(1, Math.round(session.step ?? 1))) : 1,
    startedAt: Number.isFinite(session.startedAt) ? session.startedAt : now,
    updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt ?? now : now,
    completedAt: session.completedAt ?? null,
    spoolId: session.spoolId ?? '',
    status: session.status === 'completed' ? 'completed' : 'active',
  };
}

function ensurePrinterRecords(records: Record<CalibrationItemId, CalibrationRecord> | undefined): Record<CalibrationItemId, CalibrationRecord> {
  return Object.fromEntries(
    CALIBRATION_ITEMS.map((item) => {
      const existing = records?.[item.id];
      return [item.id, existing ? { ...existing, results: existing.results ?? [] } : defaultCalibrationRecord(item)];
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

export function getCalibrationConfidence(results: CalibrationResult[]): {
  mean: number | null;
  stdDev: number | null;
  isStable: boolean;
  highConfidence: boolean;
  sampleCount: number;
} {
  const values = results
    .map((result) => result.appliedValue)
    .filter((value): value is number => value !== null);
  const sampleCount = values.length;

  if (sampleCount === 0) {
    return {
      mean: null,
      stdDev: null,
      isStable: false,
      highConfidence: false,
      sampleCount,
    };
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / sampleCount;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sampleCount;
  const stdDev = Math.sqrt(variance);
  const isStable = stdDev < mean * 0.05;

  return {
    mean,
    stdDev,
    isStable,
    highConfidence: sampleCount >= 3 && isStable,
    sampleCount,
  };
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
      wizardSessions: [],
      activeWizardSessions: {},

      getCalibrationRecords: (printerId) => Object.values(ensurePrinterRecords(get().calibrationByPrinterId[printerId])),

      addCalibrationResult: (printerId, itemId, result) => {
        set((state) => {
          const printerRecords = ensurePrinterRecords(state.calibrationByPrinterId[printerId]);
          return {
            calibrationByPrinterId: {
              ...state.calibrationByPrinterId,
              [printerId]: {
                ...printerRecords,
                [itemId]: {
                  ...printerRecords[itemId],
                  results: [
                    { ...result, id: uid('result') },
                    ...(printerRecords[itemId].results ?? []),
                  ].slice(0, CALIBRATION_RESULTS_LIMIT),
                },
              },
            },
          };
        });
      },

      getCalibrationResults: (printerId, itemId) => ensurePrinterRecords(get().calibrationByPrinterId[printerId])[itemId].results ?? [],

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

      createWizardSession: (printerId, testType, spoolId = '') => {
        const session = normalizeWizardSession({ testType, step: 1, startedAt: Date.now(), spoolId }, printerId);
        set((state) => ({
          wizardSessions: [session, ...state.wizardSessions].slice(0, WIZARD_SESSION_LIMIT),
          activeWizardSessions: {
            ...state.activeWizardSessions,
            [printerId]: session,
          },
        }));
        return session.id;
      },

      updateWizardSessionById: (id, patch) => set((state) => {
        const existing = state.wizardSessions.find((session) => session.id === id);
        if (!existing) return {};
        const updatedSession: WizardSession = {
          ...existing,
          ...patch,
          step: patch.step !== undefined ? Math.min(8, Math.max(1, Math.round(patch.step))) : existing.step,
          updatedAt: Date.now(),
        };
        const wizardSessions = state.wizardSessions.map((session) => (
          session.id === id ? updatedSession : session
        ));
        const activeWizardSessions = {
          ...state.activeWizardSessions,
          [updatedSession.printerId]: updatedSession.status === 'active' ? updatedSession : null,
        };
        return { wizardSessions, activeWizardSessions };
      }),

      completeWizardSession: (id) => set((state) => {
        const existing = state.wizardSessions.find((session) => session.id === id);
        if (!existing) return {};
        const now = Date.now();
        const completedSession: WizardSession = { ...existing, status: 'completed', completedAt: now, updatedAt: now, step: 8 };
        const wizardSessions = state.wizardSessions.map((session) => (
          session.id === id ? completedSession : session
        ));
        const activeWizardSessions = { ...state.activeWizardSessions, [completedSession.printerId]: null };
        return { wizardSessions, activeWizardSessions };
      }),

      deleteWizardSession: (id) => set((state) => {
        const session = state.wizardSessions.find((item) => item.id === id);
        return {
          wizardSessions: state.wizardSessions.filter((item) => item.id !== id),
          activeWizardSessions: session && state.activeWizardSessions[session.printerId]?.id === id
            ? { ...state.activeWizardSessions, [session.printerId]: null }
            : state.activeWizardSessions,
        };
      }),

      startWizardSession: (printerId, testType, spoolId = '') => set((state) => {
        const session = normalizeWizardSession({ testType, step: 1, startedAt: Date.now(), spoolId }, printerId);
        return {
          wizardSessions: [session, ...state.wizardSessions].slice(0, WIZARD_SESSION_LIMIT),
          activeWizardSessions: {
            ...state.activeWizardSessions,
            [printerId]: session,
          },
        };
      }),

      updateWizardSession: (printerId, step, spoolId) => set((state) => {
        const existing = state.activeWizardSessions[printerId];
        if (!existing) return {};
        const updated = {
          ...existing,
          step: Math.min(8, Math.max(1, Math.round(step))),
          updatedAt: Date.now(),
          ...(spoolId !== undefined ? { spoolId } : {}),
        };
        return {
          wizardSessions: state.wizardSessions.map((session) => (
            session.id === existing.id ? updated : session
          )),
          activeWizardSessions: {
            ...state.activeWizardSessions,
            [printerId]: updated,
          },
        };
      }),

      endWizardSession: (printerId) => set((state) => ({
        wizardSessions: state.wizardSessions.filter((session) => session.id !== state.activeWizardSessions[printerId]?.id),
        activeWizardSessions: {
          ...state.activeWizardSessions,
          [printerId]: null,
        },
      })),

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
      version: 3,
      migrate: (persistedState) => {
        const state = persistedState as Partial<CalibrationStore>;
        const migratedSessions = [
          ...(state.wizardSessions ?? []),
          ...Object.entries(state.activeWizardSessions ?? {})
            .filter((entry): entry is [string, WizardSession] => entry[1] !== null)
            .map(([printerId, session]) => normalizeWizardSession(session, printerId)),
        ];
        if (!state.calibrationByPrinterId) {
          return {
            ...state,
            wizardSessions: migratedSessions,
          };
        }
        return {
          ...state,
          wizardSessions: migratedSessions,
          calibrationByPrinterId: Object.fromEntries(
            Object.entries(state.calibrationByPrinterId).map(([printerId, records]) => [
              printerId,
              ensurePrinterRecords(records),
            ]),
          ),
        };
      },
    },
  ),
);
