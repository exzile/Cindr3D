import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

type MeshPrimitiveKind = 'Box' | 'Sphere' | 'Cylinder' | 'Torus';

export function MeshPrimitivesDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);
  const [kind, setKind] = useState<MeshPrimitiveKind>('Box');
  const [size, setSize] = useState(20);

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith(`Mesh ${kind}`)).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Mesh ${kind} ${n}`,
      type: 'primitive',
      params: { kind, size, isMesh: true },
      bodyKind: 'mesh',
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    });
    onClose();
  };

  return (
    <DialogShell title="Mesh Primitives" onClose={onClose} onConfirm={handleOK}>
      <div className="form-group">
        <label>Kind</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as MeshPrimitiveKind)}>
          <option value="Box">Box</option>
          <option value="Sphere">Sphere</option>
          <option value="Cylinder">Cylinder</option>
          <option value="Torus">Torus</option>
        </select>
      </div>
      <div className="form-group">
        <label>Size (mm)</label>
        <input
          type="number"
          min={0.1}
          value={size}
          onChange={(e) => setSize(parseFloat(e.target.value) || 20)}
        />
      </div>
      <p className="dialog-hint">Creates a mesh body primitive (not a solid).</p>
    </DialogShell>
  );
}
