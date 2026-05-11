// schedulingStore.ts — persistent state for Phase 12 print scheduling.
// Owns:
//   - ScheduledPrint slots (calendar entries)
//   - Quiet-hours windows per day-of-week
//   - Bed-clearing auto-queue settings per printer
//   - Print-start verification checklist items + per-printer overrides

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../utils/generateId';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sun
export type TOUTier = 'off-peak' | 'shoulder' | 'peak';
export type SolarProvider = 'tesla-powerwall' | 'enphase-envoy' | 'solaredge' | 'custom';

export interface QuietWindow {
  id: string;
  days: DayOfWeek[];   // which days this window applies
  startHour: number;   // 0-23 inclusive
  startMinute: number;
  endHour: number;
  endMinute: number;
  label: string;
}

export interface TOUWindow {
  id: string;
  printerId: string | null;
  days: DayOfWeek[];
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  label: string;
  tier: TOUTier;
  ratePerKwh: number;
}

export interface UtilityRateConfig {
  printerId: string;
  enabled: boolean;
  url: string;
  format: 'json' | 'csv';
  ratePath: string;
  updatedAt: number | null;
}

export interface SolarIntegrationConfig {
  printerId: string;
  enabled: boolean;
  provider: SolarProvider;
  endpointUrl: string;
  apiKey: string;
  minSurplusW: number;
  currentSurplusW: number;
  lastReadAt: number | null;
}

export interface SolarGateResult {
  allowed: boolean;
  surplusW: number;
  requiredW: number;
  provider: SolarProvider;
  reason: string;
}

export interface CheapestPrintWindow {
  start: number;
  end: number;
  ratePerKwh: number;
  estimatedEnergyCost: number;
  tier: TOUTier;
  label: string;
}

export interface ScheduledPrint {
  id: string;
  jobId: string | null;        // printQueueStore job id (null = placeholder)
  filePath: string;
  fileName: string;
  printerId: string | null;
  scheduledStart: number;      // epoch ms
  estimatedDurationMs: number; // 0 = unknown
  note: string;
  status: 'scheduled' | 'printing' | 'done' | 'cancelled' | 'skipped';
  createdAt: number;
}

export interface BedClearSettings {
  printerId: string;
  enabled: boolean;
  // How many seconds after job completion to wait before checking
  delayAfterPrintSec: number;
  // When vision confirms bed is clear (or user confirms), auto-start next queued job
  autoStartNextJob: boolean;
  // Last detected state: null = never checked, true = clear, false = occupied
  lastClearState: boolean | null;
  lastCheckedAt: number | null;
}

export interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

export const DEFAULT_CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    id: 'bed-clean',
    label: 'Bed is clean',
    description: 'Remove any leftover filament, adhesive residue, or debris from the previous print.',
    defaultEnabled: true,
  },
  {
    id: 'nozzle-wiped',
    label: 'Nozzle wiped',
    description: 'Purge a small amount of filament and wipe the nozzle tip.',
    defaultEnabled: true,
  },
  {
    id: 'filament-loaded',
    label: 'Correct filament loaded',
    description: 'Verify the loaded spool matches the material required for this job.',
    defaultEnabled: true,
  },
  {
    id: 'camera-healthy',
    label: 'Camera feed healthy',
    description: 'Check that the webcam feed is live and aimed at the build plate.',
    defaultEnabled: false,
  },
  {
    id: 'sd-mounted',
    label: 'SD / USB storage mounted',
    description: 'For offline printers, confirm the file has been transferred to the printer\'s storage.',
    defaultEnabled: false,
  },
];

