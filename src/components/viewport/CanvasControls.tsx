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
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import Popover from './canvasControls/Popover';
import DisplaySettingsPanel from './canvasControls/DisplaySettingsPanel';
import GridSettingsPanel from './canvasControls/GridSettingsPanel';
import IncrementSettingsPanel from './canvasControls/IncrementSettingsPanel';

export interface CanvasControlsProps {
  /** Trigger orbit mode in OrbitControls */
  onOrbit?: () => void;
  /** Trigger pan mode */
  onPan?: () => void;
  /** Trigger zoom mode */
  onZoom?: () => void;
  /** Zoom to fit the scene */
  onZoomToFit?: () => void;
  /** Zoom window (marquee zoom) */
  onZoomWindow?: () => void;
  /** Look-at mode */
  onLookAt?: () => void;
  /** Home view */
  onHomeView?: () => void;
}

export default function CanvasControls({
  onOrbit,
  onPan,
  onZoom,
  onZoomToFit,
  onZoomWindow,
  onLookAt,
  onHomeView,
}: CanvasControlsProps) {
  const gridVisible = useCADStore((s) => s.gridVisible);
  const setGridVisible = useCADStore((s) => s.setGridVisible);
  const gridLocked = useCADStore((s) => s.gridLocked);
  const setGridLocked = useCADStore((s) => s.setGridLocked);
  const snapEnabled = useCADStore((s) => s.snapEnabled);
  const setSnapEnabled = useCADStore((s) => s.setSnapEnabled);
  const incrementalMove = useCADStore((s) => s.incrementalMove);
  const setIncrementalMove = useCADStore((s) => s.setIncrementalMove);
  const triggerCameraHome = useCADStore((s) => s.triggerCameraHome);

  // Popover state
  const [openPopover, setOpenPopover] = useState<string | null>(null);
  const displayRef = useRef<HTMLButtonElement>(null);
  const gridSettingsRef = useRef<HTMLButtonElement>(null);
  const incrementRef = useRef<HTMLButtonElement>(null);

  const togglePopover = useCallback((id: string) => {
    setOpenPopover((prev) => (prev === id ? null : id));
  }, []);

  const closePopover = useCallback(() => setOpenPopover(null), []);

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

        <button className="cc-btn" title="Orbit" onClick={onOrbit}>
          <RotateCcw size={14} />
        </button>
        <button className="cc-btn" title="Pan" onClick={onPan}>
          <Hand size={14} />
        </button>
        <button className="cc-btn" title="Zoom" onClick={onZoom}>
          <Search size={14} />
        </button>
        <button className="cc-btn" title="Zoom to Fit" onClick={onZoomToFit}>
          <Maximize size={14} />
        </button>
        <button className="cc-btn" title="Zoom Window" onClick={onZoomWindow}>
          <ScanSearch size={14} />
        </button>

        <div className="cc-divider" />

        <button className="cc-btn" title="Look At" onClick={onLookAt}>
          <Eye size={14} />
        </button>
        <button
          className="cc-btn"
          title="Home View"
          onClick={() => { triggerCameraHome(); onHomeView?.(); }}
        >
          <Home size={14} />
        </button>
      </div>
    </div>
  );
}
