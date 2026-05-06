import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DashboardConfig, DashboardLayoutItem, PanelId } from '../types/dashboard-layout.types';

export type { DashboardConfig, DashboardLayoutItem, PanelId } from '../types/dashboard-layout.types';

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
  'air-quality',
  'object-cancel',
  'mesh-preview',
] as const;

export const ROW_HEIGHT = 90;
export const GRID_COLS = 12;
export const MIN_PANEL_WIDTH = 3;

const DEFAULT_ORDER: PanelId[] = [
  'camera',
  'tools',
  'temperature',
  'fans',
  'axes',
  'extruder',
  'speed-flow',
  'pressure-advance',
  'input-shaper',
  'tool-offsets',
  'workplace',
  'bed-compensation',
  'restore-points',
  'macros',
  'custom-buttons',
  'atx-power',
  'system-info',
  'filament-sensors',
  'air-quality',
  'object-cancel',
  'mesh-preview',
];

export const DEFAULT_COLSPANS: Record<PanelId, number> = {
  'camera': 12,
  'tools': 12,
  'temperature': 8,
  'axes': 8,
  'system-info': 8,
  'macros': 6,
  'custom-buttons': 6,
  'tool-offsets': 6,
  'workplace': 6,
  'bed-compensation': 6,
  'restore-points': 6,
  'fans': 4,
  'extruder': 4,
  'speed-flow': 4,
  'pressure-advance': 4,
  'input-shaper': 4,
  'atx-power': 4,
  'filament-sensors': 12,
  'air-quality': 6,
  'object-cancel': 6,
  'mesh-preview': 6,
};

export const DEFAULT_ROWSPANS: Record<PanelId, number> = {
  'camera': 6,
  'tools': 5,
  'temperature': 5,
  'fans': 3,
  'axes': 6,
  'extruder': 3,
  'speed-flow': 3,
  'pressure-advance': 3,
  'input-shaper': 3,
  'macros': 4,
  'custom-buttons': 4,
  'tool-offsets': 4,
  'workplace': 4,
  'bed-compensation': 3,
  'restore-points': 4,
  'atx-power': 2,
  'system-info': 3,
  'filament-sensors': 3,
  'air-quality': 4,
  'object-cancel': 4,
  'mesh-preview': 5,
};

