import { useCallback, useState } from 'react';
import { Eye, PencilRuler, RotateCcw } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import {
  DEFAULT_COLSPANS,
  DEFAULT_ROWSPANS,
  isSpacerId,
  type PanelId,
} from '../../store/dashboardLayoutStore';
import { useDashboardLayout } from '../../store/dashboardLayoutStore';
import { colors as COLORS } from '../../utils/theme';
import DashboardCard from './dashboard/DashboardCard';
import ViewSettingsPanel from './dashboard/ViewSettingsPanel';
import { PANEL_DEFS, PANEL_MAP, SpacerBlock } from './duetDashboard/config';
import { useDashboardEditor } from './duetDashboard/useDashboardEditor';

export default function DuetDashboard() {
  const error = usePrinterStore((s) => s.error);
  const setError = usePrinterStore((s) => s.setError);
  const order = useDashboardLayout((s) => s.order);
  const hidden = useDashboardLayout((s) => s.hidden);
  const colSpans = useDashboardLayout((s) => s.colSpans);
  const rowSpans = useDashboardLayout((s) => s.rowSpans);
  const setOrder = useDashboardLayout((s) => s.setOrder);
  const setColSpan = useDashboardLayout((s) => s.setColSpan);
  const setRowSpan = useDashboardLayout((s) => s.setRowSpan);
  const reset = useDashboardLayout((s) => s.reset);

  const [showViewSettings, setShowViewSettings] = useState(false);
  const handleCloseViewSettings = useCallback(() => setShowViewSettings(false), []);

  const {
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
  } = useDashboardEditor({
    colSpans,
    hidden,
    order,
    rowSpans,
    setColSpan,
    setOrder,
    setRowSpan,
  });

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
          {hiddenCount > 0 && <span className="dc-hidden-badge">{hiddenCount} hidden</span>}
          {editMode && (
            <span className="dc-edit-badge">
              Drag to swap · drag to empty space to move · resize handles on edges &amp; corners
            </span>
          )}
        </div>
        <div className="dc-controls-right">
          <div className="dc-view-wrap">
            <button
              className={`dc-reset-btn${showViewSettings ? ' is-active' : ''}`}
              onClick={() => setShowViewSettings((value) => !value)}
              title="Show / hide panels"
            >
              <Eye size={11} /> View
            </button>
            {showViewSettings && (
              <ViewSettingsPanel panels={PANEL_DEFS} onClose={handleCloseViewSettings} />
            )}
          </div>
          <button
            className={`dc-reset-btn dc-edit-btn${editMode ? ' is-active' : ''}`}
            onClick={() => setEditMode((value) => !value)}
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
            {Array.from({ length: 12 * 20 }).map((_, index) => (
              <div key={index} className="dc-edit-col" />
            ))}
          </div>
        )}

        {dragOverlay &&
          (() => {
            const { top, height, colWidth, pStart, panelSpan, insertAfterIdx } = dragOverlay;
            return Array.from({ length: 14 - panelSpan - pStart + 1 }).map((_, index) => {
              const col = pStart + index;
              const zoneKey = `ov-${col}`;
              return (
                <div
                  key={zoneKey}
                  className={`dc-gap-cell${dropZoneHover === zoneKey ? ' is-hover' : ''}`}
                  style={{
                    position: 'absolute',
                    left: (col - 1) * colWidth,
                    top,
                    width: colWidth,
                    height,
                    zIndex: 20,
                    borderRadius: 6,
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setDropZoneHover(zoneKey);
                  }}
                  onDragLeave={() => setDropZoneHover(null)}
                  onDrop={(event) => {
                    event.stopPropagation();
                    handleGapDrop(insertAfterIdx, col);
                  }}
                />
              );
            });
          })()}

        {order.flatMap((id, idx) => {
          if (isSpacerId(id)) {
            const span = Number(id.replace('__spacer_', ''));
            if (!editMode) {
              return [<div key={`spacer-${idx}`} style={{ gridColumn: `span ${span}` }} />];
            }
            return [
              <SpacerBlock
                key={`spacer-${idx}`}
                span={span}
                onDelete={() => removeFromOrder(idx)}
              />,
            ];
          }

          const def = PANEL_MAP[id as PanelId];
          if (!def || hidden[id]) return [];

          const span = colSpans[id] ?? DEFAULT_COLSPANS[id as PanelId];
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
            if (dragId === id) return [card];
            return [
              card,
              <div
                key={`gap-${idx}`}
                className={`dc-gap-zone${dropZoneHover === String(idx) ? ' is-hover' : ''}`}
                style={{ gridColumn: `span ${gapInfo.span}`, gridRow: `span ${rowSpan}` }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDropZoneHover(String(idx));
                }}
                onDragLeave={() => setDropZoneHover(null)}
                onDrop={(event) => {
                  event.stopPropagation();
                  handleGapDrop(idx, gapInfo.colStart);
                }}
              />,
            ];
          }

          return [card];
        })}
      </div>
    </div>
  );
}
