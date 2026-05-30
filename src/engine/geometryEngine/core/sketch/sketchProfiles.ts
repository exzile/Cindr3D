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
    const points = shape.getPoints(48);
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
    // ≥2 atomic faces contained in this raw shape, whose areas tile it = the raw
    // shape was subdivided by a crossing curve and must not be offered as a profile.
    if (count >= 2 && Math.abs(covered - rawArea) / rawArea < 0.03) {
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

export function entitiesToShapes(
  entities: SketchEntity[],
  project: (p: SketchPoint) => { u: number; v: number },
  opts: { nestHoles?: boolean } = {},
): THREE.Shape[] {
  const { nestHoles = true } = opts;
  const shapes: THREE.Shape[] = [];
  const tolerance = 1e-3;

  const chainable: { entity: SketchEntity; endpoints: [{ u: number; v: number }, { u: number; v: number }] }[] = [];

  for (const entity of entities) {
    if (CLOSED_PRIMITIVE_TYPES.has(entity.type)) {
      const shape = entitiesToShape([entity], project);
      if (shape) shapes.push(shape);
    } else if (BOUNDARY_TYPES.has(entity.type)) {
      const endpoints = getEntityEndpoints(entity, project);
      if (endpoints) chainable.push({ entity, endpoints });
    }
  }

  const used = new Set<number>();
  const ptClose = (a: { u: number; v: number }, b: { u: number; v: number }) =>
    Math.hypot(a.u - b.u, a.v - b.v) <= tolerance;

  for (let seed = 0; seed < chainable.length; seed++) {
    if (used.has(seed)) continue;
    const chain: SketchEntity[] = [chainable[seed].entity];
    let chainStart = chainable[seed].endpoints[0];
    let chainEnd = chainable[seed].endpoints[1];
    used.add(seed);

    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < chainable.length; i++) {
        if (used.has(i)) continue;
        const endpoints = chainable[i].endpoints;
        if (ptClose(chainEnd, endpoints[0])) {
          chain.push(chainable[i].entity);
          chainEnd = endpoints[1];
          used.add(i);
          extended = true;
        } else if (ptClose(chainStart, endpoints[1])) {
          chain.unshift(chainable[i].entity);
          chainStart = endpoints[0];
          used.add(i);
          extended = true;
        }
      }
    }

    if (chain.length > 0 && ptClose(chainStart, chainEnd)) {
      const shape = entitiesToShape(chain, project);
      if (shape) shapes.push(shape);
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
