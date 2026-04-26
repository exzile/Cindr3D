import * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon, Ring as PCRing } from 'polygon-clipping';
import type { SketchEntity, SketchPoint } from '../../../../types/cad';
import { booleanMultiPolygonClipper2Sync } from '../../../slicer/geometry/clipper2Boolean';
import { loadClipper2Module } from '../../../slicer/geometry/clipper2Wasm';

// ARACHNE-9.4A.4: fire-and-forget warm-up at module-init so the sync
// fast path in `computeAtomicRegions` resolves by the time the user
// commits an overlap-resolving extrude. The polygon-clipping fallback
// has been retired — see `requireMP` below; if WASM isn't loaded the
// caller gets a clear error instead of silent JS-fallback drift.
void loadClipper2Module().catch(() => { /* error surfaces via requireMP */ });

function requireMP(result: PCMultiPolygon | null, op: string): PCMultiPolygon {
  if (result === null) {
    throw new Error(`profileGeometry.${op}: Clipper2 WASM not loaded — ensure loadClipper2Module() has resolved before calling computeAtomicRegions`);
  }
  return result;
}

export function getEntityEndpoints(
  entity: SketchEntity,
  project: (p: SketchPoint) => { u: number; v: number },
): [{ u: number; v: number }, { u: number; v: number }] | null {
  if (entity.type === 'line' || entity.type === 'spline') {
    if (entity.points.length < 2) return null;
    return [project(entity.points[0]), project(entity.points[entity.points.length - 1])];
  }
  if (entity.type === 'arc') {
    if (entity.points.length < 1 || !entity.radius) return null;
    const center = project(entity.points[0]);
    const startAngle = entity.startAngle ?? 0;
    const endAngle = entity.endAngle ?? Math.PI;
    return [
      { u: center.u + Math.cos(startAngle) * entity.radius, v: center.v + Math.sin(startAngle) * entity.radius },
      { u: center.u + Math.cos(endAngle) * entity.radius, v: center.v + Math.sin(endAngle) * entity.radius },
    ];
  }
  if (entity.type === 'elliptical-arc') {
    if (entity.points.length < 1 || !entity.majorRadius || !entity.minorRadius) return null;
    const center = project(entity.points[0]);
    const rotation = entity.rotation ?? 0;
    const startAngle = entity.startAngle ?? 0;
    const endAngle = entity.endAngle ?? Math.PI;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const projectAngle = (angle: number) => {
      const x = entity.majorRadius! * Math.cos(angle);
      const y = entity.minorRadius! * Math.sin(angle);
      return { u: center.u + cos * x - sin * y, v: center.v + sin * x + cos * y };
    };
    return [projectAngle(startAngle), projectAngle(endAngle)];
  }
  return null;
}

export function polygonArea(points: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(area) * 0.5;
}

