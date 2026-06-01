import * as THREE from 'three';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { Sketch, SketchEntity } from '../../../../types/cad';

/** A corner where two line entities meet — the anchor for a fillet/chamfer. */
export interface FilletCorner {
  corner: THREE.Vector3;
  ent0: SketchEntity;
  ptIdx0: 0 | 1;
  ent1: SketchEntity;
  ptIdx1: 0 | 1;
}

/** Resolved fillet arc geometry for a corner at a given radius. */
export interface FilletGeometry {
  center: THREE.Vector3;
  tangent0: THREE.Vector3;
  tangent1: THREE.Vector3;
  /** Short-path (≤180°) CCW arc, already ordered for the renderer. */
  arcStart: number;
  arcEnd: number;
}

/**
 * Find the corner (two coincident line endpoints from different lines) nearest
 * to `clickPt`, within `maxDist`. Pass `Infinity` for `maxDist` to always latch
 * onto the nearest corner (used by the hover preview). Returns null when no
 * qualifying corner exists.
 */
export function findFilletCorner(
  sketch: Sketch,
  clickPt: THREE.Vector3,
  maxDist: number,
): FilletCorner | null {
  const lineEnts = sketch.entities.filter(
    (e) => e.type === 'line' && e.points.length >= 2,
  );
  const verts: { pos: THREE.Vector3; lineIdx: number; ptIdx: 0 | 1 }[] = [];
  lineEnts.forEach((e, i) => {
    verts.push({ pos: new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z), lineIdx: i, ptIdx: 0 });
    verts.push({ pos: new THREE.Vector3(e.points[1].x, e.points[1].y, e.points[1].z), lineIdx: i, ptIdx: 1 });
  });

  let best: { pos: THREE.Vector3; lines: { idx: number; ptIdx: 0 | 1 }[] } | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const coinc = [verts[i]];
    for (let j = i + 1; j < verts.length; j++) {
      if (verts[j].lineIdx === verts[i].lineIdx) continue;
      if (verts[j].pos.distanceTo(verts[i].pos) < 0.5) coinc.push(verts[j]);
    }
    if (coinc.length < 2) continue;
    const dist = clickPt.distanceTo(verts[i].pos);
    if (dist < bestDist) {
      bestDist = dist;
      best = { pos: verts[i].pos.clone(), lines: coinc.map((c) => ({ idx: c.lineIdx, ptIdx: c.ptIdx })) };
    }
  }

  if (!best || bestDist > maxDist || best.lines.length < 2) return null;
  const li0 = best.lines[0];
  const li1 = best.lines[1];
  return {
    corner: best.pos,
    ent0: lineEnts[li0.idx],
    ptIdx0: li0.ptIdx,
    ent1: lineEnts[li1.idx],
    ptIdx1: li1.ptIdx,
  };
}

/**
 * Compute the fillet arc geometry for a corner at the given radius. Returns null
 * when the two lines are (nearly) parallel and no fillet is possible.
 */
export function computeFilletGeometry(
  sketch: Sketch,
  cornerInfo: FilletCorner,
  radius: number,
): FilletGeometry | null {
  const { corner, ent0, ptIdx0, ent1, ptIdx1 } = cornerInfo;
  const otherPt0 = ptIdx0 === 0 ? ent0.points[1] : ent0.points[0];
  const otherPt1 = ptIdx1 === 0 ? ent1.points[1] : ent1.points[0];
  const dir0 = new THREE.Vector3(otherPt0.x - corner.x, otherPt0.y - corner.y, otherPt0.z - corner.z).normalize();
  const dir1 = new THREE.Vector3(otherPt1.x - corner.x, otherPt1.y - corner.y, otherPt1.z - corner.z).normalize();
  return filletGeometryFromDirs(sketch, corner, dir0, dir1, radius);
}

/**
 * Core fillet math: given the corner apex and the two outward edge directions
 * (unit vectors from the corner toward each line's far end), produce the arc
 * centre, tangent points, and short-path arc angles for the requested radius.
 */
