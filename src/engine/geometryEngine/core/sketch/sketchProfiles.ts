import * as THREE from 'three';
import type { Sketch, SketchEntity, SketchPoint } from '../../../../types/cad';
import { getSketchAxes as getSketchAxesUtil } from '../../planeUtils';
import {
  computeAtomicRegions,
  getEntityEndpoints,
  pointInPoly,
  polygonArea,
  removeSliverTriangles2D,
} from './profileGeometry';

const BOUNDARY_TYPES = new Set([
  'line', 'arc', 'spline', 'ellipse', 'elliptical-arc', 'polygon',
]);

const CLOSED_PRIMITIVE_TYPES = new Set([
  'rectangle', 'circle', 'ellipse', 'polygon',
]);

/**
 * Adaptive segment count for a circular arc / full circle so chord-arc
 * deviation stays bounded. For an inscribed N-gon at radius `r`,
 * deviation = r·(1 − cos(π/N·angleFrac)). Solve for N at `chordTolMm`:
 *   N = (angleFrac·π) / acos(1 − chordTolMm / r)
 *
 * Default `chordTolMm = 0.02` keeps a 50 mm hole within ±20 µm of a
 * true circle (well below print resolution). Capped at 32 minimum so
 * tiny sketches still get reasonable sampling, and 256 maximum so
 * we don't blow up vertex counts on huge meshes.
 */
export function circleSegments(radius: number, angleFrac = 1, chordTolMm = 0.02): number {
  if (!Number.isFinite(radius) || radius <= 0) return 32;
  const ratio = Math.max(1e-9, Math.min(1, 1 - chordTolMm / radius));
  const fullCircleN = Math.PI / Math.acos(ratio);
  const n = Math.ceil(fullCircleN * 2 * Math.max(1e-3, Math.min(1, angleFrac)));
  return Math.max(32, Math.min(256, n));
}

export function getSketchProfileCentroid(sketch: Sketch, profileIndex?: number): THREE.Vector3 | null {
  const { t1, t2 } = getSketchAxesUtil(sketch);
  const origin = sketch.planeOrigin;
  const allShapes = entitiesToShapes(sketch.entities, (p) => {
    const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    return { u: d.dot(t1), v: d.dot(t2) };
  });
  const shapes = profileIndex === undefined
    ? allShapes
    : (allShapes[profileIndex] ? [allShapes[profileIndex]] : []);
  if (shapes.length === 0) return null;

  const box = new THREE.Box2();
  for (const shape of shapes) {
    for (const point of shape.getPoints(32)) box.expandByPoint(point);
  }
  if (box.isEmpty()) return null;

  const center2 = box.getCenter(new THREE.Vector2());
  return origin.clone().addScaledVector(t1, center2.x).addScaledVector(t2, center2.y);
}

export function createSketchProfileMesh(
  sketch: Sketch,
  material: THREE.Material,
  profileIndex?: number,
): THREE.Mesh | null {
  const { t1, t2 } = getSketchAxesUtil(sketch);
  const origin = sketch.planeOrigin;
  const project = (p: SketchPoint) => {
    const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    return { u: d.dot(t1), v: d.dot(t2) };
  };

  let shapes: THREE.Shape[];
  if (profileIndex === undefined) {
    shapes = entitiesToShapes(sketch.entities, project);
  } else {
    const flat = sketchToProfileShapesFlat(sketch);
    const outer = flat[profileIndex];
    if (!outer) return null;
    shapes = [outer];
  }
  if (shapes.length === 0) return null;

  const rawGeometry = new THREE.ShapeGeometry(shapes);
  const nonIndexed = rawGeometry.toNonIndexed();
  rawGeometry.dispose();
  const filtered = removeSliverTriangles2D(nonIndexed, 0.002);
  nonIndexed.dispose();

  const positionCount = (filtered.attributes.position as THREE.BufferAttribute).count;
  let geometry = filtered;
  if (positionCount < 3) {
    filtered.dispose();
    const retry = new THREE.ShapeGeometry(shapes);
    geometry = retry.toNonIndexed();
    retry.dispose();
  }

  const mesh = new THREE.Mesh(geometry, material);
  const meshNormal = new THREE.Vector3().crossVectors(t1, t2).normalize();
  const basis = new THREE.Matrix4().makeBasis(t1, t2, meshNormal);
  mesh.quaternion.setFromRotationMatrix(basis);
  mesh.position.copy(origin);
  return mesh;
}

