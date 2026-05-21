/**
 * profileTopology.ts — EXACT model-edge topology for a (non-tapered,
 * non-custom-plane) extrude, derived directly from the sketch PROFILE LOOPS
 * rather than from the triangulated mesh.
 *
 * `buildExtrudeFeatureMesh` returns a non-indexed soup even for a simple
 * profile-with-hole, so reconstructing edges from it always inherits the
 * non-manifold hole-region residue. The profile loops are clean by
 * construction, so this yields ZERO spurious lines:
 *   • each loop (outer + holes) → a polyline on the start cap and the end cap;
 *     a smooth loop (circle) stays one closed edge, a cornered loop is split
 *     into straight corner-to-corner edges,
 *   • a side-seam edge at every sharp corner connecting the two caps.
 * For a box-with-hole: 4 outer edges/cap ×2 + 4 corner verticals + the hole
 * circle ×2 = exactly the real model edges, full-length, no diagonals.
 *
 * World transform mirrors extrudeSketch + buildExtrudeFeatureMesh exactly:
 *   world = origin + u·t1 + v·t2 + (zLocal + shift)·extrudeNormal
 * Returns `{ edges: [] }` for taper / custom-plane (caller falls back to
 * mesh-based extraction via `extractEdgeTopology` for those).
 *
 * Split out of the `extrusion.ts` monolith (2026-05 refactor): topology
 * extraction is a distinct concern from mesh construction and shares the
 * `modelEdgeId` id format + `ModelEdge` shape with `edgeTopology.ts`.
 */
import * as THREE from 'three';
import type { Sketch, SketchPoint } from '../../../../types/cad';
import { getSketchExtrudeNormal as getSketchExtrudeNormalUtil } from '../../planeUtils';
import { entitiesToShapes, circleSegments } from '../sketch/sketchProfiles';
import { adaptiveCurveSegments } from './extrusionInternals';
import { getRightHandedFrame } from './extrusion';
import { modelEdgeId } from './edgeId';
import type { ModelEdge } from './edgeTopology';

