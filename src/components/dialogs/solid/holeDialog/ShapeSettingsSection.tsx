import { CollapsibleSection } from '../../common/CollapsibleSection';
import { SegmentedIconGroup } from '../../common/SegmentedIconGroup';
import type { HoleStandard, HoleSizeEntry } from '../HoleSizePresets';
import { STANDARD_SIZES } from '../HoleSizePresets';
import {
  DRILL_POINT_OPTIONS,
  HOLE_TYPE_OPTIONS,
  TAP_TYPE_OPTIONS,
  type DrillPoint,
  type HoleTermination,
  type HoleType,
  type TapType,
} from './types';
import { FaceSelector } from '../../common/FaceSelector';

interface ShapeSettingsSectionProps {
  termination: HoleTermination;
  setTermination: (value: HoleTermination) => void;
  holeType: HoleType;
  setHoleType: (value: HoleType) => void;
  tapType: TapType;
  setTapType: (value: TapType) => void;
  drillPoint: DrillPoint;
  setDrillPoint: (value: DrillPoint) => void;
  standard: HoleStandard;
  setStandard: (value: HoleStandard) => void;
  selectedPreset: HoleSizeEntry | null;
  handleApplyPreset: (label: string) => void;
  headDepth: number;
  setHeadDepth: (value: number) => void;
  drillAngle: number;
  setDrillAngle: (value: number) => void;
  draftDiameter: number;
  setDraftDiameter: (value: number) => void;
  through: boolean;
  draftDepth: number;
  setDraftDepth: (value: number) => void;
  showCB: boolean;
  cbDiameter: number;
  setCbDiameter: (value: number) => void;
  cbDepth: number;
  setCbDepth: (value: number) => void;
  showCS: boolean;
  csDiameter: number;
  setCsDiameter: (value: number) => void;
  csAngle: number;
  setCsAngle: (value: number) => void;
}

