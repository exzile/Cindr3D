import { X, Check } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export default function PatchPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);
  const profileId = useCADStore((s) => s.patchSelectedSketchId);
  const setProfileId = useCADStore((s) => s.setPatchSelectedSketchId);
  const patchContinuity = useCADStore((s) => s.patchContinuity);
  const setPatchContinuity = useCADStore((s) => s.setPatchContinuity);
  const commitPatch = useCADStore((s) => s.commitPatch);
  const cancelPatchTool = useCADStore((s) => s.cancelPatchTool);

  if (activeTool !== 'patch') return null;

  const available = sketches.filter((s) => s.entities.length > 0);
  const canCommit = !!profileId;

  return (
    <div className="tool-panel">
      <div className="tp-header">
        <div className="tp-header-icon" style={{ background: '#34d399' }} />
        <span className="tp-header-title">PATCH</span>
        <button className="tp-close" onClick={cancelPatchTool} title="Cancel"><X size={14} /></button>
      </div>

      <div className="tp-body">
        <div className="tp-section">
          <div className="tp-section-title">Profile</div>
          <div className="tp-row">
            <span className="tp-label">Sketch</span>
            <select className="tp-select" value={profileId ?? ''}
              onChange={(e) => setProfileId(e.target.value || null)}>
              <option value="" disabled>Select profile sketch</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="tp-divider" />

        <div className="tp-section">
          <div className="tp-section-title">Continuity</div>
          <div className="tp-row">
            <span className="tp-label">Boundary</span>
            <select className="tp-select" value={patchContinuity}
              onChange={(e) => setPatchContinuity(e.target.value as 'G0' | 'G1' | 'G2')}>
              <option value="G0">G0 (Position)</option>
              <option value="G1">G1 (Tangent)</option>
              <option value="G2">G2 (Curvature)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="tp-actions">
        <button className="tp-btn tp-btn-cancel" onClick={cancelPatchTool}><X size={13} /> Cancel</button>
        <button className="tp-btn tp-btn-ok" onClick={commitPatch} disabled={!canCommit}><Check size={13} /> OK</button>
      </div>
    </div>
  );
}
