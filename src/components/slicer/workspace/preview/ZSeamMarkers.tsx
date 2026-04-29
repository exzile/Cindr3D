// Z-seam visualization — render a small dot at every wall-outer chain
// start point on the current layer. Verifies that
// `zSeamPosition: aligned/sharpest/shortest` is doing what the user
// expects without scrubbing through the G-code.

import { useMemo } from 'react';
import * as THREE from 'three';
import { Z_SEAM_THREE_COLOR } from './constants';

interface ZSeamMarkersProps {
  points: Array<{ x: number; y: number }>;
  z: number;
}

const MARKER_RADIUS_MM = 0.35;
const MARKER_SEGMENTS = 12;

const SEAM_GEOMETRY = new THREE.SphereGeometry(MARKER_RADIUS_MM, MARKER_SEGMENTS, MARKER_SEGMENTS);
SEAM_GEOMETRY.userData.shared = true;
const SEAM_MATERIAL = new THREE.MeshBasicMaterial({ color: Z_SEAM_THREE_COLOR });
SEAM_MATERIAL.userData.shared = true;

export function ZSeamMarkers({ points, z }: ZSeamMarkersProps) {
  // Build a single instanced mesh — much cheaper than N <mesh> elements
  // when a layer has 50+ wall rings (e.g. dense honeycomb infill in a
  // top/bottom layer).
  const instancedMesh = useMemo(() => {
    const m = new THREE.InstancedMesh(SEAM_GEOMETRY, SEAM_MATERIAL, points.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < points.length; i++) {
      dummy.position.set(points[i].x, points[i].y, z + 0.05);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    return m;
  }, [points, z]);

  // Dispose only the instanced mesh's instance buffer; geometry/material
  // are module-level shared singletons.
  return <primitive object={instancedMesh} />;
}
