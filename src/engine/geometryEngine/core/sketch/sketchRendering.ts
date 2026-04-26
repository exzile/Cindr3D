import * as THREE from 'three';
import type { Sketch, SketchEntity, SketchPlane, SketchPoint } from '../../../../types/cad';
import { BODY_MATERIAL, SURFACE_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import {
  CENTERLINE_MATERIAL,
  CONSTRUCTION_MATERIAL,
  ISOPARAMETRIC_MATERIAL,
  SKETCH_MATERIAL,
} from '../../materials';
import { getPlaneAxes as getPlaneAxesUtil, getSketchAxes as getSketchAxesUtil } from '../../planeUtils';

export function createSketchGeometry(sketch: Sketch): THREE.Group {
  const group = new THREE.Group();
  group.name = sketch.name;
  const axes = getSketchAxesUtil(sketch);
  for (const entity of sketch.entities) {
    const obj = createEntityGeometry(entity, sketch.plane, axes);
    if (obj) group.add(obj);
  }
  return group;
}

export function createEntityGeometry(
  entity: SketchEntity,
  plane: SketchPlane = 'XZ',
  axes?: { t1: THREE.Vector3; t2: THREE.Vector3 },
): THREE.Object3D | null {
  const material = SKETCH_MATERIAL;
  const planeAxes = axes ?? getPlaneAxesUtil(plane);
  switch (entity.type) {
    case 'line':              return createLine(entity.points, material);
    case 'construction-line': return createDashedLine(entity.points, CONSTRUCTION_MATERIAL);
    case 'centerline':        return createDashedLine(entity.points, CENTERLINE_MATERIAL);
    case 'circle':            return createCircle(entity, material, planeAxes);
    case 'rectangle':         return createRectangle(entity.points, material, planeAxes);
    case 'arc':               return createArc(entity, material, planeAxes);
    case 'point':             return createPointMarker(entity.points[0], planeAxes);
    case 'spline':            return createLine(entity.points, material);
    case 'ellipse':           return createEllipse(entity, material, planeAxes);
    case 'elliptical-arc':    return createEllipticalArc(entity, material, planeAxes);
    case 'isoparametric':     return createDashedLine(entity.points, ISOPARAMETRIC_MATERIAL);
    default: return null;
  }
}

export function createFilletGeometry(mesh: THREE.Mesh, _radius: number): THREE.Mesh {
  void _radius;

  const geometry = mesh.geometry.clone();
  const material = (mesh.material as THREE.Material).clone();
  return new THREE.Mesh(geometry, material);
}

function createPointMarker(
  point: SketchPoint | undefined,
  axes: { t1: THREE.Vector3; t2: THREE.Vector3 },
): THREE.Object3D | null {
  if (!point) return null;
  const size = 0.4;
  const { t1, t2 } = axes;
  const positions = new Float32Array([
    point.x - t1.x * size, point.y - t1.y * size, point.z - t1.z * size,
    point.x + t1.x * size, point.y + t1.y * size, point.z + t1.z * size,
    point.x - t2.x * size, point.y - t2.y * size, point.z - t2.z * size,
    point.x + t2.x * size, point.y + t2.y * size, point.z + t2.z * size,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.LineSegments(geometry, SKETCH_MATERIAL);
}

function createLine(points: SketchPoint[], material: THREE.LineBasicMaterial): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array(points.flatMap((p) => [p.x, p.y, p.z]));
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  return new THREE.Line(geometry, material);
}

function createDashedLine(points: SketchPoint[], material: THREE.LineDashedMaterial): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array(points.flatMap((p) => [p.x, p.y, p.z]));
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  return line;
}

function createCircle(
  entity: SketchEntity,
  material: THREE.LineBasicMaterial,
  axes: { t1: THREE.Vector3; t2: THREE.Vector3 },
): THREE.Line {
  const centerPoint = entity.points[0];
  const radius = entity.radius || 1;
  const segments = 64;
  const center = new THREE.Vector3(centerPoint.x, centerPoint.y, centerPoint.z);
  const { t1, t2 } = axes;
  const points: THREE.Vector3[] = [];

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(
      center.clone()
        .addScaledVector(t1, Math.cos(angle) * radius)
        .addScaledVector(t2, Math.sin(angle) * radius),
    );
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geometry, material);
}

