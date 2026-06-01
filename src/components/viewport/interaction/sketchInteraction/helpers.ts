import * as THREE from 'three';
import type { Sketch, SketchEntity } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';

/** Compute the circumcenter of 3 world-space points that lie on the given sketch plane.
 *  Returns center (world coords) and radius, or null if points are collinear. */
export function circumcenter2D(
  p1: {x:number;y:number;z:number},
  p2: {x:number;y:number;z:number},
  p3: {x:number;y:number;z:number},
  t1: THREE.Vector3, t2: THREE.Vector3
): { center: {x:number;y:number;z:number}; radius: number } | null {
  // Project to plane-local 2D
  const proj = (p: {x:number;y:number;z:number}, o: {x:number;y:number;z:number}) => {
    const d = new THREE.Vector3(p.x-o.x, p.y-o.y, p.z-o.z);
    return { u: d.dot(t1), v: d.dot(t2) };
  };
  const a = proj(p2, p1);
  const b = proj(p3, p1);
  const D = 2 * (a.u * b.v - a.v * b.u);
  if (Math.abs(D) < 1e-10) return null; // collinear
  const aa = a.u*a.u + a.v*a.v;
  const bb = b.u*b.u + b.v*b.v;
  const cu = (b.v * aa - a.v * bb) / D;
  const cv = (a.u * bb - b.u * aa) / D;
  const cx = p1.x + t1.x*cu + t2.x*cv;
  const cy = p1.y + t1.y*cu + t2.y*cv;
  const cz = p1.z + t1.z*cu + t2.z*cv;
  const radius = Math.sqrt(cu*cu + cv*cv);
  return { center: {x:cx, y:cy, z:cz}, radius };
}

// ---------------------------------------------------------------------------
// Blend Curve helpers (D44)
// ---------------------------------------------------------------------------

export interface EndpointWithTangent {
  endpoint: THREE.Vector3;
  /** Tangent direction in world space, pointing AWAY from the entity body. */
  tangent: THREE.Vector3;
  entityId: string;
  isStart: boolean;
}

const BLEND_PICK_RADIUS = 6; // world units

/**
 * Find the nearest sketch entity endpoint (within BLEND_PICK_RADIUS) to `click`,
 * and return its position and the curve tangent at that end.
 */
