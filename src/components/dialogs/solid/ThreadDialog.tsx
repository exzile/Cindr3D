import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import type { Feature } from '../../../types/cad';
import { THREAD_SIZES, findThreadSize } from './ThreadSizePresets';
import type { ThreadStandard } from './ThreadSizePresets';
import '../FeatureDialogExtras.css';

export function ThreadDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId  = useCADStore((s) => s.editingFeatureId);
  const features          = useCADStore((s) => s.features);
  const editing           = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p                 = editing?.params ?? {};

  const [threadType, setThreadType] = useState<'cosmetic' | 'modeled'>((p.threadType as 'cosmetic' | 'modeled') ?? 'cosmetic');
  const [standard, setStandard]     = useState<ThreadStandard>((p.standard as ThreadStandard) ?? 'iso-metric');
  const [designation, setDesignation] = useState(String(p.designation ?? 'M6x1.0'));
  const [threadClass, setThreadClass] = useState(String(p.threadClass ?? '6H'));
  const [diameter, setDiameter]     = useState(Number(p.diameter ?? 6));
  const [pitch, setPitch]           = useState(Number(p.pitch ?? 1.0));
  const [length, setLength]         = useState(Number(p.length ?? 15));
  const [offset, setOffset]         = useState(Number(p.offset ?? 0));
  const [fullLength, setFullLength] = useState(p.fullLength !== false && !!p.fullLength);
  const [direction, setDirection]   = useState<'right-hand' | 'left-hand'>((p.direction as 'right-hand' | 'left-hand') ?? 'right-hand');

  const addFeature         = useCADStore((s) => s.addFeature);
  const commitThread       = useCADStore((s) => s.commitThread);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage   = useCADStore((s) => s.setStatusMessage);

  const designations = THREAD_SIZES[standard].map((e) => e.designation);

  // SOL-I9: auto-populate diameter, pitch, and class when standard changes
  const handleStandardChange = (next: ThreadStandard) => {
    setStandard(next);
    const sizes = THREAD_SIZES[next];
    if (sizes.length > 0) {
      const first = sizes[0];
      setDesignation(first.designation);
      setDiameter(parseFloat(first.diameter.toFixed(3)));
      setPitch(parseFloat(first.pitch.toFixed(4)));
      setThreadClass(first.defaultClass);
    }
  };

  // SOL-I9: auto-populate from designation lookup
  const handleDesignationChange = (des: string) => {
    setDesignation(des);
    const entry = findThreadSize(standard, des);
    if (entry) {
      setDiameter(parseFloat(entry.diameter.toFixed(3)));
      setPitch(parseFloat(entry.pitch.toFixed(4)));
      setThreadClass(entry.defaultClass);
    }
  };

  // SOL-I9: validate pitch — must be positive and smaller than diameter
  const pitchError = pitch <= 0 ? 'Pitch must be > 0'
    : pitch >= diameter ? 'Pitch must be less than diameter'
    : null;

  const canApply = !pitchError && diameter > 0 && length > 0;

  const handleApply = () => {
    if (!canApply) return;
    const params = {
      threadType, standard, designation, threadClass,
      diameter, pitch, length, offset, fullLength, direction,
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
      if (threadType === 'cosmetic') {
        commitThread(feature.id, diameter / 2, pitch, fullLength ? length : length);
      }
      setStatusMessage(`Created ${threadType} thread: ${designation}`);
    }
    onClose();
  };

  return (
    <DialogShell title={editing ? 'Edit Thread' : 'Thread'} onClose={onClose} size="sm" onConfirm={handleApply} confirmDisabled={!canApply}>
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
              <select value={standard} onChange={(e) => handleStandardChange(e.target.value as ThreadStandard)}>
                <option value="iso-metric">ISO Metric</option>
                <option value="ansi-unified">ANSI Unified</option>
                <option value="npt">NPT</option>
              </select>
            </div>
            <div className="form-group">
              <label>Designation</label>
              <select value={designation} onChange={(e) => handleDesignationChange(e.target.value)}>
                {designations.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div className="settings-grid">
            <div className="form-group">
              <label>Class</label>
              <input
                type="text"
                value={threadClass}
                onChange={(e) => setThreadClass(e.target.value)}
                placeholder="e.g. 6H"
              />
            </div>
            <div className="form-group">
              <label>Diameter (mm)</label>
              <input
                type="number"
                value={diameter}
                onChange={(e) => setDiameter(Math.max(0.1, parseFloat(e.target.value) || 6))}
                step={0.5}
                min={0.1}
              />
            </div>
          </div>

          <div className="settings-grid">
            <div className="form-group">
              <label>Pitch (mm)</label>
              <input
                type="number"
                value={pitch}
                onChange={(e) => setPitch(Math.max(0.01, parseFloat(e.target.value) || 1))}
                step={0.05}
                min={0.01}
              />
            </div>
            <div className="form-group">
              <label>Length (mm)</label>
              <input
                type="number"
                value={length}
                onChange={(e) => setLength(Math.max(0.1, parseFloat(e.target.value) || 15))}
                disabled={fullLength}
                step={0.5}
                min={0.1}
              />
            </div>
          </div>

          {pitchError && (
            <div className="dialog-hint dialog-hint--error">{pitchError}</div>
          )}

          <div className="settings-grid">
            <div className="form-group">
              <label>Offset (mm)</label>
              <input
                type="number"
                value={offset}
                onChange={(e) => setOffset(parseFloat(e.target.value) || 0)}
                step={0.5}
              />
            </div>
          </div>

          <label className="checkbox-label">
            <input type="checkbox" checked={fullLength} onChange={(e) => setFullLength(e.target.checked)} />
            Full Length
          </label>
    </DialogShell>
  );
}
