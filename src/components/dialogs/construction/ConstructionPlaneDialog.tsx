import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import type { ConstructionDefinition } from '../../../types/cad';
import * as THREE from 'three';

/** SDK-10: All supported plane definition methods */
type PlaneMethod = 'offset' | 'angle' | 'midplane' | 'through-point' | 'three-points' | 'normal-to-curve';

function Vec3Input({ label, value, onChange }: {
  label: string;
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
}) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <div key={axis} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <span style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>{axis}</span>
            <input
              type="number"
              step={1}
              value={value[i]}
              onChange={(e) => {
                const v = parseFloat(e.target.value) || 0;
                const next = [...value] as [number, number, number];
                next[i] = v;
                onChange(next);
              }}
              style={{ width: '100%' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ConstructionPlaneDialog({ onClose, initialMethod }: { onClose: () => void; initialMethod?: string }) {
  const [method, setMethod] = useState<PlaneMethod>((initialMethod as PlaneMethod) ?? 'offset');
  const [distance, setDistance] = useState(10);
  const [referencePlane, setReferencePlane] = useState('XY');
  const [angle, setAngle] = useState(45);
  // SDK-10: through-point method
  const [throughPoint, setThroughPoint] = useState<[number, number, number]>([0, 0, 0]);
  // SDK-10: three-points method
  const [pt1, setPt1] = useState<[number, number, number]>([0, 0, 0]);
  const [pt2, setPt2] = useState<[number, number, number]>([100, 0, 0]);
  const [pt3, setPt3] = useState<[number, number, number]>([0, 100, 0]);
  // SDK-10: normal-to-curve — specify origin + direction
  const [curveOrigin, setCurveOrigin] = useState<[number, number, number]>([0, 0, 0]);
  const [curveDir, setCurveDir] = useState<[number, number, number]>([0, 1, 0]);

  const activeComponentId = useComponentStore((s) => s.activeComponentId ?? s.rootComponentId);
  const addConstruction = useComponentStore((s) => s.addConstruction);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const normal = new THREE.Vector3(0, 0, 1);
    const origin = new THREE.Vector3(0, 0, 0);
    let name = 'Plane';
    let definition: ConstructionDefinition = { method: 'offset-plane', referencePlane, distance };

    if (method === 'offset') {
      switch (referencePlane) {
        case 'XY': normal.set(0, 0, 1); origin.set(0, 0, distance); break;
        case 'XZ': normal.set(0, 1, 0); origin.set(0, distance, 0); break;
        case 'YZ': normal.set(1, 0, 0); origin.set(distance, 0, 0); break;
      }
      name = `Offset Plane (${referencePlane} + ${distance}mm)`;
      definition = { method: 'offset-plane', referencePlane, distance };
    } else if (method === 'angle') {
      const rad = (angle * Math.PI) / 180;
      switch (referencePlane) {
        case 'XY': normal.set(0, Math.sin(rad), Math.cos(rad)); break;
        case 'XZ': normal.set(Math.sin(rad), Math.cos(rad), 0); break;
        case 'YZ': normal.set(Math.cos(rad), 0, Math.sin(rad)); break;
      }
      name = `Angled Plane (${angle}° from ${referencePlane})`;
      definition = { method: 'angle-plane', referencePlane, angle, axis: 'x' };
    } else if (method === 'midplane') {
      origin.set(0, 0, distance / 2);
      name = 'Midplane';
      definition = { method: 'midplane', plane1: 'XY', plane2: 'XY' };
    } else if (method === 'through-point') {
      // Plane passes through the point, normal from selected reference plane
      switch (referencePlane) {
        case 'XY': normal.set(0, 0, 1); break;
        case 'XZ': normal.set(0, 1, 0); break;
        case 'YZ': normal.set(1, 0, 0); break;
      }
      origin.set(...throughPoint);
      name = `Plane Through Point (${throughPoint.join(', ')})`;
      definition = { method: 'through-point', point: throughPoint, referencePlane };
    } else if (method === 'three-points') {
      // Compute normal from three points using cross product
      const v1 = new THREE.Vector3(...pt2).sub(new THREE.Vector3(...pt1));
      const v2 = new THREE.Vector3(...pt3).sub(new THREE.Vector3(...pt1));
      normal.crossVectors(v1, v2).normalize();
      if (normal.lengthSq() < 0.001) {
        setStatusMessage('Three Points: points must not be collinear');
        return;
      }
      origin.set(...pt1);
      name = `Plane (3 Points)`;
      definition = { method: 'three-points', pt1, pt2, pt3 };
    } else if (method === 'normal-to-curve') {
      // Plane perpendicular to a curve direction at origin
      const dir = new THREE.Vector3(...curveDir).normalize();
      if (dir.lengthSq() < 0.001) {
        setStatusMessage('Normal to Curve: direction must be non-zero');
        return;
      }
      normal.copy(dir);
      origin.set(...curveOrigin);
      name = `Normal-to-Curve Plane`;
      definition = { method: 'normal-to-curve', origin: curveOrigin, direction: curveDir };
    }

    addConstruction({
      name,
      type: 'plane',
      componentId: activeComponentId,
      visible: true,
      planeNormal: normal,
      planeOrigin: origin,
      planeSize: 50,
      definition,
    });

    setStatusMessage(`Created construction plane: ${name}`);
    onClose();
  };

  const needsRefPlane = method === 'offset' || method === 'angle' || method === 'through-point';

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
            <select value={method} onChange={(e) => setMethod(e.target.value as PlaneMethod)}>
              <option value="offset">Offset Plane</option>
              <option value="angle">Plane at Angle</option>
              <option value="midplane">Midplane</option>
              <option value="through-point">Through Point</option>
              <option value="three-points">Three Points</option>
              <option value="normal-to-curve">Normal to Curve Direction</option>
            </select>
          </div>

          {needsRefPlane && (
            <div className="form-group">
              <label>Reference Plane</label>
              <select value={referencePlane} onChange={(e) => setReferencePlane(e.target.value)}>
                <option value="XY">XY Plane</option>
                <option value="XZ">XZ Plane</option>
                <option value="YZ">YZ Plane</option>
              </select>
            </div>
          )}

          {method === 'offset' && (
            <div className="form-group">
              <label>Offset Distance (mm)</label>
              <input type="number" value={distance} onChange={(e) => setDistance(parseFloat(e.target.value) || 0)} step={1} />
            </div>
          )}

          {method === 'angle' && (
            <div className="form-group">
              <label>Angle (°)</label>
              <input type="number" value={angle} onChange={(e) => setAngle(parseFloat(e.target.value) || 0)} min={-180} max={180} step={5} />
            </div>
          )}

          {method === 'through-point' && (
            <Vec3Input label="Point" value={throughPoint} onChange={setThroughPoint} />
          )}

          {method === 'three-points' && (
            <>
              <Vec3Input label="Point 1" value={pt1} onChange={setPt1} />
              <Vec3Input label="Point 2" value={pt2} onChange={setPt2} />
              <Vec3Input label="Point 3" value={pt3} onChange={setPt3} />
            </>
          )}

          {method === 'normal-to-curve' && (
            <>
              <Vec3Input label="Origin" value={curveOrigin} onChange={setCurveOrigin} />
              <Vec3Input label="Curve Direction" value={curveDir} onChange={setCurveDir} />
            </>
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
