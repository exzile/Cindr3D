import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../store/cadStore';
import { useComponentStore } from '../store/componentStore';
import type { Feature, BooleanOperation } from '../types/cad';
import * as THREE from 'three';

// ===== Shell Dialog =====
export function ShellDialog({ onClose }: { onClose: () => void }) {
  const [thickness, setThickness] = useState(2);
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Shell (${thickness}mm)`,
      type: 'shell',
      params: { thickness, removeFaces: '' },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created shell with ${thickness}mm thickness`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Shell</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Inside Thickness (mm)</label>
            <input type="number" value={thickness} onChange={(e) => setThickness(parseFloat(e.target.value) || 2)} step={0.5} min={0.1} />
          </div>
          <p className="dialog-hint">Select faces to remove after clicking OK, or leave empty to shell all faces.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Linear Pattern Dialog =====
export function LinearPatternDialog({ onClose }: { onClose: () => void }) {
  const [count, setCount] = useState(3);
  const [spacing, setSpacing] = useState(20);
  const [directionX, setDirectionX] = useState(1);
  const [directionY, setDirectionY] = useState(0);
  const [directionZ, setDirectionZ] = useState(0);
  const [useSecond, setUseSecond] = useState(false);
  const [count2, setCount2] = useState(2);
  const [spacing2, setSpacing2] = useState(20);

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Linear Pattern (${count}x)`,
      type: 'linear-pattern',
      params: {
        count,
        spacing,
        directionX, directionY, directionZ,
        useSecondDirection: useSecond,
        count2: useSecond ? count2 : 1,
        spacing2: useSecond ? spacing2 : 0,
      },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created linear pattern: ${count} instances`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <h3>Linear Pattern</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="settings-grid">
            <div className="form-group">
              <label>Count</label>
              <input type="number" value={count} onChange={(e) => setCount(parseInt(e.target.value) || 2)} min={2} max={100} />
            </div>
            <div className="form-group">
              <label>Spacing (mm)</label>
              <input type="number" value={spacing} onChange={(e) => setSpacing(parseFloat(e.target.value) || 10)} step={1} />
            </div>
          </div>
          <div className="form-group">
            <label>Direction (X, Y, Z)</label>
            <div className="direction-inputs">
              <input type="number" value={directionX} onChange={(e) => setDirectionX(parseFloat(e.target.value) || 0)} step={0.1} />
              <input type="number" value={directionY} onChange={(e) => setDirectionY(parseFloat(e.target.value) || 0)} step={0.1} />
              <input type="number" value={directionZ} onChange={(e) => setDirectionZ(parseFloat(e.target.value) || 0)} step={0.1} />
            </div>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={useSecond} onChange={(e) => setUseSecond(e.target.checked)} />
            Second Direction
          </label>
          {useSecond && (
            <div className="settings-grid">
              <div className="form-group">
                <label>Count 2</label>
                <input type="number" value={count2} onChange={(e) => setCount2(parseInt(e.target.value) || 2)} min={2} />
              </div>
              <div className="form-group">
                <label>Spacing 2 (mm)</label>
                <input type="number" value={spacing2} onChange={(e) => setSpacing2(parseFloat(e.target.value) || 10)} />
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

// ===== Circular Pattern Dialog =====
export function CircularPatternDialog({ onClose }: { onClose: () => void }) {
  const [count, setCount] = useState(6);
  const [totalAngle, setTotalAngle] = useState(360);
  const [symmetric, setSymmetric] = useState(false);

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Circular Pattern (${count}x)`,
      type: 'circular-pattern',
      params: { count, totalAngle, symmetric },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created circular pattern: ${count} instances`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Circular Pattern</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="settings-grid">
            <div className="form-group">
              <label>Count</label>
              <input type="number" value={count} onChange={(e) => setCount(parseInt(e.target.value) || 2)} min={2} max={100} />
            </div>
            <div className="form-group">
              <label>Total Angle (deg)</label>
              <input type="number" value={totalAngle} onChange={(e) => setTotalAngle(parseFloat(e.target.value) || 360)} min={1} max={360} />
            </div>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={symmetric} onChange={(e) => setSymmetric(e.target.checked)} />
            Symmetric
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

// ===== Mirror Dialog =====
export function MirrorDialog({ onClose }: { onClose: () => void }) {
  const [mirrorPlane, setMirrorPlane] = useState('XY');

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Mirror (${mirrorPlane})`,
      type: 'mirror',
      params: { mirrorPlane },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created mirror on ${mirrorPlane} plane`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Mirror</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Mirror Plane</label>
            <select value={mirrorPlane} onChange={(e) => setMirrorPlane(e.target.value)}>
              <option value="XY">XY Plane</option>
              <option value="XZ">XZ Plane</option>
              <option value="YZ">YZ Plane</option>
            </select>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Combine (Boolean) Dialog =====
export function CombineDialog({ onClose }: { onClose: () => void }) {
  const [operation, setOperation] = useState<BooleanOperation>('join');

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Combine (${operation})`,
      type: 'combine',
      params: { operation },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created ${operation} operation`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Combine Bodies</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as BooleanOperation)}>
              <option value="join">Join (Union)</option>
              <option value="cut">Cut (Subtract)</option>
              <option value="intersect">Intersect</option>
            </select>
          </div>
          <div className="boolean-preview">
            <div className="boolean-diagram">
              {operation === 'join' && <div className="bool-icon join">A + B</div>}
              {operation === 'cut' && <div className="bool-icon cut">A - B</div>}
              {operation === 'intersect' && <div className="bool-icon intersect">A &cap; B</div>}
            </div>
          </div>
          <p className="dialog-hint">Select a target body and a tool body in the viewport.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Hole Dialog =====
export function HoleDialog({ onClose }: { onClose: () => void }) {
  const [holeType, setHoleType] = useState<'simple' | 'counterbore' | 'countersink'>('simple');
  const [diameter, setDiameter] = useState(5);
  const [depth, setDepth] = useState(10);
  const [through, setThrough] = useState(false);
  const [cbDiameter, setCbDiameter] = useState(10);
  const [cbDepth, setCbDepth] = useState(3);
  const [csAngle, setCsAngle] = useState(90);

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Hole (${diameter}mm)`,
      type: 'hole',
      params: {
        holeType, diameter, depth, through,
        cbDiameter, cbDepth, csAngle,
      },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created ${holeType} hole: ${diameter}mm`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <h3>Hole</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Hole Type</label>
            <select value={holeType} onChange={(e) => setHoleType(e.target.value as any)}>
              <option value="simple">Simple</option>
              <option value="counterbore">Counterbore</option>
              <option value="countersink">Countersink</option>
            </select>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Diameter (mm)</label>
              <input type="number" value={diameter} onChange={(e) => setDiameter(parseFloat(e.target.value) || 5)} step={0.5} min={0.1} />
            </div>
            <div className="form-group">
              <label>Depth (mm)</label>
              <input type="number" value={depth} onChange={(e) => setDepth(parseFloat(e.target.value) || 10)} disabled={through} />
            </div>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={through} onChange={(e) => setThrough(e.target.checked)} />
            Through All
          </label>
          {holeType === 'counterbore' && (
            <div className="settings-grid">
              <div className="form-group">
                <label>CB Diameter (mm)</label>
                <input type="number" value={cbDiameter} onChange={(e) => setCbDiameter(parseFloat(e.target.value) || 10)} />
              </div>
              <div className="form-group">
                <label>CB Depth (mm)</label>
                <input type="number" value={cbDepth} onChange={(e) => setCbDepth(parseFloat(e.target.value) || 3)} />
              </div>
            </div>
          )}
          {holeType === 'countersink' && (
            <div className="form-group">
              <label>CS Angle (deg)</label>
              <input type="number" value={csAngle} onChange={(e) => setCsAngle(parseFloat(e.target.value) || 90)} min={60} max={120} />
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

// ===== Construction Plane Dialog =====
export function ConstructionPlaneDialog({ onClose }: { onClose: () => void }) {
  const [method, setMethod] = useState('offset');
  const [distance, setDistance] = useState(10);
  const [referencePlane, setReferencePlane] = useState('XY');
  const [angle, setAngle] = useState(45);

  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const addConstruction = useComponentStore((s) => s.addConstruction);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    let normal = new THREE.Vector3(0, 0, 1);
    let origin = new THREE.Vector3(0, 0, 0);
    let name = 'Plane';

    if (method === 'offset') {
      switch (referencePlane) {
        case 'XY': normal.set(0, 0, 1); origin.set(0, 0, distance); break;
        case 'XZ': normal.set(0, 1, 0); origin.set(0, distance, 0); break;
        case 'YZ': normal.set(1, 0, 0); origin.set(distance, 0, 0); break;
      }
      name = `Offset Plane (${referencePlane} + ${distance}mm)`;
    } else if (method === 'angle') {
      const rad = (angle * Math.PI) / 180;
      switch (referencePlane) {
        case 'XY': normal.set(0, Math.sin(rad), Math.cos(rad)); break;
        case 'XZ': normal.set(Math.sin(rad), Math.cos(rad), 0); break;
        case 'YZ': normal.set(Math.cos(rad), 0, Math.sin(rad)); break;
      }
      name = `Angled Plane (${angle}deg from ${referencePlane})`;
    } else if (method === 'midplane') {
      origin.set(0, 0, distance / 2);
      name = 'Midplane';
    }

    addConstruction({
      name,
      type: 'plane',
      componentId: activeComponentId,
      visible: true,
      planeNormal: normal,
      planeOrigin: origin,
      planeSize: 50,
      definition: method === 'offset'
        ? { method: 'offset-plane', referencePlane, distance }
        : method === 'angle'
        ? { method: 'angle-plane', referencePlane, angle, axis: 'x' }
        : { method: 'midplane', plane1: 'XY', plane2: 'XY' },
    });

    setStatusMessage(`Created construction plane: ${name}`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <h3>Construction Plane</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="offset">Offset Plane</option>
              <option value="angle">Plane at Angle</option>
              <option value="midplane">Midplane</option>
            </select>
          </div>
          <div className="form-group">
            <label>Reference Plane</label>
            <select value={referencePlane} onChange={(e) => setReferencePlane(e.target.value)}>
              <option value="XY">XY Plane</option>
              <option value="XZ">XZ Plane</option>
              <option value="YZ">YZ Plane</option>
            </select>
          </div>
          {method === 'offset' && (
            <div className="form-group">
              <label>Offset Distance (mm)</label>
              <input type="number" value={distance} onChange={(e) => setDistance(parseFloat(e.target.value) || 0)} step={1} />
            </div>
          )}
          {method === 'angle' && (
            <div className="form-group">
              <label>Angle (degrees)</label>
              <input type="number" value={angle} onChange={(e) => setAngle(parseFloat(e.target.value) || 0)} min={-180} max={180} step={5} />
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

// ===== Joint Dialog =====
export function JointDialog({ onClose }: { onClose: () => void }) {
  const [jointType, setJointType] = useState('rigid');
  const [name, setName] = useState('Joint 1');
  const [rotMin, setRotMin] = useState(-180);
  const [rotMax, setRotMax] = useState(180);
  const [transMin, setTransMin] = useState(0);
  const [transMax, setTransMax] = useState(50);

  const addJoint = useComponentStore((s) => s.addJoint);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    addJoint({
      name,
      type: jointType as any,
      componentId1: activeComponentId,
      componentId2: activeComponentId, // placeholder
      origin: new THREE.Vector3(0, 0, 0),
      axis: new THREE.Vector3(0, 1, 0),
      rotationLimits: ['revolute', 'cylindrical'].includes(jointType)
        ? { min: rotMin, max: rotMax } : undefined,
      translationLimits: ['slider', 'cylindrical', 'pin-slot'].includes(jointType)
        ? { min: transMin, max: transMax } : undefined,
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
          {['revolute', 'cylindrical'].includes(jointType) && (
            <div className="settings-grid">
              <div className="form-group">
                <label>Rotation Min (deg)</label>
                <input type="number" value={rotMin} onChange={(e) => setRotMin(parseFloat(e.target.value))} />
              </div>
              <div className="form-group">
                <label>Rotation Max (deg)</label>
                <input type="number" value={rotMax} onChange={(e) => setRotMax(parseFloat(e.target.value))} />
              </div>
            </div>
          )}
          {['slider', 'cylindrical', 'pin-slot'].includes(jointType) && (
            <div className="settings-grid">
              <div className="form-group">
                <label>Translation Min (mm)</label>
                <input type="number" value={transMin} onChange={(e) => setTransMin(parseFloat(e.target.value))} />
              </div>
              <div className="form-group">
                <label>Translation Max (mm)</label>
                <input type="number" value={transMax} onChange={(e) => setTransMax(parseFloat(e.target.value))} />
              </div>
            </div>
          )}
          <p className="dialog-hint">Select two components to connect with this joint.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}
