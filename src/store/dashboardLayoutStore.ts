import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PanelId, SpacerId, LayoutItem, ColSpan } from '../types/dashboard-layout.types';

export type { PanelId, SpacerId, LayoutItem, ColSpan } from '../types/dashboard-layout.types';

export const PANEL_IDS = [
  'camera',
  'tools',
  'tool-offsets',
  'workplace',
  'bed-compensation',
  'restore-points',
  'temperature',
  'speed-flow',
  'fans',
  'pressure-advance',
  'input-shaper',
  'axes',
  'extruder',
  'atx-power',
  'macros',
  'custom-buttons',
  'system-info',
  'filament-sensors',
  'object-cancel',
  'mesh-preview',
] as const;

export function isSpacerId(id: string): id is SpacerId { return id.startsWith('__spacer_'); }
export function spacerSpan(id: SpacerId): number { return parseInt(id.slice(9), 10); }
export const VALID_SPANS: ColSpan[] = [3, 4, 6, 8, 12];

const DEFAULT_ORDER: PanelId[] = [
  // -- Row 1: camera monitor (12) -------------------------------------------
  'camera',
  // ── Row 1: active tool selector (12) ──────────────────────────────────────
  'tools',
  // ── Row 3: thermal management (8 + 4) ─────────────────────────────────────
  'temperature', 'fans',
  // ── Row 4: motion + extrusion (8 + 4) ─────────────────────────────────────
  'axes', 'extruder',
  // ── Row 5: print quality tuning (4 + 4 + 4) ───────────────────────────────
  'speed-flow', 'pressure-advance', 'input-shaper',
  // ── Row 6: coordinate systems (6 + 6) ─────────────────────────────────────
  'tool-offsets', 'workplace',
  // ── Row 7: bed levelling (6 + 6) ──────────────────────────────────────────
  'bed-compensation', 'restore-points',
  // ── Row 8: automation & shortcuts (6 + 6) ─────────────────────────────────
  'macros', 'custom-buttons',
  // ── Row 9: power & system info (4 + 8) ────────────────────────────────────
  'atx-power', 'system-info',
  // ── Row 10: filament sensors (12) ─────────────────────────────────────────
  'filament-sensors',
  // ── Row 11: object cancellation (6) + mesh preview (6) ────────────────────
  'object-cancel',
  'mesh-preview',
];

export const DEFAULT_COLSPANS: Record<PanelId, ColSpan> = {
  // full-width headers / rich card lists
  'camera':           12,
  'tools':            12,
  // wide panels — charts, jog grid, system info
  'temperature':       8,
  'axes':              8,
  'system-info':       8,
  // half-width — data tables, automation
  'macros':            6,
  'custom-buttons':    6,
  'tool-offsets':      6,
  'workplace':         6,
  'bed-compensation':  6,
  'restore-points':    6,
  // third-width — compact single-purpose controls
  'fans':              4,
  'extruder':          4,
  'speed-flow':        4,
  'pressure-advance':  4,
  'input-shaper':      4,
  'atx-power':         4,
  'filament-sensors': 12,
  'object-cancel':     6,
  'mesh-preview':      6,
};

// Single source of truth for the grid row unit (matches CSS grid-auto-rows)
export const ROW_HEIGHT = 90; // px

export const DEFAULT_ROWSPANS: Record<PanelId, number> = {
  'camera':            6,
  'tools':             5,
  'temperature':       5,   // heater rows + history chart
  'fans':              3,
  'axes':              6,   // jog grid + baby stepping
  'extruder':          3,
  'speed-flow':        3,
  'pressure-advance':  3,
  'input-shaper':      3,
  'macros':            4,
  'custom-buttons':    4,
  'tool-offsets':      4,
  'workplace':         4,
  'bed-compensation':  3,
  'restore-points':    4,
  'atx-power':         2,   // single toggle
  'system-info':       3,
  'filament-sensors':  3,   // one row per monitor — grows via resize if needed
  'object-cancel':     4,   // compact list — grows as objects are added
  'mesh-preview':      5,   // 3D viewport — needs height to be useful
};

interface DashboardLayoutState {
  order: LayoutItem[];
  colSpans: Record<string, ColSpan>;
  rowSpans: Record<string, number>;
  hidden: Record<string, boolean>;
  setOrder: (order: LayoutItem[] | ((prev: LayoutItem[]) => LayoutItem[])) => void;
  setColSpan: (id: string, span: ColSpan) => void;
  setRowSpan: (id: string, rows: number) => void;
  toggleHidden: (id: string) => void;
  reset: () => void;
}

function migrateDashboardLayout(persistedState: unknown): Partial<DashboardLayoutState> {
  const state = (persistedState ?? {}) as Partial<DashboardLayoutState>;
  const persistedOrder = Array.isArray(state.order) ? state.order : DEFAULT_ORDER;
  const missingPanels = DEFAULT_ORDER.filter((id) => !persistedOrder.includes(id));
  const rowSpans = { ...DEFAULT_ROWSPANS, ...(state.rowSpans ?? {}) };
  rowSpans.camera = Math.max(rowSpans.camera ?? 0, DEFAULT_ROWSPANS.camera);

  return {
    ...state,
    order: missingPanels.length > 0 ? [...missingPanels, ...persistedOrder] : persistedOrder,
    colSpans: { ...DEFAULT_COLSPANS, ...(state.colSpans ?? {}) },
    rowSpans,
    hidden: state.hidden ?? {},
  };
}

export const useDashboardLayout = create<DashboardLayoutState>()(
  persist(
    (set) => ({
      order: DEFAULT_ORDER,
      colSpans: { ...DEFAULT_COLSPANS },
      rowSpans: { ...DEFAULT_ROWSPANS },
      hidden: {},
      setOrder: (order) => set((state) => ({
        order: typeof order === 'function' ? order(state.order) : order,
      })),
      setColSpan: (id, span) =>
        set((state) => ({ colSpans: { ...state.colSpans, [id]: span } })),
      setRowSpan: (id, rows) =>
        set((state) => ({ rowSpans: { ...state.rowSpans, [id]: rows } })),
      toggleHidden: (id) =>
        set((state) => ({
          hidden: { ...state.hidden, [id]: !state.hidden[id] },
        })),
      reset: () =>
        set({ order: DEFAULT_ORDER, colSpans: { ...DEFAULT_COLSPANS }, rowSpans: { ...DEFAULT_ROWSPANS }, hidden: {} }),
    }),
    {
      name: 'duet-dashboard-layout',
      version: 3,
      migrate: migrateDashboardLayout,
    },
  ),
);