export function ShapeSettingsSection({
  termination,
  setTermination,
  holeType,
  setHoleType,
  tapType,
  setTapType,
  drillPoint,
  setDrillPoint,
  standard,
  setStandard,
  selectedPreset,
  handleApplyPreset,
  headDepth,
  setHeadDepth,
  drillAngle,
  setDrillAngle,
  draftDiameter,
  setDraftDiameter,
  through,
  draftDepth,
  setDraftDepth,
  showCB,
  cbDiameter,
  setCbDiameter,
  cbDepth,
  setCbDepth,
  showCS,
  csDiameter,
  setCsDiameter,
  csAngle,
  setCsAngle,
}: ShapeSettingsSectionProps) {
  return (
    <CollapsibleSection title="Shape Settings">
      <div className="tp-row">
        <span className="tp-label">Extents</span>
        <div className="tp-units-row">
          <select className="tp-select" value={termination} onChange={(e) => setTermination(e.target.value as HoleTermination)}>
            <option value="blind">Distance</option>
            <option value="through-all">Through All</option>
            <option value="to-object">To Object</option>
            <option value="to-face">To Face</option>
          </select>
          <button type="button" className="tp-icon-btn" title="Flip direction" aria-label="Flip direction">
            <svg width={11} height={11} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.4}>
              <path d="M2 6 L10 6 M7 3 L10 6 L7 9" />
            </svg>
          </button>
        </div>
      </div>
      {termination === 'to-face' && (
        <div className="tp-row">
          <span className="tp-label">To Face</span>
          <FaceSelector selected={false} pickActive={false} onClear={() => {}} emptyLabel="Select face" />
        </div>
      )}
      <div className="tp-row">
        <span className="tp-label">Hole Type</span>
        <SegmentedIconGroup value={holeType} onChange={setHoleType} options={HOLE_TYPE_OPTIONS} ariaLabel="Hole Type" />
      </div>
      <div className="tp-row">
        <span className="tp-label">Tap Type</span>
        <SegmentedIconGroup value={tapType} onChange={setTapType} options={TAP_TYPE_OPTIONS} ariaLabel="Hole Tap Type" />
      </div>
      <div className="tp-row">
        <span className="tp-label">Drill Point</span>
        <SegmentedIconGroup value={drillPoint} onChange={setDrillPoint} options={DRILL_POINT_OPTIONS} ariaLabel="Drill Point" />
      </div>

      <div className="tp-row">
        <span className="tp-label">Standard</span>
        <select
          className="tp-select"
          value={standard}
          onChange={(e) => {
            setStandard(e.target.value as HoleStandard);
          }}
        >
          <option value="custom">Custom</option>
          <option value="ISO">ISO Metric</option>
          <option value="ANSI">ANSI Inch</option>
          <option value="NPT">NPT Pipe</option>
        </select>
      </div>
      {standard !== 'custom' && (
        <div className="tp-row">
          <span className="tp-label">Size</span>
          <select className="tp-select" value={selectedPreset?.label ?? ''} onChange={(e) => handleApplyPreset(e.target.value)}>
            <option value="">- select -</option>
            {STANDARD_SIZES[standard].map((entry) => (
              <option key={entry.label} value={entry.label}>{entry.label}</option>
            ))}
          </select>
        </div>
      )}

      <div className="hole-diagram">
        <svg className="hole-diagram__svg" width={56} height={92} viewBox="0 0 64 110" fill="none" stroke="currentColor" strokeWidth={1.1}>
          <line x1={20} y1={6} x2={44} y2={6} />
          <line x1={20} y1={6} x2={20} y2={84} />
          <line x1={44} y1={6} x2={44} y2={84} />
          {drillPoint === 'angled' ? <polyline points="20,84 32,98 44,84" /> : <line x1={20} y1={84} x2={44} y2={84} />}
          <line x1={6} y1={6} x2={6} y2={84} strokeDasharray="2,2" />
        </svg>
        <div className="hole-diagram__fields">
          <div className="tp-input-group hole-diagram__field">
            <input
              type="number"
              value={headDepth}
              step={0.5}
              min={0}
              onChange={(e) => setHeadDepth(parseFloat(e.target.value) || 0)}
              aria-label="Head depth (mm)"
            />
            <span className="tp-unit">mm</span>
          </div>
          {drillPoint === 'angled' && (
            <div className="tp-input-group hole-diagram__field">
              <input
                type="number"
                value={drillAngle}
                min={60}
                max={150}
                step={1}
                onChange={(e) => setDrillAngle(parseFloat(e.target.value) || 118)}
                aria-label="Drill angle (deg)"
              />
              <span className="tp-unit">deg</span>
            </div>
          )}
          <div className="tp-input-group hole-diagram__field">
            <input
              type="number"
              value={draftDiameter}
              step={0.5}
              min={0.1}
              onChange={(e) => {
                const value = parseFloat(e.target.value);
                if (Number.isFinite(value) && value > 0) setDraftDiameter(value);
              }}
              aria-label="Diameter (mm)"
            />
            <span className="tp-unit">mm</span>
          </div>
        </div>
      </div>

      {!through && (
        <div className="tp-row">
          <span className="tp-label">Depth</span>
          <div className="tp-input-group">
            <input
              type="number"
              value={draftDepth}
              step={0.5}
              min={0.1}
              onChange={(e) => {
                const value = parseFloat(e.target.value);
                if (Number.isFinite(value) && value > 0) setDraftDepth(value);
              }}
            />
            <span className="tp-unit">mm</span>
          </div>
        </div>
      )}
      {showCB && (
        <>
          <div className="tp-row">
            <span className="tp-label">CB D</span>
            <div className="tp-input-group">
              <input type="number" value={cbDiameter} step={0.5} min={0.1} onChange={(e) => setCbDiameter(parseFloat(e.target.value) || 10)} />
              <span className="tp-unit">mm</span>
            </div>
          </div>
          <div className="tp-row">
            <span className="tp-label">CB Depth</span>
            <div className="tp-input-group">
              <input type="number" value={cbDepth} step={0.5} min={0.1} onChange={(e) => setCbDepth(parseFloat(e.target.value) || 3)} />
              <span className="tp-unit">mm</span>
            </div>
          </div>
        </>
      )}
      {showCS && (
        <>
          <div className="tp-row">
            <span className="tp-label">CS D</span>
            <div className="tp-input-group">
              <input type="number" value={csDiameter} step={0.5} min={0.1} onChange={(e) => setCsDiameter(parseFloat(e.target.value) || 9)} />
              <span className="tp-unit">mm</span>
            </div>
          </div>
          <div className="tp-row">
            <span className="tp-label">CS Angle</span>
            <div className="tp-input-group">
              <input type="number" value={csAngle} min={60} max={120} step={5} onChange={(e) => setCsAngle(parseFloat(e.target.value) || 90)} />
              <span className="tp-unit">deg</span>
            </div>
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}
