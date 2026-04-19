import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { ExtrudeDirection } from '../../../store/cadStore';
import { useCADStore } from '../../../store/cadStore';
import type { Sketch } from '../../../types/cad';
import { PREVIEW_MATERIAL, PREVIEW_MATERIAL_CUT, PREVIEW_EDGE_MATERIAL, PREVIEW_EDGE_MATERIAL_CUT } from './materials';

export default function ExtrudePreview({ sketch, distance, direction }: {
  sketch: Sketch;
  distance: number;
  direction: ExtrudeDirection;
}) {
  const operation  = useCADStore((s) => s.extrudeOperation);
  const startType  = useCADStore((s) => s.extrudeStartType);
  const startOffset = useCADStore((s) => s.extrudeStartOffset);
  const taperAngle = useCADStore((s) => s.extrudeTaperAngle);
  const taperAngle2 = useCADStore((s) => s.extrudeTaperAngle2);
  const distance2  = useCADStore((s) => s.extrudeDistance2);

  const isCut = operation === 'cut';
  const absDistance = Math.abs(distance);
  // Negative distance = user dragged in reverse direction
  const effectiveDirection: ExtrudeDirection =
    direction === 'two-sides' ? 'two-sides' : (distance < 0 ? 'negative' : direction);
  const effectiveOffset = startType === 'offset' ? startOffset : 0;

  const { mesh, edges } = useMemo(() => {
    if (absDistance < 0.001) return { mesh: null, edges: null };
    // buildExtrudeFeatureMesh handles direction shifting, offset, and taper together
    const m = GeometryEngine.buildExtrudeFeatureMesh(
      sketch,
      absDistance,
      effectiveDirection,
      taperAngle,
      effectiveOffset,
      Math.abs(distance2),
      taperAngle2,
    );
    if (!m) return { mesh: null, edges: null };
    m.material = isCut ? PREVIEW_MATERIAL_CUT : PREVIEW_MATERIAL;

    // Build shape-based edges (top/bottom cap outlines + sharp-corner verticals).
    // Going through the sketch curves instead of the mesh triangulation avoids
    // CSG-seam artifacts on the cap faces entirely. For two-sides (which bakes a
    // CSG union into world space) fall back to EdgesGeometry — that path is rare.
    let edgeMesh: THREE.LineSegments | null = null;
    if (effectiveDirection !== 'two-sides') {
      const edgeGeom = GeometryEngine.buildExtrudeFeatureEdges(sketch, absDistance);
      if (edgeGeom) {
        edgeMesh = new THREE.LineSegments(
          edgeGeom,
          isCut ? PREVIEW_EDGE_MATERIAL_CUT : PREVIEW_EDGE_MATERIAL,
        );
        // The edge geometry is in local plane space with z ∈ [0, distance] —
        // identical to the mesh's local geometry — so copy the mesh's transform
        // (which already includes direction shift + offset) verbatim.
        edgeMesh.position.copy(m.position);
        edgeMesh.quaternion.copy(m.quaternion);
        edgeMesh.scale.copy(m.scale);
        edgeMesh.renderOrder = 1;
      }
    } else {
      const edgeGeom = new THREE.EdgesGeometry(m.geometry, 30);
      edgeMesh = new THREE.LineSegments(
        edgeGeom,
        isCut ? PREVIEW_EDGE_MATERIAL_CUT : PREVIEW_EDGE_MATERIAL,
      );
      edgeMesh.renderOrder = 1;
    }

    return { mesh: m, edges: edgeMesh };
  }, [sketch, absDistance, effectiveDirection, taperAngle, taperAngle2, effectiveOffset, distance2, isCut]);

  useEffect(() => {
    return () => {
      mesh?.geometry.dispose();
      edges?.geometry.dispose();
    };
  }, [mesh, edges]);

  if (!mesh) return null;
  return (
    <group>
      <primitive object={mesh} />
      {edges && <primitive object={edges} />}
    </group>
  );
}
