import * as THREE from 'three';
import type { SketchEntity, SketchPoint, Sketch } from '../../types/cad';

export interface Pt2 {
  x: number;
  y: number;
}

/**
 * Plane-aware projection helper. SketchPoints are stored in WORLD 3D
 * coordinates, not 2D plane-local coords â€” see SketchInteraction.tsx:447
 * where x/y/z are written from the world-space raycast hit. To do correct
 * 2D analysis (chain detection, area, intersection) on a non-XY sketch
 * (XZ, YZ, custom face plane), we must project each 3D point onto the
 * sketch plane's t1/t2 axes.
 *
 * If `axes` is null we fall back to the legacy XY-only behavior â€” keeps
 * the helpers usable for unit tests that pass synthetic 2D entities.
 */
export type SketchAxes = { origin: THREE.Vector3; t1: THREE.Vector3; t2: THREE.Vector3 } | null;

/** Build SketchAxes from a Sketch's plane definition. */
export function buildSketchAxes(sketch: Sketch): SketchAxes {
  const n = sketch.planeNormal?.clone().normalize();
  const o = sketch.planeOrigin?.clone();
  if (!n || !o) return null;
  // Choose a stable t1: world X if non-parallel to normal, else world Z
  const ref = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const t1 = ref.clone().sub(n.clone().multiplyScalar(ref.dot(n))).normalize();
  const t2 = n.clone().cross(t1).normalize();
  return { origin: o, t1, t2 };
}

/** Project a 3D SketchPoint onto sketch plane UV coords. */
export function projectPt(p: SketchPoint, axes: SketchAxes): Pt2 {
  if (!axes) return { x: p.x, y: p.y };
  const v = new THREE.Vector3(p.x, p.y, p.z).sub(axes.origin);
  return { x: v.dot(axes.t1), y: v.dot(axes.t2) };
}

/** Round a coordinate to a grid bucket for tolerance-based grouping */
export function bucketKey(x: number, y: number, tol: number): string {
  const bx = Math.round(x / tol);
  const by = Math.round(y / tol);
  return `${bx},${by}`;
}

