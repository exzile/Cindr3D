import { useState, useEffect } from 'react';
import * as THREE from 'three';
import { Eye, X, FileDown } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { downloadDXF } from '../../utils/dxfExport';

interface SketchOption {
  label: string;
  key: string;
  defaultValue: boolean;
}

// Local-only palette options (no store backing needed)
const SKETCH_OPTIONS: SketchOption[] = [
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
  const filletRadius = useCADStore((s) => s.sketchFilletRadius);
  const setFilletRadius = useCADStore((s) => s.setSketchFilletRadius);
  const tangentCircleRadius = useCADStore((s) => s.tangentCircleRadius);
  const setTangentCircleRadius = useCADStore((s) => s.setTangentCircleRadius);
  const chamferDist1 = useCADStore((s) => s.sketchChamferDist1);
  const setChamferDist1 = useCADStore((s) => s.setSketchChamferDist1);
  const chamferDist2 = useCADStore((s) => s.sketchChamferDist2);
  const setChamferDist2 = useCADStore((s) => s.setSketchChamferDist2);
  const chamferAngle = useCADStore((s) => s.sketchChamferAngle);
  const setChamferAngle = useCADStore((s) => s.setSketchChamferAngle);
  const showProfile = useCADStore((s) => s.showSketchProfile);
  const setShowProfile = useCADStore((s) => s.setShowSketchProfile);
  const sliceEnabled = useCADStore((s) => s.sliceEnabled);
  const setSliceEnabled = useCADStore((s) => s.setSliceEnabled);
  const showSketchPoints = useCADStore((s) => s.showSketchPoints);
  const setShowSketchPoints = useCADStore((s) => s.setShowSketchPoints);
  const showSketchDimensions = useCADStore((s) => s.showSketchDimensions);
  const setShowSketchDimensions = useCADStore((s) => s.setShowSketchDimensions);
  const showSketchConstraints = useCADStore((s) => s.showSketchConstraints);
  const setShowSketchConstraints = useCADStore((s) => s.setShowSketchConstraints);
  const showProjectedGeometries = useCADStore((s) => s.showProjectedGeometries);
  const setShowProjectedGeometries = useCADStore((s) => s.setShowProjectedGeometries);
  const setCameraTargetQuaternion = useCADStore((s) => s.setCameraTargetQuaternion);
  const [dismissed, setDismissed] = useState(false);
  const isPolygonTool =
    activeTool === 'polygon' ||
    activeTool === 'polygon-inscribed' ||
    activeTool === 'polygon-circumscribed' ||
    activeTool === 'polygon-edge';
  const isFilletTool = activeTool === 'sketch-fillet';
  const isChamferEqualTool = activeTool === 'sketch-chamfer-equal';
  const isChamferTwoDistTool = activeTool === 'sketch-chamfer-two-dist';
  const isChamferDistAngleTool = activeTool === 'sketch-chamfer-dist-angle';
  const isChamferTool = isChamferEqualTool || isChamferTwoDistTool || isChamferDistAngleTool;
  const isTangentCircleTool = activeTool === 'circle-2tangent';

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

          {/* Show Profile — D55 translucent fill of closed sketch loops */}
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Show Profile</span>
            <label className="sketch-palette-check">
              <input
                type="checkbox"
                checked={showProfile}
                onChange={() => setShowProfile(!showProfile)}
              />
              <span className="sketch-palette-checkmark" />
            </label>
          </div>

          {/* Slice — D54 clipping plane at sketch plane */}
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Slice</span>
            <label className="sketch-palette-check">
              <input
                type="checkbox"
                checked={sliceEnabled}
                onChange={() => setSliceEnabled(!sliceEnabled)}
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

          {/* Fillet radius — only visible while sketch-fillet tool is active */}
          {isFilletTool && (
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">Radius</span>
              <input
                type="number"
                min={0.01}
                step={0.5}
                value={filletRadius}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v) && v > 0) setFilletRadius(v);
                }}
                className="measure-select"
                style={{ width: 64 }}
              />
            </div>
          )}

          {/* Tangent circle radius — visible while 2-tangent circle tool is active (D40) */}
          {isTangentCircleTool && (
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">Radius</span>
              <input
                type="number"
                min={0.01}
                step={0.5}
                value={tangentCircleRadius}
                onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v) && v > 0) setTangentCircleRadius(v); }}
                className="measure-select"
                style={{ width: 64 }}
              />
            </div>
          )}

          {/* Chamfer inputs — visible while any chamfer tool is active (D47) */}
          {isChamferTool && (
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">{isChamferDistAngleTool ? 'Dist' : 'Dist 1'}</span>
              <input
                type="number"
                min={0.01}
                step={0.5}
                value={chamferDist1}
                onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v) && v > 0) setChamferDist1(v); }}
                className="measure-select"
                style={{ width: 64 }}
              />
            </div>
          )}
          {isChamferTwoDistTool && (
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">Dist 2</span>
              <input
                type="number"
                min={0.01}
                step={0.5}
                value={chamferDist2}
                onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v) && v > 0) setChamferDist2(v); }}
                className="measure-select"
                style={{ width: 64 }}
              />
            </div>
          )}
          {isChamferDistAngleTool && (
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">Angle °</span>
              <input
                type="number"
                min={1}
                max={89}
                step={1}
                value={chamferAngle}
                onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setChamferAngle(v); }}
                className="measure-select"
                style={{ width: 64 }}
              />
            </div>
          )}

          {/* Store-backed visibility toggles (D56) */}
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Points</span>
            <label className="sketch-palette-check">
              <input type="checkbox" checked={showSketchPoints} onChange={() => setShowSketchPoints(!showSketchPoints)} />
              <span className="sketch-palette-checkmark" />
            </label>
          </div>
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Dimensions</span>
            <label className="sketch-palette-check">
              <input type="checkbox" checked={showSketchDimensions} onChange={() => setShowSketchDimensions(!showSketchDimensions)} />
              <span className="sketch-palette-checkmark" />
            </label>
          </div>
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Constraints</span>
            <label className="sketch-palette-check">
              <input type="checkbox" checked={showSketchConstraints} onChange={() => setShowSketchConstraints(!showSketchConstraints)} />
              <span className="sketch-palette-checkmark" />
            </label>
          </div>
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Projected Geom.</span>
            <label className="sketch-palette-check">
              <input type="checkbox" checked={showProjectedGeometries} onChange={() => setShowProjectedGeometries(!showProjectedGeometries)} />
              <span className="sketch-palette-checkmark" />
            </label>
          </div>

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

          {/* Export DXF button (D61) */}
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Export</span>
            <button
              className="spl-btn"
              title="Export sketch as DXF (for laser cutting / CNC)"
              onClick={() => {
                if (activeSketch) downloadDXF(activeSketch);
              }}
            >
              <FileDown size={14} />
            </button>
          </div>

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