export function findBlendEndpoint(
  click: THREE.Vector3,
  sketch: Sketch,
): EndpointWithTangent | null {
  const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);

  let bestDist = BLEND_PICK_RADIUS;
  let best: EndpointWithTangent | null = null;

  const worldPt = (pt: { x: number; y: number; z: number }) =>
    new THREE.Vector3(pt.x, pt.y, pt.z);

  const check = (pt: THREE.Vector3, tangent: THREE.Vector3, entity: SketchEntity, isStart: boolean) => {
    const d = click.distanceTo(pt);
    if (d < bestDist) {
      bestDist = d;
      best = { endpoint: pt.clone(), tangent: tangent.clone().normalize(), entityId: entity.id, isStart };
    }
  };

  for (const entity of sketch.entities) {
    switch (entity.type) {
      case 'line':
      case 'construction-line':
      case 'centerline': {
        if (entity.points.length < 2) break;
        const p0 = worldPt(entity.points[0]);
        const p1 = worldPt(entity.points[entity.points.length - 1]);
        const dir = p1.clone().sub(p0);
        check(p0, dir.clone().negate(), entity, true);
        check(p1, dir.clone(), entity, false);
        break;
      }
      case 'arc': {
        if (!entity.points.length || entity.radius == null) break;
        const cx = entity.points[0];
        const r = entity.radius;
        const sa = entity.startAngle ?? 0;
        const ea = entity.endAngle ?? Math.PI;
        // world positions of arc endpoints
        const startPt = new THREE.Vector3(
          cx.x + t1.x * r * Math.cos(sa) + t2.x * r * Math.sin(sa),
          cx.y + t1.y * r * Math.cos(sa) + t2.y * r * Math.sin(sa),
          cx.z + t1.z * r * Math.cos(sa) + t2.z * r * Math.sin(sa),
        );
        const endPt = new THREE.Vector3(
          cx.x + t1.x * r * Math.cos(ea) + t2.x * r * Math.sin(ea),
          cx.y + t1.y * r * Math.cos(ea) + t2.y * r * Math.sin(ea),
          cx.z + t1.z * r * Math.cos(ea) + t2.z * r * Math.sin(ea),
        );
        // tangent = d(arc)/dθ = -t1*sin(θ) + t2*cos(θ), then negate for outward direction at start
        const tanStart = new THREE.Vector3(
          -t1.x * Math.sin(sa) + t2.x * Math.cos(sa),
          -t1.y * Math.sin(sa) + t2.y * Math.cos(sa),
          -t1.z * Math.sin(sa) + t2.z * Math.cos(sa),
        ).negate(); // negate so it points away from body
        const tanEnd = new THREE.Vector3(
          -t1.x * Math.sin(ea) + t2.x * Math.cos(ea),
          -t1.y * Math.sin(ea) + t2.y * Math.cos(ea),
          -t1.z * Math.sin(ea) + t2.z * Math.cos(ea),
        );
        check(startPt, tanStart, entity, true);
        check(endPt, tanEnd, entity, false);
        break;
      }
      case 'spline': {
        const pts = entity.points;
        if (pts.length < 2) break;
        const p0 = worldPt(pts[0]);
        const p1s = worldPt(pts[1]);
        const pn1 = worldPt(pts[pts.length - 2]);
        const pn = worldPt(pts[pts.length - 1]);
        check(p0, p0.clone().sub(p1s), entity, true);
        check(pn, pn.clone().sub(pn1), entity, false);
        break;
      }
      default:
        break;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// G2 curvature helpers
// ---------------------------------------------------------------------------

/**
 * Returns the curvature at a sketch arc endpoint closest to `pt`.
 * Normal points from the endpoint toward the arc center (i.e., into the curve).
 * Returns null if no arc endpoint is within tolerance, or for lines (zero curvature).
 */
export function getArcCurvatureAtPoint(
  sketch: Sketch,
  pt: THREE.Vector3,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
): { radius: number; normal: THREE.Vector3 } | null {
  const EPS = 0.1; // world-space mm matching tolerance
  for (const entity of sketch.entities) {
    if (entity.type !== 'arc' || entity.radius == null || !entity.points.length) continue;
    const r = entity.radius;
    const cx = entity.points[0];
    const center = new THREE.Vector3(cx.x, cx.y, cx.z);
    for (const angle of [entity.startAngle ?? 0, entity.endAngle ?? Math.PI]) {
      const epx = cx.x + t1.x * r * Math.cos(angle) + t2.x * r * Math.sin(angle);
      const epy = cx.y + t1.y * r * Math.cos(angle) + t2.y * r * Math.sin(angle);
      const epz = cx.z + t1.z * r * Math.cos(angle) + t2.z * r * Math.sin(angle);
      const ep = new THREE.Vector3(epx, epy, epz);
      if (ep.distanceTo(pt) < EPS) {
        return { radius: r, normal: center.clone().sub(ep).normalize() };
      }
    }
  }
  return null;
}

// Scratch vectors for sampleCubicBezier — module-level to avoid per-call allocs
const _sbP1 = new THREE.Vector3();
const _sbP2 = new THREE.Vector3();

/**
 * Sample a cubic Bezier curve at `n` points.
 * P1 = P0 + h*tangentA, P2 = P3 - h*tangentB, h = |P3-P0|/3.
 *
 * @param out  Optional pre-allocated array of Vector3s to fill in place.
 *             Must have at least n+1 elements. When provided, no new Vector3s
 *             are allocated. If omitted, a fresh array is returned (use only
 *             for non-frame-rate paths).
 */
export function sampleCubicBezier(
  p0: THREE.Vector3,
  tangentA: THREE.Vector3,
  p3: THREE.Vector3,
  tangentB: THREE.Vector3,
  n = 32,
  out?: THREE.Vector3[],
): THREE.Vector3[] {
  const h = p0.distanceTo(p3) / 3;
  _sbP1.copy(p0).addScaledVector(tangentA, h);
  _sbP2.copy(p3).addScaledVector(tangentB, -h);
  const pts = out ?? Array.from({ length: n + 1 }, () => new THREE.Vector3());
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    const x = mt * mt * mt * p0.x + 3 * mt * mt * t * _sbP1.x + 3 * mt * t * t * _sbP2.x + t * t * t * p3.x;
    const y = mt * mt * mt * p0.y + 3 * mt * mt * t * _sbP1.y + 3 * mt * t * t * _sbP2.y + t * t * t * p3.y;
    const z = mt * mt * mt * p0.z + 3 * mt * mt * t * _sbP1.z + 3 * mt * t * t * _sbP2.z + t * t * t * p3.z;
    pts[i].set(x, y, z);
  }
  return pts;
}

/**
 * Sample a G2-continuous degree-5 (quintic) Bezier blend between two endpoints.
 * Matches tangent direction AND curvature at each endpoint (uses arc curvature when
 * the connecting entity is an arc; treats lines as zero curvature).
 *
 * Control points Q0..Q5:
 *   Q0 = p0, Q5 = p3
 *   Q1 = Q0 + T0*(h/5)        (G1 at start)
 *   Q4 = Q5 - T3*(h/5)        (G1 at end)
 *   Q2 = 2*Q1-Q0 + κ0*(h²/20) (G2 at start — κ0 = curvNormal0/r0, 0 for lines)
 *   Q3 = 2*Q4-Q5 + κ3*(h²/20) (G2 at end)
 * where h = |p3-p0|.
 */
export function sampleQuinticBezierG2(
  p0: THREE.Vector3,
  tangentA: THREE.Vector3,
  curvA: { radius: number; normal: THREE.Vector3 } | null,
  p3: THREE.Vector3,
  tangentB: THREE.Vector3,
  curvB: { radius: number; normal: THREE.Vector3 } | null,
  n = 32,
): THREE.Vector3[] {
  const h = p0.distanceTo(p3);
  const hOver5 = h / 5;
  const hSqOver20 = (h * h) / 20;

  // Q0, Q1
  const Q0 = p0.clone();
  const Q1 = p0.clone().addScaledVector(tangentA, hOver5);
  // Q2: add curvature offset if connecting to an arc
  const Q2 = Q1.clone().add(Q1.clone().sub(Q0));
  if (curvA && curvA.radius > 1e-6) {
    Q2.addScaledVector(curvA.normal, hSqOver20 / curvA.radius);
  }

  // Q5, Q4
  const Q5 = p3.clone();
  const Q4 = p3.clone().addScaledVector(tangentB, -hOver5);
  // Q3: add curvature offset if connecting to an arc
  const Q3 = Q4.clone().add(Q4.clone().sub(Q5));
  if (curvB && curvB.radius > 1e-6) {
    Q3.addScaledVector(curvB.normal, hSqOver20 / curvB.radius);
  }

  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    const b0 = mt * mt * mt * mt * mt;
    const b1 = 5 * mt * mt * mt * mt * t;
    const b2 = 10 * mt * mt * mt * t * t;
    const b3 = 10 * mt * mt * t * t * t;
    const b4 = 5 * mt * t * t * t * t;
    const b5 = t * t * t * t * t;
    pts.push(new THREE.Vector3(
      b0 * Q0.x + b1 * Q1.x + b2 * Q2.x + b3 * Q3.x + b4 * Q4.x + b5 * Q5.x,
      b0 * Q0.y + b1 * Q1.y + b2 * Q2.y + b3 * Q3.y + b4 * Q4.y + b5 * Q5.y,
      b0 * Q0.z + b1 * Q1.z + b2 * Q2.z + b3 * Q3.z + b4 * Q4.z + b5 * Q5.z,
    ));
  }
  return pts;
}