function createRectangle(
  points: SketchPoint[],
  material: THREE.LineBasicMaterial,
  axes: { t1: THREE.Vector3; t2: THREE.Vector3 },
): THREE.Line {
  if (points.length < 2) return new THREE.Line(new THREE.BufferGeometry(), material);
  const v1 = new THREE.Vector3(points[0].x, points[0].y, points[0].z);
  const v2 = new THREE.Vector3(points[1].x, points[1].y, points[1].z);
  const { t1, t2 } = axes;
  const delta = v2.clone().sub(v1);
  const dt1 = t1.clone().multiplyScalar(delta.dot(t1));
  const dt2 = t2.clone().multiplyScalar(delta.dot(t2));
  const corners = [
    v1.clone(),
    v1.clone().add(dt1),
    v1.clone().add(dt1).add(dt2),
    v1.clone().add(dt2),
    v1.clone(),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(corners);
  return new THREE.Line(geometry, material);
}

function createArc(
  entity: SketchEntity,
  material: THREE.LineBasicMaterial,
  axes: { t1: THREE.Vector3; t2: THREE.Vector3 },
): THREE.Line {
  const centerPoint = entity.points[0];
  const radius = entity.radius || 1;
  const startAngle = entity.startAngle || 0;
  const endAngle = entity.endAngle || Math.PI;
  const segments = 32;
  const center = new THREE.Vector3(centerPoint.x, centerPoint.y, centerPoint.z);
  const { t1, t2 } = axes;
  const points: THREE.Vector3[] = [];

  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (i / segments) * (endAngle - startAngle);
    points.push(
      center.clone()
        .addScaledVector(t1, Math.cos(angle) * radius)
        .addScaledVector(t2, Math.sin(angle) * radius),
    );
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geometry, material);
}

function createEllipse(
  entity: SketchEntity,
  material: THREE.LineBasicMaterial,
  axes: { t1: THREE.Vector3; t2: THREE.Vector3 },
): THREE.Line {
  const { t1, t2 } = axes;
  const cx = entity.cx ?? entity.points[0]?.x ?? 0;
  const cy = entity.cy ?? entity.points[0]?.y ?? 0;
  const cz = entity.points[0]?.z ?? 0;
  const a = entity.majorRadius ?? 1;
  const b = entity.minorRadius ?? 0.5;
  const rot = entity.rotation ?? 0;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const segments = 64;
  const points: THREE.Vector3[] = [];
  const center = new THREE.Vector3(cx, cy, cz);
  const center3 = entity.points.length > 0
    ? new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z)
    : center;

  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const u = a * Math.cos(t) * cosR - b * Math.sin(t) * sinR;
    const v = a * Math.cos(t) * sinR + b * Math.sin(t) * cosR;
    points.push(center3.clone().addScaledVector(t1, u).addScaledVector(t2, v));
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geometry, material);
}

function createEllipticalArc(
  entity: SketchEntity,
  material: THREE.LineBasicMaterial,
  axes: { t1: THREE.Vector3; t2: THREE.Vector3 },
): THREE.Line {
  const { t1, t2 } = axes;
  const a = entity.majorRadius ?? 1;
  const b = entity.minorRadius ?? 0.5;
  const rot = entity.rotation ?? 0;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const sa = entity.startAngle ?? 0;
  const ea = entity.endAngle ?? Math.PI;
  const segments = 64;
  const points: THREE.Vector3[] = [];
  const center3 = entity.points.length > 0
    ? new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z)
    : new THREE.Vector3(0, 0, 0);

  for (let i = 0; i <= segments; i++) {
    const t = sa + (i / segments) * (ea - sa);
    const u = a * Math.cos(t) * cosR - b * Math.sin(t) * sinR;
    const v = a * Math.cos(t) * sinR + b * Math.sin(t) * cosR;
    points.push(center3.clone().addScaledVector(t1, u).addScaledVector(t2, v));
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geometry, material);
}

export { BODY_MATERIAL, SURFACE_MATERIAL };
