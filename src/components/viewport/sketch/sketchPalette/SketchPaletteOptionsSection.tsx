import * as THREE from 'three';
import { Eye } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { SketchPaletteState } from './useSketchPaletteState';

interface SketchPaletteOptionsSectionProps {
  state: SketchPaletteState;
  lineType: 'normal' | 'construction';
  setLineType: Dispatch<SetStateAction<'normal' | 'construction'>>;
}

export function SketchPaletteOptionsSection({
  state,
  lineType,
  setLineType,
}: SketchPaletteOptionsSectionProps) {
  return (
    <>
      <div className="sketch-palette-section-header" onClick={() => {}}>
        <span>\u25bc Options</span>
      </div>

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

      <div className="sketch-palette-row">
        <span className="sketch-palette-label">Look At</span>
        <button
          className="spl-btn"
          title="Orient view normal to sketch plane"
          onClick={() => {
            if (!state.activeSketch) return;
            const normal =
              state.activeSketch.plane === 'XY' ? new THREE.Vector3(0, 1, 0)
              : state.activeSketch.plane === 'XZ' ? new THREE.Vector3(0, 0, 1)
              : new THREE.Vector3(1, 0, 0);
            const camDir = normal.clone().multiplyScalar(5);
            const up =
              state.activeSketch.plane === 'XY'
                ? new THREE.Vector3(0, 0, -1)
                : new THREE.Vector3(0, 1, 0);
            const m = new THREE.Matrix4().lookAt(camDir, new THREE.Vector3(0, 0, 0), up);
            state.setCameraTargetQuaternion(new THREE.Quaternion().setFromRotationMatrix(m));
          }}
        >
          <Eye size={14} />
        </button>
      </div>

      <div className="sketch-palette-section-header sketch-palette-section-header--spaced">
        <span>\u25bc Grid &amp; Snap</span>
      </div>

      <div className="sketch-palette-row">
        <span className="sketch-palette-label">Show Grid</span>
        <label className="sketch-palette-check">
          <input
            type="checkbox"
            checked={state.sketchGridEnabled && state.gridVisible}
            onChange={() => {
              const next = !(state.sketchGridEnabled && state.gridVisible);
              state.setSketchGridEnabled(next);
              state.setGridVisible(next);
            }}
          />
          <span className="sketch-palette-checkmark" />
        </label>
      </div>

      {state.sketchGridEnabled && state.gridVisible && (
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Grid Size</span>
          <input
            type="number"
            className="sketch-palette-input--narrow"
            min={0.1}
            step={1}
            value={state.sketchGridSize ?? state.gridSize}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              state.setSketchGridSize(Number.isFinite(v) && v > 0 ? v : null);
            }}
            title="Per-sketch grid spacing (overrides global)"
          />
        </div>
      )}

      <div className="sketch-palette-row">
        <span className="sketch-palette-label">Snap to Grid</span>
        <label className="sketch-palette-check">
          <input
            type="checkbox"
            checked={state.sketchSnapEnabled}
            onChange={() => state.setSketchSnapEnabled(!state.sketchSnapEnabled)}
          />
          <span className="sketch-palette-checkmark" />
        </label>
      </div>

      <div className="sketch-palette-row">
        <span className="sketch-palette-label">Snap to Geom.</span>
        <label className="sketch-palette-check">
          <input
            type="checkbox"
            checked={state.snapEnabled}
            onChange={() => state.setSnapEnabled(!state.snapEnabled)}
          />
          <span className="sketch-palette-checkmark" />
        </label>
      </div>

      <div className="sketch-palette-row">
        <span className="sketch-palette-label">Show Profile</span>
        <label className="sketch-palette-check">
          <input
            type="checkbox"
            checked={state.showProfile}
            onChange={() => state.setShowProfile(!state.showProfile)}
          />
          <span className="sketch-palette-checkmark" />
        </label>
      </div>

      <div className="sketch-palette-row">
        <span className="sketch-palette-label">Slice</span>
        <label className="sketch-palette-check">
          <input
            type="checkbox"
            checked={state.sliceEnabled}
            onChange={() => state.setSliceEnabled(!state.sliceEnabled)}
          />
          <span className="sketch-palette-checkmark" />
        </label>
      </div>

      {state.isPolygonTool && (
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Sides</span>
          <input
            type="number"
            min={3}
            max={128}
            step={1}
            value={state.polygonSides}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v)) state.setPolygonSides(v);
            }}
            className="sketch-palette-input--narrow"
          />
        </div>
      )}

      {state.isOffsetConstraintTool && (
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Offset (mm)</span>
          <input
            type="number"
            min={0.001}
            step={0.5}
            value={state.constraintOffsetValue}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v) && v > 0) state.setConstraintOffsetValue(v);
            }}
            className="sketch-palette-input--narrow"
          />
        </div>
      )}

      {state.isSurfaceConstraintTool && (
        <div className="sketch-palette-row sketch-palette-row--wrap">
          <span className="sketch-palette-label">Surface Plane</span>
          {state.constraintSurfacePlane == null ? (
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Pick a construction plane</span>
          ) : (
            <>
              <span style={{ fontSize: '0.75rem', color: '#4ade80' }}>&#x2713; Plane set - now pick sketch entity</span>
              <button
                className="spl-btn spl-btn--offset"
                title="Clear surface plane selection"
                onClick={() => state.setConstraintSurfacePlane(null)}
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {state.isFilletTool && (
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Radius</span>
          <input
            type="number"
            min={0.01}
            step={0.5}
            value={state.filletRadius}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v) && v > 0) state.setFilletRadius(v);
            }}
            className="sketch-palette-input--narrow"
          />
        </div>
      )}

      {state.isConicTool && (
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Rho</span>
          <input
            type="number"
            min={0.01}
            max={0.99}
            step={0.05}
            value={state.conicRho}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v)) state.setConicRho(v);
            }}
            className="sketch-palette-input--narrow"
          />
        </div>
      )}

      {state.isBlendCurveTool && (
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Continuity</span>
          <select
            className="sketch-palette-input--narrow"
            value={state.blendCurveMode}
            onChange={(e) => state.setBlendCurveMode(e.target.value as 'g1' | 'g2')}
          >
            <option value="g1">G1</option>
            <option value="g2">G2</option>
          </select>
        </div>
      )}

      {state.isArcSlotTool && (
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Slot Width</span>
          <input
            type="number"
            min={0.01}
            step={0.5}
            value={state.slotWidth}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v) && v > 0) state.setSlotWidth(v);
            }}
            className="sketch-palette-input--narrow"
          />
        </div>
      )}

      {state.isTangentCircleTool && (
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Radius</span>
          <input
            type="number"
            min={0.01}
            step={0.5}
            value={state.tangentCircleRadius}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v) && v > 0) state.setTangentCircleRadius(v);
            }}
            className="sketch-palette-input--narrow"
          />
        </div>
      )}

      {state.isChamferTool && (
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">{state.isChamferDistAngleTool ? 'Dist' : 'Dist 1'}</span>
          <input
            type="number"
            min={0.01}
            step={0.5}
            value={state.chamferDist1}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v) && v > 0) state.setChamferDist1(v);
            }}
            className="sketch-palette-input--narrow"
          />
        </div>
      )}

      {state.isChamferTwoDistTool && (
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Dist 2</span>
          <input
            type="number"
            min={0.01}
            step={0.5}
            value={state.chamferDist2}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v) && v > 0) state.setChamferDist2(v);
            }}
            className="sketch-palette-input--narrow"
          />
        </div>
      )}

      {state.isChamferDistAngleTool && (
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Angle</span>
          <input
            type="number"
            min={1}
            max={89}
            step={1}
            value={state.chamferAngle}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v)) state.setChamferAngle(v);
            }}
            className="sketch-palette-input--narrow"
          />
        </div>
      )}
    </>
  );
}
