import * as THREE from 'three';
import type { Sketch, SketchPoint } from '../../../../types/cad';
import { BODY_MATERIAL, SURFACE_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { EXTRUDE_MATERIAL } from '../../materials';
import {
  getSketchAxes as getSketchAxesUtil,
  getSketchExtrudeNormal as getSketchExtrudeNormalUtil,
} from '../../planeUtils';
import { entitiesToShapes, sketchToShape } from '../sketch/sketchProfiles';
import { csgUnion } from './csg';
import { buildExtrudeGeomHolesAware } from './extrusionInternals';

function getRightHandedFrame(sketch: Sketch): { t1: THREE.Vector3; t2: THREE.Vector3; normal: THREE.Vector3 } {
  const { t1, t2 } = getSketchAxesUtil(sketch);
  const normal = sketch.planeNormal.clone().normalize();
  const frameT2 = t2.clone();
  if (new THREE.Vector3().crossVectors(t1, frameT2).dot(normal) < 0) frameT2.negate();
  return { t1, t2: frameT2, normal };
}

export function extrudeThinSketch(
  sketch: Sketch,
  distance: number,
  thickness: number,
  side: 'inside' | 'outside' | 'center',
): THREE.Mesh | null {
  if (sketch.entities.length === 0) return null;
  const { t1, t2 } = getSketchAxesUtil(sketch);
  const origin = sketch.planeOrigin;
  const projFn = (p: SketchPoint) => {
    const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    return { u: d.dot(t1), v: d.dot(t2) };
  };

  const outline: THREE.Vector2[] = [];
  for (const entity of sketch.entities) {
    if (entity.type === 'line' && entity.points.length >= 2) {
      const { u, v } = projFn(entity.points[0]);
      if (outline.length === 0) outline.push(new THREE.Vector2(u, v));
      const { u: u2, v: v2 } = projFn(entity.points[1]);
      outline.push(new THREE.Vector2(u2, v2));
    }
  }
  if (outline.length < 2) return extrudeSketch(sketch, distance);

  const offsetPts = (points: THREE.Vector2[], delta: number): THREE.Vector2[] => {
    const result: THREE.Vector2[] = [];
    for (let i = 0; i < points.length; i++) {
      const prev = points[(i - 1 + points.length) % points.length];
      const curr = points[i];
      const next = points[(i + 1) % points.length];
      const seg1 = new THREE.Vector2(curr.x - prev.x, curr.y - prev.y).normalize();
      const seg2 = new THREE.Vector2(next.x - curr.x, next.y - curr.y).normalize();
      const n1 = new THREE.Vector2(-seg1.y, seg1.x);
      const n2 = new THREE.Vector2(-seg2.y, seg2.x);
      const avg = n1.clone().add(n2).normalize();
      const dot = n1.dot(avg);
      const scale = dot > 0.01 ? 1 / dot : 1;
      result.push(new THREE.Vector2(curr.x + avg.x * delta * scale, curr.y + avg.y * delta * scale));
    }
    return result;
  };

  let outerOffset = 0;
  let innerOffset = 0;
  if (side === 'outside') {
    outerOffset = thickness;
  } else if (side === 'inside') {
    innerOffset = -thickness;
  } else {
    outerOffset = thickness / 2;
    innerOffset = -thickness / 2;
  }

  const outer = offsetPts(outline, outerOffset);
  const inner = offsetPts(outline, innerOffset);
  const shape = new THREE.Shape([...outer, ...inner.slice().reverse()]);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: distance, bevelEnabled: false });
  const mesh = new THREE.Mesh(geometry, EXTRUDE_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  orientExtrudedMesh(mesh, sketch);
  return mesh;
}

