import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function MeshCombineDialog({ onClose }: { onClose: () => void }) {
  const commitMeshCombine = useCADStore((s) => s.commitMeshCombine);
  const selectedFeatureId = useCADStore((s) => s.selectedFeatureId);
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);
  const [operation, setOperation] = useState<'Union' | 'Subtract' | 'Intersect'>('Union');
  const [toolBody, setToolBody] = useState('');
  const [keepTool, setKeepTool] = useState(false);

  const handleOK = () => {
    if (selectedFeatureId && toolBody) {
      commitMeshCombine([selectedFeatureId, toolBody]);
    } else {
      // Fallback stub when bodies not selected
      const n = features.filter((f) => f.name.startsWith('Mesh Combine')).length + 1;
      addFeature({
        id: crypto.randomUUID(),
        name: `Mesh Combine ${n}`,
        type: 'import',
        params: { isMeshCombine: true, operation, toolBody, keepTool },
        bodyKind: 'mesh',
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      });
    }
    onClose();
  };

  return (
    <DialogShell title="Mesh Combine" onClose={onClose} onConfirm={handleOK}>
          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as typeof operation)}>
              <option value="Union">Union</option>
              <option value="Subtract">Subtract</option>
              <option value="Intersect">Intersect</option>
            </select>
          </div>
          <div className="form-group">
            <label>Tool Body</label>
            <input
              type="text"
              placeholder="Select mesh body"
              value={toolBody}
              onChange={(e) => setToolBody(e.target.value)}
            />
          </div>
          <div className="form-group form-group-inline">
            <label>Keep Tool Body</label>
            <input
              type="checkbox"
              checked={keepTool}
              onChange={(e) => setKeepTool(e.target.checked)}
            />
          </div>
          <p className="dialog-hint">Performs a boolean operation between two mesh bodies.</p>
    </DialogShell>
  );
}
