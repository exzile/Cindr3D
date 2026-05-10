import { useCallback, useMemo, useRef, useState } from 'react';
import type { DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import ReactGridLayout, { noCompactor, type Layout, type LayoutItem as GridLayoutItem } from 'react-grid-layout';

// Allow cards to overlap freely during drag; replace-on-drop logic runs at release.
const overlapCompactor = { ...noCompactor, allowOverlap: true };
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { ArrowLeftRight, Check, Edit3, Eye, EyeOff, FileCode, FolderOpen, Minus, PencilRuler, PlugZap, Plus, RotateCcw, Settings, Wifi, X } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import {
  GRID_COLS,
  MIN_PANEL_WIDTH,
  ROW_HEIGHT,
  defaultPanelLayout,
  type DashboardLayoutItem,
  type PanelId,
} from '../../store/dashboardLayoutStore';
import { useDashboardLayout } from '../../store/dashboardLayoutStore';
import { colors as COLORS } from '../../utils/theme';
import DashboardCard from './dashboard/DashboardCard';
import CameraDashboardPanel from './dashboard/CameraDashboardPanel';
import ViewSettingsPanel from './dashboard/ViewSettingsPanel';
import { PANEL_DEFS } from './duetDashboard/config';

const GRID_MARGIN: readonly [number, number] = [10, 10];
const GRID_PADDING: readonly [number, number] = [10, 8];

function panelSort(layouts: Record<PanelId, DashboardLayoutItem>) {
  return (a: (typeof PANEL_DEFS)[number], b: (typeof PANEL_DEFS)[number]) => {
    const aLayout = layouts[a.id] ?? defaultPanelLayout(a.id);
    const bLayout = layouts[b.id] ?? defaultPanelLayout(b.id);
    return aLayout.y - bLayout.y || aLayout.x - bLayout.x || a.title.localeCompare(b.title);
  };
}

function gridBottom(layouts: Record<PanelId, DashboardLayoutItem>, hidden: Record<string, boolean>) {
  return PANEL_DEFS.reduce((bottom, panel) => {
    if (hidden[panel.id]) return bottom;
    const layout = layouts[panel.id] ?? defaultPanelLayout(panel.id);
    return Math.max(bottom, layout.y + layout.h);
  }, 0);
}

function isPanelId(value: string): value is PanelId {
  return PANEL_DEFS.some((panel) => panel.id === value);
}

// Ref-callback based width measurement — re-connects the ResizeObserver whenever
// the element mounts. useContainerWidth from react-grid-layout only runs its effect
// once (on component mount), so it misses the offline→connected DOM transition.
function useGridWidth(initialWidth = 1280) {
  const [width, setWidth] = useState(initialWidth);
  const [mounted, setMounted] = useState(false);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    setWidth(node.offsetWidth);
    setMounted(true);
    observerRef.current = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    observerRef.current.observe(node);
  }, []);

  return { width, mounted, ref };
}

