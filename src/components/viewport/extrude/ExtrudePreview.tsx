import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { ExtrudeDirection } from '../../../store/cadStore';
import { useCADStore } from '../../../store/cadStore';
import type { Sketch } from '../../../types/cad';
import { PREVIEW_MATERIAL, PREVIEW_MATERIAL_CUT, PREVIEW_EDGE_MATERIAL, PREVIEW_EDGE_MATERIAL_CUT, PREVIEW_EDGE_XRAY_MATERIAL, PREVIEW_EDGE_XRAY_MATERIAL_CUT } from './materials';

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

  const { mesh, edges, xrayEdges } = useMemo(() => {
    if (absDistance < 0.001) return { mesh: null, edges: null, xrayEdges: null };
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
    if (!m) return { mesh: null, edges: null, xrayEdges: null };
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
      // Two-sides bakes a CSG union into world-space geometry and the returned
      // mesh has identity position/quaternion/scale — so the edges LineSegments
      // is also intentionally NOT transformed. Do not "fix" by copying m's
      // transform; that would shift the edges to the wrong place.
      const edgeGeom = new THREE.EdgesGeometry(m.geometry, 30);
      edgeMesh = new THREE.LineSegments(
        edgeGeom,
        isCut ? PREVIEW_EDGE_MATERIAL_CUT : PREVIEW_EDGE_MATERIAL,
      );
      edgeMesh.renderOrder = 1;
    }

    // X-ray pass — separate geometry that includes sparse spine lines so circular
    // and arc profiles show connecting lines through body surfaces (depthTest:false).
    let xrayMesh: THREE.LineSegments | null = null;
    if (effectiveDirection !== 'two-sides') {
      const xrayGeom = GeometryEngine.buildExtrudeXRayEdges(sketch, absDistance);
      if (xrayGeom) {
        xrayMesh = new THREE.LineSegments(
          xrayGeom,
          isCut ? PREVIEW_EDGE_XRAY_MATERIAL_CUT : PREVIEW_EDGE_XRAY_MATERIAL,
        );
        xrayMesh.position.copy(m.position);
        xrayMesh.quaternion.copy(m.quaternion);
        xrayMesh.scale.copy(m.scale);
        xrayMesh.renderOrder = 3;
      }
    } else if (edgeMesh) {
      // two-sides: reuse the EdgesGeometry already built for edgeMesh (same geometry,
      // no extra alloc needed — disposed via edges below).
      xrayMesh = new THREE.LineSegments(
        edgeMesh.geometry,
        isCut ? PREVIEW_EDGE_XRAY_MATERIAL_CUT : PREVIEW_EDGE_XRAY_MATERIAL,
      );
      xrayMesh.renderOrder = 3;
    }

    return { mesh: m, edges: edgeMesh, xrayEdges: xrayMesh };
  }, [sketch, absDistance, effectiveDirection, taperAngle, taperAngle2, effectiveOffset, distance2, isCut]);

  useEffect(() => {
    return () => {
      mesh?.geometry.dispose();
      edges?.geometry.dispose();
      // For the two-sides path, xrayEdges.geometry === edges.geometry (shared) — skip.
      // For all other paths, xrayEdges has its own geometry from buildExtrudeXRayEdges.
      if (xrayEdges && xrayEdges.geometry !== edges?.geometry) {
        xrayEdges.geometry.dispose();
      }
    };
  }, [mesh, edges, xrayEdges]);

  useEffect(() => {
    return () => {
      mesh?.geometry.dispose();
      edges?.geometry.dispose();
      // For the two-sides path, xrayEdges.geometry === edges.geometry (shared) — skip.
      // For all other paths, xrayEdges has its own geometry from buildExtrudeXRayEdges.
      if (xrayEdges && xrayEdges.geometry !== edges?.geometry) {
        xrayEdges.geometry.dispose();
      }
    };
  }, [mesh, edges, xrayEdges]);

  if (!mesh) return null;
  return (
    <group>
      <primitive object={mesh} />
      {edges && <primitive object={edges} />}
      {xrayEdges && <primitive object={xrayEdges} />}
    </group>
  );
}