export function createProfileSketch(sketch: Sketch, profileIndex: number): Sketch | null {
  const flatShapes = sketchToProfileShapesFlat(sketch);
  const shape = flatShapes[profileIndex];
  if (!shape) return null;

  const { t1, t2 } = getSketchAxesUtil(sketch);
  const origin = sketch.planeOrigin;

  const toSketchPoints = (raw: THREE.Vector2[]): SketchPoint[] | null => {
    const points = [...raw];
    if (points.length >= 2 && points[points.length - 1].distanceTo(points[0]) <= 1e-5) points.pop();
    if (points.length < 3) return null;
    return points.map((point) => ({
      id: crypto.randomUUID(),
      x: origin.x + t1.x * point.x + t2.x * point.y,
      y: origin.y + t1.y * point.x + t2.y * point.y,
      z: origin.z + t1.z * point.x + t2.z * point.y,
    }));
  };

  const outerPoints = toSketchPoints(shape.getPoints(64));
  if (!outerPoints) return null;

  const holeEntities: SketchEntity[] = [];
  const appendHole = (holePoints2D: THREE.Vector2[]) => {
    const sketchPoints = toSketchPoints(holePoints2D);
    if (!sketchPoints) return;
    for (let i = 0; i < sketchPoints.length; i++) {
      const next = (i + 1) % sketchPoints.length;
      holeEntities.push({
        id: crypto.randomUUID(),
        type: 'line',
        points: [sketchPoints[i], sketchPoints[next]],
      });
    }
  };

  if (shape.holes.length > 0) {
    for (const hole of shape.holes) appendHole(hole.getPoints(64));
  } else {
    const outerPoly2D = shape.getPoints(64);
    const outerArea = polygonArea(outerPoly2D);
    for (let i = 0; i < flatShapes.length; i++) {
      if (i === profileIndex) continue;
      const other = flatShapes[i];
      if (other.holes.length > 0) continue;
      const otherPoints = other.getPoints(64);
      if (polygonArea(otherPoints) >= outerArea) continue;
      const cx = otherPoints.reduce((sum, point) => sum + point.x, 0) / otherPoints.length;
      const cy = otherPoints.reduce((sum, point) => sum + point.y, 0) / otherPoints.length;
      if (!pointInPoly(new THREE.Vector2(cx, cy), outerPoly2D)) continue;
      appendHole(otherPoints);
    }
  }

  const entities: SketchEntity[] = [];
  for (let i = 0; i < outerPoints.length; i++) {
    const next = (i + 1) % outerPoints.length;
    entities.push({
      id: crypto.randomUUID(),
      type: 'line',
      points: [outerPoints[i], outerPoints[next]],
    });
  }
  entities.push(...holeEntities);

  return {
    ...sketch,
    id: `${sketch.id}::profile-${profileIndex}`,
    name: `${sketch.name} • Profile ${profileIndex + 1}`,
    entities,
    constraints: [],
    dimensions: [],
    fullyConstrained: false,
  };
}

export function sketchToShapes(sketch: Sketch): THREE.Shape[] {
  const { t1, t2 } = getSketchAxesUtil(sketch);
  const origin = sketch.planeOrigin;
  return entitiesToShapes(sketch.entities, (p) => {
    const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    return { u: d.dot(t1), v: d.dot(t2) };
  });
}

