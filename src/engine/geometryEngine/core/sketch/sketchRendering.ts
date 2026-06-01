import * as THREE from 'three';
import type { Sketch, SketchEntity, SketchPlane, SketchPoint } from '../../../../types/cad';
import { BODY_MATERIAL, SURFACE_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import {
  CENTERLINE_MATERIAL,
  CONSTRUCTION_MATERIAL,
  ISOPARAMETRIC_MATERIAL,
  OPEN_SKETCH_MATERIAL,
  SKETCH_MATERIAL,
} from '../../materials';
import { getPlaneAxes as getPlaneAxesUtil, getSketchAxes as getSketchAxesUtil } from '../../planeUtils';

const SKETCH_RENDER_ORDER = 1000;
const PROFILE_BOUNDARY_TYPES = new Set<SketchEntity['type']>([
  'line',
  'arc',
  'spline',
  'fixed-spline',
  'elliptical-arc',
]);
const CLOSED_PROFILE_TYPES = new Set<SketchEntity['type']>([
  'circle',
  'ellipse',
  'rectangle',
  'polygon',
]);
function setSketchRenderOrder<T extends THREE.Object3D>(object: T): T {
  object.renderOrder = SKETCH_RENDER_ORDER;
  return object;
}

function getBoundaryEndpoints(
  entity: SketchEntity,
  axes: { t1: THREE.Vector3; t2: THREE.Vector3 },
): [THREE.Vector3, THREE.Vector3] | null {
  if (!PROFILE_BOUNDARY_TYPES.has(entity.type)) return null;
  if (entity.type === 'arc') {
    if (entity.points.length < 1 || !entity.radius) return null;
    const center = entity.points[0];
    const startAngle = entity.startAngle ?? 0;
    const endAngle = entity.endAngle ?? Math.PI;
    const endpoint = (angle: number) => new THREE.Vector3(
      center.x + Math.cos(angle) * entity.radius! * axes.t1.x + Math.sin(angle) * entity.radius! * axes.t2.x,
      center.y + Math.cos(angle) * entity.radius! * axes.t1.y + Math.sin(angle) * entity.radius! * axes.t2.y,
      center.z + Math.cos(angle) * entity.radius! * axes.t1.z + Math.sin(angle) * entity.radius! * axes.t2.z,
    );
    return [endpoint(startAngle), endpoint(endAngle)];
  }
  if (entity.type === 'elliptical-arc') {
    if (entity.points.length < 1 || !entity.majorRadius || !entity.minorRadius) return null;
    const center = entity.points[0];
    const rotation = entity.rotation ?? 0;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    const endpoint = (angle: number) => {
      const x = entity.majorRadius! * Math.cos(angle);
      const y = entity.minorRadius! * Math.sin(angle);
      const u = cosR * x - sinR * y;
      const v = sinR * x + cosR * y;
      return new THREE.Vector3(
        center.x + u * axes.t1.x + v * axes.t2.x,
        center.y + u * axes.t1.y + v * axes.t2.y,
        center.z + u * axes.t1.z + v * axes.t2.z,
      );
    };
    return [endpoint(entity.startAngle ?? 0), endpoint(entity.endAngle ?? Math.PI)];
  }
  if (entity.points.length < 2) return null;
  const start = entity.points[0];
  const end = entity.points[entity.points.length - 1];
  return [
    new THREE.Vector3(start.x, start.y, start.z),
    new THREE.Vector3(end.x, end.y, end.z),
  ];
}

function closedProfileEntityIds(
  entities: SketchEntity[],
  axes: { t1: THREE.Vector3; t2: THREE.Vector3 },
): Set<string> {
  const closedIds = new Set<string>();
  const rawEdges: Array<{ id: string; endpoints: [THREE.Vector3, THREE.Vector3] }> = [];
  const nodes: THREE.Vector3[] = [];
  const edges: Array<{ id: string; a: number; b: number }> = [];
  const adjacency = new Map<number, Array<{ edgeIndex: number; neighbor: number }>>();

  const addAdjacency = (from: number, to: number, edgeIndex: number) => {
    const list = adjacency.get(from) ?? [];
    list.push({ edgeIndex, neighbor: to });
    adjacency.set(from, list);
  };

  for (const entity of entities) {
    if (entity.isConstruction || entity.type === 'construction-line' || entity.type === 'centerline') continue;
    if (CLOSED_PROFILE_TYPES.has(entity.type)) {
      closedIds.add(entity.id);
      continue;
    }
    const endpoints = getBoundaryEndpoints(entity, axes);
    if (!endpoints) continue;
    const [a, b] = endpoints;
    if (a.distanceTo(b) <= 1e-5) {
      closedIds.add(entity.id);
      continue;
    }
    rawEdges.push({ id: entity.id, endpoints });
    nodes.push(a, b);
  }

  if (rawEdges.length === 0) return closedIds;

  const box = new THREE.Box3().setFromPoints(nodes);
  const extent = box.getSize(new THREE.Vector3()).length();
  const joinTolerance = Math.min(1.0, Math.max(1e-5, 0.02 * extent));
  const mergedNodes: THREE.Vector3[] = [];
  // Spatial hash: O(1) average lookup instead of O(n) linear scan.
  const spatialCells = new Map<string, number[]>();
  const invTol = 1 / joinTolerance;
  const nodeIndexFor = (point: THREE.Vector3): number => {
    const cx = Math.floor(point.x * invTol);
    const cy = Math.floor(point.y * invTol);
    const cz = Math.floor(point.z * invTol);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const candidates = spatialCells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!candidates) continue;
          for (const idx of candidates) {
            if (mergedNodes[idx].distanceTo(point) <= joinTolerance) return idx;
          }
        }
      }
    }
    const idx = mergedNodes.length;
    mergedNodes.push(point);
    const key = `${cx},${cy},${cz}`;
    const list = spatialCells.get(key) ?? [];
    list.push(idx);
    spatialCells.set(key, list);
    return idx;
  };

  for (const raw of rawEdges) {
    const a = nodeIndexFor(raw.endpoints[0]);
    const b = nodeIndexFor(raw.endpoints[1]);
    if (a === b) {
      closedIds.add(raw.id);
      continue;
    }
    const edgeIndex = edges.length;
    edges.push({ id: raw.id, a, b });
    addAdjacency(a, b, edgeIndex);
    addAdjacency(b, a, edgeIndex);
  }

  const visited = new Set<number>();
  const discovery = new Map<number, number>();
  const low = new Map<number, number>();
  let time = 0;

  const visit = (node: number, parentEdgeIndex: number) => {
    discovery.set(node, time);
    low.set(node, time);
    time += 1;

    for (const next of adjacency.get(node) ?? []) {
      if (next.edgeIndex === parentEdgeIndex) continue;
      if (!discovery.has(next.neighbor)) {
        visited.add(next.edgeIndex);
        visit(next.neighbor, next.edgeIndex);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(next.neighbor) ?? 0));
        if ((low.get(next.neighbor) ?? 0) > (discovery.get(node) ?? 0)) {
          visited.delete(next.edgeIndex);
        }
      } else {
        low.set(node, Math.min(low.get(node) ?? 0, discovery.get(next.neighbor) ?? 0));
        visited.add(next.edgeIndex);
      }
    }
  };

  for (const edge of edges) {
    if (!discovery.has(edge.a)) visit(edge.a, -1);
    if (!discovery.has(edge.b)) visit(edge.b, -1);
  }

  for (const edgeIndex of visited) {
    closedIds.add(edges[edgeIndex].id);
  }

  return closedIds;
}

