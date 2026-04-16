import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';

export default function IncrementSettingsPanel({ onClose }: { onClose: () => void }) {
  void onClose;
  const moveIncrement = useCADStore((s) => s.moveIncrement);
  const setMoveIncrement = useCADStore((s) => s.setMoveIncrement);
  const rotateIncrement = useCADStore((s) => s.rotateIncrement);
  const setRotateIncrement = useCADStore((s) => s.setRotateIncrement);

  const [localMove, setLocalMove] = useState(String(moveIncrement));
  const [localRotate, setLocalRotate] = useState(String(rotateIncrement));

  const applyMove = () => {
    const val = parseFloat(localMove);
    if (!isNaN(val) && val > 0) setMoveIncrement(val);
  };

  const applyRotate = () => {
    const val = parseFloat(localRotate);
    if (!isNaN(val) && val > 0) setRotateIncrement(val);
  };

  return (
    <div className="cc-panel">
      <div className="cc-panel-title">Set Increments</div>
      <div className="cc-panel-section">
        <div className="cc-panel-field">
          <label className="cc-panel-field-label">Move</label>
          <div className="cc-panel-field-input-wrap">
            <input
              type="number"
              className="cc-panel-field-input"
              value={localMove}
              onChange={(e) => setLocalMove(e.target.value)}
              onBlur={applyMove}
              onKeyDown={(e) => { if (e.key === 'Enter') applyMove(); }}
              min={0.01}
              step={0.5}
            />
            <span className="cc-panel-field-unit">mm</span>
          </div>
        </div>
        <div className="cc-panel-field">
          <label className="cc-panel-field-label">Rotate</label>
          <div className="cc-panel-field-input-wrap">
            <input
              type="number"
              className="cc-panel-field-input"
              value={localRotate}
              onChange={(e) => setLocalRotate(e.target.value)}
              onBlur={applyRotate}
              onKeyDown={(e) => { if (e.key === 'Enter') applyRotate(); }}
              min={1}
              step={5}
            />
            <span className="cc-panel-field-unit">deg</span>
          </div>
        </div>
      </div>
    </div>
  );
}
