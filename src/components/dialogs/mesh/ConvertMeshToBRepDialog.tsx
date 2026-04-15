import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function ConvertMeshToBRepDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitConvertMeshToBRep = useCADStore((s) => s.commitConvertMeshToBRep);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const bodyFeatures = features.filter((f) => !!f.mesh);
  const [selectedId, setSelectedId] = useState<string>(bodyFeatures[0]?.id ?? '');
  const [mode, setMode] = useState<'facet' | 'prismatic'>('facet');

  const handleOK = () => {
    if (!selectedId) {
      setStatusMessage('Convert to BRep: no body selected');
      return;
    }
    commitConvertMeshToBRep(selectedId, mode);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Convert Mesh to BRep</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Body</label>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {bodyFeatures.length === 0 && <option value="">— no bodies —</option>}
              {bodyFeatures.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Conversion Mode</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label className="checkbox-label">
                <input
                  type="radio"
                  name="mode"
                  value="facet"
                  checked={mode === 'facet'}
                  onChange={() => setMode('facet')}
                />
                Facet — keep triangles as-is, reclassify as solid body
              </label>
              <label className="checkbox-label">
                <input
                  type="radio"
                  name="mode"
                  value="prismatic"
                  checked={mode === 'prismatic'}
                  onChange={() => setMode('prismatic')}
                />
                Prismatic — ensure watertight before converting
              </label>
            </div>
          </div>
          <p className="dialog-hint">Converts the mesh body into a solid BRep. Facet mode is fastest (one triangle = one face).</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK} disabled={!selectedId}>OK</button>
        </div>
      </div>
    </div>
  );
}