export interface PrinterChecklistOverride {
  printerId: string;
  // item id → true (enabled) | false (disabled) | undefined (use default)
  overrides: Record<string, boolean>;
  // Whether the pre-flight modal is shown at all for this printer
  showChecklist: boolean;
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface SchedulingStore {
  scheduledPrints: ScheduledPrint[];
  quietWindows: QuietWindow[];
  touWindows: TOUWindow[];
  utilityRateConfigs: UtilityRateConfig[];
  solarIntegrationConfigs: SolarIntegrationConfig[];
  bedClearSettings: BedClearSettings[];
  checklistItems: ChecklistItem[];
  checklistOverrides: PrinterChecklistOverride[];

  // Calendar actions
  addScheduledPrint: (entry: Omit<ScheduledPrint, 'id' | 'createdAt'>) => string;
  updateScheduledPrint: (id: string, changes: Partial<ScheduledPrint>) => void;
  removeScheduledPrint: (id: string) => void;
  reschedule: (id: string, newStart: number) => void;

  // Quiet hours
  addQuietWindow: (w: Omit<QuietWindow, 'id'>) => string;
  updateQuietWindow: (id: string, changes: Partial<QuietWindow>) => void;
  removeQuietWindow: (id: string) => void;
  isQuietNow: () => boolean;
  isQuietAt: (epochMs: number) => boolean;

  // Time-of-use/off-peak planning
  addTOUWindow: (w: Omit<TOUWindow, 'id'>) => string;
  updateTOUWindow: (id: string, changes: Partial<TOUWindow>) => void;
  removeTOUWindow: (id: string) => void;
  getTOUWindowsForPrinter: (printerId: string | null) => TOUWindow[];
  rateAt: (printerId: string | null, epochMs: number) => Pick<TOUWindow, 'ratePerKwh' | 'tier' | 'label'>;
  findCheapestStart: (
    printerId: string | null,
    earliestStart: number,
    estimatedDurationMs: number,
    printerWatts?: number,
    horizonHours?: number,
  ) => CheapestPrintWindow | null;
  schedulePrintAtCheapestWindow: (entry: Omit<ScheduledPrint, 'id' | 'createdAt' | 'scheduledStart'> & {
    earliestStart: number;
    printerWatts?: number;
    horizonHours?: number;
  }) => string | null;
  upsertUtilityRateConfig: (printerId: string, changes: Partial<UtilityRateConfig>) => void;
  upsertSolarIntegrationConfig: (printerId: string, changes: Partial<SolarIntegrationConfig>) => void;
  canStartWithSolarSurplus: (printerId: string, requiredWatts?: number) => SolarGateResult;

  // Bed-clear auto-queue
  getBedClearSettings: (printerId: string) => BedClearSettings;
  upsertBedClearSettings: (printerId: string, changes: Partial<BedClearSettings>) => void;
  markBedCleared: (printerId: string, cleared: boolean) => void;

  // Checklist
  getChecklistForPrinter: (printerId: string) => Array<ChecklistItem & { enabled: boolean }>;
  setChecklistOverride: (printerId: string, itemId: string, enabled: boolean) => void;
  setChecklistVisible: (printerId: string, show: boolean) => void;
  updateChecklistItem: (id: string, changes: Partial<ChecklistItem>) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return generateId('sched');
}

function minuteOfDay(h: number, m: number): number {
  return h * 60 + m;
}

function isInWindow(window: QuietWindow, d: Date): boolean {
  const dow = d.getDay() as DayOfWeek;
  const current = minuteOfDay(d.getHours(), d.getMinutes());
  const start = minuteOfDay(window.startHour, window.startMinute);
  const end = minuteOfDay(window.endHour, window.endMinute);
  if (start <= end) {
    return window.days.includes(dow) && current >= start && current < end;
  }

  // Overnight windows apply to the configured start day before midnight, and
  // to the following day after midnight.
  const previousDow = ((dow + 6) % 7) as DayOfWeek;
  return (
    (window.days.includes(dow) && current >= start) ||
    (window.days.includes(previousDow) && current < end)
  );
}

function windowCoversDate(
  window: Pick<TOUWindow | QuietWindow, 'days' | 'startHour' | 'startMinute' | 'endHour' | 'endMinute'>,
  d: Date,
): boolean {
  const dow = d.getDay() as DayOfWeek;
  const current = minuteOfDay(d.getHours(), d.getMinutes());
  const start = minuteOfDay(window.startHour, window.startMinute);
  const end = minuteOfDay(window.endHour, window.endMinute);
  if (start <= end) {
    return window.days.includes(dow) && current >= start && current < end;
  }
  const previousDow = ((dow + 6) % 7) as DayOfWeek;
  return (
    (window.days.includes(dow) && current >= start) ||
    (window.days.includes(previousDow) && current < end)
  );
}

function defaultRate(): Pick<TOUWindow, 'ratePerKwh' | 'tier' | 'label'> {
  return { ratePerKwh: 0.16, tier: 'shoulder', label: 'Default rate' };
}

function defaultSolarConfig(printerId: string): SolarIntegrationConfig {
  return {
    printerId,
    enabled: false,
    provider: 'custom',
    endpointUrl: '',
    apiKey: '',
    minSurplusW: 500,
    currentSurplusW: 0,
    lastReadAt: null,
  };
}

function solarGate(config: SolarIntegrationConfig, requiredWatts = config.minSurplusW): SolarGateResult {
  if (!config.enabled) {
    return {
      allowed: true,
      surplusW: config.currentSurplusW,
      requiredW: Math.max(0, requiredWatts),
      provider: config.provider,
      reason: 'Solar gate disabled',
    };
  }
  const requiredW = Math.max(config.minSurplusW, Math.max(0, requiredWatts));
  const allowed = config.currentSurplusW >= requiredW;
  return {
    allowed,
    surplusW: config.currentSurplusW,
    requiredW,
    provider: config.provider,
    reason: allowed ? 'Solar surplus is sufficient' : 'Waiting for more solar surplus',
  };
}

function rateAtForWindows(
  windows: TOUWindow[],
  printerId: string | null,
  epochMs: number,
): Pick<TOUWindow, 'ratePerKwh' | 'tier' | 'label'> {
  const d = new Date(epochMs);
  const matches = windows.filter((window) =>
    (window.printerId === null || window.printerId === printerId) && windowCoversDate(window, d));
  if (matches.length === 0) return defaultRate();
  return matches.reduce((best, window) => (window.ratePerKwh < best.ratePerKwh ? window : best), matches[0]);
}

function setTimeOnDate(date: Date, hour: number, minute: number): number {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next.getTime();
}

function touBoundaryStarts(
  windows: TOUWindow[],
  printerId: string | null,
  startMs: number,
  endMs: number,
): number[] {
  const boundaries = new Set<number>();
  const firstDay = new Date(startMs);
  firstDay.setHours(0, 0, 0, 0);
  for (let dayOffset = -1; dayOffset <= Math.ceil((endMs - startMs) / 86_400_000) + 1; dayOffset++) {
    const date = new Date(firstDay.getTime() + dayOffset * 86_400_000);
    const dow = date.getDay() as DayOfWeek;
    for (const window of windows) {
      if (window.printerId !== null && window.printerId !== printerId) continue;
      if (!window.days.includes(dow)) continue;
      for (const boundary of [
        setTimeOnDate(date, window.startHour, window.startMinute),
        setTimeOnDate(date, window.endHour, window.endMinute),
      ]) {
        if (boundary >= startMs && boundary <= endMs) boundaries.add(boundary);
      }
    }
  }
  return [...boundaries].sort((a, b) => a - b);
}

function energyCostForStart(
  windows: TOUWindow[],
  printerId: string | null,
  startMs: number,
  durationMs: number,
  printerWatts: number,
): Pick<CheapestPrintWindow, 'estimatedEnergyCost' | 'ratePerKwh' | 'tier' | 'label'> {
  const endMs = startMs + Math.max(0, durationMs);
  let cursor = startMs;
  let cost = 0;
  let weightedRate = 0;
  let sampledMs = 0;
  let lowest = rateAtForWindows(windows, printerId, startMs);
  const boundaries = touBoundaryStarts(windows, printerId, startMs, endMs);
  let boundaryIndex = 0;

  while (cursor < endMs) {
    while (boundaryIndex < boundaries.length && boundaries[boundaryIndex] <= cursor) boundaryIndex++;
    const nextBoundary = boundaries[boundaryIndex] ?? endMs;
    const next = Math.min(nextBoundary, endMs);
    const rate = rateAtForWindows(windows, printerId, cursor);
    const hours = (next - cursor) / 3_600_000;
    cost += (Math.max(0, printerWatts) / 1000) * hours * rate.ratePerKwh;
    weightedRate += rate.ratePerKwh * (next - cursor);
    sampledMs += next - cursor;
    if (rate.ratePerKwh < lowest.ratePerKwh) lowest = rate;
    cursor = next;
  }

  return {
    estimatedEnergyCost: cost,
    ratePerKwh: sampledMs > 0 ? weightedRate / sampledMs : lowest.ratePerKwh,
    tier: lowest.tier,
    label: lowest.label,
  };
}

export function findCheapestTOUStart(
  windows: TOUWindow[],
  printerId: string | null,
  earliestStart: number,
  estimatedDurationMs: number,
  printerWatts = 250,
  horizonHours = 72,
): CheapestPrintWindow | null {
  if (!Number.isFinite(earliestStart)) return null;
  const stepMs = 15 * 60 * 1000;
  const durationMs = Math.max(0, estimatedDurationMs);
  const horizonEnd = earliestStart + Math.max(stepMs, horizonHours * 3_600_000);
  let best: CheapestPrintWindow | null = null;
  const candidates = new Set<number>();

  for (let start = earliestStart; start <= horizonEnd; start += stepMs) {
    candidates.add(start);
  }
  for (const boundary of touBoundaryStarts(windows, printerId, earliestStart, horizonEnd)) {
    candidates.add(boundary);
  }

  for (const start of [...candidates].sort((a, b) => a - b)) {
    const cost = energyCostForStart(windows, printerId, start, durationMs, printerWatts);
    const candidate = {
      start,
      end: start + durationMs,
      ...cost,
    };
    if (!best || candidate.estimatedEnergyCost < best.estimatedEnergyCost) {
      best = candidate;
    }
  }

  return best;
}

function defaultBedClearSettings(printerId: string): BedClearSettings {
  return {
    printerId,
    enabled: false,
    delayAfterPrintSec: 30,
    autoStartNextJob: false,
    lastClearState: null,
    lastCheckedAt: null,
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSchedulingStore = create<SchedulingStore>()(
  persist(
    (set, get) => ({
      scheduledPrints: [],
      quietWindows: [],
      touWindows: [],
      utilityRateConfigs: [],
      solarIntegrationConfigs: [],
      bedClearSettings: [],
      checklistItems: DEFAULT_CHECKLIST_ITEMS,
      checklistOverrides: [],

      // ── Calendar ────────────────────────────────────────────────────────────
      addScheduledPrint: (entry) => {
        const id = uid();
        set((s) => ({
          scheduledPrints: [
            ...s.scheduledPrints,
            { ...entry, id, createdAt: Date.now() },
          ],
        }));
        return id;
      },

      updateScheduledPrint: (id, changes) => {
        set((s) => ({
          scheduledPrints: s.scheduledPrints.map((e) =>
            e.id === id ? { ...e, ...changes } : e,
          ),
        }));
      },

      removeScheduledPrint: (id) => {
        set((s) => ({
          scheduledPrints: s.scheduledPrints.filter((e) => e.id !== id),
        }));
      },

      reschedule: (id, newStart) => {
        set((s) => ({
          scheduledPrints: s.scheduledPrints.map((e) =>
            e.id === id ? { ...e, scheduledStart: newStart } : e,
          ),
        }));
      },

      // ── Quiet hours ─────────────────────────────────────────────────────────
      addQuietWindow: (w) => {
        const id = uid();
        set((s) => ({ quietWindows: [...s.quietWindows, { ...w, id }] }));
        return id;
      },

      updateQuietWindow: (id, changes) => {
        set((s) => ({
          quietWindows: s.quietWindows.map((w) =>
            w.id === id ? { ...w, ...changes } : w,
          ),
        }));
      },

      removeQuietWindow: (id) => {
        set((s) => ({
          quietWindows: s.quietWindows.filter((w) => w.id !== id),
        }));
      },

      isQuietNow: () => {
        const now = new Date();
        return get().quietWindows.some((w) => isInWindow(w, now));
      },

      isQuietAt: (epochMs) => {
        const d = new Date(epochMs);
        return get().quietWindows.some((w) => isInWindow(w, d));
      },

      // Time-of-use / off-peak planning
      addTOUWindow: (w) => {
        const id = uid();
        set((s) => ({ touWindows: [...s.touWindows, { ...w, id }] }));
        return id;
      },

      updateTOUWindow: (id, changes) => {
        set((s) => ({
          touWindows: s.touWindows.map((w) =>
            w.id === id ? { ...w, ...changes } : w,
          ),
        }));
      },

      removeTOUWindow: (id) => {
        set((s) => ({
          touWindows: s.touWindows.filter((w) => w.id !== id),
        }));
      },

      getTOUWindowsForPrinter: (printerId) =>
        get().touWindows.filter((w) => w.printerId === null || w.printerId === printerId),

      rateAt: (printerId, epochMs) => rateAtForWindows(get().touWindows, printerId, epochMs),

      findCheapestStart: (printerId, earliestStart, estimatedDurationMs, printerWatts = 250, horizonHours = 72) =>
        findCheapestTOUStart(get().touWindows, printerId, earliestStart, estimatedDurationMs, printerWatts, horizonHours),

      schedulePrintAtCheapestWindow: (entry) => {
        const cheapest = get().findCheapestStart(
          entry.printerId,
          entry.earliestStart,
          entry.estimatedDurationMs,
          entry.printerWatts,
          entry.horizonHours,
        );
        if (!cheapest) return null;
        return get().addScheduledPrint({
          jobId: entry.jobId,
          filePath: entry.filePath,
          fileName: entry.fileName,
          printerId: entry.printerId,
          scheduledStart: cheapest.start,
          estimatedDurationMs: entry.estimatedDurationMs,
          note: entry.note,
          status: entry.status,
        });
      },

      upsertUtilityRateConfig: (printerId, changes) => {
        set((s) => {
          const existing = s.utilityRateConfigs.find((config) => config.printerId === printerId);
          const next: UtilityRateConfig = {
            printerId,
            enabled: changes.enabled ?? existing?.enabled ?? false,
            url: changes.url ?? existing?.url ?? '',
            format: changes.format ?? existing?.format ?? 'json',
            ratePath: changes.ratePath ?? existing?.ratePath ?? 'rates',
            updatedAt: changes.updatedAt ?? existing?.updatedAt ?? null,
          };
          return {
            utilityRateConfigs: existing
              ? s.utilityRateConfigs.map((config) => (config.printerId === printerId ? next : config))
              : [...s.utilityRateConfigs, next],
          };
        });
      },

      upsertSolarIntegrationConfig: (printerId, changes) => {
        set((s) => {
          const existing = s.solarIntegrationConfigs.find((config) => config.printerId === printerId);
          const base = existing ?? defaultSolarConfig(printerId);
          const next: SolarIntegrationConfig = {
            ...base,
            ...changes,
            printerId,
            minSurplusW: Math.max(0, changes.minSurplusW ?? base.minSurplusW),
            currentSurplusW: Math.max(0, changes.currentSurplusW ?? base.currentSurplusW),
          };
          return {
            solarIntegrationConfigs: existing
              ? s.solarIntegrationConfigs.map((config) => (config.printerId === printerId ? next : config))
              : [...s.solarIntegrationConfigs, next],
          };
        });
      },

      canStartWithSolarSurplus: (printerId, requiredWatts) => {
        const config = get().solarIntegrationConfigs.find((entry) => entry.printerId === printerId)
          ?? defaultSolarConfig(printerId);
        return solarGate(config, requiredWatts);
      },

      // ── Bed-clear auto-queue ────────────────────────────────────────────────
      getBedClearSettings: (printerId) => {
        return (
          get().bedClearSettings.find((s) => s.printerId === printerId) ??
          defaultBedClearSettings(printerId)
        );
      },

      upsertBedClearSettings: (printerId, changes) => {
        set((s) => {
          const existing = s.bedClearSettings.find((b) => b.printerId === printerId);
          if (existing) {
            return {
              bedClearSettings: s.bedClearSettings.map((b) =>
                b.printerId === printerId ? { ...b, ...changes } : b,
              ),
            };
          }
          return {
            bedClearSettings: [
              ...s.bedClearSettings,
              { ...defaultBedClearSettings(printerId), ...changes },
            ],
          };
        });
      },

      markBedCleared: (printerId, cleared) => {
        get().upsertBedClearSettings(printerId, {
          lastClearState: cleared,
          lastCheckedAt: Date.now(),
        });
      },

      // ── Checklist ───────────────────────────────────────────────────────────
      getChecklistForPrinter: (printerId) => {
        const { checklistItems, checklistOverrides } = get();
        const override = checklistOverrides.find((o) => o.printerId === printerId);
        if (override?.showChecklist === false) return [];
        return checklistItems.map((item) => ({
          ...item,
          enabled:
            override?.overrides[item.id] !== undefined
              ? override.overrides[item.id]
              : item.defaultEnabled,
        }));
      },

      setChecklistOverride: (printerId, itemId, enabled) => {
        set((s) => {
          const existing = s.checklistOverrides.find((o) => o.printerId === printerId);
          if (existing) {
            return {
              checklistOverrides: s.checklistOverrides.map((o) =>
                o.printerId === printerId
                  ? { ...o, overrides: { ...o.overrides, [itemId]: enabled } }
                  : o,
              ),
            };
          }
          return {
            checklistOverrides: [
              ...s.checklistOverrides,
              { printerId, overrides: { [itemId]: enabled }, showChecklist: true },
            ],
          };
        });
      },

      setChecklistVisible: (printerId, show) => {
        set((s) => {
          const existing = s.checklistOverrides.find((o) => o.printerId === printerId);
          if (existing) {
            return {
              checklistOverrides: s.checklistOverrides.map((o) =>
                o.printerId === printerId ? { ...o, showChecklist: show } : o,
              ),
            };
          }
          return {
            checklistOverrides: [
              ...s.checklistOverrides,
              { printerId, overrides: {}, showChecklist: show },
            ],
          };
        });
      },

      updateChecklistItem: (id, changes) => {
        set((s) => ({
          checklistItems: s.checklistItems.map((item) =>
            item.id === id ? { ...item, ...changes } : item,
          ),
        }));
      },
    }),
    {
      name: 'cindr3d-scheduling',
      partialize: (state) => ({
        ...state,
        solarIntegrationConfigs: state.solarIntegrationConfigs.map((config) => ({
          ...config,
          apiKey: '',
        })),
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<SchedulingStore> | undefined;
        return {
          ...currentState,
          ...persisted,
          solarIntegrationConfigs: (persisted?.solarIntegrationConfigs ?? currentState.solarIntegrationConfigs).map((config) => ({
            ...config,
            apiKey: '',
          })),
        };
      },
    },
  ),
);
