import './SweepPanel.css';
import { X, Check, Spline } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export default function SweepPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);

  const profileId = useCADStore((s) => s.sweepProfileSketchId);
  const setProfileId = useCADStore((s) => s.setSweepProfileSketchId);
  const pathId = useCADStore((s) => s.sweepPathSketchId);
  const setPathId = useCADStore((s) => s.setSweepPathSketchId);
  const guideRailId = useCADStore((s) => s.sweepGuideRailId);
  const setGuideRailId = useCADStore((s) => s.setSweepGuideRailId);

  const orientation = useCADStore((s) => s.sweepOrientation);
  const setOrientation = useCADStore((s) => s.setSweepOrientation);
  const profileScaling = useCADStore((s) => s.sweepProfileScaling);
  const setProfileScaling = useCADStore((s) => s.setSweepProfileScaling);
  const twistAngle = useCADStore((s) => s.sweepTwistAngle);
  const setTwistAngle = useCADStore((s) => s.setSweepTwistAngle);
  const taperAngle = useCADStore((s) => s.sweepTaperAngle);
  const setTaperAngle = useCADStore((s) => s.setSweepTaperAngle);

  const distance = useCADStore((s) => s.sweepDistance);
  const setDistance = useCADStore((s) => s.setSweepDistance);
  const distanceOne = useCADStore((s) => s.sweepDistanceOne);
  const setDistanceOne = useCADStore((s) => s.setSweepDistanceOne);
  const distanceTwo = useCADStore((s) => s.sweepDistanceTwo);
  const setDistanceTwo = useCADStore((s) => s.setSweepDistanceTwo);
  const operation = useCADStore((s) => s.sweepOperation);
  const setOperation = useCADStore((s) => s.setSweepOperation);
  const bodyKind = useCADStore((s) => s.sweepBodyKind);
  const setBodyKind = useCADStore((s) => s.setSweepBodyKind);

  const commitSweep = useCADStore((s) => s.commitSweep);
  const cancelSweepTool = useCADStore((s) => s.cancelSweepTool);

  if (activeTool !== 'sweep') return null;

  const available = sketches.filter((s) => s.entities.length > 0);
  const canCommit = !!profileId && !!pathId && profileId !== pathId;

  return (
    <div className="tool-panel">
      <div className="tp-header">
        <div className="tp-header-icon sweep"><Spline size={12} /></div>
        <span className="tp-header-title">SWEEP</span>
        <button className="tp-close" onClick={cancelSweepTool} title="Cancel"><X size={14} /></button>
      </div>

      <div className="tp-body">
        {/* Profile */}
        <div className="tp-section">
          <div className="tp-section-title">Profile</div>
          <div className="tp-row">
            <span className="tp-label">Sketch</span>
            <select className="tp-select" value={profileId ?? ''}
              onChange={(e) => setProfileId(e.target.value || null)}>
              <option value="" disabled>Select profile</option>
              {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <div className="tp-divider" />

        {/* Path */}
        <div className="tp-section">
          <div className="tp-section-title">Path</div>
          <div className="tp-row">
            <span className="tp-label">Sketch</span>
            <select className="tp-select" value={pathId ?? ''}
              onChange={(e) => setPathId(e.target.value || null)}>
              <option value="" disabled>Select path</option>
              {available.filter((s) => s.id !== profileId)
                .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="tp-row">
            <span className="tp-label">Distance</span>
            <select className="tp-select" value={distance}
              onChange={(e) => setDistance(e.target.value as 'entire' | 'distance')}>
              <option value="entire">Entire Path</option>
              <option value="distance">Partial (0–1)</option>
            </select>
          </div>
          {distance === 'distance' && (
            <>
              <div className="tp-row">
                <span className="tp-label">Start (0–1)</span>
                <input
                  type="number"
                  className="tp-input"
                  min={0} max={1} step={0.05}
                  value={distanceOne}
                  onChange={(e) => setDistanceOne(parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="tp-row">
                <span className="tp-label">End (0–1)</span>
                <input
                  type="number"
                  className="tp-input"
                  min={0} max={1} step={0.05}
                  value={distanceTwo}
                  onChange={(e) => setDistanceTwo(parseFloat(e.target.value) || 1)}
                />
              </div>
            </>
          )}
          <div className="tp-row">
            <span className="tp-label">Guide Rail</span>
            <select className="tp-select" value={guideRailId ?? ''}
              onChange={(e) => setGuideRailId(e.target.value || null)}>
              <option value="">— none —</option>
              {available.filter((s) => s.id !== profileId && s.id !== pathId)
                .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <div className="tp-divider" />

        {/* Options */}
        <div className="tp-section">
          <div className="tp-section-title">Options</div>
          <div className="tp-row">
            <span className="tp-label">Orientation</span>
            <select className="tp-select" value={orientation}
              onChange={(e) => setOrientation(e.target.value as 'perpendicular' | 'parallel' | 'default')}>
              <option value="perpendicular">Perpendicular to Path</option>
              <option value="parallel">Parallel (Fixed)</option>
              <option value="default">Default</option>
            </select>
          </div>
          <div className="tp-row">
            <span className="tp-label">Scaling</span>
            <select className="tp-select" value={profileScaling}
              onChange={(e) => setProfileScaling(e.target.value as 'none' | 'scale-to-path' | 'scale-to-rail')}>
              <option value="none">No Scaling</option>
              <option value="scale-to-path">Scale to Path</option>
              <option value="scale-to-rail">Scale to Rail</option>
            </select>
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
        </div>

        <div className="tp-divider" />

        {/* Output */}
        <div className="tp-section">
          <div className="tp-section-title">Output</div>
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
