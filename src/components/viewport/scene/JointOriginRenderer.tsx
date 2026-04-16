/**
 * JointOriginRenderer — renders all persisted JointOriginRecords from the store
 * as small axis-triad indicators (same 3-axis style as JointOriginPicker).
 */

import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import type { JointOriginRecord } from '../../../types/cad';

// ── Module-level material singletons ─────────────────────────────────────────
const MAT_X = new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: false });
const MAT_Y = new THREE.LineBasicMaterial({ color: 0x22ff22, depthTest: false });
const MAT_Z = new THREE.LineBasicMaterial({ color: 0x2222ff, depthTest: false });

const AXIS_LEN = 15;

// ── Per-origin triad ──────────────────────────────────────────────────────────

function JointOriginTriad({ origin }: { origin: JointOriginRecord }) {
  const { geoX, geoY, geoZ } = useMemo(() => {
    const [ox, oy, oz] = origin.position;
    const x = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ox, oy, oz),
      new THREE.Vector3(ox + AXIS_LEN, oy, oz),
    ]);
    const y = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ox, oy, oz),
      new THREE.Vector3(ox, oy + AXIS_LEN, oz),
    ]);
    const z = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ox, oy, oz),
      new THREE.Vector3(ox, oy, oz + AXIS_LEN),
    ]);
    return { geoX: x, geoY: y, geoZ: z };
  }, [origin.position]);

  useEffect(() => {
    return () => {
      geoX.dispose();
      geoY.dispose();
      geoZ.dispose();
    };
  }, [geoX, geoY, geoZ]);

  return (
    <>
      <lineSegments geometry={geoX} material={MAT_X} />
      <lineSegments geometry={geoY} material={MAT_Y} />
      <lineSegments geometry={geoZ} material={MAT_Z} />
    </>
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