export function extrudeSketchWithTaper(sketch: Sketch, distance: number, taperAngleDeg: number): THREE.Mesh | null {
  if (Math.abs(taperAngleDeg) < 0.01) return extrudeSketch(sketch, distance);
  if (sketch.entities.length === 0) return null;

  const getPts2D = (): { u: number; v: number }[] => {
    if (sketch.plane === 'custom') {
      const { t1, t2 } = getSketchAxesUtil(sketch);
      const origin = sketch.planeOrigin;
      const pts: { u: number; v: number }[] = [];
      for (const entity of sketch.entities) {
        for (const point of entity.points) {
          const d = new THREE.Vector3(point.x - origin.x, point.y - origin.y, point.z - origin.z);
          pts.push({ u: d.dot(t1), v: d.dot(t2) });
        }
      }
      return pts;
    }
    const shape = sketchToShape(sketch);
    if (!shape) return [];
    return shape.getPoints(64).map((point) => ({ u: point.x, v: point.y }));
  };

  const shape = sketch.plane === 'custom' ? null : sketchToShape(sketch);
  const rawPts = sketch.plane === 'custom'
    ? getPts2D()
    : (shape ? shape.getPoints(64).map((point) => ({ u: point.x, v: point.y })) : []);
  if (rawPts.length < 3) return extrudeSketch(sketch, distance);

  const cx = rawPts.reduce((sum, point) => sum + point.u, 0) / rawPts.length;
  const cy = rawPts.reduce((sum, point) => sum + point.v, 0) / rawPts.length;
  const taperRad = taperAngleDeg * Math.PI / 180;
  const steps = Math.max(3, Math.min(20, Math.ceil(Math.abs(distance) / 2) + 2));
  const nPts = rawPts.length;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < steps; i++) {
    const z = distance * i / (steps - 1);
    const scaleFactor = 1 + Math.tan(taperRad) * (i / (steps - 1));
    for (const point of rawPts) {
      positions.push(cx + (point.u - cx) * scaleFactor, cy + (point.v - cy) * scaleFactor, z);
    }
  }

  for (let ring = 0; ring < steps - 1; ring++) {
    const base0 = ring * nPts;
    const base1 = (ring + 1) * nPts;
    for (let j = 0; j < nPts; j++) {
      const next = (j + 1) % nPts;
      indices.push(base0 + j, base1 + j, base0 + next);
      indices.push(base0 + next, base1 + j, base1 + next);
    }
  }

  const bottomCenter = positions.length / 3;
  positions.push(cx, cy, 0);
  for (let j = 0; j < nPts; j++) indices.push(bottomCenter, (j + 1) % nPts, j);

  const topRingBase = (steps - 1) * nPts;
  const topCenter = positions.length / 3;
  positions.push(cx, cy, distance);
  for (let j = 0; j < nPts; j++) indices.push(topCenter, topRingBase + j, topRingBase + (j + 1) % nPts);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));

  const mesh = new THREE.Mesh(geometry, EXTRUDE_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  orientExtrudedMesh(mesh, sketch);
  return mesh;
}

