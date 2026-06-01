import * as THREE from 'three';

/**
 * Shared regular-polygon vertex math for the center-radius polygon tools
 * (inscribed + circumscribed), used by BOTH the commit handler and the live
 * preview so they trace the same shape.
 *
 * Matches Fusion 360: the point the user clicks while dragging defines the size
 * AND the orientation of the polygon —
 *   - inscribed:     the clicked point is a VERTEX of the polygon, so the
 *                    polygon rotates so a vertex sits under the cursor.
 *   - circumscribed: the clicked point is an EDGE MIDPOINT (tangent point of the
 *                    inscribed circle), so the polygon rotates so an edge
 *                    midpoint sits under the cursor.
 */
export type PolygonKind = 'inscribed' | 'circumscribed';

/**
 * Returns the `sides` vertex positions of a regular polygon in world space.
 *
 * @param center     polygon center
 * @param cursorDist distance from center to the clicked/cursor point. For
 *                   inscribed this is the circumradius; for circumscribed it is
 *                   the apothem (edge-midpoint distance).
 * @param baseAngle  in-plane angle (atan2 of cursor−center via t1/t2) that the
 *                   clicked point sits at — drives the rotation.
 */
export function polygonVertexPositions(
  center: THREE.Vector3,
  cursorDist: number,
  sides: number,
  baseAngle: number,
  kind: PolygonKind,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
): THREE.Vector3[] {
  // circumscribed: cursor is an edge midpoint → circumradius = apothem / cos(π/n),
  // and vertices sit ±π/n either side of each edge-midpoint angle.
  const radius = kind === 'circumscribed' ? cursorDist / Math.cos(Math.PI / sides) : cursorDist;
  const angleOffset = kind === 'circumscribed' ? -Math.PI / sides : 0;
  const verts: THREE.Vector3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = baseAngle + angleOffset + (i / sides) * Math.PI * 2;
    verts.push(
      center.clone()
        .addScaledVector(t1, Math.cos(a) * radius)
        .addScaledVector(t2, Math.sin(a) * radius),
    );
  }
  return verts;
}

/** Closed loop (verts + first vertex repeated) for drawing a preview outline. */
export function polygonLoop(verts: THREE.Vector3[]): THREE.Vector3[] {
  if (verts.length === 0) return verts;
  return [...verts, verts[0].clone()];
}
