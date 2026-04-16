/**
 * JointOriginPicker — active when activeDialog === 'joint-origin'.
 * Uses useVertexPicker to capture the placement position, then renders
 * a small coordinate-frame triad at the picked point.
 */

import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useVertexPicker } from '../../../hooks/useVertexPicker';

// ── Module-level material singletons ─────────────────────────────────────────
const MAT_X = new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: false });
const MAT_Y = new THREE.LineBasicMaterial({ color: 0x22ff22, depthTest: false });
const MAT_Z = new THREE.LineBasicMaterial({ color: 0x2222ff, depthTest: false });

const AXIS_LEN = 15;

// ── Triad helper ──────────────────────────────────────────────────────────────

interface TriadProps {
  position: [number, number, number];
}

function AxisTriad({ position }: TriadProps) {
  const { geoX, geoY, geoZ } = useMemo(() => {
    const px = position;
    const x = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(px[0], px[1], px[2]),
      new THREE.Vector3(px[0] + AXIS_LEN, px[1], px[2]),
    ]);
    const y = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(px[0], px[1], px[2]),
      new THREE.Vector3(px[0], px[1] + AXIS_LEN, px[2]),
    ]);
    const z = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(px[0], px[1], px[2]),
      new THREE.Vector3(px[0], px[1], px[2] + AXIS_LEN),
    ]);
    return { geoX: x, geoY: y, geoZ: z };
  }, [position]);

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

// ── Main component ────────────────────────────────────────────────────────────

export default function JointOriginPicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const pickedPoint = useCADStore((s) => s.jointOriginPickedPoint);
  const setJointOriginPoint = useCADStore((s) => s.setJointOriginPoint);

  const enabled = activeDialog === 'joint-origin';

  useVertexPicker({
    enabled,
    onClick: (result) => {
      const p = result.position.toArray() as [number, number, number];
      setJointOriginPoint(p);
    },
  });

  if (!enabled || !pickedPoint) return null;

  return <AxisTriad position={pickedPoint} />;
}
