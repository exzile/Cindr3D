import { X, Check, Plus, Minus } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export default function LoftPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);

  const profileIds = useCADStore((s) => s.loftProfileSketchIds);
  const setProfileIds = useCADStore((s) => s.setLoftProfileSketchIds);
  const bodyKind = useCADStore((s) => s.loftBodyKind);
  const setBodyKind = useCADStore((s) => s.setLoftBodyKind);

  // D72 upgrades
  const closed = useCADStore((s) => s.loftClosed);
  const setClosed = useCADStore((s) => s.setLoftClosed);
  const tangentEdgesMerged = useCADStore((s) => s.loftTangentEdgesMerged);
  const setTangentEdgesMerged = useCADStore((s) => s.setLoftTangentEdgesMerged);
  const startCond = useCADStore((s) => s.loftStartCondition);
  const setStartCond = useCADStore((s) => s.setLoftStartCondition);
  const endCond = useCADStore((s) => s.loftEndCondition);
  const setEndCond = useCADStore((s) => s.setLoftEndCondition);
  const railId = useCADStore((s) => s.loftRailSketchId);
  const setRailId = useCADStore((s) => s.setLoftRailSketchId);
  const loftOperation = useCADStore((s) => s.loftOperation);
  const setLoftOperation = useCADStore((s) => s.setLoftOperation);

  const commitLoft = useCADStore((s) => s.commitLoft);
  const cancelLoftTool = useCADStore((s) => s.cancelLoftTool);

  if (activeTool !== 'loft') return null;

  const available = sketches.filter((s) => s.entities.length > 0);
  const canCommit = profileIds.length >= 2 && profileIds.every((id) => id !== '');

  const addSlot = () => setProfileIds([...profileIds, '']);
  const removeSlot = (i: number) => setProfileIds(profileIds.filter((_, idx) => idx !== i));
  const setSlot = (i: number, id: string) => {
    const next = [...profileIds];
    next[i] = id;
    setProfileIds(next);
  };

  type EndCond = 'free' | 'tangent' | 'curvature';

  return (
    <div className="extrude-panel">
      <div className="sketch-palette-header">
        <span className="sketch-palette-dot" style={{ background: '#f59e0b' }} />
        <span className="sketch-palette-title">LOFT</span>
        <button className="sketch-palette-close" onClick={cancelLoftTool} title="Cancel">
          <X size={12} />
        </button>
      </div>

      <div className="sketch-palette-body">
        {profileIds.map((id, i) => (
          <div className="sketch-palette-row" key={i}>
            <span className="sketch-palette-label">Profile {i + 1}</span>
            <div className="loft-profile-row">
              <select className="measure-select loft-profile-row__select" value={id}
                onChange={(e) => setSlot(i, e.target.value)}>
                <option value="" disabled>Select sketch</option>
                {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {profileIds.length > 2 && (
                <button className="btn btn-secondary" style={{ padding: '2px 6px' }}
                  onClick={() => removeSlot(i)} title="Remove">
                  <Minus size={12} />
                </button>
              )}
            </div>
          </div>
        ))}

        <div className="sketch-palette-row">
          <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }}
            onClick={addSlot}>
            <Plus size={12} /> Add Profile
          </button>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Rail Sketch</span>
          <select className="measure-select" value={railId ?? ''}
            onChange={(e) => setRailId(e.target.value || null)}>
            <option value="">— none —</option>
            {available.filter((s) => !profileIds.includes(s.id))
              .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Start</span>
          <select className="measure-select" value={startCond}
            onChange={(e) => setStartCond(e.target.value as EndCond)}>
            <option value="free">Free</option>
            <option value="tangent">Tangent (G1)</option>
            <option value="curvature">Curvature (G2)</option>
          </select>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">End</span>
          <select className="measure-select" value={endCond}
            onChange={(e) => setEndCond(e.target.value as EndCond)}>
            <option value="free">Free</option>
            <option value="tangent">Tangent (G1)</option>
            <option value="curvature">Curvature (G2)</option>
          </select>
        </div>

        <div className="sketch-palette-row">
          <label className="loft-checkbox-label">
            <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
            <span className="sketch-palette-label">Closed Loft</span>
          </label>
        </div>
        <div className="sketch-palette-row">
          <label className="loft-checkbox-label">
            <input type="checkbox" checked={tangentEdgesMerged} onChange={(e) => setTangentEdgesMerged(e.target.checked)} />
            <span className="sketch-palette-label">Merge Tangent Edges</span>
          </label>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Output</span>
          <select className="measure-select" value={bodyKind}
            onChange={(e) => setBodyKind(e.target.value as 'solid' | 'surface')}>
            <option value="solid">Solid Body</option>
            <option value="surface">Surface Body</option>
          </select>
        </div>
        {bodyKind !== 'surface' && (
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Operation</span>
            <select className="measure-select" value={loftOperation}
              onChange={(e) => setLoftOperation(e.target.value as 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component')}>
              <option value="new-body">New Body</option>
              <option value="join">Join</option>
              <option value="cut">Cut</option>
              <option value="intersect">Intersect</option>
              <option value="new-component">New Component</option>
            </select>
          </div>
        )}

        <div className="extrude-panel-actions">
          <button className="btn btn-secondary" onClick={cancelLoftTool}>
            <X size={14} /> Cancel
          </button>
          <button className="btn btn-primary" onClick={commitLoft} disabled={!canCommit}>
            <Check size={14} /> OK
          </button>
        </div>
      </div>
    </div>
  );
}
