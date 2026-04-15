/**
 * S7: Visual indicator for the active 3D sketch draw-plane override.
 *
 * Rendered when sketch3DMode is true AND sketch3DActivePlane is set.
 * Shows a small semi-transparent orange plane at the active draw origin
 * so the user can see which plane subsequent entities will land on.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../store/cadStore';

export default function Sketch3DPlaneIndicator() {
  const sketch3DMode = useCADStore((s) => s.sketch3DMode);
  const sketch3DActivePlane = useCADStore((s) => s.sketch3DActivePlane);

  const derived = useMemo(() => {
    if (!sketch3DActivePlane) return null;
    const n = new THREE.Vector3(...sketch3DActivePlane.normal).normalize();
    const o = new THREE.Vector3(...sketch3DActivePlane.origin);

    // Build a quaternion that rotates the XY plane onto the active plane
    // by finding an up vector that is not collinear with n
    const up = Math.abs(n.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const t1 = new THREE.Vector3().crossVectors(up, n).normalize();
    const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
    const m4 = new THREE.Matrix4().makeBasis(t1, t2, n);
    const quat = new THREE.Quaternion().setFromRotationMatrix(m4);

    return { origin: o, quat };
  }, [sketch3DActivePlane]);

  if (!sketch3DMode || !derived) return null;

  const { origin, quat } = derived;

  return (
    <group renderOrder={600}>
      {/* Semi-transparent orange fill */}
      <mesh position={origin} quaternion={quat} renderOrder={15}>
        <planeGeometry args={[12, 12]} />
        <meshBasicMaterial
          color="#f97316"
          transparent
          opacity={0.13}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Orange wireframe border */}
      <mesh position={origin} quaternion={quat} renderOrder={16}>
        <planeGeometry args={[12, 12]} />
        <meshBasicMaterial
          color="#f97316"
          transparent
          opacity={0.4}
          wireframe
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
