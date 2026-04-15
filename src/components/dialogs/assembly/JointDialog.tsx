import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import * as THREE from 'three';

export function JointDialog({ onClose }: { onClose: () => void }) {
  const [jointType, setJointType] = useState('rigid');
  const [name, setName] = useState('Joint 1');
  const [rotMin, setRotMin] = useState(-180);
  const [rotMax, setRotMax] = useState(180);
  const [transMin, setTransMin] = useState(0);
  const [transMax, setTransMax] = useState(50);
  const [originX, setOriginX] = useState(0);
  const [originY, setOriginY] = useState(0);
  const [originZ, setOriginZ] = useState(0);

  const addJoint = useComponentStore((s) => s.addJoint);
  const components = useComponentStore((s) => s.components);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const componentList = Object.values(components);

  const [componentId1, setComponentId1] = useState(activeComponentId);
  const [componentId2, setComponentId2] = useState(activeComponentId);

  const hasRotationLimits = ['revolute', 'cylindrical'].includes(jointType);
  const hasTranslationLimits = ['slider', 'cylindrical', 'pin-slot'].includes(jointType);

  const handleApply = () => {
    addJoint({
      name,
      type: jointType as any,
      componentId1,
      componentId2,
      origin: new THREE.Vector3(originX, originY, originZ),
      axis: new THREE.Vector3(0, 1, 0),
      rotationLimits: hasRotationLimits ? { min: rotMin, max: rotMax } : undefined,
      translationLimits: hasTranslationLimits ? { min: transMin, max: transMax } : undefined,
      rotationValue: 0,
      translationValue: 0,
      locked: false,
    });

    setStatusMessage(`Created ${jointType} joint: ${name}`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <h3>Joint</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Component 1</label>
            <select value={componentId1} onChange={(e) => setComponentId1(e.target.value)}>
              {componentList.length === 0
                ? <option value="">— no components —</option>
                : componentList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
              }
            </select>
          </div>
          <div className="form-group">
            <label>Component 2</label>
            <select value={componentId2} onChange={(e) => setComponentId2(e.target.value)}>
              {componentList.length === 0
                ? <option value="">— no components —</option>
                : componentList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
              }
            </select>
          </div>
          <div className="form-group">
            <label>Joint Type</label>
            <select value={jointType} onChange={(e) => setJointType(e.target.value)}>
              <option value="rigid">Rigid</option>
              <option value="revolute">Revolute (Rotation)</option>
              <option value="slider">Slider (Translation)</option>
              <option value="cylindrical">Cylindrical</option>
              <option value="pin-slot">Pin-Slot</option>
              <option value="planar">Planar</option>
              <option value="ball">Ball</option>
            </select>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Origin X (mm)</label>
              <input type="number" value={originX} onChange={(e) => setOriginX(parseFloat(e.target.value) || 0)} step={1} />
            </div>
            <div className="form-group">
              <label>Origin Y (mm)</label>
              <input type="number" value={originY} onChange={(e) => setOriginY(parseFloat(e.target.value) || 0)} step={1} />
            </div>
            <div className="form-group">
              <label>Origin Z (mm)</label>
              <input type="number" value={originZ} onChange={(e) => setOriginZ(parseFloat(e.target.value) || 0)} step={1} />
            </div>
          </div>
          {hasRotationLimits && (
            <div className="settings-grid">
              <div className="form-group">
                <label>Rotation Min (deg)</label>
                <input type="number" value={rotMin} onChange={(e) => setRotMin(parseFloat(e.target.value) || -180)} />
              </div>
              <div className="form-group">
                <label>Rotation Max (deg)</label>
                <input type="number" value={rotMax} onChange={(e) => setRotMax(parseFloat(e.target.value) || 180)} />
              </div>
            </div>
          )}
          {hasTranslationLimits && (
            <div className="settings-grid">
              <div className="form-group">
                <label>Translation Min (mm)</label>
                <input type="number" value={transMin} onChange={(e) => setTransMin(parseFloat(e.target.value) || 0)} />
              </div>
              <div className="form-group">
                <label>Translation Max (mm)</label>
                <input type="number" value={transMax} onChange={(e) => setTransMax(parseFloat(e.target.value) || 50)} />
              </div>
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}
