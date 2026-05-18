import { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { ExtrudeDirection } from '../../../store/cadStore';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import type { Sketch } from '../../../types/cad';
import { PREVIEW_MATERIAL, PREVIEW_MATERIAL_CUT, PREVIEW_EDGE_MATERIAL, PREVIEW_EDGE_MATERIAL_CUT, PREVIEW_EDGE_XRAY_MATERIAL, PREVIEW_EDGE_XRAY_MATERIAL_CUT } from './materials';
import { bodyIdGeometryCache, liveBodyMeshes } from '../../../store/meshRegistry';
import { csgSubtract } from '../../../engine/geometryEngine/core/solid/csg';

// Same color as BODY_MATERIAL so the CSG preview looks like the committed result.
const PREVIEW_CUT_RESULT_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0xf2a23a,
  metalness: 0.0,
  roughness: 0.58,
  side: THREE.DoubleSide,
});

function restoreBodyVisibility() {
  liveBodyMeshes.forEach((m) => { m.visible = true; });
}

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

  // ── Live CSG cut preview (no useState — fully imperative to avoid hook-order issues) ──
  // When in cut mode, compute the actual post-cut geometry so the user sees
  // depth inside the hole (like Fusion 360).  CSG runs on a 200 ms debounce:
  // during drag the red solid / edges are shown; once settled, intact body
  // meshes are hidden and the CSG result is placed in csgGroupRef.
  const csgTimerRef    = useRef<number>(0);
  const csgMeshesRef   = useRef<THREE.Mesh[]>([]);
  const csgGroupRef    = useRef<THREE.Group | null>(null);
  const redGroupRef    = useRef<THREE.Group | null>(null);

  useEffect(() => {
    if (!isCut || !mesh) {
      clearTimeout(csgTimerRef.current);
      csgTimerRef.current = 0;
      // Restore: show the red solid group, clear CSG group, restore body visibility
      if (redGroupRef.current) redGroupRef.current.visible = true;
      if (csgGroupRef.current) csgGroupRef.current.clear();
      csgMeshesRef.current.forEach((m) => m.geometry.dispose());
      csgMeshesRef.current = [];
      restoreBodyVisibility();
      return;
    }

    const capturedMesh = mesh; // capture at effect time; changes with distance

    clearTimeout(csgTimerRef.current);
    csgTimerRef.current = window.setTimeout(() => {
      // Body geometry in bodyIdGeometryCache is world-space.
      // Apply the cut solid's local matrix to bring it into world space.
      const localMatrix = new THREE.Matrix4().compose(
        capturedMesh.position,
        capturedMesh.quaternion,
        capturedMesh.scale,
      );
      const cutGeomWorld = capturedMesh.geometry.clone().applyMatrix4(localMatrix);

      const bodies = useComponentStore.getState().bodies;
      const results: THREE.Mesh[] = [];

      for (const bodyId of Object.keys(bodies)) {
        const bodyGeom = bodyIdGeometryCache.get(bodyId);
        if (!bodyGeom) continue;
        let resultGeom: THREE.BufferGeometry;
        try {
          resultGeom = csgSubtract(bodyGeom.clone(), cutGeomWorld.clone());
        } catch {
          // No intersection — keep this body visible unchanged so it doesn't vanish
          resultGeom = bodyGeom.clone();
        }
        results.push(new THREE.Mesh(resultGeom, PREVIEW_CUT_RESULT_MATERIAL));
      }

      cutGeomWorld.dispose();

      // Dispose old CSG meshes
      csgMeshesRef.current.forEach((m) => m.geometry.dispose());
      csgMeshesRef.current = results;

      if (results.length > 0) {
        // Hide the intact body meshes so they don't fill in the CSG hole
        liveBodyMeshes.forEach((m) => { m.visible = false; });
        // Hide the red cut solid (CSG result shows the body with hole instead)
        if (redGroupRef.current) redGroupRef.current.visible = false;
        // Populate the CSG group imperatively — no React re-render needed
        if (csgGroupRef.current) {
          csgGroupRef.current.clear();
          results.forEach((m) => csgGroupRef.current!.add(m));
        }
      }
    }, 200);

    return () => clearTimeout(csgTimerRef.current);
  }, [isCut, mesh]);

  // Restore body visibility and dispose CSG meshes when the component unmounts
  useEffect(() => {
    return () => {
      clearTimeout(csgTimerRef.current);
      restoreBodyVisibility();
      csgMeshesRef.current.forEach((m) => m.geometry.dispose());
    };
  }, []);

  if (!mesh) return null;
  return (
    <group>
      {/* Red cut solid / blue join solid — hidden imperatively once CSG is ready */}
      <group ref={redGroupRef}>
        <primitive object={mesh} />
      </group>
      {/* Cut outline edges always shown — cheap and useful during drag */}
      {edges && <primitive object={edges} />}
      {/* X-ray outline — same geometry, depthTest:false, renders through body surfaces */}
      {xrayEdges && <primitive object={xrayEdges} />}
      {/* CSG result: actual body with hole so depth is visible. Populated imperatively. */}
      <group ref={csgGroupRef} />
    </group>
  );
}