export function sketchToProfileShapesFlat(sketch: Sketch): THREE.Shape[] {
  const { t1, t2 } = getSketchAxesUtil(sketch);
  const origin = sketch.planeOrigin;
  const project = (p: SketchPoint) => {
    const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    return { u: d.dot(t1), v: d.dot(t2) };
  };
  const rawShapes = entitiesToShapes(sketch.entities, project, { nestHoles: false });

  const atomic = computeAtomicRegions(rawShapes);
  if (atomic.length === 0) return rawShapes;

  const shapeSignature = (shape: THREE.Shape) => {
    const raw = shape.getPoints(48);
    // Drop a duplicated closing vertex before averaging the centroid. A raw shape
    // (built with an explicit closing lineTo) repeats its first point, while the
    // Clipper2 atomic twin of the same region does not — leaving it in would shift
    // the centroid by ~one-vertex worth and make sameShape() fail to match a raw
    // shape to its atomic equivalent, so the atom gets appended as a phantom
    // duplicate profile. (Area via the shoelace sum is already dup-invariant.)
    const points = (raw.length > 1 && raw[0].distanceTo(raw[raw.length - 1]) < 1e-6)
      ? raw.slice(0, -1)
      : raw;
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      area += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    area = Math.abs(area) * 0.5;
    for (const point of points) {
      cx += point.x;
      cy += point.y;
    }
    cx /= points.length;
    cy /= points.length;
    return { area, cx, cy };
  };

  const sameShape = (
    a: ReturnType<typeof shapeSignature>,
    b: ReturnType<typeof shapeSignature>,
  ): boolean => {
    const scale = Math.max(a.area, b.area, 1e-6);
    if (Math.abs(a.area - b.area) / scale > 0.01) return false;
    const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    return dist < 0.01 * Math.sqrt(scale);
  };

  const originalSignatures = rawShapes.map(shapeSignature);

  // Start from a mutable copy. For each atomic region we either:
  //  (a) replace the corresponding raw shape in-place when the atomic version
  //      adds holes that the raw shape lacks (e.g. a rectangle that contains
  //      circles: raw shape has holes=[], atomic version has holes=[circle1, circle2]),
  //  (b) append it as a new independent region if no raw shape matches.
  //
  // Replacing in-place preserves the index positions stored in existing
  // feature.params.profileIndex / profileIndices so saved models stay valid.
  const combined: THREE.Shape[] = [...rawShapes];
  const matchedRawIndices = new Set<number>();

  for (const atom of atomic) {
    const atomSignature = shapeSignature(atom);
    const matchIdx = originalSignatures.findIndex(
      (sig, i) => !matchedRawIndices.has(i) && sameShape(sig, atomSignature),
    );

    if (matchIdx >= 0) {
      matchedRawIndices.add(matchIdx);
      // Replace the raw shape when the atomic version carries holes that the
      // raw (nestHoles:false) shape is missing — this is the fix for the
      // "circles inside a rectangle don't become through-holes" bug.
      if (atom.holes.length > combined[matchIdx].holes.length) {
        combined[matchIdx] = atom;
      }
    } else {
      // Genuinely new atomic region (a sub-region from overlapping shapes).
      combined.push(atom);
    }
  }

  // Pure-JS fallback: apply holes from entitiesToShapes(nestHoles:true) onto any
  // combined shape that still has no holes but should have some.  This runs without
  // Clipper2 WASM and catches the common "circles inside a rectangle" case even
  // when the WASM hasn't loaded yet, guaranteeing the primary profile always
  // carries its through-holes.
  const nestedShapes = entitiesToShapes(sketch.entities, project, { nestHoles: true });
  for (const nested of nestedShapes) {
    if (nested.holes.length === 0) continue;
    const nestedSig = shapeSignature(nested);
    for (let i = 0; i < combined.length; i++) {
      if (combined[i].holes.length >= nested.holes.length) continue;
      if (sameShape(shapeSignature(combined[i]), nestedSig)) {
        combined[i] = nested;
        break;
      }
    }
  }

  // Fusion parity: drop redundant un-split raw shapes. When a curve crosses
  // another shape's boundary (e.g. a circle straddling a rectangle's edge), the
  // valid profiles are ONLY the atomic faces — the original whole rectangle and
  // whole circle must NOT be offered, because selecting "the rectangle" would
  // wrongly pull in the half-circle region the atomic decomposition split out.
  //
  // A raw shape is redundant when it was NOT itself matched to an atomic face
  // (matchedRawIndices) AND its footprint is tiled by 2+ atomic regions whose net
  // areas sum to the raw shape's net area. A raw shape that simply equals one
  // atomic face (single rectangle, disjoint shapes, circle-in-rectangle) is
  // matched above and never reaches this test, so those cases are unchanged.
  const netArea = (shape: THREE.Shape): number => {
    let a = polygonArea(shape.getPoints(64));
    for (const hole of shape.holes) a -= polygonArea(hole.getPoints(64));
    return a;
  };
  // Only worth testing when at least one raw shape was NOT matched to an atomic
  // face (an unmatched raw is a candidate for "subdivided by a crossing curve").
  const hasUnmatchedRaw = rawShapes.some((_, i) => !matchedRawIndices.has(i));
  if (!hasUnmatchedRaw) return combined;

  // An atom "belongs to" a raw shape only when the atom is geometrically CONTAINED
  // in it. Boundary-point sampling fails here: atoms are bounded BY the raw curves,
  // so an atom's outline points lie ON the raw boundary where pointInPoly is
  // unreliable (the lens's arc edge IS the circle, so ~half its outline points read
  // as "outside"). Instead we sample each atom's INTERIOR via its triangulation —
  // triangle centroids are strictly inside the atom, so a containment test against
  // the raw polygon is robust to shared edges.
  const interiorSamples = (shape: THREE.Shape): THREE.Vector2[] => {
    const geo = new THREE.ShapeGeometry(shape);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const idx = geo.index;
    const pts: THREE.Vector2[] = [];
    const tri = (a: number, b: number, c: number) => {
      pts.push(new THREE.Vector2(
        (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3,
        (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3,
      ));
    };
    if (idx) {
      for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    } else {
      for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
    }
    geo.dispose();
    return pts;
  };
  const atomInteriors = atomic.map((atom) => ({ samples: interiorSamples(atom), area: netArea(atom) }));
  const atomContainedIn = (samples: THREE.Vector2[], rawPoly: THREE.Vector2[]): boolean => {
    if (samples.length === 0) return false;
    let inside = 0;
    for (const p of samples) if (pointInPoly(p, rawPoly)) inside += 1;
    return inside / samples.length >= 0.85;
  };
  const redundantRawIndices = new Set<number>();
  for (let i = 0; i < rawShapes.length; i++) {
    if (matchedRawIndices.has(i)) continue;
    const rawPoly = rawShapes[i].getPoints(64);
    const rawArea = netArea(rawShapes[i]);
    if (rawArea <= 1e-9) continue;
    let covered = 0;
    let count = 0;
    for (const atom of atomInteriors) {
      if (atomContainedIn(atom.samples, rawPoly)) {
        covered += atom.area;
        count += 1;
      }
    }
    // An unmatched raw shape that contains ≥2 atomic faces is never a minimal face,
    // so Fusion would not offer it as a profile — only the atoms are valid. Two ways
    // it arises:
    //   • covered ≈ rawArea — the raw shape is tiled exactly by the atoms (a region
    //     subdivided by a crossing curve), or
    //   • covered <  rawArea — a greedy chain that wandered across branch vertices
    //     (e.g. a square with triangles attached to its edges) produced an inflated
    //     outer loop enclosing the faces PLUS non-face area.
    // Atoms are disjoint and minimal, so a genuine face never contains another atom;
    // that is why dropping here cannot remove a real profile. (`covered <= rawArea`
    // also guards the impossible case of contained atoms exceeding the footprint.)
    if (count >= 2 && covered <= rawArea * 1.03) {
      redundantRawIndices.add(i);
    }
  }
  if (redundantRawIndices.size === 0) return combined;
  return combined.filter((_, i) => !redundantRawIndices.has(i));
}

export function sketchToShape(sketch: Sketch): THREE.Shape | null {
  const shapes = sketchToShapes(sketch);
  return shapes.length > 0 ? shapes[0] : null;
}

export function isSketchClosedProfile(sketch: Sketch): boolean {
  if (sketch.entities.length === 0) return false;
  const shapes = sketchToShapes(sketch);
  if (shapes.length === 0) return false;

  return shapes.every((shape) => {
    const points = shape.getPoints(64);
    if (points.length < 3) return false;
    const first = points[0];
    const last = points[points.length - 1];
    return first.distanceTo(last) <= 1e-4;
  });
}

/** A boundary entity together with its travel direction along an assembled chain. */
interface OrientedEntity { entity: SketchEntity; reversed: boolean; }

/**
 * Build a THREE.Shape from an ordered, orientation-aware chain of boundary
 * entities. Each element carries a `reversed` flag so segments that were drawn
 * "backwards" relative to the loop's travel direction are emitted end→start.
 * For a forward-only chain this produces output identical to the legacy
 * `entitiesToShape(chain)` path (so existing profiles are unaffected); the
 * difference only shows up for mixed-orientation loops, which previously failed
 * to close.
 */
function orientedChainToShape(
  chain: OrientedEntity[],
  project: (p: SketchPoint) => { u: number; v: number },
  autoClose = false,
): THREE.Shape | null {
  const shape = new THREE.Shape();
  let hasContent = false;
  const begin = (u: number, v: number) => {
    if (!hasContent) { shape.moveTo(u, v); hasContent = true; }
  };

  for (const { entity, reversed } of chain) {
    switch (entity.type) {
      case 'line': {
        if (entity.points.length >= 2) {
          const i0 = reversed ? entity.points.length - 1 : 0;
          const i1 = reversed ? 0 : entity.points.length - 1;
          const a = project(entity.points[i0]);
          const b = project(entity.points[i1]);
          begin(a.u, a.v);
          shape.lineTo(b.u, b.v);
        }
        break;
      }
      case 'spline': {
        if (entity.points.length >= 2) {
          const pts = reversed ? [...entity.points].reverse() : entity.points;
          const first = project(pts[0]);
          begin(first.u, first.v);
          for (let i = 1; i < pts.length; i++) {
            const p = project(pts[i]);
            shape.lineTo(p.u, p.v);
          }
        }
        break;
      }
      case 'arc': {
        if (entity.points.length >= 1 && entity.radius) {
          const c = project(entity.points[0]);
          const sa = entity.startAngle ?? 0;
          let ea = entity.endAngle ?? Math.PI;
          if (ea <= sa) ea += Math.PI * 2;
          const fromA = reversed ? ea : sa;
          begin(c.u + Math.cos(fromA) * entity.radius, c.v + Math.sin(fromA) * entity.radius);
          // reversed → sweep clockwise from ea back to sa
          shape.absarc(c.u, c.v, entity.radius, reversed ? ea : sa, reversed ? sa : ea, reversed);
        }
        break;
      }
      case 'elliptical-arc': {
        if (entity.points.length >= 1 && entity.majorRadius && entity.minorRadius) {
          const c = project(entity.points[0]);
          const rot = entity.rotation ?? 0;
          const sa = entity.startAngle ?? 0;
          let ea = entity.endAngle ?? Math.PI;
          if (ea <= sa) ea += Math.PI * 2;
          const cos = Math.cos(rot), sin = Math.sin(rot);
          const fromA = reversed ? ea : sa;
          const sx = entity.majorRadius * Math.cos(fromA);
          const sy = entity.minorRadius * Math.sin(fromA);
          begin(c.u + cos * sx - sin * sy, c.v + sin * sx + cos * sy);
          shape.absellipse(c.u, c.v, entity.majorRadius, entity.minorRadius, reversed ? ea : sa, reversed ? sa : ea, reversed, rot);
        }
        break;
      }
      default:
        break;
    }
  }

  // Snap a healed near-miss loop exactly shut so the resulting region is closed.
  if (hasContent && autoClose) shape.closePath();

  return hasContent ? shape : null;
}

export function entitiesToShapes(
  entities: SketchEntity[],
  project: (p: SketchPoint) => { u: number; v: number },
  opts: { nestHoles?: boolean } = {},
): THREE.Shape[] {
  const { nestHoles = true } = opts;
  const shapes: THREE.Shape[] = [];
  const tolerance = 1e-3;

  const chainable: { entity: SketchEntity; endpoints: [{ u: number; v: number }, { u: number; v: number }] }[] = [];
  const lineCandidates: { entity: SketchEntity; endpoints: [{ u: number; v: number }, { u: number; v: number }] }[] = [];

  for (const entity of entities) {
    if (CLOSED_PRIMITIVE_TYPES.has(entity.type)) {
      const shape = entitiesToShape([entity], project);
      if (shape) shapes.push(shape);
    } else if (entity.type === 'line') {
      const endpoints = getEntityEndpoints(entity, project);
      if (endpoints) lineCandidates.push({ entity, endpoints });
    } else if (BOUNDARY_TYPES.has(entity.type)) {
      const endpoints = getEntityEndpoints(entity, project);
      if (endpoints) chainable.push({ entity, endpoints });
    }
  }

  if (lineCandidates.length > 0) {
    const splitTs = lineCandidates.map(() => [0, 1]);
    const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
    const addT = (list: number[], t: number) => {
      if (t < -1e-7 || t > 1 + 1e-7) return;
      const clamped = Math.min(1, Math.max(0, t));
      if (!list.some((existing) => Math.abs(existing - clamped) <= 1e-5)) list.push(clamped);
    };

    for (let i = 0; i < lineCandidates.length; i++) {
      const a = lineCandidates[i].endpoints[0];
      const b = lineCandidates[i].endpoints[1];
      const rx = b.u - a.u;
      const ry = b.v - a.v;
      for (let j = i + 1; j < lineCandidates.length; j++) {
        const c = lineCandidates[j].endpoints[0];
        const d = lineCandidates[j].endpoints[1];
        const sx = d.u - c.u;
        const sy = d.v - c.v;
        const denom = cross(rx, ry, sx, sy);
        if (Math.abs(denom) <= 1e-9) continue;
        const qpx = c.u - a.u;
        const qpy = c.v - a.v;
        const ti = cross(qpx, qpy, sx, sy) / denom;
        const tj = cross(qpx, qpy, rx, ry) / denom;
        if (ti >= -1e-7 && ti <= 1 + 1e-7 && tj >= -1e-7 && tj <= 1 + 1e-7) {
          addT(splitTs[i], ti);
          addT(splitTs[j], tj);
        }
      }
    }

    const lineExtent = (() => {
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (const candidate of lineCandidates) {
        for (const point of candidate.endpoints) {
          if (point.u < minU) minU = point.u; if (point.u > maxU) maxU = point.u;
          if (point.v < minV) minV = point.v; if (point.v > maxV) maxV = point.v;
        }
      }
      return Math.hypot(maxU - minU, maxV - minV);
    })();
    const splitKeyTolerance = Math.min(1.0, Math.max(tolerance, 0.02 * lineExtent));
    const endpointKey = (p: { u: number; v: number }) =>
      `${Math.round(p.u / splitKeyTolerance)},${Math.round(p.v / splitKeyTolerance)}`;
    const splitSegments: typeof chainable = [];
    const degree = new Map<string, number>();
    const addDegree = (key: string) => degree.set(key, (degree.get(key) ?? 0) + 1);
    const pointAt = (entity: SketchEntity, t: number): SketchPoint => {
      const a = entity.points[0];
      const b = entity.points[entity.points.length - 1];
      return {
        id: crypto.randomUUID(),
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
      };
    };

    for (let i = 0; i < lineCandidates.length; i++) {
      const candidate = lineCandidates[i];
      const ts = splitTs[i].sort((a, b) => a - b);
      for (let k = 0; k < ts.length - 1; k++) {
        const t0 = ts[k];
        const t1v = ts[k + 1];
        if (Math.abs(t1v - t0) <= 1e-5) continue;
        const p0 = {
          u: candidate.endpoints[0].u + (candidate.endpoints[1].u - candidate.endpoints[0].u) * t0,
          v: candidate.endpoints[0].v + (candidate.endpoints[1].v - candidate.endpoints[0].v) * t0,
        };
        const p1 = {
          u: candidate.endpoints[0].u + (candidate.endpoints[1].u - candidate.endpoints[0].u) * t1v,
          v: candidate.endpoints[0].v + (candidate.endpoints[1].v - candidate.endpoints[0].v) * t1v,
        };
        const synthetic: SketchEntity = {
          ...candidate.entity,
          points: [pointAt(candidate.entity, t0), pointAt(candidate.entity, t1v)],
        };
        splitSegments.push({ entity: synthetic, endpoints: [p0, p1] });
        addDegree(endpointKey(p0));
        addDegree(endpointKey(p1));
      }
    }

    const validSplitSegments = splitSegments.filter((segment) => {
      const a = endpointKey(segment.endpoints[0]);
      const b = endpointKey(segment.endpoints[1]);
      return (degree.get(a) ?? 0) >= 2 && (degree.get(b) ?? 0) >= 2;
    });

    const hasInteriorSplit = splitTs.some((ts) => ts.some((t) => t > 1e-5 && t < 1 - 1e-5));
    // A branch vertex (3+ segments meeting at one point) means the lines form a
    // planar subdivision rather than a single loop — e.g. a square with triangles
    // attached along its edges, where each shared corner joins 4 segments. The
    // greedy chain assembler below can only trace ONE loop through such a graph, so
    // the cycle-based face finder must run here too, not only when one line crosses
    // another in its interior (hasInteriorSplit). Every vertex of an ordinary closed
    // loop has degree 2, so this does not fire for normal profiles.
    //
    // Detect coincidence with a FINE tolerance, not the coarse `endpointKey`
    // (which rounds to ~2% of the sketch extent): a curve re-emitted as a dense
    // polyline — e.g. a circular hole from createProfileSketch — has many vertices
    // closer together than the coarse grid, which would otherwise collapse into one
    // bucket and read as a false high-degree branch. True shared corners coincide
    // exactly; a smooth curve's consecutive points are spaced well above `tolerance`.
    const fineKey = (p: { u: number; v: number }) =>
      `${Math.round(p.u / tolerance)},${Math.round(p.v / tolerance)}`;
    const fineDegree = new Map<string, number>();
    for (const segment of validSplitSegments) {
      const a = fineKey(segment.endpoints[0]);
      const b = fineKey(segment.endpoints[1]);
      fineDegree.set(a, (fineDegree.get(a) ?? 0) + 1);
      fineDegree.set(b, (fineDegree.get(b) ?? 0) + 1);
    }
    const hasBranchVertex = Array.from(fineDegree.values()).some((d) => d >= 3);
    if (hasInteriorSplit || hasBranchVertex) {
      const nodePoints = new Map<string, { u: number; v: number }>();
      const graph = new Map<string, Set<string>>();
      const addGraphEdge = (a: string, b: string, pa: { u: number; v: number }, pb: { u: number; v: number }) => {
        nodePoints.set(a, nodePoints.get(a) ?? pa);
        nodePoints.set(b, nodePoints.get(b) ?? pb);
        const la = graph.get(a) ?? new Set<string>();
        const lb = graph.get(b) ?? new Set<string>();
        la.add(b); lb.add(a);
        graph.set(a, la); graph.set(b, lb);
      };
      for (const segment of validSplitSegments) {
        addGraphEdge(
          endpointKey(segment.endpoints[0]),
          endpointKey(segment.endpoints[1]),
          segment.endpoints[0],
          segment.endpoints[1],
        );
      }

      const cycleKey = (cycle: string[]) => {
        const variants: string[] = [];
        for (let i = 0; i < cycle.length; i++) variants.push([...cycle.slice(i), ...cycle.slice(0, i)].join('|'));
        const reversed = [...cycle].reverse();
        for (let i = 0; i < reversed.length; i++) variants.push([...reversed.slice(i), ...reversed.slice(0, i)].join('|'));
        return variants.sort()[0];
      };
      const cycleArea = (cycle: string[]) => {
        let area = 0;
        for (let i = 0, j = cycle.length - 1; i < cycle.length; j = i++) {
          const a = nodePoints.get(cycle[j]);
          const b = nodePoints.get(cycle[i]);
          if (!a || !b) return 0;
          area += a.u * b.v - b.u * a.v;
        }
        return Math.abs(area) * 0.5;
      };
      const cycles = new Map<string, string[]>();
      const maxCycleLength = 16;
      const dfs = (start: string, current: string, path: string[], usedNodes: Set<string>) => {
        if (path.length > maxCycleLength) return;
        for (const next of graph.get(current) ?? []) {
          if (next === start && path.length >= 3) {
            const key = cycleKey(path);
            if (!cycles.has(key) && cycleArea(path) > 1e-4) cycles.set(key, [...path]);
            continue;
          }
          if (usedNodes.has(next)) continue;
          usedNodes.add(next);
          path.push(next);
          dfs(start, next, path, usedNodes);
          path.pop();
          usedNodes.delete(next);
        }
      };
      for (const start of graph.keys()) dfs(start, start, [start], new Set([start]));

      for (const cycle of cycles.values()) {
        const points = cycle
          .map((key) => nodePoints.get(key))
          .filter((point): point is { u: number; v: number } => Boolean(point))
          .map((point) => new THREE.Vector2(point.u, point.v));
        if (points.length >= 3) shapes.push(new THREE.Shape(points));
      }
    }

    for (const segment of validSplitSegments) {
      chainable.push(segment);
    }
  }

  const used = new Set<number>();
  const chainExtent = (() => {
    if (chainable.length === 0) return 0;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const item of chainable) {
      for (const point of item.endpoints) {
        if (point.u < minU) minU = point.u; if (point.u > maxU) maxU = point.u;
        if (point.v < minV) minV = point.v; if (point.v > maxV) maxV = point.v;
      }
    }
    return Math.hypot(maxU - minU, maxV - minV);
  })();
  const joinTolerance = Math.min(1.0, Math.max(tolerance, 0.02 * chainExtent));
  const ptClose = (a: { u: number; v: number }, b: { u: number; v: number }) =>
    Math.hypot(a.u - b.u, a.v - b.v) <= joinTolerance;

  for (let seed = 0; seed < chainable.length; seed++) {
    if (used.has(seed)) continue;
    // Track orientation per chain element. A segment is "reversed" when it was
    // drawn in the opposite direction to the chain's travel — e.g. the user
    // snapped its END (not its start) to the previous segment. Without honoring
    // this, a mixed-orientation loop (very common when drawing separate line
    // segments and snapping their endpoints) never closes, so the profile is
    // wrongly classified as open and won't extrude as a solid.
    const chain: OrientedEntity[] = [{ entity: chainable[seed].entity, reversed: false }];
    let chainStart = chainable[seed].endpoints[0];
    let chainEnd = chainable[seed].endpoints[1];
    used.add(seed);

    // Track the chain's bounding box so the closing-gap heal tolerance can be
    // proportional to the sketch's size (see the closure check below).
    let minU = Math.min(chainStart.u, chainEnd.u), maxU = Math.max(chainStart.u, chainEnd.u);
    let minV = Math.min(chainStart.v, chainEnd.v), maxV = Math.max(chainStart.v, chainEnd.v);
    const grow = (p: { u: number; v: number }) => {
      if (p.u < minU) minU = p.u; if (p.u > maxU) maxU = p.u;
      if (p.v < minV) minV = p.v; if (p.v > maxV) maxV = p.v;
    };

    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < chainable.length; i++) {
        if (used.has(i)) continue;
        const [e0, e1] = chainable[i].endpoints;
        // Try all four ways the candidate can attach to either end of the chain,
        // flipping the segment's orientation when its far endpoint is the match.
        if (ptClose(chainEnd, e0)) {
          chain.push({ entity: chainable[i].entity, reversed: false });
          chainEnd = e1;
          used.add(i); extended = true; grow(e1);
        } else if (ptClose(chainEnd, e1)) {
          chain.push({ entity: chainable[i].entity, reversed: true });
          chainEnd = e0;
          used.add(i); extended = true; grow(e0);
        } else if (ptClose(chainStart, e1)) {
          chain.unshift({ entity: chainable[i].entity, reversed: false });
          chainStart = e0;
          used.add(i); extended = true; grow(e0);
        } else if (ptClose(chainStart, e0)) {
          chain.unshift({ entity: chainable[i].entity, reversed: true });
          chainStart = e1;
          used.add(i); extended = true; grow(e1);
        }
      }
    }

    // Closure with gap-healing. A hand-drawn loop frequently ends a fraction of
    // a millimetre short of its start (the closing snap just missed), leaving a
    // gap far larger than `tolerance` (1µm) but tiny relative to the sketch. Such
    // a near-miss is unambiguously meant to be closed, so we heal gaps up to ~1%
    // of the sketch's diagonal (clamped to [0.05, 1.0] units). When healed we
    // snap the path shut via closePath() so the region is exactly closed and the
    // profile becomes solid-extrudable. Genuine open chains (gap well beyond the
    // heal tolerance) are still left open → surface extrude, as before.
    if (chain.length > 0) {
      const gap = Math.hypot(chainStart.u - chainEnd.u, chainStart.v - chainEnd.v);
      const extent = Math.hypot(maxU - minU, maxV - minV);
      const healTol = Math.min(1.0, Math.max(0.05, 0.01 * extent));
      if (gap <= healTol) {
        const shape = orientedChainToShape(chain, project, /* autoClose */ gap > tolerance);
        if (shape) shapes.push(shape);
      }
    }
  }

  if (!nestHoles || shapes.length < 2) return shapes;

  const shapeArea = (points: THREE.Vector2[]): number => {
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      area += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
  };

  const pointInPoly = (point: THREE.Vector2, poly: THREE.Vector2[]): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x;
      const yi = poly[i].y;
      const xj = poly[j].x;
      const yj = poly[j].y;
      if (((yi > point.y) !== (yj > point.y)) &&
          (point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  };

  const sampleDensity = 48;
  const data = shapes.map((shape) => {
    const points = shape.getPoints(sampleDensity);
    const area = shapeArea(points);
    const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    return { shape, area, points, centroid: new THREE.Vector2(cx, cy) };
  });

  data.sort((a, b) => b.area - a.area);
  const absorbed = new Array(data.length).fill(false);

  for (let i = 1; i < data.length; i++) {
    if (absorbed[i]) continue;
    const inner = data[i];
    let parentIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (absorbed[j]) continue;
      if (pointInPoly(inner.centroid, data[j].points)) {
        parentIdx = j;
        break;
      }
    }
    if (parentIdx >= 0) {
      data[parentIdx].shape.holes.push(inner.shape);
      absorbed[i] = true;
    }
  }

  return data.filter((_, i) => !absorbed[i]).map((item) => item.shape);
}
export function entitiesToShape(
  entities: SketchEntity[],
  project: (p: SketchPoint) => { u: number; v: number },
): THREE.Shape | null {
  const shape = new THREE.Shape();
  let hasContent = false;

  for (const entity of entities) {
    switch (entity.type) {
      case 'line': {
        if (entity.points.length >= 2) {
          const a = project(entity.points[0]);
          const b = project(entity.points[1]);
          if (!hasContent) {
            shape.moveTo(a.u, a.v);
            hasContent = true;
          }
          shape.lineTo(b.u, b.v);
        }
        break;
      }
      case 'rectangle': {
        if (entity.points.length >= 2) {
          const p1 = project(entity.points[0]);
          const p2 = project(entity.points[1]);
          shape.moveTo(p1.u, p1.v);
          shape.lineTo(p2.u, p1.v);
          shape.lineTo(p2.u, p2.v);
          shape.lineTo(p1.u, p2.v);
          shape.lineTo(p1.u, p1.v);
          hasContent = true;
        }
        break;
      }
      case 'circle': {
        if (entity.points.length >= 1 && entity.radius) {
          const c = project(entity.points[0]);
          const path = new THREE.Path();
          path.absarc(c.u, c.v, entity.radius, 0, Math.PI * 2, false);
          shape.setFromPoints(path.getPoints(circleSegments(entity.radius)));
          hasContent = true;
        }
        break;
      }
      case 'arc': {
        if (entity.points.length >= 1 && entity.radius) {
          const c = project(entity.points[0]);
          const sa = entity.startAngle ?? 0;
          let ea = entity.endAngle ?? Math.PI;
          if (ea <= sa) ea += Math.PI * 2;
          if (!hasContent) {
            shape.moveTo(c.u + Math.cos(sa) * entity.radius, c.v + Math.sin(sa) * entity.radius);
            hasContent = true;
          }
          shape.absarc(c.u, c.v, entity.radius, sa, ea, false);
        }
        break;
      }
      case 'spline': {
        if (entity.points.length >= 2) {
          const first = project(entity.points[0]);
          if (!hasContent) {
            shape.moveTo(first.u, first.v);
            hasContent = true;
          }
          for (let i = 1; i < entity.points.length; i++) {
            const point = project(entity.points[i]);
            shape.lineTo(point.u, point.v);
          }
        }
        break;
      }
      case 'ellipse': {
        if (entity.points.length >= 1 && entity.majorRadius && entity.minorRadius) {
          const c = project(entity.points[0]);
          const rot = entity.rotation ?? 0;
          const path = new THREE.Path();
          path.absellipse(c.u, c.v, entity.majorRadius, entity.minorRadius, 0, Math.PI * 2, false, rot);
          // Use the major radius for chord-tolerance sampling — covers
          // the worst-case curvature on the ellipse.
          const segs = circleSegments(Math.max(entity.majorRadius, entity.minorRadius));
          shape.setFromPoints(path.getPoints(segs));
          hasContent = true;
        }
        break;
      }
      case 'elliptical-arc': {
        if (entity.points.length >= 1 && entity.majorRadius && entity.minorRadius) {
          const c = project(entity.points[0]);
          const rot = entity.rotation ?? 0;
          const sa = entity.startAngle ?? 0;
          let ea = entity.endAngle ?? Math.PI;
          if (ea <= sa) ea += Math.PI * 2;
          if (!hasContent) {
            const cos = Math.cos(rot);
            const sin = Math.sin(rot);
            const sx = entity.majorRadius * Math.cos(sa);
            const sy = entity.minorRadius * Math.sin(sa);
            shape.moveTo(c.u + cos * sx - sin * sy, c.v + sin * sx + cos * sy);
            hasContent = true;
          }
          shape.absellipse(c.u, c.v, entity.majorRadius, entity.minorRadius, sa, ea, false, rot);
        }
        break;
      }
      case 'polygon': {
        const sides = entity.sides ?? 6;
        if (entity.points.length >= 2 && sides >= 3) {
          const center = project(entity.points[0]);
          const edge = project(entity.points[1]);
          const radius = Math.hypot(edge.u - center.u, edge.v - center.v);
          for (let i = 0; i <= sides; i++) {
            const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
            const u = center.u + radius * Math.cos(angle);
            const v = center.v + radius * Math.sin(angle);
            if (i === 0) shape.moveTo(u, v);
            else shape.lineTo(u, v);
          }
          hasContent = true;
        }
        break;
      }
    }
  }

  return hasContent ? shape : null;
}
