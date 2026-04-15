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
