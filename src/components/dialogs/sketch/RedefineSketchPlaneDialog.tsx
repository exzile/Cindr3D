import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import * as THREE from 'three';

export function RedefineSketchPlaneDialog({ onClose }: { onClose: () => void }) {
  const sketches = useCADStore((s) => s.sketches);
  const redefineSketchPlane = useCADStore((s) => s.redefineSketchPlane);

  const [sketchId, setSketchId] = useState(sketches[0]?.id ?? '');
  const [plane, setPlane] = useState<'XY' | 'XZ' | 'YZ' | 'custom'>('XY');
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [offsetZ, setOffsetZ] = useState(0);

  const handleApply = () => {
    const normal = new THREE.Vector3(0, 0, 1);
    const origin = new THREE.Vector3(offsetX, offsetY, offsetZ);
    if (plane === 'XY') { normal.set(0, 0, 1); }
    else if (plane === 'XZ') { normal.set(0, 1, 0); }
    else if (plane === 'YZ') { normal.set(1, 0, 0); }
    redefineSketchPlane(sketchId, plane, normal, origin);
    onClose();
  };

  if (sketches.length === 0) {
    return (
      <DialogShell title="Redefine Sketch Plane" onClose={onClose} size="sm" cancelLabel="Close">
        <p className="dialog-hint">No sketches available to redefine.</p>
      </DialogShell>
    );
  }

  return (
    <DialogShell title="Redefine Sketch Plane" onClose={onClose} size="sm" onConfirm={handleApply} confirmDisabled={!sketchId}>
      <div className="form-group">
        <label>Sketch</label>
        <select value={sketchId} onChange={(e) => setSketchId(e.target.value)}>
          {sketches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label>New Plane</label>
        <select value={plane} onChange={(e) => setPlane(e.target.value as typeof plane)}>
          <option value="XY">XY Plane</option>
          <option value="XZ">XZ Plane</option>
          <option value="YZ">YZ Plane</option>
        </select>
      </div>
      <div className="form-group">
        <label>Origin Offset</label>
      </div>
      <div className="settings-grid">
        <div className="form-group">
          <label>X (mm)</label>
          <input type="number" value={offsetX} onChange={(e) => setOffsetX(parseFloat(e.target.value) || 0)} step={1} />
        </div>
        <div className="form-group">
          <label>Y (mm)</label>
          <input type="number" value={offsetY} onChange={(e) => setOffsetY(parseFloat(e.target.value) || 0)} step={1} />
        </div>
        <div className="form-group">
          <label>Z (mm)</label>
          <input type="number" value={offsetZ} onChange={(e) => setOffsetZ(parseFloat(e.target.value) || 0)} step={1} />
        </div>
      </div>
      <p className="dialog-hint">Redefines the reference plane for the selected sketch. All geometry remains unchanged; only the coordinate system is updated.</p>
    </DialogShell>
  );
}