export function createSketchGeometry(sketch: Sketch): THREE.Group {
  const group = new THREE.Group();
  group.name = sketch.name;
  group.renderOrder = SKETCH_RENDER_ORDER;
  const axes = getSketchAxesUtil(sketch);
  const closedEntityIds = closedProfileEntityIds(sketch.entities, axes);

  // Merge all solid lines into two batched LineSegments (one per material).
  // This collapses N draw calls (one per polygon edge) → 2 regardless of entity count.
  const closedBuf: number[] = [];
  const openBuf: number[] = [];

  for (const entity of sketch.entities) {
    // Dashed types need per-object computeLineDistances — keep separate (few of them).
    if (
      entity.type === 'construction-line' ||
      entity.type === 'centerline' ||
      entity.type === 'isoparametric'
    ) {
      const obj = createEntityGeometry(entity, sketch.plane, axes, false);
      if (obj) group.add(obj);
      continue;
    }
    // Ellipse axis dashes are built inside createEntityGeometry — keep separate.
    if (entity.type === 'ellipse') {
      const obj = createEntityGeometry(entity, sketch.plane, axes, closedEntityIds.has(entity.id));
      if (obj) group.add(obj);
      continue;
    }
    // Points always use SKETCH_MATERIAL regardless of profile status.
    const buf = entity.type === 'point' || closedEntityIds.has(entity.id) ? closedBuf : openBuf;
    appendEntitySegments(entity, axes, buf);
  }

  if (closedBuf.length > 0) group.add(makeBatchedLineSegments(closedBuf, SKETCH_MATERIAL));
  if (openBuf.length > 0) group.add(makeBatchedLineSegments(openBuf, OPEN_SKETCH_MATERIAL));

  return group;
}

function makeBatchedLineSegments(buf: number[], material: THREE.LineBasicMaterial): THREE.LineSegments {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf), 3));
  const ls = new THREE.LineSegments(geo, material);
  ls.renderOrder = SKETCH_RENDER_ORDER;
  return ls;
}

