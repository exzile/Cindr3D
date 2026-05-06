import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { Check, RefreshCw, X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { analyzeMeshGeometry, autoRepairMeshGeometry, weldMeshVertices } from '../../../meshRepair';
import '../common/ToolPanel.css';

function findMesh(object: unknown): THREE.Mesh | null {
  if (object instanceof THREE.Mesh) return object;
  if (object instanceof THREE.Group) {
    let found: THREE.Mesh | null = null;
    object.traverse((child) => {
      if (!found && child instanceof THREE.Mesh) found = child;
    });
    return found;
  }
  return null;
}

export function MeshRepairDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const selectedFeatureId = useCADStore((s) => s.selectedFeatureId);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const pushUndo = useCADStore((s) => s.pushUndo);
  const selected = features.find((feature) => feature.id === selectedFeatureId) ?? features.find((feature) => feature.mesh);
  const mesh = findMesh(selected?.mesh);
  const [repairCount, setRepairCount] = useState(0);
  const report = useMemo(() => mesh ? analyzeMeshGeometry(mesh.geometry) : null, [mesh, repairCount]);

  const replaceGeometry = (geometry: THREE.BufferGeometry, label: string) => {
    if (!mesh) return;
    pushUndo();
    const old = mesh.geometry;
    mesh.geometry = geometry;
    setTimeout(() => old.dispose(), 0);
    setRepairCount((c) => c + 1);
    setStatusMessage(label);
  };

  return (
    <div className="tool-panel-overlay">
      <div className="tool-panel" style={{ width: 330 }}>
        <div className="tp-header">
          <div className="tp-header-icon"><RefreshCw size={12} /></div>
          <span className="tp-header-title">Mesh Repair</span>
          <button className="tp-close" onClick={onClose} title="Close"><X size={14} /></button>
        </div>
        <div className="tp-body">
          <div className="tp-section">
            <div className="tp-section-title">Selected Mesh</div>
            <p className="dialog-hint">{selected?.name ?? 'Select a mesh feature first.'}</p>
          </div>
          {report && (
            <div className="tp-section">
              <div className="tp-section-title">Report</div>
              <p className="dialog-hint">Vertices: {report.vertices}</p>
              <p className="dialog-hint">Triangles: {report.triangles}</p>
              <p className="dialog-hint">Duplicate vertices: {report.duplicateVertices}</p>
              <p className="dialog-hint">Boundary edges: {report.boundaryEdges}</p>
              <p className="dialog-hint">Non-manifold edges: {report.nonManifoldEdges}</p>
              <p className="dialog-hint">Degenerate faces: {report.degenerateFaces}</p>
            </div>
          )}
        </div>
        <div className="tp-actions">
          <button className="tp-btn" disabled={!mesh} onClick={() => mesh && replaceGeometry(weldMeshVertices(mesh.geometry), 'Mesh vertices welded')}>
            <Check size={13} /> Weld
          </button>
          <button className="tp-btn" disabled={!mesh} onClick={() => mesh && replaceGeometry(autoRepairMeshGeometry(mesh.geometry), 'Mesh auto-repaired')}>
            <RefreshCw size={13} /> Auto-Fix
          </button>
          <button className="tp-btn tp-btn-cancel" disabled={!mesh} onClick={() => {
            if (!mesh) return;
            pushUndo();
            mesh.geometry.scale(-1, 1, 1);
            mesh.geometry.computeVertexNormals();
            setRepairCount((c) => c + 1);
            setStatusMessage('Mesh normals flipped');
          }}>
            Flip Normals
          </button>
        </div>
      </div>
    </div>
  );
}
