import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';

type ThreadStandard = 'iso-metric' | 'ansi-unified' | 'npt';

export function ThreadDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const [threadType, setThreadType] = useState<'cosmetic' | 'modeled'>((p.threadType as 'cosmetic' | 'modeled') ?? 'cosmetic');
  const [standard, setStandard] = useState<ThreadStandard>((p.standard as ThreadStandard) ?? 'iso-metric');
  const [designation, setDesignation] = useState(String(p.designation ?? 'M6x1.0'));
  const [threadClass, setThreadClass] = useState(String(p.threadClass ?? '6H'));
  const [diameter, setDiameter] = useState(Number(p.diameter ?? 6));
  const [length, setLength] = useState(Number(p.length ?? 15));
  const [offset, setOffset] = useState(Number(p.offset ?? 0));
  const [fullLength, setFullLength] = useState(p.fullLength !== false && !!p.fullLength);
  const [direction, setDirection] = useState<'right-hand' | 'left-hand'>((p.direction as 'right-hand' | 'left-hand') ?? 'right-hand');

  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const ISO_DESIGNATIONS = ['M3x0.5', 'M4x0.7', 'M5x0.8', 'M6x1.0', 'M8x1.25', 'M10x1.5', 'M12x1.75', 'M16x2.0', 'M20x2.5', 'M24x3.0'];
  const ANSI_DESIGNATIONS = ['1/4-20', '5/16-18', '3/8-16', '7/16-14', '1/2-13', '5/8-11', '3/4-10', '7/8-9', '1-8'];
  const NPT_DESIGNATIONS = ['1/8 NPT', '1/4 NPT', '3/8 NPT', '1/2 NPT', '3/4 NPT', '1 NPT'];
  const designations = standard === 'iso-metric' ? ISO_DESIGNATIONS : standard === 'ansi-unified' ? ANSI_DESIGNATIONS : NPT_DESIGNATIONS;

  const handleApply = () => {
    const params = {
      threadType, standard, designation, threadClass,
      diameter, length, offset, fullLength,
      direction,
    };
    if (editing) {
      updateFeatureParams(editing.id, params);
      setStatusMessage(`Updated ${threadType} thread: ${designation}`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Thread (${designation}, ${direction === 'left-hand' ? 'LH' : 'RH'})`,
        type: 'thread',
        params,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Created ${threadType} thread: ${designation}`);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Thread' : 'Thread'}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="settings-grid">
            <div className="form-group">
              <label>Type</label>
              <select value={threadType} onChange={(e) => setThreadType(e.target.value as 'cosmetic' | 'modeled')}>
                <option value="cosmetic">Cosmetic</option>
                <option value="modeled">Modeled</option>
              </select>
            </div>
            <div className="form-group">
              <label>Direction</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value as 'right-hand' | 'left-hand')}>
                <option value="right-hand">Right Hand</option>
                <option value="left-hand">Left Hand</option>
              </select>
            </div>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Standard</label>
              <select value={standard} onChange={(e) => { setStandard(e.target.value as ThreadStandard); setDesignation(''); }}>
                <option value="iso-metric">ISO Metric</option>
                <option value="ansi-unified">ANSI Unified</option>
                <option value="npt">NPT</option>
              </select>
            </div>
            <div className="form-group">
              <label>Designation</label>
              <select value={designation} onChange={(e) => setDesignation(e.target.value)}>
                {designations.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Class</label>
              <input type="text" value={threadClass} onChange={(e) => setThreadClass(e.target.value)} placeholder="e.g. 6H" />
            </div>
            <div className="form-group">
              <label>Diameter (mm)</label>
              <input type="number" value={diameter} onChange={(e) => setDiameter(Math.max(0.1, parseFloat(e.target.value) || 6))} step={0.5} min={0.1} />
            </div>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Length (mm)</label>
              <input type="number" value={length} onChange={(e) => setLength(Math.max(0.1, parseFloat(e.target.value) || 15))} disabled={fullLength} step={0.5} min={0.1} />
            </div>
            <div className="form-group">
              <label>Offset (mm)</label>
              <input type="number" value={offset} onChange={(e) => setOffset(parseFloat(e.target.value) || 0)} step={0.5} />
            </div>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={fullLength} onChange={(e) => setFullLength(e.target.checked)} />
            Full Length
          </label>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}