function clampGridNumber(value: unknown, fallback: number, min: number, max: number) {
  const next = Math.round(Number(value));
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

function clampLayoutItem(id: PanelId, item: Partial<DashboardLayoutItem>): DashboardLayoutItem {
  const fallbackSpan = DEFAULT_COLSPANS[id];
  const w = clampGridNumber(item.w, fallbackSpan, MIN_PANEL_WIDTH, GRID_COLS);
  const h = clampGridNumber(item.h, DEFAULT_ROWSPANS[id], 1, 100);
  return {
    i: id,
    x: clampGridNumber(item.x, 0, 0, GRID_COLS - w),
    y: clampGridNumber(item.y, 0, 0, 1000),
    w,
    h,
  };
}

function buildDefaultLayouts(): Record<PanelId, DashboardLayoutItem> {
  const layouts = {} as Record<PanelId, DashboardLayoutItem>;
  let x = 0;
  let y = 0;
  let rowHeight = 1;

  for (const id of DEFAULT_ORDER) {
    const w = DEFAULT_COLSPANS[id];
    const h = DEFAULT_ROWSPANS[id];
    if (x + w > GRID_COLS) {
      y += rowHeight;
      x = 0;
      rowHeight = 1;
    }

    layouts[id] = { i: id, x, y, w, h };
    rowHeight = Math.max(rowHeight, h);
    x += w;
    if (x >= GRID_COLS) {
      y += rowHeight;
      x = 0;
      rowHeight = 1;
    }
  }

  return layouts;
}

const DEFAULT_LAYOUTS = buildDefaultLayouts();
const DEFAULT_DASHBOARD_ID = 'dashboard-default';

interface LegacyDashboardState {
  order?: unknown[];
  colSpans?: Record<string, number>;
  rowSpans?: Record<string, number>;
  positions?: Record<string, { col?: number; row?: number }>;
}

function isPanelId(value: unknown): value is PanelId {
  return typeof value === 'string' && PANEL_IDS.includes(value as PanelId);
}

function legacySpacerSpan(value: unknown): number | null {
  if (typeof value !== 'string' || !value.startsWith('__spacer_')) return null;
  const span = Number.parseInt(value.slice('__spacer_'.length), 10);
  if (!Number.isFinite(span)) return null;
  return Math.max(1, Math.min(GRID_COLS, span));
}

function migrateLegacyLayouts(state: LegacyDashboardState): Record<PanelId, DashboardLayoutItem> {
  const layouts = { ...DEFAULT_LAYOUTS };
  const rawOrder = Array.isArray(state.order) ? state.order : DEFAULT_ORDER;
  const orderedPanels = rawOrder.filter(isPanelId);
  const missingPanels = DEFAULT_ORDER.filter((id) => !orderedPanels.includes(id));
  const colSpans = state.colSpans ?? {};
  const rowSpans = state.rowSpans ?? {};
  const positions = state.positions ?? {};
  const seen = new Set<PanelId>();
  let x = 0;
  let y = 0;
  let rowHeight = 1;

  const advance = (span: number, height = 1) => {
    if (x + span > GRID_COLS) {
      y += rowHeight;
      x = 0;
      rowHeight = 1;
    }
    rowHeight = Math.max(rowHeight, height);
    x += span;
    if (x >= GRID_COLS) {
      y += rowHeight;
      x = 0;
      rowHeight = 1;
    }
  };

  const placeItem = (item: unknown) => {
    const spacerSpan = legacySpacerSpan(item);
    if (spacerSpan !== null) {
      advance(spacerSpan);
      return;
    }

    if (!isPanelId(item) || seen.has(item)) return;
    const id = item;
    seen.add(id);
    const position = positions[id];
    const fallback = layouts[id];
    const w = colSpans[id] ?? fallback.w;
    const h = rowSpans[id] ?? fallback.h;
    const hasStoredPosition = position?.col !== undefined || position?.row !== undefined;
    const clampedW = clampGridNumber(w, fallback.w, MIN_PANEL_WIDTH, GRID_COLS);
    if (!hasStoredPosition && x + clampedW > GRID_COLS) {
      y += rowHeight;
      x = 0;
      rowHeight = 1;
    }
    layouts[id] = clampLayoutItem(id, {
      i: id,
      x: position?.col ? position.col - 1 : x,
      y: position?.row ? position.row - 1 : y,
      w,
      h,
    });

    if (!hasStoredPosition) advance(layouts[id].w, layouts[id].h);
  };

  for (const item of rawOrder) placeItem(item);

  if (missingPanels.length > 0) {
    x = 0;
    y = Math.max(...Array.from(seen, (id) => layouts[id].y + layouts[id].h), 0);
    rowHeight = 1;
    for (const id of missingPanels) placeItem(id);
  }

  return layouts;
}

function normalizeLayouts(state: Partial<DashboardLayoutState> & LegacyDashboardState): Record<PanelId, DashboardLayoutItem> {
  if (!state.layouts) return migrateLegacyLayouts(state);

  const layouts = { ...DEFAULT_LAYOUTS };
  for (const id of PANEL_IDS) {
    layouts[id] = clampLayoutItem(id, state.layouts[id] ?? layouts[id]);
  }
  return layouts;
}

function sanitizeLayouts(layouts: Partial<Record<PanelId, Partial<DashboardLayoutItem>>>): Record<PanelId, DashboardLayoutItem> {
  const next = { ...DEFAULT_LAYOUTS };
  for (const id of PANEL_IDS) {
    next[id] = clampLayoutItem(id, layouts[id] ?? next[id]);
  }
  return next;
}

function cloneLayouts(layouts: Record<PanelId, DashboardLayoutItem>): Record<PanelId, DashboardLayoutItem> {
  return Object.fromEntries(
    PANEL_IDS.map((id) => [id, { ...layouts[id] }]),
  ) as Record<PanelId, DashboardLayoutItem>;
}

function sanitizeHidden(hidden: unknown): Record<string, boolean> {
  if (!hidden || typeof hidden !== 'object') return {};
  return Object.fromEntries(
    Object.entries(hidden as Record<string, unknown>)
      .filter(([id]) => isPanelId(id))
      .map(([id, value]) => [id, Boolean(value)]),
  );
}

function createDefaultDashboard(name = 'Monitor'): DashboardConfig {
  return {
    id: DEFAULT_DASHBOARD_ID,
    name,
    layouts: cloneLayouts(DEFAULT_LAYOUTS),
    hidden: {},
  };
}

function normalizeDashboard(value: unknown, fallbackName: string, fallbackId: string): DashboardConfig {
  const dashboard = (value ?? {}) as Partial<DashboardConfig> & LegacyDashboardState;
  const rawName = typeof dashboard.name === 'string' ? dashboard.name.trim() : '';
  const rawId = typeof dashboard.id === 'string' ? dashboard.id.trim() : '';
  return {
    id: rawId || fallbackId,
    name: rawName || fallbackName,
    layouts: normalizeLayouts(dashboard),
    hidden: sanitizeHidden(dashboard.hidden),
  };
}

function uniqueDashboardName(dashboards: DashboardConfig[]) {
  const used = new Set(dashboards.map((dashboard) => dashboard.name));
  let index = dashboards.length + 1;
  let name = `Dashboard ${index}`;
  while (used.has(name)) {
    index += 1;
    name = `Dashboard ${index}`;
  }
  return name;
}

function activeDashboardFrom(dashboards: DashboardConfig[], activeDashboardId: string): DashboardConfig {
  return dashboards.find((dashboard) => dashboard.id === activeDashboardId) ?? dashboards[0] ?? createDefaultDashboard();
}

function activeFields(dashboards: DashboardConfig[], activeDashboardId: string) {
  const activeDashboard = activeDashboardFrom(dashboards, activeDashboardId);
  return {
    activeDashboardId: activeDashboard.id,
    layouts: cloneLayouts(activeDashboard.layouts),
    hidden: { ...activeDashboard.hidden },
  };
}

interface DashboardLayoutState {
  dashboards: DashboardConfig[];
  activeDashboardId: string;
  layouts: Record<PanelId, DashboardLayoutItem>;
  hidden: Record<string, boolean>;
  addDashboard: () => void;
  removeDashboard: (id: string) => void;
  renameDashboard: (id: string, name: string) => void;
  setActiveDashboard: (id: string) => void;
  setLayouts: (layouts: Partial<Record<PanelId, DashboardLayoutItem>>) => void;
  setPanelLayout: (id: PanelId, layout: DashboardLayoutItem) => void;
  setHidden: (id: string, hidden: boolean) => void;
  setAllHidden: (hidden: boolean) => void;
  toggleHidden: (id: string) => void;
  reset: () => void;
}

function migrateDashboardLayout(persistedState: unknown): Partial<DashboardLayoutState> {
  const state = (persistedState ?? {}) as Partial<DashboardLayoutState> & LegacyDashboardState;
  const dashboards = Array.isArray(state.dashboards) && state.dashboards.length > 0
    ? state.dashboards.map((dashboard, index) => normalizeDashboard(dashboard, index === 0 ? 'Monitor' : `Dashboard ${index + 1}`, `dashboard-${index + 1}`))
    : [{
        ...createDefaultDashboard(),
        layouts: normalizeLayouts(state),
        hidden: sanitizeHidden(state.hidden),
      }];
  const activeDashboardId = dashboards.some((dashboard) => dashboard.id === state.activeDashboardId)
    ? state.activeDashboardId as string
    : dashboards[0].id;
  return {
    dashboards,
    ...activeFields(dashboards, activeDashboardId),
  };
}

export function defaultPanelLayout(id: PanelId): DashboardLayoutItem {
  return { ...DEFAULT_LAYOUTS[id] };
}

export const useDashboardLayout = create<DashboardLayoutState>()(
  persist(
    (set) => ({
      dashboards: [createDefaultDashboard()],
      activeDashboardId: DEFAULT_DASHBOARD_ID,
      layouts: cloneLayouts(DEFAULT_LAYOUTS),
      hidden: {},
      addDashboard: () =>
        set((state) => {
          const dashboard: DashboardConfig = {
            id: `dashboard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            name: uniqueDashboardName(state.dashboards),
            layouts: cloneLayouts(DEFAULT_LAYOUTS),
            hidden: {},
          };
          const dashboards = [...state.dashboards, dashboard];
          return {
            dashboards,
            ...activeFields(dashboards, dashboard.id),
          };
        }),
      removeDashboard: (id) =>
        set((state) => {
          if (state.dashboards.length <= 1) return {};
          const dashboards = state.dashboards.filter((dashboard) => dashboard.id !== id);
          const activeId = state.activeDashboardId === id ? dashboards[0].id : state.activeDashboardId;
          return {
            dashboards,
            ...activeFields(dashboards, activeId),
          };
        }),
      renameDashboard: (id, name) =>
        set((state) => {
          const trimmed = name.trim();
          if (!trimmed) return {};
          return {
            dashboards: state.dashboards.map((dashboard) =>
              dashboard.id === id ? { ...dashboard, name: trimmed } : dashboard,
            ),
          };
        }),
      setActiveDashboard: (id) =>
        set((state) => activeFields(state.dashboards, id)),
      setLayouts: (layouts) =>
        set((state) => {
          const nextLayouts = sanitizeLayouts(layouts);
          return {
            layouts: nextLayouts,
            dashboards: state.dashboards.map((dashboard) =>
              dashboard.id === state.activeDashboardId
                ? { ...dashboard, layouts: nextLayouts }
                : dashboard,
            ),
          };
        }),
      setPanelLayout: (id, layout) =>
        set((state) => {
          const layouts = { ...state.layouts, [id]: clampLayoutItem(id, layout) };
          return {
            layouts,
            dashboards: state.dashboards.map((dashboard) =>
              dashboard.id === state.activeDashboardId
                ? { ...dashboard, layouts }
                : dashboard,
            ),
          };
        }),
      setHidden: (id, hidden) =>
        set((state) => {
          const nextHidden = { ...state.hidden, [id]: hidden };
          return {
            hidden: nextHidden,
            dashboards: state.dashboards.map((dashboard) =>
              dashboard.id === state.activeDashboardId
                ? { ...dashboard, hidden: nextHidden }
                : dashboard,
            ),
          };
        }),
      setAllHidden: (hidden) =>
        set((state) => {
          const nextHidden = Object.fromEntries(PANEL_IDS.map((id) => [id, hidden]));
          return {
            hidden: nextHidden,
            dashboards: state.dashboards.map((dashboard) =>
              dashboard.id === state.activeDashboardId
                ? { ...dashboard, hidden: nextHidden }
                : dashboard,
            ),
          };
        }),
      toggleHidden: (id) =>
        set((state) => {
          const nextHidden = { ...state.hidden, [id]: !state.hidden[id] };
          return {
            hidden: nextHidden,
            dashboards: state.dashboards.map((dashboard) =>
              dashboard.id === state.activeDashboardId
                ? { ...dashboard, hidden: nextHidden }
                : dashboard,
            ),
          };
        }),
      reset: () =>
        set((state) => {
          const layouts = cloneLayouts(DEFAULT_LAYOUTS);
          const hidden = {};
          return {
            layouts,
            hidden,
            dashboards: state.dashboards.map((dashboard) =>
              dashboard.id === state.activeDashboardId
                ? { ...dashboard, layouts, hidden }
                : dashboard,
            ),
          };
        }),
    }),
    {
      name: 'duet-dashboard-layout',
      version: 6,
      migrate: migrateDashboardLayout,
    },
  ),
);
