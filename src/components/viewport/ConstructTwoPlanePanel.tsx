/**
 * ConstructTwoPlanePanel — D190: Axis Through Two Planes
 *
 * Shows when activeTool === 'construct-axis-two-planes'. Lists construction
 * planes by name; user picks two to compute their intersection axis.
 */

import { useState } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../store/cadStore';
import type { ConstructionPlane } from '../../types/cad';
import './ConstructPanel.css';

// Module-level scratch — no per-render allocation
const _n1 = new THREE.Vector3();
const _n2 = new THREE.Vector3();
const _axis = new THREE.Vector3();

function computeIntersectionAxis(
  p1: ConstructionPlane,
  p2: ConstructionPlane,
): { origin: [number, number, number]; direction: [number, number, number] } | null {
  _n1.fromArray(p1.normal);
  _n2.fromArray(p2.normal);
  _axis.crossVectors(_n1, _n2);
  const lenSq = _axis.lengthSq();
  if (lenSq < 1e-10) return null; // parallel planes

  _axis.normalize();

  // Find a point on both planes via the formula:
  //   P = ((d2*(n1×n2)×n1) - (d1*(n1×n2)×n2)) / |n1×n2|²
  const d1 = -(_n1.dot(new THREE.Vector3().fromArray(p1.origin)));
  const d2 = -(_n2.dot(new THREE.Vector3().fromArray(p2.origin)));

  const axisXn1 = new THREE.Vector3().crossVectors(_axis, _n1);
  const axisXn2 = new THREE.Vector3().crossVectors(_axis, _n2);
  // origin = (axisXn1 * (-d1) - axisXn2 * (-d2)) / lenSq ... using plane eq: n·P + d = 0 → d = -n·O
  // Standard formula: P = (d2 * (n1×n2)×n1 - d1 * (n1×n2)×n2) / |n1×n2|²  where di = -ni·Oi
  const origin = new THREE.Vector3()
    .addScaledVector(axisXn1, -d2)
    .addScaledVector(axisXn2, d1)
    .divideScalar(lenSq);

  return {
    origin: origin.toArray() as [number, number, number],
    direction: _axis.toArray() as [number, number, number],
  };
}

export default function ConstructTwoPlanePanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const constructionPlanes = useCADStore((s) => s.constructionPlanes);
  const addConstructionAxis = useCADStore((s) => s.addConstructionAxis);
  const cancelConstructTool = useCADStore((s) => s.cancelConstructTool);

  const [selected, setSelected] = useState<string[]>([]);

  if (activeTool !== 'construct-axis-two-planes') return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const handleCreate = () => {
    if (selected.length !== 2) return;
    const p1 = constructionPlanes.find((p) => p.id === selected[0]);
    const p2 = constructionPlanes.find((p) => p.id === selected[1]);
    if (!p1 || !p2) return;
    const result = computeIntersectionAxis(p1, p2);
    if (!result) return;
    addConstructionAxis({ origin: result.origin, direction: result.direction, length: 20 });
    setSelected([]);
    cancelConstructTool();
  };

  return (
    <div className="construct-panel">
      <div className="construct-panel__title">Axis Through Two Planes</div>
      <div className="construct-panel__hint">
        Select 2 construction planes ({selected.length}/2):
      </div>
      {constructionPlanes.length === 0 && (
        <div className="construct-panel__empty">No construction planes in scene.</div>
      )}
      {constructionPlanes.map((p) => (
        <div
          key={p.id}
          onClick={() => toggle(p.id)}
          className={`construct-panel__item${selected.includes(p.id) ? ' construct-panel__item--selected' : ''}`}
        >
          {p.name}
        </div>
      ))}
      <div className="construct-panel__footer">
        <button
          onClick={handleCreate}
          disabled={selected.length !== 2}
          className="construct-panel__btn-create"
        >
          Create
        </button>
        <button
          onClick={() => { setSelected([]); cancelConstructTool(); }}
          className="construct-panel__btn-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