export function filletGeometryFromDirs(
  sketch: Sketch,
  corner: THREE.Vector3,
  dir0: THREE.Vector3,
  dir1: THREE.Vector3,
  radius: number,
): FilletGeometry | null {
  const cosA = dir0.dot(dir1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  if (sinA < 0.01) return null; // nearly parallel

  const halfAngle = Math.acos(Math.max(-1, Math.min(1, cosA))) / 2;
  const distToCenter = radius / Math.sin(halfAngle);
  const bisector = dir0.clone().add(dir1).normalize();
  const center = corner.clone().addScaledVector(bisector, distToCenter);
  const tangent0 = corner.clone().addScaledVector(dir0, radius / Math.tan(halfAngle));
  const tangent1 = corner.clone().addScaledVector(dir1, radius / Math.tan(halfAngle));

  const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
  const toAngle = (v: THREE.Vector3) => Math.atan2(v.dot(t2), v.dot(t1));
  const a0 = toAngle(tangent0.clone().sub(center));
  const a1 = toAngle(tangent1.clone().sub(center));

  // Pick the CCW arc that takes the short path (≤180°); the other direction
  // would produce the reflex arc that goes the wrong way around the corner.
  const rawSpan = ((a1 - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const [arcStart, arcEnd] = rawSpan <= Math.PI ? [a0, a1] : [a1, a0];

  return { center, tangent0, tangent1, arcStart, arcEnd };
}

/** Result of recomputing a fillet arc for a new radius (re-fillet of a live arc). */
export interface FilletRadiusUpdate {
  center: THREE.Vector3;
  radius: number;
  arcStart: number;
  arcEnd: number;
  line0Id: string; line0PointIndex: 0 | 1; tangent0: THREE.Vector3;
  line1Id: string; line1PointIndex: 0 | 1; tangent1: THREE.Vector3;
}

/** 3-D intersection of two coplanar lines (point A, unit dir D). Null if parallel. */
function intersectLines(
  A0: THREE.Vector3, D0: THREE.Vector3, A1: THREE.Vector3, D1: THREE.Vector3,
): THREE.Vector3 | null {
  const cross = D0.clone().cross(D1);
  const denom = cross.lengthSq();
  if (denom < 1e-10) return null;
  const diff = A1.clone().sub(A0);
  const s = diff.clone().cross(D1).dot(cross) / denom;
  return A0.clone().addScaledVector(D0, s);
}

/**
 * Recompute an existing fillet arc for a NEW radius: reconstruct the original
 * corner from the two lines still attached to the arc's endpoints, then move the
 * line tangent points and the arc to match the new radius. Returns null if the
 * two adjoining lines can't be located (e.g. a stale/detached arc).
 *
 * `arc` must be a committed fillet arc (centre in points[0], radius + angles set).
 */
export function computeFilletRadiusUpdate(
  sketch: Sketch,
  arc: SketchEntity,
  newRadius: number,
): FilletRadiusUpdate | null {
  if (arc.type !== 'arc' || arc.points.length < 1 || typeof arc.radius !== 'number') return null;
  if (arc.startAngle === undefined || arc.endAngle === undefined) return null;

  const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
  const c = new THREE.Vector3(arc.points[0].x, arc.points[0].y, arc.points[0].z);
  const r = arc.radius;
  const endpoint = (ang: number) => c.clone()
    .addScaledVector(t1, Math.cos(ang) * r)
    .addScaledVector(t2, Math.sin(ang) * r);
  const P0 = endpoint(arc.startAngle);
  const P1 = endpoint(arc.endAngle);

  // Locate the line whose endpoint coincides with a given tangent point.
  const EPS = Math.max(0.05, r * 0.05);
  const findLineAt = (p: THREE.Vector3) => {
    for (const e of sketch.entities) {
      if (e.type !== 'line' || e.points.length < 2) continue;
      for (let i = 0 as 0 | 1; i <= 1; i = (i + 1) as 0 | 1) {
        const pt = e.points[i];
        if (Math.hypot(pt.x - p.x, pt.y - p.y, pt.z - p.z) < EPS) {
          return { id: e.id, pointIndex: i, ent: e };
        }
      }
    }
    return null;
  };

  const l0 = findLineAt(P0);
  const l1 = findLineAt(P1);
  if (!l0 || !l1 || l0.id === l1.id) return null;

  const far0v = l0.ent.points[l0.pointIndex === 0 ? 1 : 0];
  const far1v = l1.ent.points[l1.pointIndex === 0 ? 1 : 0];
  const far0 = new THREE.Vector3(far0v.x, far0v.y, far0v.z);
  const far1 = new THREE.Vector3(far1v.x, far1v.y, far1v.z);

  // Each line currently runs tangent→far; the original corner is where the two
  // infinite lines intersect.
  const d0 = far0.clone().sub(P0).normalize();
  const d1 = far1.clone().sub(P1).normalize();
  const corner = intersectLines(P0, d0, P1, d1);
  if (!corner) return null;

  const dir0 = far0.clone().sub(corner).normalize();
  const dir1 = far1.clone().sub(corner).normalize();
  const geo = filletGeometryFromDirs(sketch, corner, dir0, dir1, newRadius);
  if (!geo) return null;

  return {
    center: geo.center,
    radius: newRadius,
    arcStart: geo.arcStart,
    arcEnd: geo.arcEnd,
    line0Id: l0.id, line0PointIndex: l0.pointIndex, tangent0: geo.tangent0,
    line1Id: l1.id, line1PointIndex: l1.pointIndex, tangent1: geo.tangent1,
  };
}
