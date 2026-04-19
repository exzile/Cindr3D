import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import {
  Activity,
  Wrench,
  Thermometer,
  Move,
  Package,
  Wind,
  Gauge,
  Cpu,
  Zap,
  Layers,
  RotateCcw,
  Grid,
  MapPin,
  LayoutGrid,
  Sliders,
  Star,
  Eye,
  PencilRuler,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import {
  useDashboardLayout,
  type PanelId,
  type LayoutItem,
  type ColSpan,
  type SpacerId,
  DEFAULT_COLSPANS,
  DEFAULT_ROWSPANS,
  VALID_SPANS,
  ROW_HEIGHT,
  isSpacerId,
  spacerSpan,
} from '../../store/dashboardLayoutStore';
import { colors as COLORS } from '../../utils/theme';
import DashboardCard from './dashboard/DashboardCard';
import ViewSettingsPanel from './dashboard/ViewSettingsPanel';
import DuetCustomButtons from './DuetCustomButtons';
import MachineStatusHeader from './dashboard/MachineStatusHeader';
import TemperaturePanel from './dashboard/TemperaturePanel';
import AxisMovementPanel from './dashboard/AxisMovementPanel';
import ExtruderControlPanel from './dashboard/ExtruderControlPanel';
import SpeedFlowPanel from './dashboard/SpeedFlowPanel';
import FanControlPanel from './dashboard/FanControlPanel';
import SystemInfoPanel from './dashboard/SystemInfoPanel';
import AtxPowerPanel from './dashboard/AtxPowerPanel';
import MacroPanel from './dashboard/MacroPanel';
import ToolSelectorPanel from './dashboard/ToolSelectorPanel';
import ToolOffsetsPanel from './dashboard/ToolOffsetsPanel';
import PressureAdvancePanel from './dashboard/PressureAdvancePanel';
import InputShaperPanel from './dashboard/InputShaperPanel';
import WorkplaceCoordinatesPanel from './dashboard/WorkplaceCoordinatesPanel';
import BedCompensationPanel from './dashboard/BedCompensationPanel';
import RestorePointsPanel from './dashboard/RestorePointsPanel';

interface PanelDef {
  id: PanelId;
  title: string;
  icon: React.ReactNode;
  component: React.ReactNode;
}

const PANEL_DEFS: PanelDef[] = [
  { id: 'status',           title: 'Machine Status',        icon: <Activity size={12} />,    component: <MachineStatusHeader /> },
  { id: 'tools',            title: 'Tools',                 icon: <Wrench size={12} />,      component: <ToolSelectorPanel /> },
  { id: 'tool-offsets',     title: 'Tool Offsets',          icon: <Sliders size={12} />,     component: <ToolOffsetsPanel /> },
  { id: 'workplace',        title: 'Workplace Coordinates', icon: <MapPin size={12} />,      component: <WorkplaceCoordinatesPanel /> },
  { id: 'bed-compensation', title: 'Bed Compensation',      icon: <Grid size={12} />,        component: <BedCompensationPanel /> },
  { id: 'restore-points',   title: 'Restore Points',        icon: <RotateCcw size={12} />,   component: <RestorePointsPanel /> },
  { id: 'temperature',      title: 'Temperature',           icon: <Thermometer size={12} />, component: <TemperaturePanel /> },
  { id: 'speed-flow',       title: 'Speed & Flow',          icon: <Gauge size={12} />,       component: <SpeedFlowPanel /> },
  { id: 'fans',             title: 'Fans',                  icon: <Wind size={12} />,        component: <FanControlPanel /> },
  { id: 'pressure-advance', title: 'Pressure Advance',      icon: <Zap size={12} />,         component: <PressureAdvancePanel /> },
  { id: 'input-shaper',     title: 'Input Shaper',          icon: <Layers size={12} />,      component: <InputShaperPanel /> },
  { id: 'axes',             title: 'Axis Movement',         icon: <Move size={12} />,        component: <AxisMovementPanel /> },
  { id: 'extruder',         title: 'Extruder',              icon: <Package size={12} />,     component: <ExtruderControlPanel /> },
  { id: 'atx-power',        title: 'ATX Power',             icon: <Zap size={12} />,         component: <AtxPowerPanel /> },
  { id: 'macros',           title: 'Macros',                icon: <LayoutGrid size={12} />,  component: <MacroPanel /> },
  { id: 'custom-buttons',   title: 'Custom Buttons',        icon: <Star size={12} />,        component: <DuetCustomButtons /> },
  { id: 'system-info',      title: 'System Info',           icon: <Cpu size={12} />,         component: <SystemInfoPanel /> },
];

const PANEL_MAP = Object.fromEntries(
  PANEL_DEFS.map((p) => [p.id, p]),
) as Record<PanelId, PanelDef>;

interface ResizeState {
  id: PanelId;
  startX: number;
  startSpan: ColSpan;
}

interface ResizeYState {
  id: PanelId;
  startY: number;
  startSpan: number;
}

interface ResizeCornerState {
  id: PanelId;
  startX: number;
  startY: number;
  startSpan: ColSpan;
  startRowSpan: number;
}

function itemSpan(id: LayoutItem, colSpans: Record<string, ColSpan>): number {
  if (isSpacerId(id)) return spacerSpan(id);
  return (colSpans[id] ?? DEFAULT_COLSPANS[id]) as number;
}

function computePanelColStarts(
  order: LayoutItem[],
  colSpans: Record<string, ColSpan>,
  hidden: Record<string, boolean>,
): Map<string, number> {
  const COLS = 12;
  let cursor = 0;
  const starts = new Map<string, number>();
  for (const id of order) {
    if (!isSpacerId(id) && hidden[id]) continue;
    const span = itemSpan(id, colSpans);
    if (cursor + span > COLS) cursor = 0;
    starts.set(id, cursor + 1);
    cursor += span;
    if (cursor >= COLS) cursor = 0;
  }
  return starts;
}

function computeRowGaps(
  order: LayoutItem[],
  colSpans: Record<string, ColSpan>,
  hidden: Record<string, boolean>,
): { span: number; insertAfterIndex: number; colStart: number }[] {
  const COLS = 12;
  let cursor = 0;
  let lastVisibleIdx = -1;
  const gaps: { span: number; insertAfterIndex: number; colStart: number }[] = [];

  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    if (!isSpacerId(id) && hidden[id]) continue;
    const span = itemSpan(id, colSpans);
    if (cursor + span > COLS) {
      if (cursor > 0) gaps.push({ span: COLS - cursor, insertAfterIndex: lastVisibleIdx, colStart: cursor + 1 });
      cursor = span >= COLS ? 0 : span;
    } else {
      cursor += span;
      if (cursor >= COLS) cursor = 0;
    }
    lastVisibleIdx = i;
  }
  if (cursor > 0) {
    gaps.push({ span: COLS - cursor, insertAfterIndex: lastVisibleIdx, colStart: cursor + 1 });
  } else if (lastVisibleIdx >= 0) {
    gaps.push({ span: COLS, insertAfterIndex: lastVisibleIdx, colStart: 1 });
  }
  return gaps;
}

