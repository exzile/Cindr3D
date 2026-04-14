import { useState, useRef, useEffect, useCallback } from 'react';
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

// ---- Popover wrapper ----

function Popover({
  anchorRef,
  open,
  onClose,
  children,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div ref={popRef} className="cc-popover">
      {children}
    </div>
  );
}

// ---- Sub-panels ----

function DisplaySettingsPanel({ onClose: _onClose }: { onClose: () => void }) {
  const visualStyle = useCADStore((s) => s.visualStyle);
  const setVisualStyle = useCADStore((s) => s.setVisualStyle);
  const showEnvironment = useCADStore((s) => s.showEnvironment);
  const setShowEnvironment = useCADStore((s) => s.setShowEnvironment);
  const showShadows = useCADStore((s) => s.showShadows);
  const setShowShadows = useCADStore((s) => s.setShowShadows);
  const showReflections = useCADStore((s) => s.showReflections);
  const setShowReflections = useCADStore((s) => s.setShowReflections);
  const showGroundPlane = useCADStore((s) => s.showGroundPlane);
  const setShowGroundPlane = useCADStore((s) => s.setShowGroundPlane);

  const styles: { value: typeof visualStyle; label: string }[] = [
    { value: 'shaded', label: 'Shaded' },
    { value: 'shadedEdges', label: 'Shaded with Edges' },
    { value: 'wireframe', label: 'Wireframe' },
    { value: 'hiddenLines', label: 'Hidden Lines' },
  ];

  return (
    <div className="cc-panel">
      <div className="cc-panel-title">Display Settings</div>

      <div className="cc-panel-section">
        <div className="cc-panel-section-title">Visual Style</div>
        {styles.map((s) => (
          <button
            key={s.value}
            className={`cc-panel-option ${visualStyle === s.value ? 'active' : ''}`}
            onClick={() => setVisualStyle(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="cc-panel-divider" />

      <div className="cc-panel-section">
        <div className="cc-panel-section-title">Environment</div>
        <label className="cc-panel-check">
          <input
            type="checkbox"
            checked={showEnvironment}
            onChange={(e) => setShowEnvironment(e.target.checked)}
          />
          <span>Show Environment</span>
        </label>
      </div>

      <div className="cc-panel-divider" />

      <div className="cc-panel-section">
        <div className="cc-panel-section-title">Effects</div>
        <label className="cc-panel-check">
          <input
            type="checkbox"
            checked={showShadows}
            onChange={(e) => setShowShadows(e.target.checked)}
          />
          <span>Shadows</span>
        </label>
        <label className="cc-panel-check">
          <input
            type="checkbox"
            checked={showReflections}
            onChange={(e) => setShowReflections(e.target.checked)}
          />
          <span>Reflections</span>
        </label>
        <label className="cc-panel-check">
          <input
            type="checkbox"
            checked={showGroundPlane}
            onChange={(e) => setShowGroundPlane(e.target.checked)}
          />
          <span>Ground Plane</span>
        </label>
      </div>
    </div>
  );
}

function GridSettingsPanel({ onClose: _onClose }: { onClose: () => void }) {
  const gridSize = useCADStore((s) => s.gridSize);
  const setGridSize = useCADStore((s) => s.setGridSize);
  const [localSize, setLocalSize] = useState(String(gridSize));

  const apply = () => {
    const val = parseFloat(localSize);
    if (!isNaN(val) && val > 0) {
      setGridSize(val);
    }
  };

  return (
    <div className="cc-panel">
      <div className="cc-panel-title">Grid Settings</div>
      <div className="cc-panel-section">
        <div className="cc-panel-field">
          <label className="cc-panel-field-label">Grid Size</label>
          <div className="cc-panel-field-input-wrap">
            <input
              type="number"
              className="cc-panel-field-input"
              value={localSize}
              onChange={(e) => setLocalSize(e.target.value)}
              onBlur={apply}
              onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
              min={0.1}
              step={1}
            />
            <span className="cc-panel-field-unit">mm</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function IncrementSettingsPanel({ onClose: _onClose }: { onClose: () => void }) {
  const moveIncrement = useCADStore((s) => s.moveIncrement);
  const setMoveIncrement = useCADStore((s) => s.setMoveIncrement);
  const rotateIncrement = useCADStore((s) => s.rotateIncrement);
  const setRotateIncrement = useCADStore((s) => s.setRotateIncrement);

  const [localMove, setLocalMove] = useState(String(moveIncrement));
  const [localRotate, setLocalRotate] = useState(String(rotateIncrement));

  const applyMove = () => {
    const val = parseFloat(localMove);
    if (!isNaN(val) && val > 0) setMoveIncrement(val);
  };

  const applyRotate = () => {
    const val = parseFloat(localRotate);
    if (!isNaN(val) && val > 0) setRotateIncrement(val);
  };

  return (
    <div className="cc-panel">
      <div className="cc-panel-title">Set Increments</div>
      <div className="cc-panel-section">
        <div className="cc-panel-field">
          <label className="cc-panel-field-label">Move</label>
          <div className="cc-panel-field-input-wrap">
            <input
              type="number"
              className="cc-panel-field-input"
              value={localMove}
              onChange={(e) => setLocalMove(e.target.value)}
              onBlur={applyMove}
              onKeyDown={(e) => { if (e.key === 'Enter') applyMove(); }}
              min={0.01}
              step={0.5}
            />
            <span className="cc-panel-field-unit">mm</span>
          </div>
        </div>
        <div className="cc-panel-field">
          <label className="cc-panel-field-label">Rotate</label>
          <div className="cc-panel-field-input-wrap">
            <input
              type="number"
              className="cc-panel-field-input"
              value={localRotate}
              onChange={(e) => setLocalRotate(e.target.value)}
              onBlur={applyRotate}
              onKeyDown={(e) => { if (e.key === 'Enter') applyRotate(); }}
              min={1}
              step={5}
            />
            <span className="cc-panel-field-unit">deg</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Main component ----

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
