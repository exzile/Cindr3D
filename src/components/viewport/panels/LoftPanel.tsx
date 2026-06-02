import { X, Check, Plus, Minus } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export default function LoftPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);

  const profileIds = useCADStore((s) => s.loftProfileSketchIds);
  const setProfileIds = useCADStore((s) => s.setLoftProfileSketchIds);
  const bodyKind = useCADStore((s) => s.loftBodyKind);
  const setBodyKind = useCADStore((s) => s.setLoftBodyKind);

  const closed = useCADStore((s) => s.loftClosed);
  const setClosed = useCADStore((s) => s.setLoftClosed);
  const startCond = useCADStore((s) => s.loftStartCondition);
  const setStartCond = useCADStore((s) => s.setLoftStartCondition);
  const endCond = useCADStore((s) => s.loftEndCondition);
  const setEndCond = useCADStore((s) => s.setLoftEndCondition);
  const railIds = useCADStore((s) => s.loftRailSketchIds);
  const setRailIds = useCADStore((s) => s.setLoftRailSketchIds);
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

  const addRail = () => setRailIds([...railIds, '']);
  const removeRail = (i: number) => setRailIds(railIds.filter((_, idx) => idx !== i));
  const setRail = (i: number, id: string) => {
    const next = [...railIds];
    next[i] = id;
    setRailIds(next);
  };

  // Sketches not already used as profiles
  const availableForRail = available.filter((s) => !profileIds.includes(s.id));

  type EndCond = 'free' | 'tangent';

  return (
    <div className="tool-panel">
      <div className="tp-header">
        <div className="tp-header-icon" style={{ background: '#f59e0b' }} />
        <span className="tp-header-title">LOFT</span>
        <button className="tp-close" onClick={cancelLoftTool} title="Cancel"><X size={14} /></button>
      </div>

      <div className="tp-body">
        <div className="tp-section">
          <div className="tp-section-title">Profiles</div>
          {profileIds.map((id, i) => (
            <div className="tp-row" key={i}>
              <span className="tp-label">Profile {i + 1}</span>
              <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                <select className="tp-select" style={{ flex: 1 }} value={id}
                  onChange={(e) => setSlot(i, e.target.value)}>
                  <option value="" disabled>Select sketch</option>
                  {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {profileIds.length > 2 && (
                  <button className="tp-btn tp-btn-cancel" style={{ padding: '2px 6px', minWidth: 0 }}
                    onClick={() => removeSlot(i)} title="Remove"><Minus size={12} /></button>
                )}
              </div>
            </div>
          ))}
          <div className="tp-row">
            <button className="tp-btn tp-btn-cancel" style={{ gridColumn: '1/-1', width: '100%', justifyContent: 'center' }}
              onClick={addSlot}><Plus size={12} /> Add Profile</button>
          </div>
        </div>

        <div className="tp-divider" />

        <div className="tp-section">
          <div className="tp-section-title">Rails <span style={{ fontSize: '10px', color: 'var(--text-muted,#888)', fontWeight: 400 }}>(optional)</span></div>
          {railIds.map((id, i) => (
            <div className="tp-row" key={i}>
              <span className="tp-label">Rail {i + 1}</span>
              <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                <select className="tp-select" style={{ flex: 1 }} value={id}
                  onChange={(e) => setRail(i, e.target.value)}>
                  <option value="">— none —</option>
                  {availableForRail.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button className="tp-btn tp-btn-cancel" style={{ padding: '2px 6px', minWidth: 0 }}
                  onClick={() => removeRail(i)} title="Remove"><Minus size={12} /></button>
              </div>
            </div>
          ))}
          <div className="tp-row">
            <button className="tp-btn tp-btn-cancel" style={{ gridColumn: '1/-1', width: '100%', justifyContent: 'center' }}
              onClick={addRail}><Plus size={12} /> Add Rail</button>
          </div>
        </div>

        <div className="tp-divider" />

        <div className="tp-section">
          <div className="tp-section-title">Options</div>
          <div className="tp-row">
            <span className="tp-label">Start</span>
            <select className="tp-select" value={startCond}
              onChange={(e) => setStartCond(e.target.value as EndCond)}>
              <option value="free">Free</option>
              <option value="tangent">Tangent (G1)</option>
            </select>
          </div>
          <div className="tp-row">
            <span className="tp-label">End</span>
            <select className="tp-select" value={endCond}
              onChange={(e) => setEndCond(e.target.value as EndCond)}>
              <option value="free">Free</option>
              <option value="tangent">Tangent (G1)</option>
            </select>
          </div>
          <div className="tp-row">
            <label className="tp-checkbox-label">
              <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
              <span>Closed Loft</span>
            </label>
          </div>
        </div>

        <div className="tp-divider" />

        <div className="tp-section">
          <div className="tp-section-title">Output</div>
          <div className="tp-row">
            <span className="tp-label">Body</span>
            <select className="tp-select" value={bodyKind}
              onChange={(e) => setBodyKind(e.target.value as 'solid' | 'surface')}>
              <option value="solid">Solid Body</option>
              <option value="surface">Surface Body</option>
            </select>
          </div>
          {bodyKind !== 'surface' && (
            <div className="tp-row">
              <span className="tp-label">Operation</span>
              <select className="tp-select" value={loftOperation}
                onChange={(e) => setLoftOperation(e.target.value as 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component')}>
                <option value="new-body">New Body</option>
                <option value="join">Join</option>
                <option value="cut">Cut</option>
                <option value="intersect">Intersect</option>
                <option value="new-component">New Component</option>
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="tp-actions">
        <button className="tp-btn tp-btn-cancel" onClick={cancelLoftTool}><X size={13} /> Cancel</button>
        <button className="tp-btn tp-btn-ok" onClick={commitLoft} disabled={!canCommit}><Check size={13} /> OK</button>
      </div>
    </div>
  );
}
