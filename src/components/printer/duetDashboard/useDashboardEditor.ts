import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import type {
  ColSpan,
  LayoutItem,
  PanelId,
  SpacerId,
} from '../../../store/dashboardLayoutStore';
import {
  DEFAULT_COLSPANS,
  DEFAULT_ROWSPANS,
  isSpacerId,
  ROW_HEIGHT,
  spacerSpan,
  VALID_SPANS,
} from '../../../store/dashboardLayoutStore';
import {
  computePanelColStarts,
  computeRowGaps,
} from './config';

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

export function useDashboardEditor({
  colSpans,
  hidden,
  order,
  rowSpans,
  setColSpan,
  setOrder,
  setRowSpan,
}: {
  colSpans: Record<string, ColSpan>;
  hidden: Record<string, boolean>;
  order: LayoutItem[];
  rowSpans: Record<string, number>;
  setColSpan: (id: PanelId, span: ColSpan) => void;
  setOrder: (updater: (prev: LayoutItem[]) => LayoutItem[]) => void;
  setRowSpan: (id: PanelId, span: number) => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [dragId, setDragId] = useState<PanelId | null>(null);
  const [dragOver, setDragOver] = useState<{ id: PanelId; edge: 'before' | 'after' } | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [resizeYState, setResizeYState] = useState<ResizeYState | null>(null);
  const [resizeCornerState, setResizeCornerState] = useState<ResizeCornerState | null>(null);
  const [dropZoneHover, setDropZoneHover] = useState<string | null>(null);
  const [dragOverlay, setDragOverlay] = useState<{
    top: number;
    height: number;
    colWidth: number;
    pStart: number;
    panelSpan: number;
    insertAfterIdx: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const colSpansRef = useRef(colSpans);
  const rowSpansRef = useRef(rowSpans);
  const orderRef = useRef(order);
  const hiddenRef = useRef(hidden);

  useEffect(() => {
    colSpansRef.current = colSpans;
  }, [colSpans]);

  useEffect(() => {
    rowSpansRef.current = rowSpans;
  }, [rowSpans]);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);

  useEffect(() => {
    if (!resizeState) return;

    const onMove = (event: globalThis.MouseEvent) => {
      if (!containerRef.current) return;
      const { width } = containerRef.current.getBoundingClientRect();
      if (width === 0) return;
      const colWidth = width / 12;
      const deltaX = event.clientX - resizeState.startX;
      const deltaCols = Math.round(deltaX / colWidth);
      const rawSpan = resizeState.startSpan + deltaCols;
      const clamped = Math.max(3, Math.min(12, rawSpan));
      const snapped = VALID_SPANS.reduce((prev, current) =>
        Math.abs(current - clamped) < Math.abs(prev - clamped) ? current : prev,
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

    const onMove = (event: globalThis.MouseEvent) => {
      const deltaY = event.clientY - resizeYState.startY;
      const deltaRows = Math.round(deltaY / ROW_HEIGHT);
      const newSpan = Math.max(1, resizeYState.startSpan + deltaRows);
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

    const onMove = (event: globalThis.MouseEvent) => {
      if (!containerRef.current) return;
      const { width } = containerRef.current.getBoundingClientRect();
      if (width === 0) return;

      const colWidth = width / 12;
      const deltaX = event.clientX - resizeCornerState.startX;
      const deltaCols = Math.round(deltaX / colWidth);
      const rawSpan = resizeCornerState.startSpan + deltaCols;
      const clamped = Math.max(3, Math.min(12, rawSpan));
      const snapped = VALID_SPANS.reduce((prev, current) =>
        Math.abs(current - clamped) < Math.abs(prev - clamped) ? current : prev,
      );

      if (snapped !== colSpansRef.current[resizeCornerState.id]) {
        setColSpan(resizeCornerState.id, snapped as ColSpan);
      }

      const deltaY = event.clientY - resizeCornerState.startY;
      const deltaRows = Math.round(deltaY / ROW_HEIGHT);
      const newRows = Math.max(1, resizeCornerState.startRowSpan + deltaRows);
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

  const shiftInfo = useMemo(() => {
    if (!editMode) return new Map<string, { left: boolean; right: boolean }>();
    const gaps = computeRowGaps(order, colSpans, hidden);
    const gapAnchors = new Set(gaps.map((gap) => order[gap.insertAfterIndex]).filter((id) => !isSpacerId(id)));
    const info = new Map<string, { left: boolean; right: boolean }>();

    for (let i = 0; i < order.length; i += 1) {
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
    return new Map(gaps.map((gap) => [gap.insertAfterIndex, { span: gap.span, colStart: gap.colStart }]));
  }, [editMode, dragId, order, colSpans, hidden]);

  const panelColStarts = useMemo(() => {
    if (!editMode || !dragId) return new Map<string, number>();
    return computePanelColStarts(order, colSpans, hidden);
  }, [editMode, dragId, order, colSpans, hidden]);

  const removeFromOrder = useCallback((idx: number) => {
    setOrder((prev) => {
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  }, [setOrder]);

  const handleDragStart = useCallback((id: PanelId) => {
    setDragId(id);
    requestAnimationFrame(() => {
      if (!containerRef.current) return;
      const el = containerRef.current.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
      if (!el) return;
      const currentOrder = orderRef.current;
      const currentSpans = colSpansRef.current;
      const currentHidden = hiddenRef.current;
      const containerRect = containerRef.current.getBoundingClientRect();
      const elementRect = el.getBoundingClientRect();
      const gaps = computeRowGaps(currentOrder, currentSpans, currentHidden);
      const insertAfterIdx = currentOrder.indexOf(id);
      if (!gaps.some((gap) => gap.insertAfterIndex === insertAfterIdx)) return;
      const starts = computePanelColStarts(currentOrder, currentSpans, currentHidden);
      const pStart = starts.get(id) ?? 1;
      const panelSpan = (currentSpans[id] ?? DEFAULT_COLSPANS[id as PanelId]) as number;
      setDragOverlay({
        top: elementRect.top - containerRect.top,
        height: elementRect.height,
        colWidth: containerRect.width / 12,
        pStart,
        panelSpan,
        insertAfterIdx,
      });
    });
  }, []);

  const handleDragOver = useCallback((event: DragEvent, id: PanelId) => {
    event.preventDefault();
    event.stopPropagation();
    setDropZoneHover(null);
    if (id === dragId) {
      setDragOver(null);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const edge = event.clientY < (rect.top + rect.bottom) / 2 ? 'before' : 'after';
    setDragOver({ id, edge });
  }, [dragId]);

  const handleDrop = useCallback((targetId: PanelId) => {
    if (!dragId || dragId === targetId || !dragOver) return;
    const edge = dragOver.edge;
    setOrder((prev) => {
      const next = [...prev];
      const fromIdx = next.indexOf(dragId);
      next.splice(fromIdx, 1);
      const toIdx = next.indexOf(targetId);
      const insertAt = edge === 'before' ? toIdx : toIdx + 1;
      next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, dragId);
      return next;
    });
    setDragId(null);
    setDragOver(null);
  }, [dragId, dragOver, setOrder]);

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
        const span = spacerSpan(next[idx - 1] as SpacerId);
        next[idx - 1] = `__spacer_${span + 1}` as LayoutItem;
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
      const span = spacerSpan(next[idx - 1] as SpacerId);
      if (span === 1) next.splice(idx - 1, 1);
      else next[idx - 1] = `__spacer_${span - 1}` as LayoutItem;
      return next;
    });
  }, [setOrder]);

  const handleGapDrop = useCallback((insertAfterIndex: number, dropCol: number) => {
    if (!dragId) return;
    const pStart = panelColStarts.get(dragId) ?? 1;
    setOrder((prev) => {
      const fromIdx = prev.indexOf(dragId);
      if (fromIdx === -1) return prev;
      const next = [...prev];
      if (fromIdx === insertAfterIndex) {
        const spacerSize = dropCol - pStart;
        if (spacerSize <= 0) return prev;
        next.splice(fromIdx, 0, `__spacer_${spacerSize}` as LayoutItem);
      } else {
        next.splice(fromIdx, 1);
        let targetIdx = insertAfterIndex;
        if (fromIdx <= insertAfterIndex) targetIdx -= 1;
        next.splice(Math.max(0, Math.min(targetIdx + 1, next.length)), 0, dragId);
      }
      return next;
    });
    setDragId(null);
    setDragOver(null);
    setDropZoneHover(null);
    setDragOverlay(null);
  }, [dragId, panelColStarts, setOrder]);

  const handleContainerDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!dragId || !containerRef.current) return;
    setDropZoneHover(null);
    const cardEls = Array.from(containerRef.current.querySelectorAll<HTMLElement>('[data-id]'));
    let bestDist = Infinity;
    let bestEl: HTMLElement | null = null;

    for (const el of cardEls) {
      if (el.dataset.id === dragId) continue;
      const rect = el.getBoundingClientRect();
      const dist = Math.hypot(
        event.clientX - (rect.left + rect.right) / 2,
        event.clientY - (rect.top + rect.bottom) / 2,
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestEl = el;
      }
    }

    if (bestEl) {
      const id = bestEl.dataset.id as PanelId;
      const rect = bestEl.getBoundingClientRect();
      const edge = event.clientY < (rect.top + rect.bottom) / 2 ? 'before' : 'after';
      setDragOver({ id, edge });
    }
  }, [dragId]);

  const handleContainerDrop = useCallback(() => {
    if (!dragId || !dragOver) return;
    const { id: targetId, edge } = dragOver;
    setOrder((prev) => {
      const next = [...prev];
      const fromIdx = next.indexOf(dragId);
      if (fromIdx === -1) return prev;
      next.splice(fromIdx, 1);
      const toIdx = next.indexOf(targetId);
      const insertAt = edge === 'before' ? toIdx : toIdx + 1;
      next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, dragId);
      return next;
    });
    setDragId(null);
    setDragOver(null);
  }, [dragId, dragOver, setOrder]);

  const handleResizeStart = useCallback((id: PanelId, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const currentSpan = (colSpansRef.current[id] ?? DEFAULT_COLSPANS[id]) as ColSpan;
    setResizeState({ id, startX: event.clientX, startSpan: currentSpan });
  }, []);

  const handleResizeStartY = useCallback((id: PanelId, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startSpan = rowSpansRef.current[id] ?? DEFAULT_ROWSPANS[id];
    setResizeYState({ id, startY: event.clientY, startSpan });
  }, []);

  const handleResizeStartCorner = useCallback((id: PanelId, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startSpan = (colSpansRef.current[id] ?? DEFAULT_COLSPANS[id]) as ColSpan;
    const startRowSpan = rowSpansRef.current[id] ?? DEFAULT_ROWSPANS[id];
    setResizeCornerState({ id, startX: event.clientX, startY: event.clientY, startSpan, startRowSpan });
  }, []);

  return {
    containerRef,
    dragId,
    dragOver,
    dragOverlay,
    dropZoneHover,
    editMode,
    gapMap,
    handleContainerDragOver,
    handleContainerDrop,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
    handleDrop,
    handleGapDrop,
    handleResizeStart,
    handleResizeStartCorner,
    handleResizeStartY,
    handleShiftLeft,
    handleShiftRight,
    removeFromOrder,
    setDropZoneHover,
    setEditMode,
    shiftInfo,
  };
}
