import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Applies a horizontal clipping plane at `z` to the Three.js renderer.
 * Everything above the plane (point_z > z) is discarded. This clips all
 * scene geometry uniformly — no per-material changes needed.
 */
export function SectionPlaneController({
  enabled,
  z,
}: {
  enabled: boolean;
  z: number;
}) {
  const { gl } = useThree();
  useEffect(() => {
    if (enabled) {
      // Plane equation: normal·point + constant ≥ 0 → shows point_z ≤ z.
      gl.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, -1), z)];
    } else {
      gl.clippingPlanes = [];
    }
    return () => { gl.clippingPlanes = []; };
  }, [gl, enabled, z]);
  return null;
}