/** Push vertex pairs (as LineSegments-style [a,b,b,c,...]) for one entity into buf. */
function appendEntitySegments(
  entity: SketchEntity,
  axes: { t1: THREE.Vector3; t2: THREE.Vector3 },
  buf: number[],
): void {
  const { t1, t2 } = axes;
  const seg = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
  ) => { buf.push(ax, ay, az, bx, by, bz); };

  switch (entity.type) {
    case 'line':
    case 'spline': {
      const pts = entity.points;
      for (let i = 0; i < pts.length - 1; i++) {
        seg(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
      }
      break;
    }
    case 'circle': {
      if (!entity.points[0] || !entity.radius) break;
      const c = entity.points[0];
      const r = entity.radius;
      const N = 64;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2;
        const a1 = ((i + 1) / N) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        seg(
          c.x + c0 * r * t1.x + s0 * r * t2.x,
          c.y + c0 * r * t1.y + s0 * r * t2.y,
          c.z + c0 * r * t1.z + s0 * r * t2.z,
          c.x + c1 * r * t1.x + s1 * r * t2.x,
          c.y + c1 * r * t1.y + s1 * r * t2.y,
          c.z + c1 * r * t1.z + s1 * r * t2.z,
        );
      }
      break;
    }
    case 'arc': {
      if (!entity.points[0] || !entity.radius) break;
      const c = entity.points[0];
      const r = entity.radius;
      const sa = entity.startAngle ?? 0;
      let ea = entity.endAngle ?? Math.PI;
      if (ea <= sa) ea += Math.PI * 2;
      const N = 32;
      const span = ea - sa;
      for (let i = 0; i < N; i++) {
        const a0 = sa + (i / N) * span;
        const a1 = sa + ((i + 1) / N) * span;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        seg(
          c.x + c0 * r * t1.x + s0 * r * t2.x,
          c.y + c0 * r * t1.y + s0 * r * t2.y,
          c.z + c0 * r * t1.z + s0 * r * t2.z,
          c.x + c1 * r * t1.x + s1 * r * t2.x,
          c.y + c1 * r * t1.y + s1 * r * t2.y,
          c.z + c1 * r * t1.z + s1 * r * t2.z,
        );
      }
      break;
    }
    case 'rectangle': {
      if (entity.points.length < 2) break;
      const p1 = entity.points[0];
      const p2 = entity.points[1];
      const v1 = new THREE.Vector3(p1.x, p1.y, p1.z);
      const v2 = new THREE.Vector3(p2.x, p2.y, p2.z);
      const delta = v2.clone().sub(v1);
      const dt1 = t1.clone().multiplyScalar(delta.dot(t1));
      const dt2 = t2.clone().multiplyScalar(delta.dot(t2));
      const c = [
        v1.clone(),
        v1.clone().add(dt1),
        v1.clone().add(dt1).add(dt2),
        v1.clone().add(dt2),
      ];
      for (let i = 0; i < 4; i++) {
        const a = c[i], b = c[(i + 1) % 4];
        seg(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      break;
    }
    case 'elliptical-arc': {
      const a = entity.majorRadius ?? 1;
      const b = entity.minorRadius ?? 0.5;
      const rot = entity.rotation ?? 0;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);
      const sa = entity.startAngle ?? 0;
      let ea = entity.endAngle ?? Math.PI;
      if (ea <= sa) ea += Math.PI * 2;
      const N = 64;
      const span = ea - sa;
      const ctr = entity.points[0]
        ? new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z)
        : new THREE.Vector3();
      for (let i = 0; i < N; i++) {
        const t0 = sa + (i / N) * span;
        const t1v = sa + ((i + 1) / N) * span;
        const u0 = a * Math.cos(t0) * cosR - b * Math.sin(t0) * sinR;
        const v0 = a * Math.cos(t0) * sinR + b * Math.sin(t0) * cosR;
        const u1 = a * Math.cos(t1v) * cosR - b * Math.sin(t1v) * sinR;
        const v1v = a * Math.cos(t1v) * sinR + b * Math.sin(t1v) * cosR;
        seg(
          ctr.x + u0 * t1.x + v0 * t2.x,
          ctr.y + u0 * t1.y + v0 * t2.y,
          ctr.z + u0 * t1.z + v0 * t2.z,
          ctr.x + u1 * t1.x + v1v * t2.x,
          ctr.y + u1 * t1.y + v1v * t2.y,
          ctr.z + u1 * t1.z + v1v * t2.z,
        );
      }
      break;
    }
    case 'point': {
      if (!entity.points[0]) break;
      const p = entity.points[0];
      const size = 0.4;
      seg(
        p.x - t1.x * size, p.y - t1.y * size, p.z - t1.z * size,
        p.x + t1.x * size, p.y + t1.y * size, p.z + t1.z * size,
      );
      seg(
        p.x - t2.x * size, p.y - t2.y * size, p.z - t2.z * size,
        p.x + t2.x * size, p.y + t2.y * size, p.z + t2.z * size,
      );
      break;
    }
    // 'ellipse' and dashed types are handled in createSketchGeometry directly.
  }
}

