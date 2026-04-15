import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function StitchDialog({ onClose }: { onClose: () => void }) {
  const commitStitch = useCADStore((s) => s.commitStitch);
  const features = useCADStore((s) => s.features);

  // Surface bodies available for stitching
  const surfaceBodies = features.filter(
    (f) => f.bodyKind === 'surface' && f.visible && f.mesh,
  );

  const [selectedIds, setSelectedIds] = useState<string[]>(
    surfaceBodies.map((f) => f.id),
  );
  const [tolerance, setTolerance] = useState(0.01);
  const [closeOpenEdges, setCloseOpenEdges] = useState(false);
  const [keepOriginal, setKeepOriginal] = useState(false);

  const toggleId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleOK = () => {
    commitStitch({ sourceFeatureIds: selectedIds, tolerance, closeOpenEdges, keepOriginal });
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Stitch</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Surface Bodies</label>
            {surfaceBodies.length === 0 ? (
              <p className="dialog-hint">No surface bodies found. Create a surface first.</p>
            ) : (
              <div className="body-list">
                {surfaceBodies.map((f) => (
                  <label key={f.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(f.id)}
                      onChange={() => toggleId(f.id)}
                    />
                    {f.name}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Tolerance (mm)</label>
            <input
              type="number"
              value={tolerance}
              onChange={(e) => setTolerance(parseFloat(e.target.value) || 0.01)}
              step={0.001}
              min={0.0001}
            />
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={closeOpenEdges}
              onChange={(e) => setCloseOpenEdges(e.target.checked)}
            />
            Close Open Edges (no-op)
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={keepOriginal}
              onChange={(e) => setKeepOriginal(e.target.checked)}
            />
            Keep Original Surfaces
          </label>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleOK}
            disabled={selectedIds.length < 1}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
