import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { disposeGeometries } from '../../../utils/threeDisposal';
import { FACE_HIGHLIGHT_FILL, FACE_HIGHLIGHT_OUTLINE } from './materials';

/** Renders a translucent fill + outline over a coplanar boundary loop. */
export default function FaceHighlight({ boundary }: { boundary: THREE.Vector3[] }) {
  // Build a flat polygon in WORLD space directly from the boundary points.
  // We don't project to plane-local coords — that just adds bugs. The mesh
  // is rendered in world space with depthTest disabled so it always shows on
  // top of the underlying body face.
  const { fillGeom, outlineGeom } = useMemo(() => {
    if (boundary.length < 3) return { fillGeom: null, outlineGeom: null };

    // Triangulate the boundary as a fan (works for convex faces — cube faces
    // are always convex). For non-convex faces this would fail, but they're
    // out of scope for v1.
    const positions: number[] = [];
    const indices: number[] = [];
    for (const p of boundary) positions.push(p.x, p.y, p.z);
    for (let i = 1; i < boundary.length - 1; i++) {
      indices.push(0, i, i + 1);
    }
    const fillGeom = new THREE.BufferGeometry();
    fillGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    fillGeom.setIndex(indices);
    fillGeom.computeVertexNormals();

    // Outline: closed line loop visiting each boundary point in order
    const outlinePositions: number[] = [];
    for (const p of boundary) outlinePositions.push(p.x, p.y, p.z);
    const outlineGeom = new THREE.BufferGeometry();
    outlineGeom.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));

    return { fillGeom, outlineGeom };
  }, [boundary]);

  useEffect(() => {
    return () => disposeGeometries(fillGeom, outlineGeom);
  }, [fillGeom, outlineGeom]);

  if (!fillGeom || !outlineGeom) return null;

  return (
    <group renderOrder={2000}>
      <mesh geometry={fillGeom} material={FACE_HIGHLIGHT_FILL} renderOrder={2000} />
      <lineLoop geometry={outlineGeom} material={FACE_HIGHLIGHT_OUTLINE} renderOrder={2001} />
    </group>
  );
}