export function createEntityGeometry(
  entity: SketchEntity,
  plane: SketchPlane = 'XZ',
  axes?: { t1: THREE.Vector3; t2: THREE.Vector3 },
  closedProfile = true,
): THREE.Object3D | null {
  const material = closedProfile ? SKETCH_MATERIAL : OPEN_SKETCH_MATERIAL;
  const planeAxes = axes ?? getPlaneAxesUtil(plane);
  switch (entity.type) {
    case 'line':              return createLine(entity.points, material);
    case 'construction-line': return createDashedLine(entity.points, CONSTRUCTION_MATERIAL);
    case 'centerline':        return createDashedLine(entity.points, CENTERLINE_MATERIAL);
    case 'circle':            return createCircle(entity, material, planeAxes);
    case 'rectangle':         return createRectangle(entity.points, material, planeAxes);
    case 'arc':               return createArc(entity, material, planeAxes);
    case 'point':             return createPointMarker(entity.points[0], planeAxes);
    case 'spline':
    case 'fixed-spline':     return createLine(entity.points, material);
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
  return setSketchRenderOrder(new THREE.LineSegments(geometry, SKETCH_MATERIAL));
}

function createLine(points: SketchPoint[], material: THREE.LineBasicMaterial): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array(points.flatMap((p) => [p.x, p.y, p.z]));
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  return setSketchRenderOrder(new THREE.Line(geometry, material));
}

function createDashedLine(points: SketchPoint[], material: THREE.LineDashedMaterial): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array(points.flatMap((p) => [p.x, p.y, p.z]));
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  const line = new THREE.Line(geometry, material);
  line.renderOrder = SKETCH_RENDER_ORDER;
  line.computeLineDistances();
  return line;
}

function createCircle(
  entity: SketchEntity,
  material: THREE.LineBasicMaterial,
  axes: { t1: THREE.Vector3; t2: THREE.Vector3 },
): THREE.Line {
  if (entity.points.length < 1) return setSketchRenderOrder(new THREE.Line(new THREE.BufferGeometry(), material));
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
  return setSketchRenderOrder(new THREE.Line(geometry, material));
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
  return setSketchRenderOrder(new THREE.Line(geometry, material));
}

function createArc(
  entity: SketchEntity,
  material: THREE.LineBasicMaterial,
  axes: { t1: THREE.Vector3; t2: THREE.Vector3 },
): THREE.Line {
  if (entity.points.length < 1) return setSketchRenderOrder(new THREE.Line(new THREE.BufferGeometry(), material));
  const centerPoint = entity.points[0];
  const radius = entity.radius || 1;
  const startAngle = entity.startAngle ?? 0;
  let endAngle = entity.endAngle ?? Math.PI;
  if (endAngle <= startAngle) endAngle += Math.PI * 2;
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
  return setSketchRenderOrder(new THREE.Line(geometry, material));
}

function createEllipse(
  entity: SketchEntity,
  material: THREE.LineBasicMaterial,
  axes: { t1: THREE.Vector3; t2: THREE.Vector3 },
): THREE.Object3D {
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

  const curve = setSketchRenderOrder(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));

  // Fusion shows the major/minor axes as dashed construction lines through the
  // centre. Build them in the ellipse's rotated frame and group with the curve.
  const majorDir = t1.clone().multiplyScalar(cosR).add(t2.clone().multiplyScalar(sinR));
  const minorDir = t1.clone().multiplyScalar(-sinR).add(t2.clone().multiplyScalar(cosR));
  const axisLine = (dir: THREE.Vector3, len: number): THREE.Line => {
    const geom = new THREE.BufferGeometry().setFromPoints([
      center3.clone().addScaledVector(dir, -len),
      center3.clone().addScaledVector(dir, len),
    ]);
    const line = new THREE.Line(geom, CONSTRUCTION_MATERIAL);
    line.computeLineDistances();
    return setSketchRenderOrder(line);
  };

  const group = new THREE.Group();
  group.add(curve);
  group.add(axisLine(majorDir, a));
  group.add(axisLine(minorDir, b));
  return group;
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
  let ea = entity.endAngle ?? Math.PI;
  if (ea <= sa) ea += Math.PI * 2;
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
  return setSketchRenderOrder(new THREE.Line(geometry, material));
}

export { BODY_MATERIAL, SURFACE_MATERIAL };