export function dist2(a: Pt2, b: Pt2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Return the 2-D start and end points of an entity.
 * Circles have no open endpoints â€” returns null.
 * Polygons/rectangles/slots that are closed also return null.
 */
export function entityEndpoints(e: SketchEntity, axes: SketchAxes = null): [Pt2, Pt2] | null {
  switch (e.type) {
    case 'line':
    case 'construction-line':
    case 'centerline': {
      if (e.points.length < 2) return null;
      return [projectPt(e.points[0], axes), projectPt(e.points[1], axes)];
    }
    case 'arc': {
      // Arc: points[0] is center, radius + startAngle + endAngle define geometry.
      // Actual start/end points computed from center + angles.
      if (e.points.length < 1 || e.radius == null || e.startAngle == null || e.endAngle == null) {
        return null;
      }
      const c2 = projectPt(e.points[0], axes);
      const cx = c2.x;
      const cy = c2.y;
      const r = e.radius;
      // Arc angles are stored in RADIANS (set via Math.atan2 in commitTool.ts).
      // The previous code multiplied by Ï€/180 as if they were degrees, which
      // produced wildly wrong endpoints â€” broke chain detection, closed-profile
      // detection, and self-intersection tests for any sketch with an arc.
      const sa = e.startAngle;
      const ea = e.endAngle;
      return [
        { x: cx + r * Math.cos(sa), y: cy + r * Math.sin(sa) },
        { x: cx + r * Math.cos(ea), y: cy + r * Math.sin(ea) },
      ];
    }
    case 'circle':
    case 'ellipse':
      // These are closed by nature â€” no open endpoints
      return null;
    case 'elliptical-arc': {
      // Open arc â€” endpoints at startAngle and endAngle
      if (e.points.length < 1 || e.majorRadius == null || e.minorRadius == null) return null;
      const sa = e.startAngle ?? 0;
      const ea = e.endAngle ?? Math.PI;
      const rot = e.rotation ?? 0;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const c2 = projectPt(e.points[0], axes);
      const cx = c2.x;
      const cy = c2.y;
      const a = e.majorRadius;
      const b = e.minorRadius;
      const sxU = a * Math.cos(sa) * cosR - b * Math.sin(sa) * sinR;
      const syU = a * Math.cos(sa) * sinR + b * Math.sin(sa) * cosR;
      const exU = a * Math.cos(ea) * cosR - b * Math.sin(ea) * sinR;
      const eyU = a * Math.cos(ea) * sinR + b * Math.sin(ea) * cosR;
      return [
        { x: cx + sxU, y: cy + syU },
        { x: cx + exU, y: cy + eyU },
      ];
    }
    case 'spline': {
      if (e.points.length < 2) return null;
      // Closed spline?
      if (e.closed) return null;
      return [
        projectPt(e.points[0], axes),
        projectPt(e.points[e.points.length - 1], axes),
      ];
    }
    case 'polygon':
    case 'rectangle':
    case 'slot':
      // These are closed contours
      return null;
    case 'point':
      // Isolated point entity
      return null;
    default:
      return null;
  }
}

/**
 * Sample points along an entity (for shoelace area computation).
 * Lines: 2 points. Arcs: N samples. Circles: N samples.
 * Polygons/rectangles: their control points.
 */
export function sampleEntityPoints(e: SketchEntity, arcSamples = 8, axes: SketchAxes = null): Pt2[] {
  switch (e.type) {
    case 'line':
    case 'construction-line':
    case 'centerline': {
      if (e.points.length < 2) return [];
      return [projectPt(e.points[0], axes), projectPt(e.points[1], axes)];
    }
    case 'arc': {
      if (e.points.length < 1 || e.radius == null || e.startAngle == null || e.endAngle == null) {
        return [];
      }
      const c2 = projectPt(e.points[0], axes);
      const cx = c2.x;
      const cy = c2.y;
      const r = e.radius;
      // Arc angles are stored in RADIANS â€” see entityEndpoints comment above.
      const sa = e.startAngle;
      let ea = e.endAngle;
      // Ensure we sweep in the correct direction (CCW)
      if (ea < sa) ea += 2 * Math.PI;
      const pts: Pt2[] = [];
      for (let i = 0; i <= arcSamples; i++) {
        const t = sa + ((ea - sa) * i) / arcSamples;
        pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
      }
      return pts;
    }
    case 'circle': {
      if (e.points.length < 1 || e.radius == null) return [];
      const c2 = projectPt(e.points[0], axes);
      const cx = c2.x;
      const cy = c2.y;
      const r = e.radius;
      const pts: Pt2[] = [];
      for (let i = 0; i < arcSamples; i++) {
        const t = (2 * Math.PI * i) / arcSamples;
        pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
      }
      return pts;
    }
    case 'ellipse': {
      if (e.points.length < 1 || e.majorRadius == null || e.minorRadius == null) return [];
      const c2 = projectPt(e.points[0], axes);
      const cx = c2.x;
      const cy = c2.y;
      const a = e.majorRadius;
      const b = e.minorRadius;
      const rot = e.rotation ?? 0;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const pts: Pt2[] = [];
      for (let i = 0; i < arcSamples; i++) {
        const t = (2 * Math.PI * i) / arcSamples;
        const u = a * Math.cos(t) * cosR - b * Math.sin(t) * sinR;
        const v = a * Math.cos(t) * sinR + b * Math.sin(t) * cosR;
        pts.push({ x: cx + u, y: cy + v });
      }
      return pts;
    }
    case 'elliptical-arc': {
      if (e.points.length < 1 || e.majorRadius == null || e.minorRadius == null) return [];
      const c2 = projectPt(e.points[0], axes);
      const cx = c2.x;
      const cy = c2.y;
      const a = e.majorRadius;
      const b = e.minorRadius;
      const rot = e.rotation ?? 0;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const sa = e.startAngle ?? 0;
      let ea = e.endAngle ?? Math.PI;
      if (ea <= sa) ea += 2 * Math.PI;
      const pts: Pt2[] = [];
      for (let i = 0; i <= arcSamples; i++) {
        const t = sa + ((ea - sa) * i) / arcSamples;
        const u = a * Math.cos(t) * cosR - b * Math.sin(t) * sinR;
        const v = a * Math.cos(t) * sinR + b * Math.sin(t) * cosR;
        pts.push({ x: cx + u, y: cy + v });
      }
      return pts;
    }
    case 'spline':
    case 'polygon':
    case 'rectangle':
    case 'slot':
      return e.points.map((p) => projectPt(p, axes));
    default:
      return e.points.map(p => ({ x: p.x, y: p.y }));
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function segmentIntersect(
  p: Pt2, q: Pt2, r: Pt2, s: Pt2, tol: number,
): { x: number; y: number } | null {
  const dx1 = q.x - p.x;
  const dy1 = q.y - p.y;
  const dx2 = s.x - r.x;
  const dy2 = s.y - r.y;

  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null; // parallel / collinear

  const dx3 = r.x - p.x;
  const dy3 = r.y - p.y;

  const t = (dx3 * dy2 - dy3 * dx2) / denom;
  const u = (dx3 * dy1 - dy3 * dx1) / denom;

  // Exclude endpoint touches (adjacent segments share endpoints)
  const eps = tol;
  if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) {
    return {
      x: p.x + t * dx1,
      y: p.y + t * dy1,
    };
  }
  return null;
}

/**
 * Determine if two entities of the same type are geometric duplicates.
 */
export function entitiesAreDuplicate(a: SketchEntity, b: SketchEntity, tol: number, axes: SketchAxes = null): boolean {
  switch (a.type) {
    case 'line':
    case 'construction-line':
    case 'centerline': {
      if (a.points.length < 2 || b.points.length < 2) return false;
      const pa0 = projectPt(a.points[0], axes);
      const pa1 = projectPt(a.points[1], axes);
      const pb0 = projectPt(b.points[0], axes);
      const pb1 = projectPt(b.points[1], axes);
      // Same direction or reversed
      return (
        (dist2(pa0, pb0) <= tol && dist2(pa1, pb1) <= tol) ||
        (dist2(pa0, pb1) <= tol && dist2(pa1, pb0) <= tol)
      );
    }
    case 'circle': {
      if (a.points.length < 1 || b.points.length < 1) return false;
      const ca = projectPt(a.points[0], axes);
      const cb = projectPt(b.points[0], axes);
      return dist2(ca, cb) <= tol && Math.abs((a.radius ?? 0) - (b.radius ?? 0)) <= tol;
    }
    case 'arc': {
      if (a.points.length < 1 || b.points.length < 1) return false;
      const ca = projectPt(a.points[0], axes);
      const cb = projectPt(b.points[0], axes);
      return (
        dist2(ca, cb) <= tol &&
        Math.abs((a.radius ?? 0) - (b.radius ?? 0)) <= tol &&
        Math.abs((a.startAngle ?? 0) - (b.startAngle ?? 0)) <= 0.01 &&
        Math.abs((a.endAngle ?? 0) - (b.endAngle ?? 0)) <= 0.01
      );
    }
    default:
      return false;
  }
}