export default function DuetDashboard() {
  const connected = usePrinterStore((s) => s.connected);
  const connecting = usePrinterStore((s) => s.connecting);
  const reconnecting = usePrinterStore((s) => s.reconnecting);
  const config = usePrinterStore((s) => s.config);
  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const connect = usePrinterStore((s) => s.connect);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);
  const error = usePrinterStore((s) => s.error);
  const setError = usePrinterStore((s) => s.setError);
  const dashboards = useDashboardLayout((s) => s.dashboards);
  const activeDashboardId = useDashboardLayout((s) => s.activeDashboardId);
  const layouts = useDashboardLayout((s) => s.layouts);
  const hidden = useDashboardLayout((s) => s.hidden);
  const addDashboard = useDashboardLayout((s) => s.addDashboard);
  const removeDashboard = useDashboardLayout((s) => s.removeDashboard);
  const renameDashboard = useDashboardLayout((s) => s.renameDashboard);
  const setActiveDashboard = useDashboardLayout((s) => s.setActiveDashboard);
  const setLayouts = useDashboardLayout((s) => s.setLayouts);
  const setPanelLayout = useDashboardLayout((s) => s.setPanelLayout);
  const setHidden = useDashboardLayout((s) => s.setHidden);
  const setAllHidden = useDashboardLayout((s) => s.setAllHidden);
  const pageWidthPx = useDashboardLayout((s) => s.pageWidthPx);
  const setPageWidth = useDashboardLayout((s) => s.setPageWidth);
  const reset = useDashboardLayout((s) => s.reset);

  const [editMode, setEditMode] = useState(false);
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [menuDragId, setMenuDragId] = useState<PanelId | null>(null);
  const [renamingDashboardId, setRenamingDashboardId] = useState<string | null>(null);
  const [dashboardNameDraft, setDashboardNameDraft] = useState('');
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const draggingItemIdRef = useRef<PanelId | null>(null);
  const preDragLayoutsRef = useRef<Record<PanelId, DashboardLayoutItem> | null>(null);
  const { width: gridWidth, ref: gridContainerRef, mounted: gridMounted } = useGridWidth();
  // committedWidth: what the grid actually sizes to (changes only on handle release)
  const committedWidth = Math.min(pageWidthPx ?? gridWidth, gridWidth);
  // previewWidth: live during drag for dead-zone positioning; grid doesn't resize during drag
  const previewWidth = Math.min(draftWidth ?? pageWidthPx ?? gridWidth, gridWidth);
  const deadZoneWidth = Math.max(0, Math.floor((gridWidth - previewWidth) / 2));
  const handleCloseViewSettings = useCallback(() => setShowViewSettings(false), []);

  const activePrinter = printers.find((printer) => printer.id === activePrinterId);
  const hiddenCount = Object.values(hidden).filter(Boolean).length;
  const isOpeningDashboard = Boolean(config.hostname) && (connecting || reconnecting);
  const visiblePanels = useMemo(
    () => PANEL_DEFS.filter((panel) => !hidden[panel.id]).sort(panelSort(layouts)),
    [hidden, layouts],
  );

  const gridLayout = useMemo<Layout>(() => visiblePanels.map((panel) => {
    const item = layouts[panel.id] ?? defaultPanelLayout(panel.id);
    return {
      ...item,
      minW: MIN_PANEL_WIDTH,
      minH: 1,
      maxW: GRID_COLS,
      isDraggable: editMode,
      isResizable: editMode,
      resizeHandles: ['se', 'e', 's'],
    };
  }), [editMode, layouts, visiblePanels]);

  const commitLayout = useCallback((nextLayout: Layout) => {
    setLayouts({
      ...layouts,
      ...Object.fromEntries(
        nextLayout
          .filter((item): item is GridLayoutItem & { i: PanelId } => isPanelId(item.i))
          .map((item) => [
            item.i,
            {
              i: item.i,
              x: item.x,
              y: item.y,
              w: item.w,
              h: item.h,
            },
          ]),
      ),
    });
  }, [layouts, setLayouts]);

  const handleAddPanel = useCallback((id: PanelId, placement?: Pick<DashboardLayoutItem, 'x' | 'y'>) => {
    const existing = layouts[id] ?? defaultPanelLayout(id);
    setPanelLayout(id, {
      ...existing,
      x: placement?.x ?? 0,
      y: placement?.y ?? gridBottom(layouts, hidden),
    });
    setHidden(id, false);
  }, [hidden, layouts, setHidden, setPanelLayout]);

  const handleGridDrop = useCallback((nextLayout: Layout, item: GridLayoutItem | undefined) => {
    if (!menuDragId || !item) return;
    const existing = layouts[menuDragId] ?? defaultPanelLayout(menuDragId);
    commitLayout(nextLayout);
    setPanelLayout(menuDragId, {
      ...existing,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    });
    setHidden(menuDragId, false);
    setMenuDragId(null);
  }, [commitLayout, layouts, menuDragId, setHidden, setPanelLayout]);

  const handleGridDropDragOver = useCallback(() => {
    if (!menuDragId) return false;
    const item = layouts[menuDragId] ?? defaultPanelLayout(menuDragId);
    return { w: item.w, h: item.h };
  }, [layouts, menuDragId]);

  const handleCardDragStart = useCallback(
    (_layout: Layout, _oldItem: GridLayoutItem | null, item: GridLayoutItem | null) => {
      if (!item) return;
      if (isPanelId(item.i)) {
        draggingItemIdRef.current = item.i;
        preDragLayoutsRef.current = { ...layouts };
      }
    },
    [layouts],
  );

  const handleCardDragStop = useCallback(
    (finalLayout: Layout) => {
      const draggedId = draggingItemIdRef.current;
      draggingItemIdRef.current = null;
      preDragLayoutsRef.current = null;

      if (!draggedId) {
        commitLayout(finalLayout);
        return;
      }

      const dropped = finalLayout.find((item) => item.i === draggedId);
      if (!dropped) {
        commitLayout(finalLayout);
        return;
      }

      // Hide any card whose grid cell overlaps with the dropped position.
      const overlappingIds: PanelId[] = [];
      for (const item of finalLayout) {
        if (!isPanelId(item.i) || item.i === draggedId) continue;
        const hOverlap = dropped.x < item.x + item.w && dropped.x + dropped.w > item.x;
        const vOverlap = dropped.y < item.y + item.h && dropped.y + dropped.h > item.y;
        if (hOverlap && vOverlap) overlappingIds.push(item.i);
      }

      for (const id of overlappingIds) {
        setHidden(id, true);
      }

      commitLayout(finalLayout.filter((item) => !overlappingIds.includes(item.i as PanelId)));
    },
    [commitLayout, setHidden],
  );

  const handlePanelMenuDrop = useCallback((event: DragEvent, nextHidden: boolean) => {
    event.preventDefault();
    if (!menuDragId) return;
    if (!nextHidden) {
      if (hidden[menuDragId]) handleAddPanel(menuDragId);
    } else if (!hidden[menuDragId]) {
      setHidden(menuDragId, true);
    }
    setMenuDragId(null);
  }, [handleAddPanel, hidden, menuDragId, setHidden]);

  const beginRenameDashboard = useCallback((id: string, name: string) => {
    setRenamingDashboardId(id);
    setDashboardNameDraft(name);
  }, []);

  const commitRenameDashboard = useCallback(() => {
    if (!renamingDashboardId) return;
    renameDashboard(renamingDashboardId, dashboardNameDraft);
    setRenamingDashboardId(null);
    setDashboardNameDraft('');
  }, [dashboardNameDraft, renameDashboard, renamingDashboardId]);

  const cancelRenameDashboard = useCallback(() => {
    setRenamingDashboardId(null);
    setDashboardNameDraft('');
  }, []);

  if (!connected) {
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

        <div className="duet-dash-offline">
          <div className="duet-dash-offline__hero">
            <div className={`duet-dash-offline__icon${isOpeningDashboard ? ' is-pulsing' : ''}`}>
              {isOpeningDashboard ? <Wifi size={28} /> : <PlugZap size={28} />}
            </div>
            <div>
              <h2>{isOpeningDashboard ? 'Opening printer dashboard' : 'Connect a Duet printer'}</h2>
              <p>
                {isOpeningDashboard
                  ? 'Restoring the saved printer connection. The dashboard will appear as soon as live machine data is ready.'
                  : 'Set up a Duet board to unlock live controls, file management, print monitoring, and machine diagnostics.'}
              </p>
            </div>
          </div>

          <div className="duet-dash-offline__summary">
            <div>
              <span>Active printer</span>
              <strong>{activePrinter?.name ?? 'Printer 1'}</strong>
            </div>
            <div>
              <span>Host</span>
              <strong>{config.hostname || 'Not configured'}</strong>
            </div>
            <div>
              <span>Mode</span>
              <strong>{config.mode === 'sbc' ? 'SBC' : 'Standalone'}</strong>
            </div>
          </div>

          <div className="duet-dash-offline__actions">
            <button
              className="duet-dash-offline__primary"
              disabled={connecting || !config.hostname}
              onClick={() => { void connect(); }}
              title={config.hostname ? 'Connect to printer' : 'Add a hostname in settings first'}
            >
              <Wifi size={16} /> {connecting ? 'Connecting...' : 'Connect'}
            </button>
            <button onClick={() => setActiveTab('settings')}>
              <Settings size={16} /> Connection Settings
            </button>
            <button onClick={() => setActiveTab('files')}>
              <FolderOpen size={16} /> Files
            </button>
            <button onClick={() => setActiveTab('config')}>
              <FileCode size={16} /> Config
            </button>
          </div>

          <div className="duet-dash-offline__camera">
            <div className="duet-dash-offline__camera-title">Camera</div>
            <CameraDashboardPanel compact />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`duet-dash-root${editMode ? ' is-layout-editing' : ''}`} style={{ background: COLORS.bg }}>
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
          <div className="dc-dashboard-tabs" aria-label="Dashboard layouts">
            {dashboards.map((dashboard) => {
              const isActive = dashboard.id === activeDashboardId;
              const isRenaming = dashboard.id === renamingDashboardId;
              return (
                <div
                  key={dashboard.id}
                  className={`dc-dashboard-tab${isActive ? ' is-active' : ''}`}
                >
                  {isRenaming ? (
                    <>
                      <input
                        className="dc-dashboard-tab__input"
                        value={dashboardNameDraft}
                        autoFocus
                        onChange={(event) => setDashboardNameDraft(event.target.value)}
                        onBlur={commitRenameDashboard}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRenameDashboard();
                          if (event.key === 'Escape') cancelRenameDashboard();
                        }}
                      />
                      <button
                        className="dc-dashboard-tab__icon"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={commitRenameDashboard}
                        title="Save dashboard name"
                      >
                        <Check size={11} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="dc-dashboard-tab__select"
                        onClick={() => setActiveDashboard(dashboard.id)}
                        onDoubleClick={() => beginRenameDashboard(dashboard.id, dashboard.name)}
                        title="Switch dashboard"
                      >
                        {dashboard.name}
                      </button>
                      {isActive && (
                        <button
                          className="dc-dashboard-tab__icon"
                          onClick={() => beginRenameDashboard(dashboard.id, dashboard.name)}
                          title="Rename dashboard"
                        >
                          <Edit3 size={11} />
                        </button>
                      )}
                      {isActive && dashboards.length > 1 && (
                        <button
                          className="dc-dashboard-tab__icon"
                          onClick={() => removeDashboard(dashboard.id)}
                          title="Delete dashboard"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            <button
              className="dc-dashboard-add"
              onClick={addDashboard}
              title="Add dashboard"
            >
              <Plus size={12} /> Dashboard
            </button>
          </div>
          {hiddenCount > 0 && <span className="dc-hidden-badge">{hiddenCount} hidden</span>}
          {editMode && (
            <span className="dc-edit-badge">
              {visiblePanels.length} active cards
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

      {editMode && (
        <DashboardLayoutOverlay
          panels={PANEL_DEFS}
          layouts={layouts}
          hidden={hidden}
          dragId={menuDragId}
          onDragStart={setMenuDragId}
          onDragEnd={() => setMenuDragId(null)}
          onVisibilityDrop={handlePanelMenuDrop}
          onClearPanels={() => setAllHidden(true)}
          onDone={() => setEditMode(false)}
          onAddPanel={handleAddPanel}
          onSetHidden={setHidden}
        />
      )}

      {/* Outer div keeps ref for width measurement — always full container width */}
      <div ref={gridContainerRef} style={{ position: 'relative', overflow: 'visible' }}>
        {editMode && deadZoneWidth > 1 && (
          <>
            <div className="dc-page-dead-zone" style={{ left: 0, width: deadZoneWidth }} aria-hidden="true" />
            <div className="dc-page-dead-zone" style={{ right: 0, width: deadZoneWidth }} aria-hidden="true" />
          </>
        )}
        {editMode && gridMounted && (
          <>
            <PageWidthHandle
              side="left"
              containerWidth={gridWidth}
              effectiveWidth={draftWidth ?? pageWidthPx ?? gridWidth}
              displayWidth={previewWidth}
              onDraft={setDraftWidth}
              onCommit={(px) => { setDraftWidth(null); setPageWidth(px >= gridWidth - 1 ? null : px); }}
              onReset={() => { setDraftWidth(null); setPageWidth(null); }}
            />
            <PageWidthHandle
              side="right"
              containerWidth={gridWidth}
              effectiveWidth={draftWidth ?? pageWidthPx ?? gridWidth}
              displayWidth={previewWidth}
              onDraft={setDraftWidth}
              onCommit={(px) => { setDraftWidth(null); setPageWidth(px >= gridWidth - 1 ? null : px); }}
              onReset={() => { setDraftWidth(null); setPageWidth(null); }}
            />
          </>
        )}
        <div style={{ width: committedWidth, marginLeft: 'auto', marginRight: 'auto' }}>
        {gridMounted && (
          <ReactGridLayout
            className={`duet-dash-card-list${editMode ? ' is-edit-grid' : ''}`}
            layout={gridLayout}
            width={committedWidth}
            gridConfig={{
              cols: GRID_COLS,
              rowHeight: ROW_HEIGHT,
              margin: GRID_MARGIN,
              containerPadding: GRID_PADDING,
            }}
            compactor={overlapCompactor}
            dragConfig={{
              enabled: editMode,
              handle: '.dc-header',
              cancel: '.dc-body button,.dc-body input,.dc-body select,.dc-body textarea,.dc-body a',
            }}
            resizeConfig={{
              enabled: editMode,
              handles: ['se', 'e', 's'],
            }}
            dropConfig={{
              enabled: editMode && menuDragId !== null,
              defaultItem: menuDragId
                ? { w: layouts[menuDragId]?.w ?? MIN_PANEL_WIDTH, h: layouts[menuDragId]?.h ?? 1 }
                : { w: MIN_PANEL_WIDTH, h: 1 },
            }}
            droppingItem={menuDragId ? { ...(layouts[menuDragId] ?? defaultPanelLayout(menuDragId)), i: '__dropping-elem__' } : undefined}
            onDropDragOver={handleGridDropDragOver}
            onDrop={handleGridDrop}
            onDragStart={handleCardDragStart}
            onDragStop={handleCardDragStop}
            onResizeStop={(layout) => commitLayout(layout)}
          >
            {visiblePanels.map((panel) => (
              <div key={panel.id} data-panel={panel.id}>
                <DashboardCard
                  title={panel.title}
                  icon={panel.icon}
                  editMode={editMode}
                >
                  {panel.component}
                </DashboardCard>
              </div>
            ))}
          </ReactGridLayout>
        )}
        </div>
      </div>
    </div>
  );
}

const MIN_PAGE_WIDTH = 320;

function PageWidthHandle({
  side,
  containerWidth,
  effectiveWidth,
  displayWidth,
  onDraft,
  onCommit,
  onReset,
}: {
  side: 'left' | 'right';
  containerWidth: number;
  effectiveWidth: number;
  displayWidth: number;
  onDraft: (px: number) => void;
  onCommit: (px: number) => void;
  onReset: () => void;
}) {
  const handleRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const isConstrained = displayWidth < containerWidth - 1;
  const handleLeft = side === 'right'
    ? Math.round((containerWidth + displayWidth) / 2)
    : Math.round((containerWidth - displayWidth) / 2);

  const calcNext = (clientX: number) => {
    const delta = clientX - startX.current;
    // Right handle: drag right → wider. Left handle: drag left → wider (opposite sign).
    const signed = side === 'right' ? delta : -delta;
    return Math.max(MIN_PAGE_WIDTH, startWidth.current + 2 * signed);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    handleRef.current?.setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    startWidth.current = effectiveWidth;
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!handleRef.current?.hasPointerCapture(e.pointerId)) return;
    onDraft(Math.round(calcNext(e.clientX)));
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!handleRef.current?.hasPointerCapture(e.pointerId)) return;
    onCommit(Math.round(calcNext(e.clientX)));
  };

  return (
    <div
      ref={handleRef}
      className={`dc-page-handle dc-page-handle--${side}${isConstrained ? '' : ' is-full-width'}`}
      style={{ left: handleLeft }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title="Drag to adjust page width"
    >
      <div className="dc-page-handle__line" />
      <div className="dc-page-handle__nub">
        <ArrowLeftRight size={10} />
        <span className="dc-page-handle__label">{Math.round(effectiveWidth)}px</span>
        {isConstrained && side === 'right' && (
          <button
            className="dc-page-handle__reset"
            onClick={(e) => { e.stopPropagation(); onReset(); }}
            title="Reset to full width"
          >
            <X size={9} />
          </button>
        )}
      </div>
    </div>
  );
}

function DashboardLayoutOverlay({
  panels,
  layouts,
  hidden,
  dragId,
  onDragStart,
  onDragEnd,
  onVisibilityDrop,
  onClearPanels,
  onDone,
  onAddPanel,
  onSetHidden,
}: {
  panels: typeof PANEL_DEFS;
  layouts: Record<PanelId, DashboardLayoutItem>;
  hidden: Record<string, boolean>;
  dragId: PanelId | null;
  onDragStart: (id: PanelId) => void;
  onDragEnd: () => void;
  onVisibilityDrop: (event: DragEvent, hidden: boolean) => void;
  onClearPanels: () => void;
  onDone: () => void;
  onAddPanel: (id: PanelId) => void;
  onSetHidden: (id: PanelId, hidden: boolean) => void;
}) {
  const visiblePanels = panels.filter((panel) => !hidden[panel.id]).sort(panelSort(layouts));
  const hiddenPanels = panels.filter((panel) => hidden[panel.id]);

  const renderChip = (panel: (typeof PANEL_DEFS)[number]) => {
    const isHidden = hidden[panel.id] ?? false;
    const chipClass = [
      'dc-layout-chip',
      isHidden ? 'is-hidden' : '',
      dragId === panel.id ? 'is-dragging' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        key={panel.id}
        className={chipClass}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', panel.id);
          onDragStart(panel.id);
        }}
        onDragEnd={onDragEnd}
        onClick={() => isHidden ? onAddPanel(panel.id) : onSetHidden(panel.id, true)}
        title={isHidden ? `Add ${panel.title}` : `Remove ${panel.title}`}
        role="button"
        aria-pressed={!isHidden}
        aria-label={isHidden ? `Add ${panel.title}` : `Remove ${panel.title}`}
      >
        <span className="dc-layout-chip__icon">{panel.icon}</span>
        <span className="dc-layout-chip__label">{panel.title}</span>
        <span className="dc-layout-chip__badge">
          {isHidden ? <Plus size={9} /> : <Minus size={9} />}
        </span>
      </div>
    );
  };

  return (
    <div className="dc-layout-ribbon" aria-label="Dashboard cards">
      <div className="dc-layout-ribbon__label">
        <span className="dc-layout-ribbon__count">{visiblePanels.length} / {panels.length}</span>
        <span>Cards</span>
      </div>

      <div
        className="dc-layout-ribbon__section dc-layout-ribbon__section--active"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => onVisibilityDrop(event, false)}
      >
        <div className="dc-layout-chip-list">
          {visiblePanels.length > 0 ? visiblePanels.map(renderChip) : (
            <span className="dc-layout-ribbon__empty">Drop here</span>
          )}
        </div>
        <span className="dc-layout-ribbon__section-label"><Eye size={9} /> Active</span>
      </div>

      <div className="dc-layout-ribbon__divider" />

      <div
        className="dc-layout-ribbon__section dc-layout-ribbon__section--hidden"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => onVisibilityDrop(event, true)}
      >
        <div className="dc-layout-chip-list">
          {hiddenPanels.length > 0 ? hiddenPanels.map(renderChip) : (
            <span className="dc-layout-ribbon__empty">None</span>
          )}
        </div>
        <span className="dc-layout-ribbon__section-label"><EyeOff size={9} /> Hidden</span>
      </div>

      <div className="dc-layout-ribbon__actions">
        <button
          className="dc-layout-clear"
          disabled={visiblePanels.length === 0}
          onClick={onClearPanels}
          title="Clear all cards"
        >
          Clear
        </button>
        <button
          className="dc-layout-done"
          onClick={onDone}
          title="Done editing layout"
        >
          Done
        </button>
      </div>
    </div>
  );
}
