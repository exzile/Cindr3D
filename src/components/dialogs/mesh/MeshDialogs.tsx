import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import * as THREE from 'three';

// ===== Mesh Reduce Dialog =====
export function MeshReduceDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const reduceMesh = useCADStore((s) => s.reduceMesh);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const meshFeatures = features.filter((f) => !!f.mesh);

  const [selectedId, setSelectedId] = useState<string>(meshFeatures[0]?.id ?? '');
  const [percent, setPercent] = useState(50);

  const handleApply = () => {
    if (!selectedId) {
      setStatusMessage('Mesh Reduce: no feature selected');
      return;
    }
    reduceMesh(selectedId, percent);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Reduce Mesh</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Target Feature</label>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {meshFeatures.length === 0 && <option value="">— no mesh features —</option>}
              {meshFeatures.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Reduction: {percent}%</label>
            <input
              type="range"
              min={1}
              max={99}
              value={percent}
              onChange={(e) => setPercent(parseInt(e.target.value, 10))}
            />
          </div>
          <p className="dialog-hint">Removes a percentage of vertices from the mesh.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply} disabled={!selectedId}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Reverse Normal Dialog =====
export function ReverseNormalDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const reverseNormals = useCADStore((s) => s.reverseNormals);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const meshFeatures = features.filter((f) => !!f.mesh);

  const [selectedId, setSelectedId] = useState<string>(meshFeatures[0]?.id ?? '');

  const handleApply = () => {
    if (!selectedId) {
      setStatusMessage('Reverse Normal: no feature selected');
      return;
    }
    reverseNormals(selectedId);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Reverse Normal</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Target Feature</label>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {meshFeatures.length === 0 && <option value="">— no mesh features —</option>}
              {meshFeatures.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <p className="dialog-hint">Flips face winding to reverse which side is front-facing.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply} disabled={!selectedId}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Tessellate Dialog =====
export function TessellateDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const tessellateFeature = useCADStore((s) => s.tessellateFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const meshFeatures = features.filter((f) => f.mesh != null);
  const [selectedId, setSelectedId] = useState<string>(meshFeatures[0]?.id ?? '');

  const selectedFeature = meshFeatures.find((f) => f.id === selectedId);
  let vertexCount: number | null = null;
  if (selectedFeature?.mesh) {
    const m = selectedFeature.mesh as THREE.Object3D;
    if (m instanceof THREE.Mesh) {
      vertexCount = m.geometry.attributes.position?.count ?? null;
    } else {
      let count = 0;
      m.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh) count += child.geometry.attributes.position?.count ?? 0;
      });
      vertexCount = count || null;
    }
  }

  const handleApply = () => {
    if (!selectedId) { setStatusMessage('No feature selected'); return; }
    tessellateFeature(selectedId);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Tessellate</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          {meshFeatures.length === 0 ? (
            <p className="dialog-hint">No solid or surface features with geometry found. Create or import a body first.</p>
          ) : (
            <>
              <div className="form-group">
                <label>Source Feature</label>
                <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                  {meshFeatures.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              {vertexCount != null && (
                <p className="dialog-hint">Vertex count: {vertexCount.toLocaleString()}</p>
              )}
              <p className="dialog-hint">Clones the selected feature&apos;s geometry as a new mesh body in the timeline.</p>
            </>
          )}
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply} disabled={meshFeatures.length === 0 || !selectedId}>OK</button>
        </div>
      </div>
    </div>
  );
}
