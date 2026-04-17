import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import type { MaterialAppearance } from '../../../types/cad';
import '../common/ToolPanel.css';
import './AppearanceDialog.css';

export function AppearanceDialog({ onClose }: { onClose: () => void }) {
  const bodies = useComponentStore((s) => s.bodies);
  const setBodyMaterial = useComponentStore((s) => s.setBodyMaterial);
  const selectedBodyId = useComponentStore((s) => s.selectedBodyId);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const bodyList = Object.values(bodies);
  const initialBody = bodyList.find((b) => b.id === selectedBodyId) ?? bodyList[0];

  const [bodyId, setBodyId] = useState(initialBody?.id ?? '');
  const [color, setColor] = useState(initialBody?.material.color ?? '#B0B8C0');
  const [opacity, setOpacity] = useState(initialBody?.material.opacity ?? 1);
  const [metalness, setMetalness] = useState(initialBody?.material.metalness ?? 0.5);
  const [roughness, setRoughness] = useState(initialBody?.material.roughness ?? 0.4);

  const handleApply = () => {
    if (!bodyId) {
      setStatusMessage('Appearance: no body selected');
      return;
    }
    const target = bodies[bodyId];
    if (!target) return;
    const material: MaterialAppearance = {
      ...target.material,
      id: 'custom',
      name: `Custom ${color}`,
      color,
      opacity,
      metalness,
      roughness,
      category: 'custom',
    };
    setBodyMaterial(bodyId, material);
    setStatusMessage(`Applied appearance to ${target.name}`);
    onClose();
  };

  return (
    <div className="appearance-overlay">
      <div className="tool-panel appearance-panel">
        <div className="tp-header">
          <div className="tp-header-icon appearance" />
          <span className="tp-header-title">APPEARANCE</span>
          <button className="tp-close" onClick={onClose} title="Cancel"><X size={14} /></button>
        </div>
        <div className="tp-body">
          <div className="tp-section">
            <div className="tp-section-title">Target</div>
            <div className="tp-row">
              <span className="tp-label">Body</span>
              <select
                className="tp-select"
                value={bodyId}
                onChange={(e) => {
                  const id = e.target.value;
                  setBodyId(id);
                  const b = bodies[id];
                  if (b) {
                    setColor(b.material.color);
                    setOpacity(b.material.opacity);
                    setMetalness(b.material.metalness);
                    setRoughness(b.material.roughness);
                  }
                }}
              >
                {bodyList.length === 0
                  ? <option value="">— no bodies —</option>
                  : bodyList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)
                }
              </select>
            </div>
          </div>

          <div className="tp-divider" />

          <div className="tp-section">
            <div className="tp-section-title">Material</div>
            <div className="tp-row">
              <span className="tp-label">Color</span>
              <input
                className="appearance-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
            <div className="tp-row">
              <span className="tp-label">Opacity</span>
              <div className="tp-input-group">
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={opacity}
                  onChange={(e) => setOpacity(Math.min(1, Math.max(0, parseFloat(e.target.value) || 1)))}
                />
              </div>
            </div>
            <div className="tp-row">
              <span className="tp-label">Metalness</span>
              <div className="tp-input-group">
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={metalness}
                  onChange={(e) => setMetalness(Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)))}
                />
              </div>
            </div>
            <div className="tp-row">
              <span className="tp-label">Roughness</span>
              <div className="tp-input-group">
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={roughness}
                  onChange={(e) => setRoughness(Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)))}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="tp-actions">
          <button className="tp-btn tp-btn-cancel" onClick={onClose}>
            <X size={13} /> Cancel
          </button>
          <button className="tp-btn tp-btn-ok" onClick={handleApply} disabled={!bodyId}>
            <Check size={13} /> OK
          </button>
        </div>
      </div>
    </div>
  );
}
