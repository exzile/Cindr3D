/**
 * JointOriginRenderer — renders all persisted JointOriginRecords from the store
 * as small axis-triad indicators (same 3-axis style as JointOriginPicker).
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import type { JointOriginRecord } from '../../../types/cad';

// ── Module-level material singletons ─────────────────────────────────────────
const MAT_X = new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: false });
const MAT_Y = new THREE.LineBasicMaterial({ color: 0x22ff22, depthTest: false });
const MAT_Z = new THREE.LineBasicMaterial({ color: 0x2222ff, depthTest: false });

const AXIS_LEN = 15;

/**
 * AUDIT-18: Module-level geometry singletons for the joint origin triad axes.
 * Each is a unit-length line from the origin (0,0,0) along its respective axis.
 * All JointOriginTriad instances share these geometries — position is applied via
 * the `position` prop on the containing group. Do NOT dispose these geometries.
 */
const GEO_X = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(AXIS_LEN, 0, 0),
]);
const GEO_Y = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, AXIS_LEN, 0),
]);
const GEO_Z = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, AXIS_LEN),
]);

// ── Per-origin triad ──────────────────────────────────────────────────────────

function JointOriginTriad({ origin }: { origin: JointOriginRecord }) {
  // AUDIT-18: position the shared unit-axis geometries via a group transform
  // instead of baking world coordinates into per-instance geometries.
  const position = useMemo(
    () => new THREE.Vector3(...origin.position),
    [origin.position],
  );

  return (
    <group position={position}>
      <lineSegments geometry={GEO_X} material={MAT_X} />
      <lineSegments geometry={GEO_Y} material={MAT_Y} />
      <lineSegments geometry={GEO_Z} material={MAT_Z} />
    </group>
  );
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export default function JointOriginRenderer() {
  const jointOrigins = useCADStore((s) => s.jointOrigins);

  const items = useMemo(() => jointOrigins, [jointOrigins]);

  return (
    <>
      {items.map((origin) => (
        <JointOriginTriad key={origin.id} origin={origin} />
      ))}
    </>
  );
}
