import { useState } from 'react';
import { X } from 'lucide-react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';

const FACE_NORMALS: Record<string, THREE.Vector3> = {
  Top:    new THREE.Vector3(0,  1, 0),
  Bottom: new THREE.Vector3(0, -1, 0),
  Front:  new THREE.Vector3(0,  0, 1),
  Back:   new THREE.Vector3(0,  0, -1),
  Left:   new THREE.Vector3(-1, 0, 0),
  Right:  new THREE.Vector3(1,  0, 0),
};

export function EraseAndFillDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitEraseAndFill = useCADStore((s) => s.commitEraseAndFill);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const bodyFeatures = features.filter((f) => !!f.mesh);
  const [selectedId, setSelectedId] = useState<string>(bodyFeatures[0]?.id ?? '');
  const [faceDescription, setFaceDescription] = useState('Top');
  const [fillType, setFillType] = useState<'Flat' | 'Curved' | 'Smooth'>('Flat');

  const getFaceCentroid = (bodyId: string, faceDesc: string): THREE.Vector3 => {
    const mesh = features.find((f) => f.id === bodyId)?.mesh as THREE.Mesh | undefined;
    if (mesh?.isMesh) {
      const box = new THREE.Box3().setFromObject(mesh);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);
      const n = FACE_NORMALS[faceDesc] ?? new THREE.Vector3(0, 1, 0);
      return new THREE.Vector3(
        center.x + n.x * size.x * 0.5,
        center.y + n.y * size.y * 0.5,
        center.z + n.z * size.z * 0.5,
      );
    }
    return new THREE.Vector3();
  };

  const handleOK = () => {
    if (!selectedId) {
      setStatusMessage('Erase And Fill: no body selected');
      return;
    }
    const faceNormal = FACE_NORMALS[faceDescription] ?? new THREE.Vector3(0, 1, 0);
    const faceCentroid = getFaceCentroid(selectedId, faceDescription);
    commitEraseAndFill(selectedId, faceNormal, faceCentroid);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Erase And Fill</h3>
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
            <label>Face to Erase</label>
            <select value={faceDescription} onChange={(e) => setFaceDescription(e.target.value)}>
              {Object.keys(FACE_NORMALS).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Fill Type</label>
            <select value={fillType} onChange={(e) => setFillType(e.target.value as typeof fillType)}>
              <option value="Flat">Flat</option>
              <option value="Curved">Curved</option>
              <option value="Smooth">Smooth</option>
            </select>
          </div>
          <p className="dialog-hint">Deletes the selected face region and rebuilds a patch over the hole.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK} disabled={!selectedId}>OK</button>
        </div>
      </div>
    </div>
  );
}
