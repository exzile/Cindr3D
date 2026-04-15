/**
 * ConstructThreePlanePanel — D191: Point Through Three Planes
 *
 * Shows when activeTool === 'construct-point-three-planes'. Lists construction
 * planes by name; user picks three to compute their intersection point via
 * Cramer's rule on the 3×3 system [n1; n2; n3] · P = [d1; d2; d3].
 */

import { useState } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../store/cadStore';
import type { ConstructionPlane } from '../../types/cad';

// Module-level scratch
const _n1 = new THREE.Vector3();
const _n2 = new THREE.Vector3();
const _n3 = new THREE.Vector3();

/**
 * Solve 3×3 linear system A·x = b using Cramer's rule.
 * A rows are the plane normals; b[i] = normal_i · origin_i (d values).
 * Returns null if determinant is near zero (planes don't meet at a point).
 */
function solveThreePlaneIntersection(
  p1: ConstructionPlane,
  p2: ConstructionPlane,
  p3: ConstructionPlane,
): [number, number, number] | null {
  _n1.fromArray(p1.normal);
  _n2.fromArray(p2.normal);
  _n3.fromArray(p3.normal);

  // d_i = normal_i · origin_i  (plane eq: n·P = d)
  const o1 = new THREE.Vector3().fromArray(p1.origin);
  const o2 = new THREE.Vector3().fromArray(p2.origin);
  const o3 = new THREE.Vector3().fromArray(p3.origin);
  const d1 = _n1.dot(o1);
  const d2 = _n2.dot(o2);
  const d3 = _n3.dot(o3);

  // Matrix rows: [n1x n1y n1z; n2x n2y n2z; n3x n3y n3z]
  const [a00, a01, a02] = [_n1.x, _n1.y, _n1.z];
  const [a10, a11, a12] = [_n2.x, _n2.y, _n2.z];
  const [a20, a21, a22] = [_n3.x, _n3.y, _n3.z];

  // det(A)
  const det =
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20);

  if (Math.abs(det) < 1e-10) return null;

  // Cramer's rule
  const detX =
    d1 * (a11 * a22 - a12 * a21) -
    a01 * (d2 * a22 - a12 * d3) +
    a02 * (d2 * a21 - a11 * d3);

  const detY =
    a00 * (d2 * a22 - a12 * d3) -
    d1 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * d3 - d2 * a20);

  const detZ =
    a00 * (a11 * d3 - d2 * a21) -
    a01 * (a10 * d3 - d2 * a20) +
    d1 * (a10 * a21 - a11 * a20);

  return [detX / det, detY / det, detZ / det];
}

export default function ConstructThreePlanePanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const constructionPlanes = useCADStore((s) => s.constructionPlanes);
  const addConstructionPoint = useCADStore((s) => s.addConstructionPoint);
  const cancelConstructTool = useCADStore((s) => s.cancelConstructTool);

  const [selected, setSelected] = useState<string[]>([]);

  if (activeTool !== 'construct-point-three-planes') return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return [prev[1], prev[2], id];
      return [...prev, id];
    });
  };

  const handleCreate = () => {
    if (selected.length !== 3) return;
    const p1 = constructionPlanes.find((p) => p.id === selected[0]);
    const p2 = constructionPlanes.find((p) => p.id === selected[1]);
    const p3 = constructionPlanes.find((p) => p.id === selected[2]);
    if (!p1 || !p2 || !p3) return;
    const result = solveThreePlaneIntersection(p1, p2, p3);
    if (!result) return;
    addConstructionPoint({ position: result });
    setSelected([]);
    cancelConstructTool();
  };

  return (
    <div style={{
      position: 'absolute', top: 16, right: 16, width: 220,
      background: 'var(--color-panel, #1e1e2e)', border: '1px solid var(--color-border, #444)',
      borderRadius: 6, padding: '10px 12px', color: 'var(--color-text, #cdd6f4)',
      fontSize: 12, zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Point Through Three Planes</div>
      <div style={{ marginBottom: 6, opacity: 0.7 }}>
        Select 3 construction planes ({selected.length}/3):
      </div>
      {constructionPlanes.length === 0 && (
        <div style={{ opacity: 0.5 }}>No construction planes in scene.</div>
      )}
      {constructionPlanes.map((p) => (
        <div
          key={p.id}
          onClick={() => toggle(p.id)}
          style={{
            padding: '4px 8px', marginBottom: 2, borderRadius: 4, cursor: 'pointer',
            background: selected.includes(p.id) ? 'var(--color-accent, #89b4fa33)' : 'transparent',
            border: selected.includes(p.id) ? '1px solid var(--color-accent, #89b4fa)' : '1px solid transparent',
          }}
        >
          {p.name}
        </div>
      ))}
      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        <button
          onClick={handleCreate}
          disabled={selected.length !== 3}
          style={{
            flex: 1, padding: '4px 0', borderRadius: 4, cursor: selected.length === 3 ? 'pointer' : 'default',
            background: selected.length === 3 ? 'var(--color-accent, #89b4fa)' : '#444',
            color: selected.length === 3 ? '#1e1e2e' : '#888', border: 'none', fontWeight: 600,
          }}
        >
          Create
        </button>
        <button
          onClick={() => { setSelected([]); cancelConstructTool(); }}
          style={{
            padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
            background: 'transparent', color: 'var(--color-text, #cdd6f4)',
            border: '1px solid var(--color-border, #444)',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
