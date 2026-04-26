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

const LAYOUT_CYCLE = ['1', '2h', '2v', '4'] as const;

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

  const togglePopover = useCallback((id: string) => {
    setOpenPopover((prev) => (prev === id ? null : id));
  }, []);

  const closePopover = useCallback(() => setOpenPopover(null), []);

  const handleNavMode = useCallback((mode: 'orbit' | 'pan' | 'zoom' | 'zoom-window' | 'look-at') => {
    setCameraNavMode(cameraNavMode === mode ? null : mode);
  }, [cameraNavMode, setCameraNavMode]);

  const handleCycleViewportLayout = useCallback(() => {
    const idx = LAYOUT_CYCLE.indexOf(viewportLayout);
    const next = LAYOUT_CYCLE[(idx + 1) % LAYOUT_CYCLE.length];
    setViewportLayout(next);
  }, [viewportLayout, setViewportLayout]);

  return (
    <div className="canvas-controls-bar">
      {/* ---- Grid / Snap section ---- */}
      <div className="cc-group">
        {/* Display settings */}
        <div className="cc-popover-anchor">
          <button
            ref={displayRef}
            className="cc-btn"
            title="Display Settings"
            onClick={() => togglePopover('display')}
          >
            <Settings size={14} />
          </button>
          <Popover anchorRef={displayRef} open={openPopover === 'display'} onClose={closePopover}>
            <DisplaySettingsPanel onClose={closePopover} />
          </Popover>
        </div>

        <div className="cc-divider" />

        {/* Grid toggle */}
        <button
          className={`cc-btn ${gridVisible ? 'active' : ''}`}
          title="Toggle Grid"
          onClick={() => setGridVisible(!gridVisible)}
        >
          <Grid3x3 size={14} />
        </button>

        {/* Grid lock */}
        <button
          className={`cc-btn ${gridLocked ? 'active' : ''}`}
          title="Lock Grid"
          onClick={() => setGridLocked(!gridLocked)}
        >
          {gridLocked ? <Lock size={14} /> : <Unlock size={14} />}
        </button>

        {/* Snap to grid */}
        <button
          className={`cc-btn ${snapEnabled ? 'active' : ''}`}
          title="Snap to Grid"
          onClick={() => setSnapEnabled(!snapEnabled)}
        >
          <Magnet size={14} />
        </button>

        {/* Object Snaps — NAV-24 */}
        <div className="cc-popover-anchor">
          <button
            ref={objectSnapRef}
            className={`cc-btn ${objectSnapEnabled ? 'active' : ''}`}
            title="Object Snaps"
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
            className="cc-btn"
            title="Grid Settings"
            onClick={() => togglePopover('grid')}
          >
            <SlidersHorizontal size={14} />
          </button>
          <Popover anchorRef={gridSettingsRef} open={openPopover === 'grid'} onClose={closePopover}>
            <GridSettingsPanel onClose={closePopover} />
          </Popover>
        </div>

        <div className="cc-divider" />

        {/* Incremental move */}
        <button
          className={`cc-btn ${incrementalMove ? 'active' : ''}`}
          title="Incremental Move"
          onClick={() => setIncrementalMove(!incrementalMove)}
        >
          <Move size={14} />
        </button>

        {/* Set increments */}
        <div className="cc-popover-anchor">
          <button
            ref={incrementRef}
            className="cc-btn"
            title="Set Increments"
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
      <div className="cc-group">
        <div className="cc-divider" />

        <button
          className={`cc-btn ${cameraNavMode === 'orbit' ? 'active' : ''}`}
          title="Orbit"
          onClick={() => handleNavMode('orbit')}
        >
          <RotateCcw size={14} />
        </button>
        <button
          className={`cc-btn ${cameraNavMode === 'pan' ? 'active' : ''}`}
          title="Pan"
          onClick={() => handleNavMode('pan')}
        >
          <Hand size={14} />
        </button>
        <button
          className={`cc-btn ${cameraNavMode === 'zoom' ? 'active' : ''}`}
          title="Zoom"
          onClick={() => handleNavMode('zoom')}
        >
          <Search size={14} />
        </button>
        <button
          className="cc-btn"
          title="Zoom to Fit"
          onClick={() => triggerZoomToFit()}
        >
          <Maximize size={14} />
        </button>
        <button
          className={`cc-btn ${cameraNavMode === 'zoom-window' ? 'active' : ''}`}
          title="Zoom Window"
          onClick={() => handleNavMode('zoom-window')}
        >
          <ScanSearch size={14} />
        </button>

        <div className="cc-divider" />

        <button
          className={`cc-btn ${cameraNavMode === 'look-at' ? 'active' : ''}`}
          title="Look At"
          onClick={() => handleNavMode('look-at')}
        >
          <Eye size={14} />
        </button>
        <button
          className="cc-btn"
          title="Home View"
          onClick={() => triggerCameraHome()}
        >
          <Home size={14} />
        </button>

        <div className="cc-divider" />

        {/* NAV-19: Viewport layout cycle */}
        <button
          className={`cc-btn ${viewportLayout !== '1' ? 'active' : ''}`}
          title="Viewports"
          onClick={handleCycleViewportLayout}
          style={{ position: 'relative' }}
        >
          <LayoutGrid size={14} />
          {viewportLayout !== '1' && (
            <span style={{
              position: 'absolute',
              top: 1,
              right: 1,
              fontSize: 8,
              fontWeight: 700,
              lineHeight: 1,
              color: 'inherit',
              pointerEvents: 'none',
            }}>
              {viewportLayout}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
