import { useState, useEffect } from 'react';
import * as THREE from 'three';
import { Eye, X } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';

interface SketchOption {
  label: string;
  key: string;
  defaultValue: boolean;
}

const SKETCH_OPTIONS: SketchOption[] = [
  // Note: 'sketchGrid' and 'snap' are handled separately via the CAD store
  { label: 'Slice', key: 'slice', defaultValue: false },
  { label: 'Profile', key: 'profile', defaultValue: true },
  { label: 'Points', key: 'points', defaultValue: true },
  { label: 'Dimensions', key: 'dimensions', defaultValue: true },
  { label: 'Constraints', key: 'constraints', defaultValue: true },
  { label: 'Projected Geometries', key: 'projectedGeom', defaultValue: true },
  { label: 'Construction Geometries', key: 'constructionGeom', defaultValue: true },
  { label: '3D Sketch', key: 'sketch3d', defaultValue: false },
];

export default function SketchPalette() {
  const activeSketch = useCADStore((s) => s.activeSketch);
  const activeTool = useCADStore((s) => s.activeTool);
  const finishSketch = useCADStore((s) => s.finishSketch);
  const snapEnabled = useCADStore((s) => s.snapEnabled);
  const setSnapEnabled = useCADStore((s) => s.setSnapEnabled);
  const gridVisible = useCADStore((s) => s.gridVisible);
  const setGridVisible = useCADStore((s) => s.setGridVisible);
  const polygonSides = useCADStore((s) => s.sketchPolygonSides);
  const setPolygonSides = useCADStore((s) => s.setSketchPolygonSides);
  const setCameraTargetQuaternion = useCADStore((s) => s.setCameraTargetQuaternion);
  const [dismissed, setDismissed] = useState(false);
  const isPolygonTool =
    activeTool === 'polygon' ||
    activeTool === 'polygon-inscribed' ||
    activeTool === 'polygon-circumscribed' ||
    activeTool === 'polygon-edge';

  // Reset dismissed state each time a new sketch session starts
  useEffect(() => {
    if (activeSketch) setDismissed(false);
  }, [activeSketch?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [options, setOptions] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    SKETCH_OPTIONS.forEach((o) => { init[o.key] = o.defaultValue; });
    return init;
  });
  const [lineType, setLineType] = useState<'normal' | 'construction'>('normal');
  const [collapsed, setCollapsed] = useState(false);

  if (!activeSketch || dismissed) return null;

  const toggleOption = (key: string) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="sketch-palette">
      {/* Header */}
      <div className="sketch-palette-header">
        <span className="sketch-palette-dot" />
        <span className="sketch-palette-title">SKETCH PALETTE</span>
        <button
          className="sketch-palette-collapse"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▶' : '▼'}
        </button>
        <button
          className="sketch-palette-close"
          onClick={() => setDismissed(true)}
          title="Close Palette"
        >
          <X size={12} />
        </button>
      </div>

      {!collapsed && (
        <div className="sketch-palette-body">
          {/* Options section */}
          <div className="sketch-palette-section-header" onClick={() => {}}>
            <span>▼ Options</span>
          </div>

          {/* Linetype */}
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Linetype</span>
            <div className="sketch-palette-linetype">
              <button
                className={`spl-btn ${lineType === 'normal' ? 'active' : ''}`}
                onClick={() => setLineType('normal')}
                title="Normal Line"
              >
                <svg width="16" height="16" viewBox="0 0 16 16">
                  <line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <button
                className={`spl-btn ${lineType === 'construction' ? 'active' : ''}`}
                onClick={() => setLineType('construction')}
                title="Construction Line"
              >
                <svg width="16" height="16" viewBox="0 0 16 16">
                  <line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
                </svg>
              </button>
            </div>
          </div>

          {/* Look At — reorient camera to face the active sketch plane */}
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Look At</span>
            <button
              className="spl-btn"
              title="Orient view normal to sketch plane"
              onClick={() => {
                if (!activeSketch) return;
                const normal =
                  activeSketch.plane === 'XY' ? new THREE.Vector3(0, 1, 0)
                  : activeSketch.plane === 'XZ' ? new THREE.Vector3(0, 0, 1)
                  : new THREE.Vector3(1, 0, 0);
                const camDir = normal.clone().multiplyScalar(5);
                const up = activeSketch.plane === 'XY'
                  ? new THREE.Vector3(0, 0, -1)
                  : new THREE.Vector3(0, 1, 0);
                const m = new THREE.Matrix4().lookAt(camDir, new THREE.Vector3(0, 0, 0), up);
                setCameraTargetQuaternion(new THREE.Quaternion().setFromRotationMatrix(m));
              }}
            >
              <Eye size={14} />
            </button>
          </div>

          {/* Sketch Grid — synced with CAD store */}
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Sketch Grid</span>
            <label className="sketch-palette-check">
              <input
                type="checkbox"
                checked={gridVisible}
                onChange={() => setGridVisible(!gridVisible)}
              />
              <span className="sketch-palette-checkmark" />
            </label>
          </div>

          {/* Snap — synced with CAD store */}
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Snap</span>
            <label className="sketch-palette-check">
              <input
                type="checkbox"
                checked={snapEnabled}
                onChange={() => setSnapEnabled(!snapEnabled)}
              />
              <span className="sketch-palette-checkmark" />
            </label>
          </div>

          {/* Polygon sides — only visible while a polygon tool is active */}
          {isPolygonTool && (
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">Sides</span>
              <input
                type="number"
                min={3}
                max={128}
                step={1}
                value={polygonSides}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v)) setPolygonSides(v);
                }}
                className="measure-select"
                style={{ width: 64 }}
              />
            </div>
          )}

          {/* Remaining local-only options */}
          {SKETCH_OPTIONS.map((opt) => (
            <div className="sketch-palette-row" key={opt.key}>
              <span className="sketch-palette-label">{opt.label}</span>
              <label className="sketch-palette-check">
                <input
                  type="checkbox"
                  checked={options[opt.key]}
                  onChange={() => toggleOption(opt.key)}
                />
                <span className="sketch-palette-checkmark" />
              </label>
            </div>
          ))}

          {/* Finish Sketch button */}
          <div className="sketch-palette-footer">
            <button className="sketch-palette-finish" onClick={finishSketch}>
              Finish Sketch
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