export function extrudeProfileTopology(
  sketch: Sketch,
  distance: number,
  direction: 'positive' | 'negative' | 'symmetric' | 'two-sides',
  startOffset = 0,
  distance2 = 0,
  taperAngleDeg = 0,
): { edges: ModelEdge[] } {
  if (
    sketch.plane === 'custom' ||
    Math.abs(taperAngleDeg) > 0.01 ||
    sketch.entities.length === 0 ||
    Math.abs(distance) < 1e-6
  ) {
    return { edges: [] };
  }
  const { t1, t2, normal } = getRightHandedFrame(sketch);
  const origin = sketch.planeOrigin;
  const project = (p: SketchPoint): { u: number; v: number } => {
    const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    return { u: d.dot(t1), v: d.dot(t2) };
  };
  const shapes = entitiesToShapes(sketch.entities, project);
  if (shapes.length === 0) return { edges: [] };

  const shiftN = getSketchExtrudeNormalUtil(sketch);
  let baseShift = startOffset;
  if (direction === 'symmetric') baseShift += -distance / 2;
  else if (direction === 'negative') baseShift += -distance;
  const capZs = direction === 'two-sides'
    ? [-(distance2 || distance), distance]
    : [0, distance];

  const toWorld = (u: number, v: number, zLocal: number): THREE.Vector3 =>
    new THREE.Vector3(
      origin.x + u * t1.x + v * t2.x + zLocal * normal.x + baseShift * shiftN.x,
      origin.y + u * t1.y + v * t2.y + zLocal * normal.y + baseShift * shiftN.y,
      origin.z + u * t1.z + v * t2.z + zLocal * normal.z + baseShift * shiftN.z,
    );

  const sharpCos = Math.cos(Math.PI / 12); // 15° — matches buildExtrudeFeatureEdges
  const edges: ModelEdge[] = [];
  const lexLess = (a: THREE.Vector3, b: THREE.Vector3): boolean =>
    a.x !== b.x ? a.x < b.x : a.y !== b.y ? a.y < b.y : a.z < b.z;
  const pushEdge = (polyIn: THREE.Vector3[]): void => {
    if (polyIn.length < 2) return;
    const closed = polyIn.length > 2 &&
      polyIn[0].distanceTo(polyIn[polyIn.length - 1]) < 1e-6;
    let poly = polyIn;
    if (!closed && lexLess(poly[poly.length - 1], poly[0])) poly = poly.slice().reverse();
    edges.push({ id: modelEdgeId(poly), polyline: poly, kind: 'crease' });
  };
  const strip = (pts: THREE.Vector2[]): THREE.Vector2[] =>
    pts.length >= 2 && pts[pts.length - 1].distanceTo(pts[0]) < 1e-6
      ? pts.slice(0, -1) : pts;

  const pointOnSegment = (p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): boolean => {
    const ab = b.clone().sub(a);
    const ap = p.clone().sub(a);
    const lenSq = ab.lengthSq();
    if (lenSq < 1e-12) return p.distanceTo(a) <= 1e-6;
    const t = ap.dot(ab) / lenSq;
    if (t < -1e-6 || t > 1 + 1e-6) return false;
    const closest = a.clone().addScaledVector(ab, t);
    return closest.distanceTo(p) <= 1e-5;
  };

  const pointInPolygon = (p: THREE.Vector2, polygon: THREE.Vector2[]): boolean => {
    for (let i = 0; i < polygon.length; i++) {
      if (pointOnSegment(p, polygon[i], polygon[(i + 1) % polygon.length])) return true;
    }
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const pi = polygon[i];
      const pj = polygon[j];
      if (((pi.y > p.y) !== (pj.y > p.y)) &&
          p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x) {
        inside = !inside;
      }
    }
    return inside;
  };

  const emitLoop = (raw: THREE.Vector2[]): void => {
    const p = strip(raw);
    const n = p.length;
    if (n < 2) return;
    const cornerIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], c = p[i], b = p[(i + 1) % n];
      const d1 = new THREE.Vector2(c.x - a.x, c.y - a.y);
      const d2 = new THREE.Vector2(b.x - c.x, b.y - c.y);
      if (d1.lengthSq() < 1e-12 || d2.lengthSq() < 1e-12) continue;
      d1.normalize(); d2.normalize();
      if (d1.dot(d2) < sharpCos) cornerIdx.push(i);
    }
    for (const z of capZs) {
      if (cornerIdx.length === 0) {
        const poly = p.map((q) => toWorld(q.x, q.y, z));
        poly.push(poly[0].clone());
        pushEdge(poly);
      } else {
        for (let k = 0; k < cornerIdx.length; k++) {
          const s = cornerIdx[k];
          const e = cornerIdx[(k + 1) % cornerIdx.length];
          const run: THREE.Vector3[] = [];
          let i = s;
          for (;;) {
            run.push(toWorld(p[i].x, p[i].y, z));
            if (i === e) break;
            i = (i + 1) % n;
          }
          pushEdge(run);
        }
      }
    }
    if (capZs.length >= 2) {
      const z0 = capZs[0], z1 = capZs[capZs.length - 1];
      for (const i of cornerIdx) {
        pushEdge([toWorld(p[i].x, p[i].y, z0), toWorld(p[i].x, p[i].y, z1)]);
      }
    }
  };

  const emitOpenRun = (raw: THREE.Vector2[]): void => {
    const p = raw.filter((pt, i) => i === 0 || pt.distanceTo(raw[i - 1]) > 1e-6);
    if (p.length < 2) return;
    for (const z of capZs) pushEdge(p.map((q) => toWorld(q.x, q.y, z)));
  };

  const emitHoleLoop = (raw: THREE.Vector2[], outerRaw: THREE.Vector2[]): void => {
    const hole = strip(raw);
    const outer = strip(outerRaw);
    if (hole.length < 2 || outer.length < 3) return;
    const inside = hole.map((p) => pointInPolygon(p, outer));
    if (inside.every(Boolean)) {
      emitLoop(raw);
      return;
    }

    let run: THREE.Vector2[] = [];
    const flush = () => {
      if (run.length >= 2) emitOpenRun(run);
      run = [];
    };

    for (let i = 0; i < hole.length; i++) {
      const a = hole[i];
      const b = hole[(i + 1) % hole.length];
      const aIn = inside[i];
      const bIn = inside[(i + 1) % hole.length];
      if (aIn && run.length === 0) run.push(a);
      if (aIn && bIn) {
        run.push(b);
      } else if (aIn && !bIn) {
        flush();
      } else if (!aIn && bIn) {
        run = [b];
      }
    }
    flush();
  };

  for (const shape of shapes) {
    // Mirror buildExtrudeGeomHolesAware's sampling so topology vertex positions
    // exactly match the rendered mesh.  Using a fixed SEG=64 produced a mismatch
    // (64 vs the adaptive count, e.g. 71 for a 5-unit-radius circle) that caused
    // resolveEdge to fail — the topology arc endpoints did not exist in the mesh.
    const outerSeg = adaptiveCurveSegments(shape);
    const outerPoints = shape.getPoints(outerSeg);
    emitLoop(outerPoints);
    for (const holePath of shape.holes) {
      // Per-hole adaptive count mirrors buildExtrudeGeomHolesAware exactly.
      let holeMaxR = 0;
      for (const c of holePath.curves) {
        if (c instanceof THREE.EllipseCurve) {
          const r = Math.max(c.xRadius, c.yRadius);
          if (r > holeMaxR) holeMaxR = r;
        }
      }
      const holeSeg = holeMaxR > 0 ? circleSegments(holeMaxR) : 64;
      emitHoleLoop(holePath.getPoints(holeSeg), outerPoints);
    }
  }
  return { edges };
}
