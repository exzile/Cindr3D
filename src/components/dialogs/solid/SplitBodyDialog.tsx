import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function SplitBodyDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitSplitBody = useCADStore((s) => s.commitSplitBody);

  // Exclude sketch and construction geometry — only solid/surface features
  // can be split. Note: 'construction-point' is not in the FeatureType union
  // so it must not be compared here.
  const solidFeatures = features.filter(
    (f) =>
      f.type !== 'sketch' &&
      f.type !== 'construction-plane' &&
      f.type !== 'construction-axis',
  );

  const [bodyFeatureId, setBodyFeatureId] = useState(solidFeatures[0]?.id ?? '');
  const [toolType, setToolType] = useState<'plane' | 'sketch' | 'face'>('plane');
  const [toolId, setToolId] = useState('XY');
  const [planeOffset, setPlaneOffset] = useState(0);

  const handleApply = () => {
    if (!bodyFeatureId) return;
    // isSplittingToolExtended is reserved for future implementation (plane
    // clamping to body bbox). Hardcode true until the engine supports it.
    commitSplitBody({ bodyFeatureId, toolType, toolId, planeOffset, isSplittingToolExtended: true });
    onClose();
  };

  return (
    <DialogShell title="Split Body" onClose={onClose} size="sm" onConfirm={handleApply}>
      <div className="form-group">
        <label>Body to Split</label>
        <select value={bodyFeatureId} onChange={(e) => setBodyFeatureId(e.target.value)}>
          {solidFeatures.length === 0
            ? <option value="">— no bodies —</option>
            : solidFeatures.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)
          }
        </select>
      </div>
      <div className="form-group">
        <label>Splitting Tool Type</label>
        <select value={toolType} onChange={(e) => setToolType(e.target.value as 'plane' | 'sketch' | 'face')}>
          <option value="plane">Plane</option>
          <option value="sketch">Sketch</option>
          <option value="face">Face</option>
        </select>
      </div>
      <div className="form-group">
        <label>Tool Identifier</label>
        <input
          type="text"
          value={toolId}
          onChange={(e) => setToolId(e.target.value)}
          placeholder={toolType === 'plane' ? 'XY / XZ / YZ' : 'Sketch or face name'}
        />
      </div>
      <div className="form-group">
        <label>Plane Offset</label>
        <input
          type="number"
          step={0.5}
          value={planeOffset}
          onChange={(e) => setPlaneOffset(parseFloat(e.target.value) || 0)}
        />
      </div>
    </DialogShell>
  );
}
