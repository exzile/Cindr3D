/**
 * OCC-8.x picking helpers.
 * Associates a THREE.Mesh with its BRepTessellation so face/edge pickers
 * can map raycast triangle hits → faceId / edgeId without triangle-adjacency
 * reconstruction.
 *
 * Convention: BodyMesh stores the tessellation reference in userData so any
 * picker can access it without prop-drilling.
 */
import * as THREE from 'three';
import type { BRepTessellation } from './brepBody';

export const BREP_TESS_KEY = 'brepTessellation' as const;
export const BREP_BODY_ID_KEY = 'brepBodyId' as const;
const DEFAULT_EDGE_LINE_MATERIAL = new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 1 });

/** Attach tessellation to mesh userData (called by BodyMesh after tessellation). */
export function attachTessellationToMesh(
  mesh: THREE.Mesh,
  tess: BRepTessellation,
  bodyId: string,
): void {
  mesh.userData[BREP_TESS_KEY] = tess;
  mesh.userData[BREP_BODY_ID_KEY] = bodyId;
}

/** Retrieve tessellation from mesh userData, or null if not OCC. */
export function getMeshTessellation(mesh: THREE.Mesh): BRepTessellation | null {
  return (mesh.userData[BREP_TESS_KEY] as BRepTessellation | undefined) ?? null;
}

/** Return the faceId for the triangle at `triangleIndex` in the tessellation. */
export function faceIdAtTriangle(tess: BRepTessellation, triangleIndex: number): number {
  return tess.faceIds[triangleIndex] ?? 0;
}

/**
 * Build a THREE.BufferGeometry containing ONLY the triangles that belong to
 * `faceId` in the tessellation. Used to render hover/selected face overlays.
 */
export function buildFaceHighlightGeometry(
  tess: BRepTessellation,
  faceId: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const tris = tess.faceIds.length;

  for (let i = 0; i < tris; i++) {
    if (tess.faceIds[i] !== faceId) continue;
    const base = i * 9; // 3 vertices × 3 components
    for (let k = 0; k < 9; k++) {
      positions.push(tess.positions[base + k]);
      normals.push(tess.normals[base + k]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  return geo;
}

/**
 * Build a THREE.BufferGeometry for the polyline of a specific edgeId.
 * Returns null if the edge has no polyline data.
 */
export function buildEdgeLineGeometry(
  tess: BRepTessellation,
  edgeId: number,
): THREE.BufferGeometry | null {
  const poly = tess.edgePolylines.get(edgeId);
  if (!poly || poly.length < 6) return null;

  // Convert polyline to line segments (pairs of consecutive points)
  const positions: number[] = [];
  const pointCount = poly.length / 3;
  for (let i = 0; i < pointCount - 1; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    positions.push(poly[a], poly[a + 1], poly[a + 2]);
    positions.push(poly[b], poly[b + 1], poly[b + 2]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geo;
}

/** Build LineSegments for ALL edges in the tessellation, tagged with edgeId. */
export function buildAllEdgeLineSegments(
  tess: BRepTessellation,
  material: THREE.Material = DEFAULT_EDGE_LINE_MATERIAL,
): THREE.LineSegments[] {
  const result: THREE.LineSegments[] = [];
  for (const [edgeId] of tess.edgePolylines) {
    const geo = buildEdgeLineGeometry(tess, edgeId);
    if (!geo) continue;
    const lines = new THREE.LineSegments(geo, material);
    lines.userData['edgeId'] = edgeId;
    result.push(lines);
  }
  return result;
}
