import "./CanvasControls.css";
import { useState, useRef, useCallback } from 'react';
import {
  Settings,
  Grid3x3,
  Lock,
  Unlock,
  Magnet,
  Move,
  SlidersHorizontal,
  RotateCcw,
  Hand,
  Search,
  Maximize,
  ScanSearch,
  Eye,
  Home,
  LayoutGrid,
} from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import Popover from './Popover';
import DisplaySettingsPanel from './DisplaySettingsPanel';
import GridSettingsPanel from './GridSettingsPanel';
import IncrementSettingsPanel from './IncrementSettingsPanel';
import ObjectSnapPanel from './ObjectSnapPanel';

const VIEWPORT_LAYOUTS = [
  { value: '1', label: 'Single', hint: 'One full viewport' },
  { value: '2h', label: 'Two columns', hint: 'Top and perspective side by side' },
  { value: '2v', label: 'Two rows', hint: 'Top and perspective stacked' },
  { value: '4', label: 'Four views', hint: 'Top, front, right, perspective' },
] as const;

type ViewportLayoutValue = (typeof VIEWPORT_LAYOUTS)[number]['value'];

export default function CanvasControls() {
  const gridVisible = useCADStore((s) => s.gridVisible);
  const setGridVisible = useCADStore((s) => s.setGridVisible);
  const gridLocked = useCADStore((s) => s.gridLocked);
  const setGridLocked = useCADStore((s) => s.setGridLocked);
  const snapEnabled = useCADStore((s) => s.snapEnabled);
  const setSnapEnabled = useCADStore((s) => s.setSnapEnabled);
  const objectSnapEnabled = useCADStore((s) => s.objectSnapEnabled);
  const incrementalMove = useCADStore((s) => s.incrementalMove);
  const setIncrementalMove = useCADStore((s) => s.setIncrementalMove);
  const triggerCameraHome = useCADStore((s) => s.triggerCameraHome);
  const cameraNavMode = useCADStore((s) => s.cameraNavMode);
  const setCameraNavMode = useCADStore((s) => s.setCameraNavMode);
  const triggerZoomToFit = useCADStore((s) => s.triggerZoomToFit);
  const viewportLayout = useCADStore((s) => s.viewportLayout);
  const setViewportLayout = useCADStore((s) => s.setViewportLayout);

  // Popover state
  const [openPopover, setOpenPopover] = useState<string | null>(null);
  const displayRef = useRef<HTMLButtonElement>(null);
  const gridSettingsRef = useRef<HTMLButtonElement>(null);
  const incrementRef = useRef<HTMLButtonElement>(null);
  const objectSnapRef = useRef<HTMLButtonElement>(null);
  const viewportRef = useRef<HTMLButtonElement>(null);

  const togglePopover = useCallback((id: string) => {
    setOpenPopover((prev) => (prev === id ? null : id));
  }, []);

  const closePopover = useCallback(() => setOpenPopover(null), []);

  const handleNavMode = useCallback((mode: 'orbit' | 'pan' | 'zoom' | 'zoom-window' | 'look-at') => {
    setCameraNavMode(cameraNavMode === mode ? null : mode);
  }, [cameraNavMode, setCameraNavMode]);

  const handleViewportLayoutSelect = useCallback((layout: ViewportLayoutValue) => {
    setViewportLayout(layout);
    closePopover();
  }, [closePopover, setViewportLayout]);

  return (
    <div className="canvas-controls-bar">
      {/* ---- View / display section ---- */}
      <div className="cc-group cc-group--view" aria-label="Viewport display controls">
        {/* Display settings */}
        <div className="cc-popover-anchor">
          <button
            ref={displayRef}
            className="cc-btn cc-btn--secondary"
            aria-label="Display settings"
            data-tooltip="Display settings"
            onClick={() => togglePopover('display')}
          >
            <Settings size={14} />
          </button>
          <Popover anchorRef={displayRef} open={openPopover === 'display'} onClose={closePopover}>
            <DisplaySettingsPanel onClose={closePopover} />
          </Popover>
        </div>

        {/* NAV-19: Viewport layout picker */}
        <div className="cc-popover-anchor cc-popover-anchor--viewports">
          <button
            ref={viewportRef}
            className={`cc-btn ${viewportLayout !== '1' ? 'active' : ''}`}
            aria-label="Viewports"
            data-tooltip="Viewports"
            onClick={() => togglePopover('viewports')}
          >
            <LayoutGrid size={14} />
            {viewportLayout !== '1' && (
              <span className="cc-btn-badge">
                {viewportLayout}
              </span>
            )}
          </button>
          <Popover anchorRef={viewportRef} open={openPopover === 'viewports'} onClose={closePopover}>
            <div className="cc-panel cc-panel--viewports">
              <div className="cc-panel-title">Viewports</div>
              <div className="cc-viewport-layout-grid">
                {VIEWPORT_LAYOUTS.map((layout) => (
                  <button
                    key={layout.value}
                    type="button"
                    className={`cc-viewport-layout-option ${viewportLayout === layout.value ? 'active' : ''}`}
                    onClick={() => handleViewportLayoutSelect(layout.value)}
                  >
                    <span className={`cc-viewport-layout-preview cc-viewport-layout-preview--${layout.value}`}>
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                    <span className="cc-viewport-layout-copy">
                      <span className="cc-viewport-layout-label">{layout.label}</span>
                      <span className="cc-viewport-layout-hint">{layout.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </Popover>
        </div>
      </div>

      {/* ---- Grid / snap section ---- */}
      <div className="cc-group cc-group--grid" aria-label="Grid and snap controls">
        {/* Grid toggle */}
        <button
          className={`cc-btn ${gridVisible ? 'active' : ''}`}
          aria-label="Toggle grid"
          data-tooltip="Toggle grid"
          onClick={() => setGridVisible(!gridVisible)}
        >
          <Grid3x3 size={14} />
        </button>

        {/* Grid lock */}
        <button
          className={`cc-btn ${gridLocked ? 'active' : ''}`}
          aria-label="Lock grid"
          data-tooltip="Lock grid"
          onClick={() => setGridLocked(!gridLocked)}
        >
          {gridLocked ? <Lock size={14} /> : <Unlock size={14} />}
        </button>

        {/* Snap to grid */}
        <button
          className={`cc-btn ${snapEnabled ? 'active' : ''}`}
          aria-label="Snap to grid"
          data-tooltip="Snap to grid"
          onClick={() => setSnapEnabled(!snapEnabled)}
        >
          <Magnet size={14} />
        </button>

        {/* Object Snaps — NAV-24 */}
        <div className="cc-popover-anchor">
          <button
            ref={objectSnapRef}
            className={`cc-btn ${objectSnapEnabled ? 'active' : ''}`}
            aria-label="Object snaps"
            data-tooltip="Object snaps"
            onClick={() => togglePopover('object-snap')}
          >
            <ScanSearch size={14} />
          </button>
          <Popover anchorRef={objectSnapRef} open={openPopover === 'object-snap'} onClose={closePopover}>
            <ObjectSnapPanel onClose={closePopover} />
          </Popover>
        </div>

        {/* Grid settings */}
        <div className="cc-popover-anchor">
          <button
            ref={gridSettingsRef}
            className="cc-btn cc-btn--secondary"
            aria-label="Grid settings"
            data-tooltip="Grid settings"
            onClick={() => togglePopover('grid')}
          >
            <SlidersHorizontal size={14} />
          </button>
          <Popover anchorRef={gridSettingsRef} open={openPopover === 'grid'} onClose={closePopover}>
            <GridSettingsPanel onClose={closePopover} />
          </Popover>
        </div>
        {/* Incremental move */}
        <button
          className={`cc-btn cc-btn--optional ${incrementalMove ? 'active' : ''}`}
          aria-label="Incremental move"
          data-tooltip="Incremental move"
          onClick={() => setIncrementalMove(!incrementalMove)}
        >
          <Move size={14} />
        </button>

        {/* Set increments */}
        <div className="cc-popover-anchor">
          <button
            ref={incrementRef}
            className="cc-btn cc-btn--secondary cc-btn--optional"
            aria-label="Set increments"
            data-tooltip="Set increments"
            onClick={() => togglePopover('increment')}
          >
            <SlidersHorizontal size={12} />
          </button>
          <Popover anchorRef={incrementRef} open={openPopover === 'increment'} onClose={closePopover}>
            <IncrementSettingsPanel onClose={closePopover} />
          </Popover>
        </div>
      </div>

      {/* ---- Navigation section ---- */}
      <div className="cc-group cc-group--navigation" aria-label="Viewport navigation controls">
        <button
          className={`cc-btn ${cameraNavMode === 'orbit' ? 'active' : ''}`}
          aria-label="Orbit"
          data-tooltip="Orbit"
          onClick={() => handleNavMode('orbit')}
        >
          <RotateCcw size={14} />
        </button>
        <button
          className={`cc-btn ${cameraNavMode === 'pan' ? 'active' : ''}`}
          aria-label="Pan"
          data-tooltip="Pan"
          onClick={() => handleNavMode('pan')}
        >
          <Hand size={14} />
        </button>
        <button
          className={`cc-btn ${cameraNavMode === 'zoom' ? 'active' : ''}`}
          aria-label="Zoom"
          data-tooltip="Zoom"
          onClick={() => handleNavMode('zoom')}
        >
          <Search size={14} />
        </button>
        <button
          className="cc-btn cc-btn--secondary"
          aria-label="Zoom to fit"
          data-tooltip="Zoom to fit"
          onClick={() => triggerZoomToFit()}
        >
          <Maximize size={14} />
        </button>
        <button
          className={`cc-btn ${cameraNavMode === 'zoom-window' ? 'active' : ''}`}
          aria-label="Zoom window"
          data-tooltip="Zoom window"
          onClick={() => handleNavMode('zoom-window')}
        >
          <ScanSearch size={14} />
        </button>
        <button
          className={`cc-btn ${cameraNavMode === 'look-at' ? 'active' : ''}`}
          aria-label="Look at"
          data-tooltip="Look at"
          onClick={() => handleNavMode('look-at')}
        >
          <Eye size={14} />
        </button>
        <button
          className="cc-btn cc-btn--secondary"
          aria-label="Home view"
          data-tooltip="Home view"
          onClick={() => triggerCameraHome()}
        >
          <Home size={14} />
        </button>
      </div>
    </div>
  );
}
