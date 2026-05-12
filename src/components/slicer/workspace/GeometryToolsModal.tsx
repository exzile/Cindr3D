import { useState } from 'react';
import { useAsyncAction } from '../../../hooks/useAsyncAction';
import { X } from 'lucide-react';
import { useSlicerStore } from '../../../store/slicerStore';
import './GeometryToolsModal.css';

export type GeometryTool = 'hollow' | 'cut' | 'scale-to-size';

export function GeometryToolsModal({
  tool,
  objectId,
  onClose,
}: {
  tool: GeometryTool;
  objectId: string;
  onClose: () => void;
}) {
  const obj = useSlicerStore((s) => s.plateObjects.find((o) => o.id === objectId));
  const hollow = useSlicerStore((s) => s.hollowPlateObject);
  const cut = useSlicerStore((s) => s.cutPlateObjectByPlane);
  const scaleToHeight = useSlicerStore((s) => s.scaleToHeight);

  const [wallThickness, setWallThickness] = useState(2);
  const [cutAxis, setCutAxis] = useState<'x' | 'y' | 'z'>('z');
  const [cutOffset, setCutOffset] = useState(() => {
    if (!obj) return 0;
    const center = (obj.boundingBox.min.z + obj.boundingBox.max.z) / 2;
    return center;
  });
  const [targetHeight, setTargetHeight] = useState(() => {
    if (!obj) return 50;
    return obj.boundingBox.max.z - obj.boundingBox.min.z;
  });
  const [busy, setBusy] = useState(false);
  const run = useAsyncAction(setBusy);

  if (!obj) return null;

  const apply = () => run(async () => {
    if (tool === 'hollow') {
      await hollow(objectId, wallThickness);
    } else if (tool === 'cut') {
      const normal = cutAxis === 'x' ? { x: 1, y: 0, z: 0 }
        : cutAxis === 'y' ? { x: 0, y: 1, z: 0 }
        : { x: 0, y: 0, z: 1 };
      const point = { x: 0, y: 0, z: 0 };
      if (cutAxis === 'x') point.x = cutOffset;
      else if (cutAxis === 'y') point.y = cutOffset;
      else point.z = cutOffset;
      await cut(objectId, point, normal);
    } else {
      scaleToHeight(objectId, targetHeight);
    }
    onClose();
  });

  const titles: Record<GeometryTool, string> = {
    hollow: 'Hollow Object',
    cut: 'Cut by Plane',
    'scale-to-size': 'Scale to Size',
  };

  return (
    <div className="geom-tools-modal__backdrop" onClick={onClose}>
      <div className="geom-tools-modal" onClick={(e) => e.stopPropagation()}>
        <div className="geom-tools-modal__header">
          <span>{titles[tool]} — {obj.name}</span>
          <button type="button" onClick={onClose} className="geom-tools-modal__close" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="geom-tools-modal__body">
          {tool === 'hollow' && (
            <>
              <label>
                Wall thickness (mm)
                <input
                  type="number"
                  min={0.4}
                  step={0.1}
                  value={wallThickness}
                  onChange={(e) => setWallThickness(parseFloat(e.target.value) || 0)}
                />
              </label>
              <p className="geom-tools-modal__note">
                Hollow shells the part by subtracting an inset copy. Wall
                thickness varies for non-uniform shapes; use 1.6–3 mm for
                rigid PLA prints. Slow on dense meshes.
              </p>
            </>
          )}
          {tool === 'cut' && (
            <>
              <label>
                Plane axis
                <select value={cutAxis} onChange={(e) => setCutAxis(e.target.value as 'x' | 'y' | 'z')}>
                  <option value="x">X (vertical, splits left/right)</option>
                  <option value="y">Y (vertical, splits front/back)</option>
                  <option value="z">Z (horizontal, splits top/bottom)</option>
                </select>
              </label>
              <label>
                Offset along axis (object-local mm)
                <input
                  type="number"
                  step={0.5}
                  value={cutOffset}
                  onChange={(e) => setCutOffset(parseFloat(e.target.value) || 0)}
                />
              </label>
            </>
          )}
          {tool === 'scale-to-size' && (
            <>
              <label>
                Target height (mm)
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={targetHeight}
                  onChange={(e) => setTargetHeight(parseFloat(e.target.value) || 0)}
                />
              </label>
              <p className="geom-tools-modal__note">
                Scales uniformly so the object's Z extent matches this
                value. The object is dropped to the bed afterwards.
              </p>
            </>
          )}
        </div>
        <div className="geom-tools-modal__footer">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="is-primary" onClick={apply} disabled={busy}>
            {busy ? 'Working…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