function SpacerBlock({ span, onDelete }: { span: number; onDelete: () => void }) {
  return (
    <div className="dc-spacer-block" style={{ gridColumn: `span ${span}` }}>
      <span className="dc-spacer-label">{span} col space</span>
      <button className="dc-spacer-delete" onClick={onDelete} title="Remove spacer">×</button>
    </div>
  );
}

export default function DuetDashboard() {
  const error      = usePrinterStore((s) => s.error);
  const setError   = usePrinterStore((s) => s.setError);
  const order      = useDashboardLayout((s) => s.order);
  const hidden     = useDashboardLayout((s) => s.hidden);
  const colSpans   = useDashboardLayout((s) => s.colSpans);
  const setOrder   = useDashboardLayout((s) => s.setOrder);
  const setColSpan = useDashboardLayout((s) => s.setColSpan);
  const setRowSpan = useDashboardLayout((s) => s.setRowSpan);
  const reset      = useDashboardLayout((s) => s.reset);

  const rowSpans = useDashboardLayout((s) => s.rowSpans);

  const [editMode,         setEditMode]         = useState(false);
  const [dragId,           setDragId]           = useState<PanelId | null>(null);
  const [dragOver,         setDragOver]         = useState<{ id: PanelId; edge: 'before' | 'after' } | null>(null);
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [resizeState,       setResizeState]       = useState<ResizeState | null>(null);
  const [resizeYState,      setResizeYState]      = useState<ResizeYState | null>(null);
  const [resizeCornerState, setResizeCornerState] = useState<ResizeCornerState | null>(null);
  const [dropZoneHover,     setDropZoneHover]     = useState<string | null>(null);
  const [dragOverlay,       setDragOverlay]       = useState<{
    top: number; height: number; colWidth: number;
    pStart: number; panelSpan: number; insertAfterIdx: number;
  } | null>(null);

  const containerRef  = useRef<HTMLDivElement>(null);
  const colSpansRef   = useRef(colSpans);
  const rowSpansRef   = useRef(rowSpans);
  const orderRef      = useRef(order);
  const hiddenRef     = useRef(hidden);
  useEffect(() => { colSpansRef.current = colSpans; }, [colSpans]);
  useEffect(() => { rowSpansRef.current = rowSpans; }, [rowSpans]);
  useEffect(() => { orderRef.current   = order;     }, [order]);
  useEffect(() => { hiddenRef.current  = hidden;    }, [hidden]);

  useEffect(() => {
    if (!resizeState) return;
    const onMove = (e: globalThis.MouseEvent) => {
      if (!containerRef.current) return;
      const { width } = containerRef.current.getBoundingClientRect();
      if (width === 0) return;
      const colWidth   = width / 12;
      const deltaX     = e.clientX - resizeState.startX;
      const deltaCols  = Math.round(deltaX / colWidth);
      const rawSpan    = resizeState.startSpan + deltaCols;
      const clamped    = Math.max(3, Math.min(12, rawSpan));
      const snapped    = VALID_SPANS.reduce((prev, cur) =>
        Math.abs(cur - clamped) < Math.abs(prev - clamped) ? cur : prev,
      );
      if (snapped !== colSpansRef.current[resizeState.id]) {
        setColSpan(resizeState.id, snapped as ColSpan);
      }
    };
    const onUp = () => setResizeState(null);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [resizeState, setColSpan]);

  useEffect(() => {
    if (!resizeYState) return;
    const onMove = (e: globalThis.MouseEvent) => {
      const deltaY    = e.clientY - resizeYState.startY;
      const deltaRows = Math.round(deltaY / ROW_HEIGHT);
      const newSpan   = Math.max(1, resizeYState.startSpan + deltaRows);
      if (newSpan !== rowSpansRef.current[resizeYState.id]) {
        setRowSpan(resizeYState.id, newSpan);
      }
    };
    const onUp = () => setResizeYState(null);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [resizeYState, setRowSpan]);

  useEffect(() => {
    if (!resizeCornerState) return;
    const onMove = (e: globalThis.MouseEvent) => {
      if (!containerRef.current) return;
      const { width } = containerRef.current.getBoundingClientRect();
      if (width === 0) return;
      const colWidth  = width / 12;

      const deltaX    = e.clientX - resizeCornerState.startX;
      const deltaCols = Math.round(deltaX / colWidth);
      const rawSpan   = resizeCornerState.startSpan + deltaCols;
      const clamped   = Math.max(3, Math.min(12, rawSpan));
      const snapped   = VALID_SPANS.reduce((prev, cur) =>
        Math.abs(cur - clamped) < Math.abs(prev - clamped) ? cur : prev,
      );
      if (snapped !== colSpansRef.current[resizeCornerState.id]) {
        setColSpan(resizeCornerState.id, snapped as ColSpan);
      }

      const deltaY    = e.clientY - resizeCornerState.startY;
      const deltaRows = Math.round(deltaY / ROW_HEIGHT);
      const newRows   = Math.max(1, resizeCornerState.startRowSpan + deltaRows);
      if (newRows !== rowSpansRef.current[resizeCornerState.id]) {
        setRowSpan(resizeCornerState.id, newRows);
      }
    };
    const onUp = () => setResizeCornerState(null);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [resizeCornerState, setColSpan, setRowSpan]);

  const handleCloseViewSettings = useCallback(() => setShowViewSettings(false), []);

  const shiftInfo = useMemo(() => {
    if (!editMode) return new Map<string, { left: boolean; right: boolean }>();
    const gaps = computeRowGaps(order, colSpans, hidden);
    const gapAnchors = new Set(
      gaps.map((g) => order[g.insertAfterIndex]).filter((id) => !isSpacerId(id)),
    );
    const info = new Map<string, { left: boolean; right: boolean }>();
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      if (isSpacerId(id) || hidden[id]) continue;
      const canRight = gapAnchors.has(id);
      const prevItem = i > 0 ? order[i - 1] : null;
      const canLeft = prevItem !== null && isSpacerId(prevItem);
      info.set(id, { left: canLeft, right: canRight });
    }
    return info;
  }, [editMode, order, colSpans, hidden]);

  const gapMap = useMemo(() => {
    if (!editMode || !dragId) return new Map<number, { span: number; colStart: number }>();
    const gaps = computeRowGaps(order, colSpans, hidden);
    return new Map(gaps.map((g) => [g.insertAfterIndex, { span: g.span, colStart: g.colStart }]));
  }, [editMode, dragId, order, colSpans, hidden]);

  const panelColStarts = useMemo(() => {
    if (!editMode || !dragId) return new Map<string, number>();
    return computePanelColStarts(order, colSpans, hidden);
  }, [editMode, dragId, order, colSpans, hidden]);

  const removeFromOrder = useCallback((idx: number) => {
    setOrder((prev) => { const next = [...prev]; next.splice(idx, 1); return next; });
  }, [setOrder]);

  const handleDragStart = useCallback((id: PanelId) => {
    setDragId(id);
    requestAnimationFrame(() => {
      if (!containerRef.current) return;
      const el = containerRef.current.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
      if (!el) return;
      // Use refs so we always read the latest state, not the closure-captured snapshot
      const currentOrder   = orderRef.current;
      const currentSpans   = colSpansRef.current;
      const currentHidden  = hiddenRef.current;
      const cRect = containerRef.current.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const gaps = computeRowGaps(currentOrder, currentSpans, currentHidden);
      const insertAfterIdx = currentOrder.indexOf(id);
      if (!gaps.some((g) => g.insertAfterIndex === insertAfterIdx)) return;
      const pStarts = computePanelColStarts(currentOrder, currentSpans, currentHidden);
      const pStart = pStarts.get(id) ?? 1;
      const panelSpan = (currentSpans[id] ?? DEFAULT_COLSPANS[id as PanelId]) as number;
      setDragOverlay({
        top: eRect.top - cRect.top,
        height: eRect.height,
        colWidth: cRect.width / 12,
        pStart,
        panelSpan,
        insertAfterIdx,
      });
    });
  }, []); // refs keep this stable across renders

  const handleDragOver = useCallback(
    (e: DragEvent, id: PanelId) => {
      e.preventDefault();
      e.stopPropagation();
      setDropZoneHover(null);
      if (id === dragId) { setDragOver(null); return; }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const edge = e.clientY < (rect.top + rect.bottom) / 2 ? 'before' : 'after';
      setDragOver({ id, edge });
    },
    [dragId],
  );

  const handleDrop = useCallback(
    (targetId: PanelId) => {
      if (!dragId || dragId === targetId || !dragOver) return;
      const edge = dragOver.edge;
      setOrder((prev) => {
        const next    = [...prev];
        const fromIdx = next.indexOf(dragId);
        next.splice(fromIdx, 1);
        const toIdx    = next.indexOf(targetId);
        const insertAt = edge === 'before' ? toIdx : toIdx + 1;
        next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, dragId);
        return next;
      });
      setDragId(null);
      setDragOver(null);
    },
    [dragId, dragOver, setOrder],
  );

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragOver(null);
    setDropZoneHover(null);
    setDragOverlay(null);
  }, []);

  const handleShiftRight = useCallback((id: PanelId) => {
    setOrder((prev) => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const next = [...prev];
      if (idx > 0 && isSpacerId(next[idx - 1])) {
        const sp = spacerSpan(next[idx - 1] as SpacerId);
        next[idx - 1] = `__spacer_${sp + 1}` as LayoutItem;
      } else {
        next.splice(idx, 0, '__spacer_1' as LayoutItem);
      }
      return next;
    });
  }, [setOrder]);

  const handleShiftLeft = useCallback((id: PanelId) => {
    setOrder((prev) => {
      const idx = prev.indexOf(id);
      if (idx <= 0 || !isSpacerId(prev[idx - 1])) return prev;
      const next = [...prev];
      const sp = spacerSpan(next[idx - 1] as SpacerId);
      if (sp === 1) next.splice(idx - 1, 1);
      else next[idx - 1] = `__spacer_${sp - 1}` as LayoutItem;
      return next;
    });
  }, [setOrder]);

  const handleGapDrop = useCallback(
    (insertAfterIndex: number, dropCol: number) => {
      if (!dragId) return;
      const pStart = panelColStarts.get(dragId) ?? 1;
      setOrder((prev) => {
        const fromIdx = prev.indexOf(dragId);
        if (fromIdx === -1) return prev;
        const next = [...prev];
        if (fromIdx === insertAfterIndex) {
          // Own trailing gap — insert spacer to push panel to dropCol
          const spacerSize = dropCol - pStart;
          if (spacerSize <= 0) return prev; // no-op, avoid pointless re-render
          next.splice(fromIdx, 0, `__spacer_${spacerSize}` as LayoutItem);
        } else {
          // Different row gap — reorder panel to after the anchor
          next.splice(fromIdx, 1);
          let targetIdx = insertAfterIndex;
          if (fromIdx <= insertAfterIndex) targetIdx--;
          next.splice(Math.max(0, Math.min(targetIdx + 1, next.length)), 0, dragId);
        }
        return next;
      });
      setDragId(null);
      setDragOver(null);
      setDropZoneHover(null);
      setDragOverlay(null);
    },
    [dragId, panelColStarts, setOrder],
  );

  const handleContainerDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!dragId || !containerRef.current) return;
      setDropZoneHover(null);
      const cardEls = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>('[data-id]'),
      );
      let bestDist = Infinity;
      let bestEl: HTMLElement | null = null;
      for (const el of cardEls) {
        if (el.dataset.id === dragId) continue;
        const r    = el.getBoundingClientRect();
        const dist = Math.hypot(e.clientX - (r.left + r.right) / 2, e.clientY - (r.top + r.bottom) / 2);
        if (dist < bestDist) { bestDist = dist; bestEl = el; }
      }
      if (bestEl) {
        const id   = bestEl.dataset.id as PanelId;
        const r    = bestEl.getBoundingClientRect();
        const edge = e.clientY < (r.top + r.bottom) / 2 ? 'before' : 'after';
        setDragOver({ id, edge });
      }
    },
    [dragId],
  );

  const handleContainerDrop = useCallback(
    (_e: DragEvent<HTMLDivElement>) => {
      if (!dragId || !dragOver) return;
      const { id: targetId, edge } = dragOver;
      setOrder((prev) => {
        const next    = [...prev];
        const fromIdx = next.indexOf(dragId);
        if (fromIdx === -1) return prev;
        next.splice(fromIdx, 1);
        const toIdx    = next.indexOf(targetId);
        const insertAt = edge === 'before' ? toIdx : toIdx + 1;
        next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, dragId);
        return next;
      });
      setDragId(null);
      setDragOver(null);
    },
    [dragId, dragOver, setOrder],
  );

  const handleResizeStart = useCallback(
    (id: PanelId, e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const currentSpan = (colSpansRef.current[id] ?? DEFAULT_COLSPANS[id]) as ColSpan;
      setResizeState({ id, startX: e.clientX, startSpan: currentSpan });
    },
    [],
  );

  const handleResizeStartY = useCallback(
    (id: PanelId, e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startSpan = rowSpansRef.current[id] ?? DEFAULT_ROWSPANS[id];
      setResizeYState({ id, startY: e.clientY, startSpan });
    },
    [],
  );

  const handleResizeStartCorner = useCallback(
    (id: PanelId, e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startSpan    = (colSpansRef.current[id] ?? DEFAULT_COLSPANS[id]) as ColSpan;
      const startRowSpan = rowSpansRef.current[id] ?? DEFAULT_ROWSPANS[id];
      setResizeCornerState({ id, startX: e.clientX, startY: e.clientY, startSpan, startRowSpan });
    },
    [],
  );

  const hiddenCount = Object.values(hidden).filter(Boolean).length;

  return (
    <div className="duet-dash-root" style={{ background: COLORS.bg }}>
      {error && (
        <div className="duet-dash-error-banner" style={{ borderColor: COLORS.danger, color: COLORS.danger }}>
          <span>{error}</span>
          <button
            className="duet-dash-error-dismiss"
            style={{ color: COLORS.danger }}
            onClick={() => setError(null)}
          >
            &times;
          </button>
        </div>
      )}

      <div className="duet-dash-controls-bar">
        <div className="dc-controls-left">
          {hiddenCount > 0 && (
            <span className="dc-hidden-badge">{hiddenCount} hidden</span>
          )}
          {editMode && (
            <span className="dc-edit-badge">Drag to swap · drag to empty space to move · resize handles on edges &amp; corners</span>
          )}
        </div>
        <div className="dc-controls-right">
          <div className="dc-view-wrap">
            <button
              className={`dc-reset-btn${showViewSettings ? ' is-active' : ''}`}
              onClick={() => setShowViewSettings((v) => !v)}
              title="Show / hide panels"
            >
              <Eye size={11} /> View
            </button>
            {showViewSettings && (
              <ViewSettingsPanel
                panels={PANEL_DEFS}
                onClose={handleCloseViewSettings}
              />
            )}
          </div>
          <button
            className={`dc-reset-btn dc-edit-btn${editMode ? ' is-active' : ''}`}
            onClick={() => setEditMode((v) => !v)}
            title={editMode ? 'Done editing layout' : 'Edit layout'}
          >
            <PencilRuler size={11} /> {editMode ? 'Done' : 'Edit Layout'}
          </button>
          <button className="dc-reset-btn" onClick={reset} title="Reset panel layout">
            <RotateCcw size={11} /> Reset
          </button>
        </div>
      </div>

      <div
        className="duet-dash-card-list"
        ref={containerRef}
        onDragOver={editMode ? handleContainerDragOver : undefined}
        onDrop={editMode ? handleContainerDrop : undefined}
      >
        {editMode && (
          <div className="dc-edit-overlay" aria-hidden="true">
            {Array.from({ length: 12 * 20 }).map((_, i) => (
              <div key={i} className="dc-edit-col" />
            ))}
          </div>
        )}

        {dragOverlay && (() => {
          const { top, height, colWidth, pStart, panelSpan, insertAfterIdx } = dragOverlay;
          const cells: React.ReactElement[] = [];
          for (let col = pStart; col <= 13 - panelSpan; col++) {
            const zoneKey = `ov-${col}`;
            cells.push(
              <div
                key={zoneKey}
                className={`dc-gap-cell${dropZoneHover === zoneKey ? ' is-hover' : ''}`}
                style={{
                  position: 'absolute',
                  left:   (col - 1) * colWidth,
                  top,
                  width:  colWidth,
                  height,
                  zIndex: 20,
                  borderRadius: 6,
                }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropZoneHover(zoneKey); }}
                onDragLeave={() => setDropZoneHover(null)}
                onDrop={(e) => { e.stopPropagation(); handleGapDrop(insertAfterIdx, col); }}
              />,
            );
          }
          return cells;
        })()}

        {order.flatMap((id, idx) => {
          // ── spacer placeholder ──────────────────────────────────────────
          if (isSpacerId(id)) {
            const sp = spacerSpan(id);
            if (!editMode) return [<div key={`spacer-${idx}`} style={{ gridColumn: `span ${sp}` }} />];
            return [<SpacerBlock key={`spacer-${idx}`} span={sp} onDelete={() => removeFromOrder(idx)} />];
          }

          // ── panel card ──────────────────────────────────────────────────
          const def = PANEL_MAP[id as PanelId];
          if (!def || hidden[id]) return [];
          const span    = (colSpans[id] ?? DEFAULT_COLSPANS[id as PanelId]) as ColSpan;
          const rowSpan = rowSpans[id] ?? DEFAULT_ROWSPANS[id as PanelId];
          const shift = shiftInfo.get(id) ?? { left: false, right: false };
          const card = (
            <DashboardCard
              key={id}
              id={id}
              title={def.title}
              icon={def.icon}
              colSpan={span}
              rowSpan={rowSpan}
              editMode={editMode}
              dropEdge={dragOver?.id === (id as PanelId) ? dragOver.edge : null}
              isDragging={dragId === (id as PanelId)}
              canShiftLeft={shift.left}
              canShiftRight={shift.right}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              onResizeStart={handleResizeStart}
              onResizeStartY={handleResizeStartY}
              onResizeStartCorner={handleResizeStartCorner}
              onShiftLeft={handleShiftLeft}
              onShiftRight={handleShiftRight}
            >
              {def.component}
            </DashboardCard>
          );
          const gapInfo = gapMap.get(idx);
          if (gapInfo && dragId) {
            if (dragId === id) {
              return [card];
            }
            return [
              card,
              <div
                key={`gap-${idx}`}
                className={`dc-gap-zone${dropZoneHover === String(idx) ? ' is-hover' : ''}`}
                style={{ gridColumn: `span ${gapInfo.span}`, gridRow: `span ${rowSpan}` }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropZoneHover(String(idx)); }}
                onDragLeave={() => setDropZoneHover(null)}
                onDrop={(e) => { e.stopPropagation(); handleGapDrop(idx, gapInfo.colStart); }}
              />,
            ];
          }
          return [card];
        })}
      </div>
    </div>
  );
}