export function pointInPoly(point: THREE.Vector2, poly: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (((yi > point.y) !== (yj > point.y)) && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function computeAtomicRegions(shapes: THREE.Shape[]): THREE.Shape[] {
  if (shapes.length <= 1) return shapes;

  const segments = 64;
  const tolerance = 1e-6;
  const shapeToMultiPolygon = (shape: THREE.Shape): PCMultiPolygon => {
    const points = shape.getPoints(segments);
    if (points.length < 3) return [];
    const ring: PCRing = points.map((point) => [point.x, point.y] as [number, number]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.abs(first[0] - last[0]) > tolerance || Math.abs(first[1] - last[1]) > tolerance) ring.push([first[0], first[1]]);
    return [[ring]];
  };

  const polygons = shapes.map(shapeToMultiPolygon).filter((multiPolygon) => multiPolygon.length > 0);
  if (polygons.length <= 1) return shapes;

  let atoms: PCMultiPolygon[] = [polygons[0]];
  let runningUnion: PCMultiPolygon = polygons[0];
  for (let index = 1; index < polygons.length; index += 1) {
    const polygon = polygons[index];
    const nextAtoms: PCMultiPolygon[] = [];

    for (const atom of atoms) {
      try {
        const intersection = requireMP(
          booleanMultiPolygonClipper2Sync(atom, polygon, 'intersection'), 'intersection');
        if (intersection.length > 0) nextAtoms.push(intersection);
      } catch {
        // Degenerate geometry is skipped; fallback returns the original shapes if no atoms survive.
      }
      try {
        const difference = requireMP(
          booleanMultiPolygonClipper2Sync(atom, polygon, 'difference'), 'difference');
        if (difference.length > 0) nextAtoms.push(difference);
      } catch {
        // Degenerate geometry is skipped; fallback returns the original shapes if no atoms survive.
      }
    }

    try {
      const onlyPolygon = requireMP(
        booleanMultiPolygonClipper2Sync(polygon, runningUnion, 'difference'), 'difference');
      if (onlyPolygon.length > 0) nextAtoms.push(onlyPolygon);
    } catch {
      // Degenerate geometry is skipped; fallback returns the original shapes if no atoms survive.
    }

    try {
      runningUnion = requireMP(
        booleanMultiPolygonClipper2Sync(runningUnion, polygon, 'union'), 'union');
    } catch {
      // Keep the previous union; fallback below preserves original shapes if atomization fails.
    }

    if (nextAtoms.length > 0) atoms = nextAtoms;
  }

  const simplifyRing = (ring: PCRing): THREE.Vector2[] => {
    const count = ring.length;
    const endDuplicate = count >= 2
      && Math.abs(ring[0][0] - ring[count - 1][0]) <= tolerance
      && Math.abs(ring[0][1] - ring[count - 1][1]) <= tolerance;
    const raw = endDuplicate ? ring.slice(0, -1) : ring;
    if (raw.length < 3) return [];

    const deduped: [number, number][] = [];
    for (const point of raw) {
      const last = deduped[deduped.length - 1];
      if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-5) deduped.push([point[0], point[1]]);
    }
    if (deduped.length < 3) return [];

    const minTurn = Math.sin(0.5 * Math.PI / 180);
    const kept: THREE.Vector2[] = [];
    for (let index = 0; index < deduped.length; index += 1) {
      const prev = deduped[(index - 1 + deduped.length) % deduped.length];
      const curr = deduped[index];
      const next = deduped[(index + 1) % deduped.length];
      const ax = curr[0] - prev[0];
      const ay = curr[1] - prev[1];
      const bx = next[0] - curr[0];
      const by = next[1] - curr[1];
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la < 1e-9 || lb < 1e-9) continue;
      const sinTheta = Math.abs(ax * by - ay * bx) / (la * lb);
      if (sinTheta > minTurn) kept.push(new THREE.Vector2(curr[0], curr[1]));
    }
    return kept.length >= 3 ? kept : [];
  };

  const result: THREE.Shape[] = [];
  for (const atom of atoms) {
    for (const polygon of atom) {
      if (!polygon.length) continue;
      const outerPoints = simplifyRing(polygon[0]);
      if (outerPoints.length < 3) continue;
      const shape = new THREE.Shape(outerPoints);
      for (let index = 1; index < polygon.length; index += 1) {
        const holePoints = simplifyRing(polygon[index]);
        if (holePoints.length < 3) continue;
        shape.holes.push(new THREE.Path(holePoints));
      }
      result.push(shape);
    }
  }

  return result.length > 0 ? result : shapes;
}

export function removeSliverTriangles2D(
  geometry: THREE.BufferGeometry,
  qualityThreshold = 0.02,
): THREE.BufferGeometry {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const bc = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const normalizer = 4 * Math.sqrt(3);
  const nextPositions: number[] = [];

  for (let index = 0; index < position.count; index += 3) {
    a.fromBufferAttribute(position, index);
    b.fromBufferAttribute(position, index + 1);
    c.fromBufferAttribute(position, index + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    bc.subVectors(c, b);
    cross.crossVectors(ab, ac);
    const area = cross.length() * 0.5;
    const sideSum = ab.lengthSq() + ac.lengthSq() + bc.lengthSq();
    const quality = sideSum > 1e-12 ? (normalizer * area) / sideSum : 0;
    if (quality < qualityThreshold) continue;
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
      a.fromBufferAttribute(position, index + vertexIndex);
      nextPositions.push(a.x, a.y, a.z);
    }
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(nextPositions, 3));
  result.computeVertexNormals();
  return result;
}
