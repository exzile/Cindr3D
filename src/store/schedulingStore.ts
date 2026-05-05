// schedulingStore.ts — persistent state for Phase 12 print scheduling.
// Owns:
//   - ScheduledPrint slots (calendar entries)
//   - Quiet-hours windows per day-of-week
//   - Bed-clearing auto-queue settings per printer
//   - Print-start verification checklist items + per-printer overrides

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sun

export interface QuietWindow {
  id: string;
  days: DayOfWeek[];   // which days this window applies
  startHour: number;   // 0-23 inclusive
  startMinute: number;
  endHour: number;
  endMinute: number;
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
  return `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    },
  ),
);
