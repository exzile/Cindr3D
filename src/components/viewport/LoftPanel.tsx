import { X, Check, Plus, Minus } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';

export default function LoftPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);
  const profileIds = useCADStore((s) => s.loftProfileSketchIds);
  const setProfileIds = useCADStore((s) => s.setLoftProfileSketchIds);
  // D105 surface loft
  const bodyKind = useCADStore((s) => s.loftBodyKind);
  const setBodyKind = useCADStore((s) => s.setLoftBodyKind);
  const commitLoft = useCADStore((s) => s.commitLoft);
  const cancelLoftTool = useCADStore((s) => s.cancelLoftTool);

  if (activeTool !== 'loft') return null;

  const available = sketches.filter((s) => s.entities.length > 0);
  const canCommit = profileIds.length >= 2;

  const addSlot = () => setProfileIds([...profileIds, '']);
  const removeSlot = (i: number) => setProfileIds(profileIds.filter((_, idx) => idx !== i));
  const setSlot = (i: number, id: string) => {
    const next = [...profileIds];
    next[i] = id;
    setProfileIds(next);
  };

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
            <div style={{ display: 'flex', gap: 4, flex: 1 }}>
              <select
                className="measure-select"
                style={{ flex: 1 }}
                value={id}
                onChange={(e) => setSlot(i, e.target.value)}
              >
                <option value="" disabled>Select sketch</option>
                {available.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {profileIds.length > 2 && (
                <button
                  className="btn btn-secondary"
                  style={{ padding: '2px 6px' }}
                  onClick={() => removeSlot(i)}
                  title="Remove"
                >
                  <Minus size={12} />
                </button>
              )}
            </div>
          </div>
        ))}

        <div className="sketch-palette-row">
          <button
            className="btn btn-secondary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={addSlot}
          >
            <Plus size={12} /> Add Profile
          </button>
        </div>

        {/* D105: Body kind */}
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Output</span>
          <select
            className="measure-select"
            value={bodyKind}
            onChange={(e) => setBodyKind(e.target.value as 'solid' | 'surface')}
          >
            <option value="solid">Solid Body</option>
            <option value="surface">Surface Body</option>
          </select>
        </div>

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
