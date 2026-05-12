import { useState } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function SilhouetteSplitDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const commitSilhouetteSplit = useCADStore((s) => s.commitSilhouetteSplit);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const bodyFeatures = features.filter((f) => !!f.mesh);

  const storedDir = p.direction as number[] | undefined;
  const decodedDir: 'x' | 'y' | 'z' =
    storedDir && storedDir[0] === 1 ? 'x' :
    storedDir && storedDir[1] === 1 ? 'y' : 'z';

  const [selectedId, setSelectedId] = useState<string>(String(p.bodyId ?? bodyFeatures[0]?.id ?? ''));
  const [direction, setDirection] = useState<'x' | 'y' | 'z'>(decodedDir);
  const [planeOffset, setPlaneOffset] = useState(Number(p.planeOffset ?? 0));

  const getPlaneNormal = (): THREE.Vector3 => {
    switch (direction) {
      case 'x': return new THREE.Vector3(1, 0, 0);
      case 'y': return new THREE.Vector3(0, 1, 0);
      case 'z': return new THREE.Vector3(0, 0, 1);
    }
  };

  const handleApply = () => {
    if (!selectedId) {
      setStatusMessage('Split Body: no body selected');
      return;
    }
    const dirVec = direction === 'x' ? [1, 0, 0] : direction === 'y' ? [0, 1, 0] : [0, 0, 1];
    if (editing) {
      updateFeatureParams(editing.id, { bodyId: selectedId, direction: dirVec, planeOffset });
      commitSilhouetteSplit(selectedId, getPlaneNormal(), planeOffset);
      setStatusMessage(`Updated Split Body along ${direction.toUpperCase()} axis`);
    } else {
      commitSilhouetteSplit(selectedId, getPlaneNormal(), planeOffset);
      setStatusMessage(`Split Body created along ${direction.toUpperCase()} axis`);
    }
    onClose();
  };

  return (
    <DialogShell title={editing ? 'Edit Split Body' : 'Split Body'} onClose={onClose} size="sm" onConfirm={handleApply} confirmDisabled={!selectedId}>
      <div className="form-group">
        <label>Body to Split</label>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {bodyFeatures.length === 0 && <option value="">— no bodies —</option>}
          {bodyFeatures.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Split Plane Normal</label>
        <select value={direction} onChange={(e) => setDirection(e.target.value as 'x' | 'y' | 'z')}>
          <option value="x">YZ Plane (X normal)</option>
          <option value="y">XZ Plane (Y normal)</option>
          <option value="z">XY Plane (Z normal)</option>
        </select>
      </div>
      <div className="form-group">
        <label>Plane Offset</label>
        <input
          type="number"
          value={planeOffset}
          onChange={(e) => setPlaneOffset(parseFloat(e.target.value) || 0)}
          step={0.5}
        />
      </div>
      <p className="dialog-hint">Splits the body into two halves along the chosen plane. Both halves are kept as separate bodies.</p>
    </DialogShell>
  );
}
