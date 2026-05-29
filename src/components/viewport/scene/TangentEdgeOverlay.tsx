import { useEffect } from 'react';
import * as THREE from 'three';
import { getOccSync } from '../../../engine/occ/loader';
import { globalBRepBodyRegistry } from '../../../engine/occ/globalRegistry';
import { getMeshTessellation, BREP_BODY_ID_KEY } from '../../../engine/occ/picking';
import { getSelectableEdges } from '../../../engine/occ/ops/selectableEdges';
import { buildTangentEdgeLineGeometry } from './edgeOp/edgeOpEdgeGeometry';

/**
 * Fusion 360-style tangent-edge reference lines.
 *
 * Draws the smooth (G1-continuous) edges where a fillet/round/chamfer surface
 * meets an adjacent face — the lines Fusion shows around fillets — as faint,
 * non-selectable reference lines. Sharp edges are already drawn by the viewport's
 * silhouette/outline pass; these complete the picture without cluttering picking.
 *
 * The line geometry is added as a CHILD of the body's mesh, so it inherits the
 * mesh's world transform automatically (the OCC edge polylines are in body-local
 * space). It carries no `edgeIdsBySegment` / `occDirect` userData, so the edge
 * picker (OccEdgePicker) ignores it entirely — purely visual.
 */

// Subtle mid-grey that reads as a reference line on the dark body without
// competing with the darker sharp-edge silhouette. Occluded by geometry
// (depthTest on) but does not write depth, so it never haloes other overlays.
const TANGENT_EDGE_MAT = new THREE.LineBasicMaterial({
  color: 0x9a9a9a,
  transparent: true,
  opacity: 0.55,
  depthTest: true,
  depthWrite: false,
});

const TANGENT_EDGE_RENDER_ORDER = 2;

export interface TangentEdgeLinesProps {
  mesh: THREE.Mesh;
  /** Optional hint; the authoritative body id is read from mesh.userData. */
  bodyId?: string;
}

/**
 * Per-body tangent reference lines. Renders nothing into the React tree; instead
 * it imperatively attaches/detaches a LineSegments child on the OCC body mesh
 * (which ExtrudedBodies mounts via <primitive>), so the transform is inherited
 * and R3F never reconciles the lines away.
 */
export default function TangentEdgeLines({ mesh, bodyId }: TangentEdgeLinesProps) {
  // The OCC registry is keyed by body.id, which createRegisteredOccMesh stamps on
  // the mesh — NOT the feature-level bodyId. Prefer the mesh's stamped id.
  const resolvedBodyId = (mesh.userData[BREP_BODY_ID_KEY] as string | undefined) ?? bodyId;
  useEffect(() => {
    const occ = getOccSync();
    const body = resolvedBodyId ? globalBRepBodyRegistry.get(resolvedBodyId) : undefined;
    const tess = getMeshTessellation(mesh);
    if (!occ || !body || !tess) return;

    let meta;
    try {
      meta = getSelectableEdges(occ.oc, body);
    } catch {
      return;
    }
    const geometry = buildTangentEdgeLineGeometry(tess, meta);
    if (!geometry) return;

    const lines = new THREE.LineSegments(geometry, TANGENT_EDGE_MAT);
    lines.renderOrder = TANGENT_EDGE_RENDER_ORDER;
    // Mark explicitly NON-pickable: no edgeIdsBySegment / occDirect, and skip
    // raycast so it never intercepts hover/click even via generic raycasters.
    lines.userData.tangentReference = true;
    lines.raycast = () => { /* visual-only — not raycastable */ };
    mesh.add(lines);

    return () => {
      mesh.remove(lines);
      geometry.dispose();
    };
  }, [mesh, resolvedBodyId]);

  return null;
}
