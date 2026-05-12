import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function MeshReverseNormalDialog({ onClose }: { onClose: () => void }) {
  const commitReverseNormal = useCADStore((s) => s.commitReverseNormal);
  const selectedFeatureId = useCADStore((s) => s.selectedFeatureId);
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);
  const [mode, setMode] = useState<'All Faces' | 'Selected Faces'>('All Faces');
  const [invertAll, setInvertAll] = useState(false);

  const handleOK = () => {
    if (selectedFeatureId) {
      commitReverseNormal(selectedFeatureId);
    } else {
      // Fallback: record as a feature stub when no mesh is selected
      const n = features.filter((f) => f.name.startsWith('Reverse Normal')).length + 1;
      addFeature({
        id: crypto.randomUUID(),
        name: `Reverse Normal ${n}`,
        type: 'import',
        params: { isMeshReverseNormal: true, mode, invertAll },
        bodyKind: 'mesh',
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      });
    }
    onClose();
  };

  return (
    <DialogShell title="Mesh Reverse Normal" onClose={onClose} onConfirm={handleOK}>
      <div className="form-group">
        <label>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="All Faces">All Faces</option>
          <option value="Selected Faces">Selected Faces</option>
        </select>
      </div>
      <div className="form-group form-group-inline">
        <label>Invert All</label>
        <input
          type="checkbox"
          checked={invertAll}
          onChange={(e) => setInvertAll(e.target.checked)}
        />
      </div>
      <p className="dialog-hint">Flips the normals on the selected mesh faces.</p>
    </DialogShell>
  );
}
