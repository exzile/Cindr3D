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

// Dark, semi-transparent line that reads as a subtle reference on the default
// warm body material (0xf2a23a) — a light grey washed out against it. Occluded by
// geometry (depthTest on) but does not write depth, so it never haloes other
// overlays. Slightly transparent so it reads as a reference, not a hard edge.
const TANGENT_EDGE_MAT = new THREE.LineBasicMaterial({
  color: 0x2a2a2a,
  transparent: true,
  opacity: 0.6,
  depthTest: true,
  depthWrite: false,
});

const TANGENT_EDGE_RENDER_ORDER = 2;
const TANGENT_EDGE_RETRY_MS = 150;
const TANGENT_EDGE_MAX_ATTEMPTS = 60; // ~9s: cold OCC WASM load + STEP restore.

function resolveTangentBodyId(mesh: THREE.Mesh, bodyId: string | undefined): string | undefined {
  return (mesh.userData[BREP_BODY_ID_KEY] as string | undefined) ?? bodyId;
}

function createTangentLineSegments(mesh: THREE.Mesh, bodyId: string | undefined): THREE.LineSegments | null {
  const occ = getOccSync();
  const body = bodyId ? globalBRepBodyRegistry.get(bodyId) : undefined;
  const tess = getMeshTessellation(mesh);
  if (!occ || !body || !tess) return null;

  let meta;
  try {
    meta = getSelectableEdges(occ.oc, body);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-useless-assignment
  let geometry: THREE.BufferGeometry | null = null;
  try {
    geometry = buildTangentEdgeLineGeometry(tess, meta);
  } catch {
    return null;
  }
  if (!geometry) return null;

  const lines = new THREE.LineSegments(geometry, TANGENT_EDGE_MAT);
  lines.renderOrder = TANGENT_EDGE_RENDER_ORDER;
  // Mark explicitly NON-pickable: no edgeIdsBySegment / occDirect, and skip
  // raycast so it never intercepts hover/click even via generic raycasters.
  lines.userData.tangentReference = true;
  lines.raycast = () => { /* visual-only — not raycastable */ };
  return lines;
}

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
  useEffect(() => {
    let lines: THREE.LineSegments | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let cancelled = false;

    // On a cold page reload the OCC WASM and the restored body/tessellation become
    // available AFTER this component mounts, and the effect deps do not change
    // when those async resources appear. Poll until OCC + body + tessellation are ready,
    // then build once. Bail after MAX_ATTEMPTS so a genuinely body-less mesh never
    // polls forever.
    const tryBuild = () => {
      if (cancelled || lines) return; // already built or unmounted
      // The OCC registry is keyed by body.id, which createRegisteredOccMesh stamps
      // on the mesh — NOT the feature-level bodyId. Re-read on each retry because
      // R3F/userData stamping can happen after this effect first runs.
      const resolvedBodyId = resolveTangentBodyId(mesh, bodyId);
      lines = createTangentLineSegments(mesh, resolvedBodyId);
      if (!lines) {
        if (attempts++ < TANGENT_EDGE_MAX_ATTEMPTS) timer = setTimeout(tryBuild, TANGENT_EDGE_RETRY_MS);
        return;
      }
      mesh.add(lines);
    };
    tryBuild();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (lines) mesh.remove(lines);
      lines?.geometry.dispose();
    };
  }, [mesh, bodyId]);

  return null;
}
