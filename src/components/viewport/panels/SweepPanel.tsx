import './SweepPanel.css';
import { X, Check, Spline, MousePointer2 } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';

export default function SweepPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);

  const sweepType = useCADStore((s) => s.sweepType);
  const setSweepType = useCADStore((s) => s.setSweepType);
  const chainSelection = useCADStore((s) => s.sweepChainSelection);
  const setChainSelection = useCADStore((s) => s.setSweepChainSelection);

  const profileId = useCADStore((s) => s.sweepProfileSketchId);
  const setProfileId = useCADStore((s) => s.setSweepProfileSketchId);
  const activeInput = useCADStore((s) => s.sweepActiveInput);
  const setActiveInput = useCADStore((s) => s.setSweepActiveInput);
  const pathId = useCADStore((s) => s.sweepPathSketchId);
  const setPathId = useCADStore((s) => s.setSweepPathSketchId);
  const guideRailId = useCADStore((s) => s.sweepGuideRailId);
  const setGuideRailId = useCADStore((s) => s.setSweepGuideRailId);

  const orientation = useCADStore((s) => s.sweepOrientation);
  const setOrientation = useCADStore((s) => s.setSweepOrientation);
  const taperAngle = useCADStore((s) => s.sweepTaperAngle);
  const setTaperAngle = useCADStore((s) => s.setSweepTaperAngle);
  const twistAngle = useCADStore((s) => s.sweepTwistAngle);
  const setTwistAngle = useCADStore((s) => s.setSweepTwistAngle);
  const distanceTwo = useCADStore((s) => s.sweepDistanceTwo);
  const setDistanceTwo = useCADStore((s) => s.setSweepDistanceTwo);

  const isDirectionFlipped = useCADStore((s) => s.sweepIsDirectionFlipped);
  const setIsDirectionFlipped = useCADStore((s) => s.setSweepIsDirectionFlipped);
  const operation = useCADStore((s) => s.sweepOperation);
  const setOperation = useCADStore((s) => s.setSweepOperation);
  const bodyKind = useCADStore((s) => s.sweepBodyKind);
  const setBodyKind = useCADStore((s) => s.setSweepBodyKind);

  const commitSweep = useCADStore((s) => s.commitSweep);
  const cancelSweepTool = useCADStore((s) => s.cancelSweepTool);

  if (activeTool !== 'sweep') return null;

  const available = sketches.filter((s) => s.entities.length > 0);
  const baseOf = (id: string | null) => (id ? id.split('::')[0] : null);
  const profileBase = baseOf(profileId);
  const canCommit = !!profileId && !!pathId && profileBase !== pathId && profileBase !== guideRailId;

  // Profile options = each closed region on each sketch, labelled "Sketch — Profile N"
  // so the user sees which sketch the profile lives on. Value = "sketchId::profileIndex".
  const profileOptions = available.flatMap((sketch) => {
    const count = Math.max(1, GeometryEngine.sketchToProfileShapesFlat(sketch).length);
    return Array.from({ length: count }, (_, i) => ({
      id: `${sketch.id}::${i}`,
      label: count > 1 ? `${sketch.name} — Profile ${i + 1}` : sketch.name,
    }));
  });
  const sketchOptions = (excludeIds: (string | null)[]) =>
    available.filter((s) => !excludeIds.includes(s.id)).map((s) => ({ id: s.id, label: s.name }));

  // Fusion-style selection row: cursor icon + dropdown + "1 selected" chip + clear.
  // Clicking the field marks this input active so the in-canvas picker fills it.
  // Plain render helper (not a component) to avoid remounting on every parent render.
  const selectionRow = (
    key: string,
    label: string,
    value: string | null,
    onChange: (id: string | null) => void,
    opts: { id: string; label: string }[],
    activeKey?: 'profile' | 'path' | 'guide',
  ) => {
    const selOpt = opts.find((o) => o.id === value);
    const isActive = activeKey !== undefined && activeInput === activeKey;
    return (
      <div className={`tp-row${isActive ? ' sweep-row-active' : ''}`} key={key}
        onPointerDown={() => activeKey && setActiveInput(activeKey)}>
        <span className="tp-label">{label}</span>
        <div className="sweep-select-field">
          <MousePointer2 size={12} className="sweep-select-cursor" />
          <select className="tp-select sweep-select-input" value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}>
            <option value="">{selOpt?.label ?? 'Select'}</option>
            {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {value && <span className="sweep-select-count">1 selected</span>}
          {value && (
            <button className="tp-chip__clear" title="Clear" onClick={() => onChange(null)}><X size={11} /></button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="tool-panel">
      <div className="tp-header">
        <div className="tp-header-icon sweep"><Spline size={12} /></div>
        <span className="tp-header-title">SWEEP</span>
        <button className="tp-close" onClick={cancelSweepTool} title="Cancel"><X size={14} /></button>
      </div>

      <div className="tp-body">
        <div className="tp-section">
          <div className="tp-row">
            <span className="tp-label">Type</span>
            <select className="tp-select" value={sweepType}
              onChange={(e) => setSweepType(e.target.value as 'single-path' | 'guide-rail')}>
              <option value="single-path">Single Path</option>
              <option value="guide-rail">Path + Guide Rail</option>
            </select>
          </div>

          {selectionRow('profile', 'Profile', profileId, setProfileId,
            profileOptions.filter((o) => baseOf(o.id) !== pathId && baseOf(o.id) !== guideRailId), 'profile')}
          {selectionRow('path', 'Path', pathId, setPathId, sketchOptions([profileBase, guideRailId]), 'path')}
          {sweepType === 'guide-rail' && selectionRow('guide', 'Guide Rail', guideRailId, setGuideRailId, sketchOptions([profileBase, pathId]), 'guide')}

          <div className="tp-row">
            <label className="tp-checkbox-label">
              <input type="checkbox" checked={chainSelection} onChange={(e) => setChainSelection(e.target.checked)} />
              <span>Chain Selection</span>
            </label>
          </div>
        </div>

        <div className="tp-divider" />

        <div className="tp-section">
          <div className="tp-row">
            <span className="tp-label">Distance</span>
            <div className="tp-input-group">
              <input type="number" step={0.05} min={0.01} max={1} value={distanceTwo}
                onChange={(e) => setDistanceTwo(parseFloat(e.target.value) || 1)} />
            </div>
          </div>
          <div className="tp-row">
            <span className="tp-label">Taper Angle</span>
            <div className="tp-input-group">
              <input type="number" step={1} min={-45} max={45} value={taperAngle}
                onChange={(e) => setTaperAngle(Number(e.target.value))} />
              <span className="tp-unit">°</span>
            </div>
          </div>
          <div className="tp-row">
            <span className="tp-label">Twist Angle</span>
            <div className="tp-input-group">
              <input type="number" step={5} value={twistAngle}
                onChange={(e) => setTwistAngle(Number(e.target.value))} />
              <span className="tp-unit">°</span>
            </div>
          </div>
          <div className="tp-row">
            <span className="tp-label">Orientation</span>
            <select className="tp-select" value={orientation}
              onChange={(e) => setOrientation(e.target.value as 'perpendicular' | 'frenet' | 'horizontal' | 'vertical')}>
              <option value="perpendicular">Perpendicular</option>
              <option value="frenet">Frenet (Follow Path)</option>
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
            </select>
          </div>
          <div className="tp-row">
            <label className="tp-checkbox-label">
              <input type="checkbox" checked={isDirectionFlipped}
                onChange={(e) => setIsDirectionFlipped(e.target.checked)} />
              <span>Flip Direction</span>
            </label>
          </div>
        </div>

        <div className="tp-divider" />

        <div className="tp-section">
          {bodyKind !== 'surface' && (
            <div className="tp-row">
              <span className="tp-label">Operation</span>
              <select className="tp-select" value={operation}
                onChange={(e) => setOperation(e.target.value as 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component')}>
                <option value="new-body">New Body</option>
                <option value="join">Join</option>
                <option value="cut">Cut</option>
                <option value="intersect">Intersect</option>
                <option value="new-component">New Component</option>
              </select>
            </div>
          )}
          <div className="tp-row">
            <span className="tp-label">Body</span>
            <select className="tp-select" value={bodyKind}
              onChange={(e) => setBodyKind(e.target.value as 'solid' | 'surface')}>
              <option value="solid">Solid Body</option>
              <option value="surface">Surface Body</option>
            </select>
          </div>
        </div>
      </div>

      <div className="tp-actions">
        <button className="tp-btn tp-btn-cancel" onClick={cancelSweepTool}>
          <X size={13} /> Cancel
        </button>
        <button className="tp-btn tp-btn-ok" onClick={commitSweep} disabled={!canCommit}>
          <Check size={13} /> OK
        </button>
      </div>
    </div>
  );
}
