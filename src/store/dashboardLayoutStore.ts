import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const PANEL_IDS = [
  'status',
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
] as const;

export type PanelId = (typeof PANEL_IDS)[number];

// Spacer placeholder — encodes its column span in the ID, e.g. '__spacer_6'
export type SpacerId = `__spacer_${number}`;
export type LayoutItem = PanelId | SpacerId;
export function isSpacerId(id: string): id is SpacerId { return id.startsWith('__spacer_'); }
export function spacerSpan(id: SpacerId): number { return parseInt(id.slice(9), 10); }

// Valid column spans in a 12-column grid
export type ColSpan = 3 | 4 | 6 | 8 | 12;
export const VALID_SPANS: ColSpan[] = [3, 4, 6, 8, 12];

const DEFAULT_ORDER: PanelId[] = [
  // ── Row 1: machine state (12) ─────────────────────────────────────────────
  'status',
  // ── Row 2: active tool selector (12) ──────────────────────────────────────
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
];

export const DEFAULT_COLSPANS: Record<PanelId, ColSpan> = {
  // full-width headers / rich card lists
  'status':           12,
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
};

// Single source of truth for the grid row unit (matches CSS grid-auto-rows)
export const ROW_HEIGHT = 90; // px

export const DEFAULT_ROWSPANS: Record<PanelId, number> = {
  'status':            2,
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
};

interface DashboardLayoutState {
  order: LayoutItem[];
  colSpans: Record<string, ColSpan>;
  rowSpans: Record<string, number>;
  hidden: Record<string, boolean>;
  setOrder: (order: LayoutItem[]) => void;
  setColSpan: (id: string, span: ColSpan) => void;
  setRowSpan: (id: string, rows: number) => void;
  toggleHidden: (id: string) => void;
  reset: () => void;
}

export const useDashboardLayout = create<DashboardLayoutState>()(
  persist(
    (set) => ({
      order: DEFAULT_ORDER,
      colSpans: { ...DEFAULT_COLSPANS },
      rowSpans: { ...DEFAULT_ROWSPANS },
      hidden: {},
      setOrder: (order) => set({ order }),
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
    { name: 'duet-dashboard-layout' },
  ),
);