import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import type { Feature } from '../../../types/cad';

export function SplitBodyDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const solidFeatures = features.filter((f) => f.type !== 'sketch' && f.type !== 'construction-plane' && f.type !== 'construction-axis');

  const [bodyFeatureId, setBodyFeatureId] = useState(solidFeatures[0]?.id ?? '');
  const [toolType, setToolType] = useState<'plane' | 'sketch' | 'face'>('plane');
  const [toolId, setToolId] = useState('XY');
  const [extendTool, setExtendTool] = useState(true);
  const [keepBoth, setKeepBoth] = useState(true);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Split Body (${toolType}: ${toolId})`,
      type: 'split-body',
      params: { bodyFeatureId, splitBy: toolType, toolId, extendTool, keepBoth },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Split body by ${toolType}`);
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
          <label className="checkbox-label">
            <input type="checkbox" checked={extendTool} onChange={(e) => setExtendTool(e.target.checked)} />
            Extend Tool
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={keepBoth} onChange={(e) => setKeepBoth(e.target.checked)} />
            Keep Both Sides
          </label>
    </DialogShell>
  );
}