export function extrudeSketch(sketch: Sketch, distance: number, profileIndex?: number): THREE.Mesh | null {
  if (sketch.entities.length === 0) return null;

  if (sketch.plane === 'custom') {
    return extrudeCustomPlaneSketch(sketch, distance, profileIndex);
  }

  const { t1, t2, normal } = getRightHandedFrame(sketch);
  const origin = sketch.planeOrigin;
  const project = (p: SketchPoint): { u: number; v: number } => {
    const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    return { u: d.dot(t1), v: d.dot(t2) };
  };

  const allShapes = entitiesToShapes(sketch.entities, project);
  const shapes = profileIndex === undefined ? allShapes : (allShapes[profileIndex] ? [allShapes[profileIndex]] : []);
  if (shapes.length === 0) return null;

  const geometry = buildExtrudeGeomHolesAware(shapes, {
    depth: distance,
    bevelEnabled: false,
  });
  const mesh = new THREE.Mesh(geometry, EXTRUDE_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const basis = new THREE.Matrix4().makeBasis(t1, t2, normal);
  mesh.quaternion.setFromRotationMatrix(basis);
  mesh.position.copy(origin);
  return mesh;
}

export function extrudeSketchSurface(sketch: Sketch, distance: number): THREE.Mesh | null {
  if (sketch.entities.length === 0) return null;
  const { t1, t2 } = getSketchAxesUtil(sketch);
  const origin = sketch.planeOrigin;
  const project = (p: SketchPoint) => {
    const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    return { u: d.dot(t1), v: d.dot(t2) };
  };
  const shapes = entitiesToShapes(sketch.entities, project);
  if (shapes.length === 0) return null;

  let outlineLoops2D = shapes.map((shape) => shape.getPoints(64).map((point) => ({ u: point.x, v: point.y })));
  outlineLoops2D = outlineLoops2D.filter((loop) => loop.length >= 2);
  if (outlineLoops2D.length === 0) return null;

  const positions: number[] = [];
  const indices: number[] = [];

  const addWallQuad = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
  ) => {
    const i = positions.length / 3;
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };

  const normal = sketch.planeNormal.clone().normalize();
  for (const outline2D of outlineLoops2D) {
    for (let i = 0; i < outline2D.length - 1; i++) {
      const a = outline2D[i];
      const b = outline2D[i + 1];
      const ax = origin.x + t1.x * a.u + t2.x * a.v;
      const ay = origin.y + t1.y * a.u + t2.y * a.v;
      const az = origin.z + t1.z * a.u + t2.z * a.v;
      const bx = origin.x + t1.x * b.u + t2.x * b.v;
      const by = origin.y + t1.y * b.u + t2.y * b.v;
      const bz = origin.z + t1.z * b.u + t2.z * b.v;
      addWallQuad(
        ax, ay, az,
        bx, by, bz,
        bx + normal.x * distance, by + normal.y * distance, bz + normal.z * distance,
        ax + normal.x * distance, ay + normal.y * distance, az + normal.z * distance,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, SURFACE_MATERIAL);
}

export function buildExtrudeFeatureMesh(
  sketch: Sketch,
  distance: number,
  direction: 'positive' | 'negative' | 'symmetric' | 'two-sides',
  taperAngleDeg = 0,
  startOffset = 0,
  distance2 = 0,
  taperAngleDeg2 = taperAngleDeg,
): THREE.Mesh | null {
  if (direction === 'two-sides') {
    const meshPos = Math.abs(taperAngleDeg) > 0.01
      ? extrudeSketchWithTaper(sketch, distance, taperAngleDeg)
      : extrudeSketch(sketch, distance);
    const meshNeg = Math.abs(taperAngleDeg2) > 0.01
      ? extrudeSketchWithTaper(sketch, distance2 || distance, taperAngleDeg2)
      : extrudeSketch(sketch, distance2 || distance);
    if (!meshPos) return meshNeg;
    if (!meshNeg) return meshPos;

    const normal = getSketchExtrudeNormalUtil(sketch);
    meshNeg.position.addScaledVector(normal, -(distance2 || distance));
    meshPos.updateMatrixWorld(true);
    meshNeg.updateMatrixWorld(true);
    const gPos = meshPos.geometry.clone().applyMatrix4(meshPos.matrixWorld);
    const gNeg = meshNeg.geometry.clone().applyMatrix4(meshNeg.matrixWorld);
    const merged = csgUnion(gPos, gNeg);
    gPos.dispose();
    gNeg.dispose();
    meshPos.geometry.dispose();
    meshNeg.geometry.dispose();
    const result = new THREE.Mesh(merged, BODY_MATERIAL);
    result.castShadow = true;
    result.receiveShadow = true;
    return result;
  }

  const mesh = Math.abs(taperAngleDeg) > 0.01
    ? extrudeSketchWithTaper(sketch, distance, taperAngleDeg)
    : extrudeSketch(sketch, distance);
  if (!mesh) return null;

  const normal = getSketchExtrudeNormalUtil(sketch);
  if (direction === 'symmetric') {
    mesh.position.addScaledVector(normal, -distance / 2);
  } else if (direction === 'negative') {
    mesh.position.addScaledVector(normal, -distance);
  }
  if (Math.abs(startOffset) > 0.001) {
    mesh.position.addScaledVector(normal, startOffset);
  }
  return mesh;
}

export function buildExtrudeFeatureEdges(sketch: Sketch, distance: number): THREE.BufferGeometry | null {
  if (sketch.entities.length === 0 || Math.abs(distance) < 0.001) return null;

  const { t1, t2 } = getRightHandedFrame(sketch);
  const origin = sketch.planeOrigin;
  const project = (p: SketchPoint): { u: number; v: number } => {
    const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    return { u: d.dot(t1), v: d.dot(t2) };
  };
  const shapes = entitiesToShapes(sketch.entities, project);
  if (shapes.length === 0) return null;

  const positions: number[] = [];
  const z0 = 0;
  const z1 = distance;
  const segments = 64;
  const sharpCos = Math.cos(Math.PI / 12);

  const stripClosing = (points: THREE.Vector2[]): THREE.Vector2[] =>
    points.length >= 2 && points[points.length - 1].distanceTo(points[0]) < 1e-6 ? points.slice(0, -1) : points;

  const addLoop = (points: THREE.Vector2[], z: number) => {
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      positions.push(a.x, a.y, z, b.x, b.y, z);
    }
  };

  const d1 = new THREE.Vector2();
  const d2 = new THREE.Vector2();
  const addSharpVerticals = (points: THREE.Vector2[]) => {
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const curr = points[i];
      const next = points[(i + 1) % n];
      d1.subVectors(curr, prev);
      d2.subVectors(next, curr);
      if (d1.lengthSq() < 1e-12 || d2.lengthSq() < 1e-12) continue;
      d1.normalize();
      d2.normalize();
      if (d1.dot(d2) < sharpCos) positions.push(curr.x, curr.y, z0, curr.x, curr.y, z1);
    }
  };

  for (const shape of shapes) {
    const outer = stripClosing(shape.getPoints(segments));
    if (outer.length >= 2) {
      addLoop(outer, z0);
      addLoop(outer, z1);
      addSharpVerticals(outer);
    }
    for (const hole of shape.holes) {
      const holePts = stripClosing(hole.getPoints(segments));
      if (holePts.length < 2) continue;
      addLoop(holePts, z0);
      addLoop(holePts, z1);
      addSharpVerticals(holePts);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function extrudeCustomPlaneSketch(sketch: Sketch, distance: number, profileIndex?: number): THREE.Mesh | null {
  const { t1, t2, normal } = getRightHandedFrame(sketch);
  const origin = sketch.planeOrigin;
  const project = (p: SketchPoint): { u: number; v: number } => {
    const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    return { u: d.dot(t1), v: d.dot(t2) };
  };
  const allShapes = entitiesToShapes(sketch.entities, project);
  const shapes = profileIndex === undefined ? allShapes : (allShapes[profileIndex] ? [allShapes[profileIndex]] : []);
  if (shapes.length === 0) return null;

  const geometry = buildExtrudeGeomHolesAware(shapes, { depth: distance, bevelEnabled: false });
  const mesh = new THREE.Mesh(geometry, EXTRUDE_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const basis = new THREE.Matrix4().makeBasis(t1, t2, normal);
  mesh.quaternion.setFromRotationMatrix(basis);
  mesh.position.copy(origin);
  return mesh;
}

function orientExtrudedMesh(mesh: THREE.Mesh, sketch: Sketch): void {
  const { t1, t2 } = getSketchAxesUtil(sketch);
  const normal = sketch.planeNormal.clone().normalize();
  const basis = new THREE.Matrix4().makeBasis(t1, t2, normal);
  mesh.quaternion.setFromRotationMatrix(basis);
  mesh.position.copy(sketch.planeOrigin);
}
