import * as THREE from 'three';
import type { Sketch, SketchPoint } from '../../../../types/cad';
import { SURFACE_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { EXTRUDE_MATERIAL } from '../../materials';
import { getSketchAxes as getSketchAxesUtil } from '../../planeUtils';
import { entitiesToShape, sketchToShape } from '../sketch/sketchProfiles';

export function loftSketches(profileSketches: Sketch[], surface = false): THREE.Mesh | null {
  if (profileSketches.length < 2) return null;
  const profileSegments = 48;
  const rings: THREE.Vector3[][] = [];

  for (const sketch of profileSketches) {
    let ring: THREE.Vector3[];

    if (sketch.plane === 'custom') {
      const { t1, t2 } = getSketchAxesUtil(sketch);
      const origin = sketch.planeOrigin;
      const project = (p: SketchPoint) => {
        const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
        return { u: d.dot(t1), v: d.dot(t2) };
      };
      const shape = entitiesToShape(sketch.entities, project);
      if (!shape) return null;
      ring = shape.getPoints(profileSegments).map(({ x: u, y: v }) =>
        new THREE.Vector3(
          origin.x + t1.x * u + t2.x * v,
          origin.y + t1.y * u + t2.y * v,
          origin.z + t1.z * u + t2.z * v,
        ),
      );
    } else {
      const { t1, t2 } = getSketchAxesUtil(sketch);
      const project = (p: SketchPoint) => ({
        u: t1.x * p.x + t1.y * p.y + t1.z * p.z,
        v: t2.x * p.x + t2.y * p.y + t2.z * p.z,
      });
      const shape = entitiesToShape(sketch.entities, project);
      if (!shape) return null;
      ring = shape.getPoints(profileSegments).map(({ x: u, y: v }) =>
        new THREE.Vector3(t1.x * u + t2.x * v, t1.y * u + t2.y * v, t1.z * u + t2.z * v),
      );
    }

    if (ring.length < 2) return null;
    rings.push(ring);
  }

  if (rings.length < 2) return null;

  // Track the actual point count pushed for each ring — shapes with fewer
  // entities return fewer points from getPoints(), so we can't assume every
  // ring has exactly `profileSegments` vertices.
  const positions: number[] = [];
  const indices: number[] = [];
  const ringBase: number[] = [];   // vertex index where each ring starts
  const ringLen: number[] = [];    // actual vertex count for each ring

  for (const ring of rings) {
    ringBase.push(positions.length / 3);
    ringLen.push(ring.length);
    for (const point of ring) positions.push(point.x, point.y, point.z);
  }

  for (let ri = 0; ri < rings.length - 1; ri++) {
    const baseA = ringBase[ri];
    const baseB = ringBase[ri + 1];
    const na = ringLen[ri];
    const nb = ringLen[ri + 1];
    const nq = Math.min(na, nb);
    for (let j = 0; j < nq; j++) {
      const nextA = (j + 1) % na;
      const nextB = (j + 1) % nb;
      indices.push(baseA + j, baseB + j, baseA + nextA, baseA + nextA, baseB + j, baseB + nextB);
    }
  }

  if (!surface) {
    const r0 = rings[0];
    const n0 = ringLen[0];
    const c0 = r0.reduce((acc, pt) => acc.add(pt), new THREE.Vector3()).multiplyScalar(1 / n0);
    const centroid0 = positions.length / 3;
    positions.push(c0.x, c0.y, c0.z);
    for (let j = 0; j < n0; j++) indices.push(centroid0, j, (j + 1) % n0);

    const r1 = rings[rings.length - 1];
    const n1 = ringLen[rings.length - 1];
    const c1 = r1.reduce((acc, pt) => acc.add(pt), new THREE.Vector3()).multiplyScalar(1 / n1);
    const base1 = ringBase[rings.length - 1];
    const centroid1 = positions.length / 3;
    positions.push(c1.x, c1.y, c1.z);
    for (let j = 0; j < n1; j++) indices.push(centroid1, base1 + (j + 1) % n1, base1 + j);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, surface ? SURFACE_MATERIAL : EXTRUDE_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function patchSketch(sketch: Sketch): THREE.Mesh | null {
  const { t1, t2 } = getSketchAxesUtil(sketch);
  const origin = sketch.planeOrigin;
  const shape = sketchToShape(sketch);
  if (!shape) return null;

  // Triangulate in UV (sketch-plane) space then project each vertex to world
  // space via the sketch axes t1/t2. This makes Patch work on XZ, YZ, and
  // custom planes, not just XY.
  const uvGeometry = new THREE.ShapeGeometry(shape);
  const uvPositions = uvGeometry.attributes.position as THREE.BufferAttribute;
  const worldPositions = new Float32Array(uvPositions.count * 3);
  for (let i = 0; i < uvPositions.count; i++) {
    const u = uvPositions.getX(i);
    const v = uvPositions.getY(i);
    worldPositions[i * 3]     = origin.x + t1.x * u + t2.x * v;
    worldPositions[i * 3 + 1] = origin.y + t1.y * u + t2.y * v;
    worldPositions[i * 3 + 2] = origin.z + t1.z * u + t2.z * v;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(worldPositions, 3));
  if (uvGeometry.index) geometry.setIndex(uvGeometry.index.clone());
  uvGeometry.dispose();
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, SURFACE_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export type RuledAlignmentMode = 'direction' | 'tangent' | 'normal';

export function ruledSurface(
  sketchA: Sketch,
  sketchB: Sketch,
  alignmentMode: RuledAlignmentMode = 'direction',
  distance = 0,
): THREE.Mesh | null {
  if (sketchA.entities.length === 0 || sketchB.entities.length === 0) return null;

  const getWorldPoints = (sketch: Sketch): THREE.Vector3[] => {
    if (sketch.plane === 'custom') {
      const { t1, t2 } = getSketchAxesUtil(sketch);
      const origin = sketch.planeOrigin;
      const shape = sketchToShape(sketch);
      if (!shape) return [];
      return shape.getPoints(64).map(({ x: u, y: v }) =>
        new THREE.Vector3(
          origin.x + t1.x * u + t2.x * v,
          origin.y + t1.y * u + t2.y * v,
          origin.z + t1.z * u + t2.z * v,
        ),
      );
    }
    const shape = sketchToShape(sketch);
    if (!shape) return [];
    return shape.getPoints(64).map((point) => new THREE.Vector3(point.x, 0, point.y));
  };

  let ptsA = getWorldPoints(sketchA);
  const ptsB = getWorldPoints(sketchB);
  if (ptsA.length < 2 || ptsB.length < 2) return null;

  // Apply distance offset along alignment direction before ruling
  if (Math.abs(distance) > 1e-6) {
    const getAlignDir = (pts: THREE.Vector3[], idx: number): THREE.Vector3 => {
      const tangent = pts[Math.min(idx + 1, pts.length - 1)].clone().sub(pts[Math.max(idx - 1, 0)]).normalize();
      if (alignmentMode === 'tangent') return tangent;
      if (alignmentMode === 'normal') {
        // Approximate surface normal from two consecutive tangents
        const t2 = pts[Math.min(idx + 2, pts.length - 1)].clone().sub(pts[Math.max(idx, 0)]).normalize();
        const n = new THREE.Vector3().crossVectors(tangent, t2);
        return n.lengthSq() > 1e-12 ? n.normalize() : new THREE.Vector3(0, 1, 0);
      }
      // direction mode: rule lines along the vector from A to B per segment
      return new THREE.Vector3(0, 1, 0);
    };
    ptsA = ptsA.map((p, i) => p.clone().addScaledVector(getAlignDir(ptsA, i), distance));
  }

  const n = Math.min(ptsA.length, ptsB.length);
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    positions.push(ptsA[i].x, ptsA[i].y, ptsA[i].z);
    positions.push(ptsB[i].x, ptsB[i].y, ptsB[i].z);
  }

  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, c, b, d, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, SURFACE_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function sweepSketchInternal(profileSketch: Sketch, pathSketch: Sketch, surface = false): THREE.Mesh | null {
  if (profileSketch.entities.length === 0 || pathSketch.entities.length === 0) return null;

  const pathPoints: THREE.Vector3[] = [];
  for (const entity of pathSketch.entities) {
    for (const point of entity.points) pathPoints.push(new THREE.Vector3(point.x, point.y, point.z));
  }

  const deduped: THREE.Vector3[] = [pathPoints[0]];
  for (let i = 1; i < pathPoints.length; i++) {
    if (pathPoints[i].distanceTo(deduped[deduped.length - 1]) > 0.001) deduped.push(pathPoints[i]);
  }
  if (deduped.length < 2) return null;

  const frameCount = Math.max(32, deduped.length * 4);
  const curve = new THREE.CatmullRomCurve3(deduped, false, 'centripetal');
  const { t1, t2 } = getSketchAxesUtil(profileSketch);
  const profileOrigin = profileSketch.planeOrigin;
  const project = (p: SketchPoint): { u: number; v: number } => {
    const d = new THREE.Vector3(p.x - profileOrigin.x, p.y - profileOrigin.y, p.z - profileOrigin.z);
    return { u: d.dot(t1), v: d.dot(t2) };
  };
  const shape = entitiesToShape(profileSketch.entities, project);
  const profileSegments = 32;
  let profile2D: THREE.Vector2[];
  if (shape) {
    profile2D = shape.getPoints(profileSegments).map((point) => new THREE.Vector2(point.x, point.y));
  } else {
    profile2D = profileSketch.entities.flatMap((entity) => entity.points).map((point) => {
      const { u, v } = project(point);
      return new THREE.Vector2(u, v);
    });
  }
  if (profile2D.length < 2) return null;

  return sweepWithCurve(profile2D, curve, frameCount, surface);
}

function sweepWithCurve(
  profilePts2D: THREE.Vector2[],
  curve: THREE.CatmullRomCurve3,
  frameCount: number,
  surface = false,
): THREE.Mesh | null {
  const nProfile = profilePts2D.length;
  const positions: number[] = [];
  const indices: number[] = [];

  const frames = curve.computeFrenetFrames(frameCount, false);
  const curvePoints = curve.getPoints(frameCount);

  for (let i = 0; i <= frameCount; i++) {
    const fi = Math.min(i, frameCount - 1);
    const origin = curvePoints[i] ?? curvePoints[curvePoints.length - 1];
    const normal = frames.normals[fi];
    const binormal = frames.binormals[fi];
    for (let j = 0; j < nProfile; j++) {
      const { x: u, y: v } = profilePts2D[j];
      positions.push(
        origin.x + normal.x * u + binormal.x * v,
        origin.y + normal.y * u + binormal.y * v,
        origin.z + normal.z * u + binormal.z * v,
      );
    }
  }

  for (let i = 0; i < frameCount; i++) {
    for (let j = 0; j < nProfile - 1; j++) {
      const a = i * nProfile + j;
      const b = a + 1;
      const c = a + nProfile;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  if (!surface) {
    const startOffset = 0;
    for (let j = 1; j < nProfile - 1; j++) indices.push(startOffset, startOffset + j, startOffset + j + 1);
    const endOffset = frameCount * nProfile;
    for (let j = 1; j < nProfile - 1; j++) indices.push(endOffset, endOffset + j + 1, endOffset + j);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, surface ? SURFACE_MATERIAL : EXTRUDE_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
