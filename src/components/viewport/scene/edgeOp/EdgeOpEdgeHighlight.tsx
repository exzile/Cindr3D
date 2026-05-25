import { useRef, useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useFrame, useThree, invalidate as invalidateFrame } from "@react-three/fiber";
import { buildPolylineGeometry } from "../pickerGeometry";
import { applyLinePulse } from "../pickPulse";
import { useOccEdgePicker, type OccEdgePickResult } from "../OccEdgePicker";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import { migrateLegacyExtrudeFeatures } from "../../../../engine/occ/legacyMigration";
import { getOcc } from "../../../../engine/occ/loader";
import {
  attachTessellationToMesh,
  getMeshTessellation,
} from "../../../../engine/occ/picking";
import type { BRepTessellation } from "../../../../engine/occ/brepBody";
import type { BodyTopology } from "../../../../engine/geometryEngine/core/solid/edgeTypes";
import { extrudeProfileTopology } from "../../../../engine/geometryEngine/core/solid/profileTopology";
import { GeometryEngine } from "../../../../engine/GeometryEngine";
import { useCADStore } from "../../../../store/cadStore";
import type { Feature, Sketch } from "../../../../types/cad";

interface EdgeOpEdgeHighlightProps {
  enabled: boolean;
  edgeIds: string[];
  addEdge: (id: string) => void;
  removeEdge: (id: string) => void;
  selectedColor: number;
  allowCurvedEdges?: boolean;
}

const CSG_CUT_OVERTRAVEL_MM = 0.05;

function occEdgeId(result: OccEdgePickResult): string {
  return `occ:${result.bodyId}:${result.edgeId}`;
}

function getOccEdgePolyline(result: OccEdgePickResult): THREE.Vector3[] | null {
  const body = globalBRepBodyRegistry.get(result.bodyId);
  const pts = body?._tessellation?.edgePolylines.get(result.edgeId);
  if (!pts || pts.length < 6) return null;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < pts.length; i += 3) {
    out.push(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(result.mesh.matrixWorld));
  }
  return out.length >= 2 ? out : null;
}

function polylineIsCurved(polyline: Float32Array | THREE.Vector3[]): boolean {
  const count = Array.isArray(polyline) ? polyline.length : polyline.length / 3;
  if (count <= 2) return false;
  const first = Array.isArray(polyline)
    ? polyline[0]
    : new THREE.Vector3(polyline[0], polyline[1], polyline[2]);
  const last = Array.isArray(polyline)
    ? polyline[count - 1]
    : new THREE.Vector3(polyline[(count - 1) * 3], polyline[(count - 1) * 3 + 1], polyline[(count - 1) * 3 + 2]);
  const axis = last.clone().sub(first);
  const axisLen = axis.length();
  if (axisLen < 1e-8) return true;
  axis.divideScalar(axisLen);
  const tolerance = Math.max(axisLen * 1e-3, 1e-5);
  for (let index = 1; index < count - 1; index += 1) {
    const point = Array.isArray(polyline)
      ? polyline[index]
      : new THREE.Vector3(polyline[index * 3], polyline[index * 3 + 1], polyline[index * 3 + 2]);
    const offset = point.clone().sub(first);
    const projected = first.clone().addScaledVector(axis, offset.dot(axis));
    if (point.distanceTo(projected) > tolerance) return true;
  }
  return false;
}

function resolveMeshOccTessellation(mesh: THREE.Mesh) {
  let tess = getMeshTessellation(mesh);
  let bodyId = mesh.userData.brepBodyId as string | undefined;
  if (tess && bodyId) return { tess, bodyId };

  const body =
    (bodyId ? globalBRepBodyRegistry.get(bodyId) : undefined) ??
    ((mesh.userData.featureId as string | undefined)
      ? globalBRepBodyRegistry.getByFeature(mesh.userData.featureId as string)[0]
      : undefined);
  if (!body) return null;

  tess = body._tessellation ?? null;
  if (!tess) return null;
  bodyId = body.id;
  attachTessellationToMesh(mesh, tess, body.id);
  return { tess, bodyId };
}

function buildBatchedEdgeLineGeometry(
  tess: BRepTessellation,
  allowCurvedEdges: boolean,
): { geometry: THREE.BufferGeometry; edgeIdsBySegment: number[] } | null {
  const positions: number[] = [];
  const edgeIdsBySegment: number[] = [];

  for (const [edgeId, polyline] of tess.edgePolylines) {
    if (!allowCurvedEdges && polylineIsCurved(polyline)) continue;
    const pointCount = polyline.length / 3;
    if (pointCount < 2) continue;
    for (let index = 0; index < pointCount - 1; index += 1) {
      const a = index * 3;
      const b = (index + 1) * 3;
      positions.push(
        polyline[a],
        polyline[a + 1],
        polyline[a + 2],
        polyline[b],
        polyline[b + 1],
        polyline[b + 2],
      );
      edgeIdsBySegment.push(edgeId);
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return { geometry, edgeIdsBySegment };
}

function buildMeshTopologyGuideGeometry(
  mesh: THREE.Mesh,
  allowCurvedEdges: boolean,
  curvedOnly = false,
): THREE.BufferGeometry | null {
  const topology = mesh.geometry.userData?.topology as BodyTopology | undefined;
  const positions: number[] = [];
  const world = mesh.matrixWorld;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  if (!topology?.edges?.length) return null;
  for (const edge of topology.edges) {
    const curved = polylineIsCurved(edge.polyline);
    if (curvedOnly && !curved) continue;
    if (!allowCurvedEdges && curved) continue;
    if (edge.polyline.length < 2) continue;
    for (let index = 0; index < edge.polyline.length - 1; index += 1) {
      a.copy(edge.polyline[index]).applyMatrix4(world);
      b.copy(edge.polyline[index + 1]).applyMatrix4(world);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

function appendGuideGeometryPositions(
  target: number[],
  seen: Set<string>,
  geometry: THREE.BufferGeometry | null,
) {
  if (!geometry) return;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position || position.count < 2) return;

  const keyFor = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const a = `${Math.round(ax * 10000)},${Math.round(ay * 10000)},${Math.round(az * 10000)}`;
    const b = `${Math.round(bx * 10000)},${Math.round(by * 10000)},${Math.round(bz * 10000)}`;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };

  for (let index = 0; index + 1 < position.count; index += 2) {
    const ax = position.getX(index);
    const ay = position.getY(index);
    const az = position.getZ(index);
    const bx = position.getX(index + 1);
    const by = position.getY(index + 1);
    const bz = position.getZ(index + 1);
    const key = keyFor(ax, ay, az, bx, by, bz);
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(ax, ay, az, bx, by, bz);
  }
}

function mergeGuideGeometries(geometries: (THREE.BufferGeometry | null)[]): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const seen = new Set<string>();
  for (const geometry of geometries) {
    appendGuideGeometryPositions(positions, seen, geometry);
    geometry?.dispose();
  }
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

function projectClosedLoopToBoxFace(polyline: THREE.Vector3[], box: THREE.Box3): THREE.Vector3[] | null {
  if (polyline.length < 4 || polyline[0].distanceToSquared(polyline[polyline.length - 1]) > 1e-10) {
    return null;
  }

  const diag = Math.max(box.min.distanceTo(box.max), 1);
  const planeTol = Math.max(diag * 1e-6, 1e-6);
  const insideTol = Math.max(diag * 2e-3, 1e-4);
  const axes = ["x", "y", "z"] as const;

  for (const axis of axes) {
    let min = Infinity;
    let max = -Infinity;
    for (const point of polyline) {
      min = Math.min(min, point[axis]);
      max = Math.max(max, point[axis]);
    }
    if (max - min > planeTol) continue;
    const coord = (min + max) * 0.5;
    const target =
      coord < box.min[axis] ? box.min[axis] :
      coord > box.max[axis] ? box.max[axis] :
      undefined;
    if (target === undefined) continue;

    const otherAxes = axes.filter((candidate) => candidate !== axis);
    const overlapsFace = polyline.some((point) =>
      otherAxes.every((other) =>
        point[other] >= box.min[other] - insideTol &&
        point[other] <= box.max[other] + insideTol,
      ),
    );
    if (!overlapsFace) continue;

    return polyline.map((point) => {
      const next = point.clone();
      next[axis] = target;
      return next;
    });
  }

  return null;
}

function buildLegacyCutRimGuideGeometry(
  mesh: THREE.Mesh,
  features: Feature[],
  sketches: Sketch[],
  allowCurvedEdges: boolean,
): THREE.BufferGeometry | null {
  if (!allowCurvedEdges) return null;
  const featureId = mesh.userData.featureId as string | undefined;
  const feature = featureId ? features.find((candidate) => candidate.id === featureId) : undefined;
  const operation = feature?.params.operation ?? feature?.params.extrudeOperation;
  if (!feature || feature.type !== "extrude" || operation !== "cut") return null;
  if (mesh.userData.brepBodyId) return null;

  const sketch = sketches.find((candidate) => candidate.id === feature.sketchId);
  if (!sketch) return null;

  let distance = (feature.params.distance as number | undefined) ?? 10;
  let distance2 = (feature.params.distance2 as number | undefined) ?? distance;
  let startOffset = feature.params.startType === "offset"
    ? ((feature.params.startOffset as number | undefined) ?? 0)
    : 0;
  const direction = (feature.params.direction as "positive" | "negative" | "symmetric" | "two-sides" | undefined) ?? "positive";
  const taperAngle = (feature.params.taperAngle as number | undefined) ?? 0;
  const taperAngle2 = (feature.params.taperAngle2 as number | undefined) ?? taperAngle;
  const overtravel = Math.max(CSG_CUT_OVERTRAVEL_MM, Math.abs(distance) * 1e-4);
  if (direction === "positive") {
    startOffset -= overtravel;
    distance += overtravel * 2;
  } else if (direction === "negative") {
    startOffset += overtravel;
    distance += overtravel * 2;
  } else if (direction === "symmetric") {
    distance += overtravel * 2;
  } else {
    distance += overtravel;
    distance2 += Math.max(CSG_CUT_OVERTRAVEL_MM, Math.abs(distance2) * 1e-4);
  }

  const profileIndices = Array.isArray(feature.params.profileIndices)
    ? feature.params.profileIndices as number[]
    : feature.params.profileIndex !== undefined
      ? [feature.params.profileIndex as number]
      : [undefined];
  const bodyBox = new THREE.Box3().setFromBufferAttribute(
    mesh.geometry.getAttribute("position") as THREE.BufferAttribute,
  );
  const positions: number[] = [];
  const world = mesh.matrixWorld;
  for (const profileIndex of profileIndices) {
    const profileSketch = profileIndex !== undefined
      ? GeometryEngine.createProfileSketch(sketch, profileIndex)
      : sketch;
    if (!profileSketch) continue;
    const topology = extrudeProfileTopology(profileSketch, distance, direction, startOffset, distance2, taperAngle2);
    for (const edge of topology.edges) {
      if (!polylineIsCurved(edge.polyline)) continue;
      const projected = projectClosedLoopToBoxFace(edge.polyline, bodyBox);
      if (!projected || projected.length < 2) continue;
      for (let index = 0; index < projected.length - 1; index += 1) {
        const a = projected[index].clone().applyMatrix4(world);
        const b = projected[index + 1].clone().applyMatrix4(world);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

function appendCircularBoundaryGuidePositions(
  positions: number[],
  boundaryEdges: { a: THREE.Vector3; b: THREE.Vector3 }[],
  world: THREE.Matrix4,
  bounds: THREE.Box3,
) {
  if (boundaryEdges.length < 6) return;

  type Segment = { a: THREE.Vector3; b: THREE.Vector3 };
  type Bucket = { axis: 0 | 1 | 2; coord: number; segments: Segment[] };
  type CircleFit = { axis: 0 | 1 | 2; centerA: number; centerB: number; radius: number; score: number };

  const diag = Math.max(bounds.min.distanceTo(bounds.max), 1);
  const planeTol = Math.max(diag * 2e-3, 1e-4);
  const radialTol = Math.max(diag * 8e-3, 5e-4);
  const pointTolSq = planeTol * planeTol;
  const buckets: Bucket[] = [];
  const coordAt = (p: THREE.Vector3, axis: 0 | 1 | 2) =>
    axis === 0 ? p.x : axis === 1 ? p.y : p.z;
  const project = (p: THREE.Vector3, axis: 0 | 1 | 2): [number, number] => {
    if (axis === 0) return [p.y, p.z];
    if (axis === 1) return [p.x, p.z];
    return [p.x, p.y];
  };

  for (const edge of boundaryEdges) {
    let axis: 0 | 1 | 2 = 0;
    let span = Math.abs(edge.a.x - edge.b.x);
    const spanY = Math.abs(edge.a.y - edge.b.y);
    const spanZ = Math.abs(edge.a.z - edge.b.z);
    if (spanY < span) {
      axis = 1;
      span = spanY;
    }
    if (spanZ < span) {
      axis = 2;
      span = spanZ;
    }
    if (span > planeTol) continue;
    const coord = (coordAt(edge.a, axis) + coordAt(edge.b, axis)) * 0.5;
    let bucket = buckets.find((candidate) => candidate.axis === axis && Math.abs(candidate.coord - coord) <= planeTol);
    if (!bucket) {
      bucket = { axis, coord, segments: [] };
      buckets.push(bucket);
    }
    bucket.segments.push(edge);
  }

  const fitCircle3 = (
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
  ): { centerA: number; centerB: number; radius: number } | null => {
    const [x1, y1] = p1;
    const [x2, y2] = p2;
    const [x3, y3] = p3;
    const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
    if (Math.abs(d) < 1e-9) return null;
    const x1s = x1 * x1 + y1 * y1;
    const x2s = x2 * x2 + y2 * y2;
    const x3s = x3 * x3 + y3 * y3;
    const centerA = (x1s * (y2 - y3) + x2s * (y3 - y1) + x3s * (y1 - y2)) / d;
    const centerB = (x1s * (x3 - x2) + x2s * (x1 - x3) + x3s * (x2 - x1)) / d;
    const radius = Math.hypot(x1 - centerA, y1 - centerB);
    return Number.isFinite(radius) && radius > radialTol * 2
      ? { centerA, centerB, radius }
      : null;
  };

  for (const bucket of buckets) {
    const unique: THREE.Vector3[] = [];
    for (const segment of bucket.segments) {
      for (const point of [segment.a, segment.b]) {
        if (!unique.some((candidate) => candidate.distanceToSquared(point) <= pointTolSq)) {
          unique.push(point);
        }
      }
    }
    if (unique.length < 6) continue;
    const points = unique.slice(0, 96);
    const points2 = points.map((point) => project(point, bucket.axis));
    let best: CircleFit | null = null;
    for (let i = 0; i < points2.length - 2; i += 1) {
      for (let j = i + 1; j < points2.length - 1; j += 1) {
        for (let k = j + 1; k < points2.length; k += 1) {
          const fit = fitCircle3(points2[i], points2[j], points2[k]);
          if (!fit) continue;
          let score = 0;
          for (const [a, b] of points2) {
            if (Math.abs(Math.hypot(a - fit.centerA, b - fit.centerB) - fit.radius) <= radialTol) {
              score += 1;
            }
          }
          if (score >= 6 && (!best || score > best.score)) {
            best = { axis: bucket.axis, centerA: fit.centerA, centerB: fit.centerB, radius: fit.radius, score };
          }
        }
      }
    }
    if (!best) continue;

    const inlierAngles: number[] = [];
    for (const [a, b] of points2) {
      if (Math.abs(Math.hypot(a - best.centerA, b - best.centerB) - best.radius) <= radialTol) {
        inlierAngles.push(Math.atan2(b - best.centerB, a - best.centerA));
      }
    }
    inlierAngles.sort((a, b) => a - b);
    if (inlierAngles.length < 6) continue;
    const gaps = inlierAngles.map((angle, index) => {
      const next = inlierAngles[(index + 1) % inlierAngles.length];
      return index + 1 < inlierAngles.length ? next - angle : next + Math.PI * 2 - angle;
    });
    if (Math.max(...gaps) > Math.PI * 0.9) continue;

    const pointAt = (angle: number) => {
      const a = best!.centerA + Math.cos(angle) * best!.radius;
      const b = best!.centerB + Math.sin(angle) * best!.radius;
      if (best!.axis === 0) return new THREE.Vector3(bucket.coord, a, b);
      if (best!.axis === 1) return new THREE.Vector3(a, bucket.coord, b);
      return new THREE.Vector3(a, b, bucket.coord);
    };
    const segments = 96;
    let previous = pointAt(0).applyMatrix4(world);
    for (let index = 1; index <= segments; index += 1) {
      const next = pointAt((index / segments) * Math.PI * 2).applyMatrix4(world);
      positions.push(previous.x, previous.y, previous.z, next.x, next.y, next.z);
      previous = next;
    }
  }
}

function buildMergedMeshCreaseGuideGeometry(
  mesh: THREE.Mesh,
): THREE.BufferGeometry | null {
  const source = mesh.geometry;
  const merged = mergeVertices(source, 1e-4);
  const position = merged.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position || position.count < 3) {
    merged.dispose();
    return null;
  }

  const index = merged.index;
  const edgeMap = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; normals: THREE.Vector3[] }>();
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const q = (v: THREE.Vector3) => `${Math.round(v.x * 10000)},${Math.round(v.y * 10000)},${Math.round(v.z * 10000)}`;

  const addEdge = (a: THREE.Vector3, b: THREE.Vector3, normal: THREE.Vector3) => {
    const qa = q(a);
    const qb = q(b);
    const key = qa < qb ? `${qa}|${qb}` : `${qb}|${qa}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.normals.push(normal.clone());
      return;
    }
    edgeMap.set(key, { a: a.clone(), b: b.clone(), normals: [normal.clone()] });
  };

  const triCount = index ? index.count / 3 : position.count / 3;
  for (let tri = 0; tri < triCount; tri += 1) {
    const ia = index ? index.getX(tri * 3) : tri * 3;
    const ib = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
    const ic = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;
    p0.fromBufferAttribute(position, ia);
    p1.fromBufferAttribute(position, ib);
    p2.fromBufferAttribute(position, ic);
    n.subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
    if (n.lengthSq() < 1e-16) continue;
    n.normalize();
    addEdge(p0, p1, n);
    addEdge(p1, p2, n);
    addEdge(p2, p0, n);
  }

  // Mesh-only fallback geometry is faceted, so a low threshold turns every
  // cylinder segment into a fake selectable-looking edge. Keep this high and
  // only draw true rim/box creases; OCC-backed bodies still use exact curved
  // edge polylines above.
  const creaseThreshold = THREE.MathUtils.degToRad(20);
  const positions: number[] = [];
  const world = mesh.matrixWorld;
  const bounds = new THREE.Box3().setFromBufferAttribute(position);
  const roundCandidateEdges: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  for (const edge of edgeMap.values()) {
    let include = false;
    if (edge.normals.length === 1) {
      roundCandidateEdges.push({ a: edge.a, b: edge.b });
      continue;
    }
    if (!include) {
      for (let i = 0; !include && i < edge.normals.length; i += 1) {
        for (let j = i + 1; j < edge.normals.length; j += 1) {
          if (edge.normals[i].angleTo(edge.normals[j]) >= creaseThreshold) {
            include = true;
            break;
          }
        }
      }
    }
    if (!include) continue;
    roundCandidateEdges.push({ a: edge.a, b: edge.b });
    const a = edge.a.clone().applyMatrix4(world);
    const b = edge.b.clone().applyMatrix4(world);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  appendCircularBoundaryGuidePositions(positions, roundCandidateEdges, world, bounds);
  merged.dispose();

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

export default function EdgeOpEdgeHighlight({
  enabled,
  edgeIds,
  addEdge,
  removeEdge,
  selectedColor,
  allowCurvedEdges = false,
}: EdgeOpEdgeHighlightProps) {
  const hoverMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0x2196f3,
        linewidth: 2,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  const selectedMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: selectedColor,
        linewidth: 3,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [selectedColor],
  );
  const allEdgesMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0xff6a00,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => () => hoverMat.dispose(), [hoverMat]);
  useEffect(() => () => selectedMat.dispose(), [selectedMat]);
  useEffect(() => () => allEdgesMat.dispose(), [allEdgesMat]);

  const allEdgeLinesRef = useRef<THREE.LineSegments[]>([]);
  const hoverLineRef = useRef<THREE.Line | null>(null);
  const occHoverRef = useRef<OccEdgePickResult | null>(null);
  const renderedHoverIdRef = useRef<string | null>(null);
  const selectedLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  const selectedEdgesDataRef = useRef<Map<string, THREE.Vector3[]>>(new Map());
  const lastMigrationKeyRef = useRef<string | null>(null);
  const cursorOnRef = useRef(false);
  const { scene: _scene, gl } = useThree();
  const features = useCADStore((state) => state.features);
  const sketches = useCADStore((state) => state.sketches);

  const edgeSourceSignature = useMemo(
    () =>
      features
        .filter((feature) => feature.visible && !feature.suppressed)
        .map((feature) => `${feature.id}:${feature.timestamp}:${feature.mesh instanceof THREE.Mesh ? feature.mesh.uuid : ''}`)
        .join("|"),
    [features],
  );

  const edgeIdSet = useMemo(() => new Set(edgeIds), [edgeIds]);

  useEffect(() => {
    const sceneRef = _scene;
    const canvas = gl.domElement;
    const selectedLines = selectedLinesRef.current;
    const selectedEdges = selectedEdgesDataRef.current;
    return () => {
      if (hoverLineRef.current) {
        sceneRef.remove(hoverLineRef.current);
        hoverLineRef.current.geometry.dispose();
        hoverLineRef.current = null;
      }
      for (const line of allEdgeLinesRef.current) {
        sceneRef.remove(line);
        line.geometry.dispose();
      }
      allEdgeLinesRef.current = [];
      selectedLines.forEach((line) => {
        sceneRef.remove(line);
        line.geometry.dispose();
      });
      selectedLines.clear();
      selectedEdges.clear();
      if (cursorOnRef.current) {
        canvas.style.cursor = "";
        cursorOnRef.current = false;
      }
    };
  }, [_scene, gl]);

  const handleOccHover = useCallback((result: OccEdgePickResult | null) => {
    if (result && !allowCurvedEdges) {
      const body = globalBRepBodyRegistry.get(result.bodyId);
      const polyline = body?._tessellation?.edgePolylines.get(result.edgeId);
      if (polyline && polylineIsCurved(polyline)) {
        occHoverRef.current = null;
        invalidateFrame();
        return;
      }
    }
    occHoverRef.current = result;
    invalidateFrame();
  }, [allowCurvedEdges]);

  const handleOccClick = useCallback((result: OccEdgePickResult) => {
    const polyline = getOccEdgePolyline(result);
    if (!polyline) return;
    if (!allowCurvedEdges && polylineIsCurved(polyline)) return;
    const id = occEdgeId(result);
    if (edgeIdSet.has(id)) {
      removeEdge(id);
      return;
    }
    selectedEdgesDataRef.current.set(id, polyline);
    addEdge(id);
  }, [addEdge, removeEdge, edgeIdSet, allowCurvedEdges]);

  useOccEdgePicker({
    enabled,
    onHover: handleOccHover,
    onClick: handleOccClick,
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const migrate = (occ: Awaited<ReturnType<typeof getOcc>>) => {
      const legacyKey = features
        .filter((feature) => feature.type === "extrude")
        .map((feature) => {
          const bodyId = feature.mesh instanceof THREE.Mesh ? feature.mesh.userData.brepBodyId ?? "" : "";
          return `${feature.id}:${feature.timestamp}:${feature.visible}:${feature.suppressed}:${bodyId}`;
        })
        .join("|");
      if (!legacyKey || legacyKey === lastMigrationKeyRef.current) return;
      const migrated = migrateLegacyExtrudeFeatures(features, sketches, occ);
      const changed = migrated.some((feature, index) => feature !== features[index]);
      if (changed) {
        lastMigrationKeyRef.current = legacyKey;
        useCADStore.setState({ features: migrated });
        return;
      }
      lastMigrationKeyRef.current = legacyKey;
    };

    getOcc()
      .then((occ) => {
        if (!cancelled) migrate(occ);
      })
      .catch((error) => {
        console.warn("[EdgeOpEdgeHighlight] OCC load failed before legacy migration", error);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, features, sketches]);

  useEffect(() => {
    let cancelled = false;
    let initialBuildHandle: number | null = null;
    let retryHandle: number | null = null;
    let attempts = 0;
    const maxAttempts = 24;
    for (const line of allEdgeLinesRef.current) {
      _scene.remove(line);
      line.geometry.dispose();
    }
    allEdgeLinesRef.current = [];
    if (!enabled) return undefined;

    const buildLines = () => {
      for (const line of allEdgeLinesRef.current) {
        _scene.remove(line);
        line.geometry.dispose();
      }
      const lines: THREE.LineSegments[] = [];
      _scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) && !(obj as THREE.Mesh).isMesh) return;
        const mesh = obj as THREE.Mesh;
        const resolved = resolveMeshOccTessellation(mesh);
        const batched = resolved
          ? buildBatchedEdgeLineGeometry(resolved.tess, allowCurvedEdges)
          : null;
        const guideGeometry = batched?.geometry
          ?? mergeGuideGeometries([
            buildMergedMeshCreaseGuideGeometry(mesh),
            buildLegacyCutRimGuideGeometry(mesh, features, sketches, allowCurvedEdges),
            buildMeshTopologyGuideGeometry(mesh, allowCurvedEdges, allowCurvedEdges),
          ]);
        if (!guideGeometry) return;
        const line = new THREE.LineSegments(guideGeometry, allEdgesMat);
        if (batched && resolved) {
          line.userData.edgeIdsBySegment = batched.edgeIdsBySegment;
          line.userData.brepBodyId = resolved.bodyId;
        }
        line.frustumCulled = false;
        line.matrixAutoUpdate = false;
        line.matrix.identity();
        line.renderOrder = 10000;
        _scene.add(line);
        lines.push(line);
      });
      allEdgeLinesRef.current = lines;
      invalidateFrame();
      return lines.length;
    };

    const scheduleBuild = (delayMs: number) => {
      retryHandle = window.setTimeout(() => {
        retryHandle = null;
        if (cancelled) return;
        attempts += 1;
        const lineCount = buildLines();
        if (lineCount > 0 || attempts >= maxAttempts) return;
        scheduleBuild(125);
      }, delayMs);
    };

    initialBuildHandle = window.setTimeout(() => {
      initialBuildHandle = null;
      if (cancelled) return;
      const lineCount = buildLines();
      if (lineCount > 0) return;
      scheduleBuild(125);
    }, 250);

    return () => {
      cancelled = true;
      if (initialBuildHandle !== null) window.clearTimeout(initialBuildHandle);
      if (retryHandle !== null) window.clearTimeout(retryHandle);
      for (const line of allEdgeLinesRef.current) {
        _scene.remove(line);
        line.geometry.dispose();
      }
      allEdgeLinesRef.current = [];
    };
  }, [enabled, _scene, allEdgesMat, allowCurvedEdges, edgeSourceSignature]);

  useFrame(({ scene, invalidate }) => {
    if (!enabled) {
      if (hoverLineRef.current) {
        scene.remove(hoverLineRef.current);
        hoverLineRef.current.geometry.dispose();
        hoverLineRef.current = null;
        renderedHoverIdRef.current = null;
      }
      if (selectedLinesRef.current.size > 0) {
        selectedLinesRef.current.forEach((line) => {
          scene.remove(line);
          line.geometry.dispose();
        });
        selectedLinesRef.current.clear();
        selectedEdgesDataRef.current.clear();
      }
      if (cursorOnRef.current) {
        /* eslint-disable-next-line react-hooks/immutability */
        gl.domElement.style.cursor = "";
        cursorOnRef.current = false;
      }
      return;
    }

    if (occHoverRef.current || selectedLinesRef.current.size > 0 || edgeIds.length > 0) {
      invalidate();
    }

    const wantCursor = !!occHoverRef.current;
    if (wantCursor !== cursorOnRef.current) {
      gl.domElement.style.cursor = wantCursor ? "crosshair" : "";
      cursorOnRef.current = wantCursor;
    }

    const occHover = occHoverRef.current;
    if (occHover) {
      const id = occEdgeId(occHover);
      if (id !== renderedHoverIdRef.current || !hoverLineRef.current) {
        renderedHoverIdRef.current = id;
        const hPts = getOccEdgePolyline(occHover);
        if (hPts) {
          if (!hoverLineRef.current) {
            const line = new THREE.Line(buildPolylineGeometry(hPts), hoverMat);
            line.renderOrder = 1401;
            scene.add(line);
            hoverLineRef.current = line;
          } else {
            hoverLineRef.current.geometry.dispose();
            hoverLineRef.current.geometry = buildPolylineGeometry(hPts);
          }
        }
      }
    } else if (hoverLineRef.current) {
      scene.remove(hoverLineRef.current);
      hoverLineRef.current.geometry.dispose();
      hoverLineRef.current = null;
      renderedHoverIdRef.current = null;
    }

    selectedLinesRef.current.forEach((line, id) => {
      if (!edgeIdSet.has(id)) {
        scene.remove(line);
        line.geometry.dispose();
        selectedLinesRef.current.delete(id);
        selectedEdgesDataRef.current.delete(id);
      }
    });
    for (const id of edgeIds) {
      if (!selectedLinesRef.current.has(id)) {
        const edgeData = selectedEdgesDataRef.current.get(id);
        if (edgeData && edgeData.length >= 2) {
          const line = new THREE.Line(buildPolylineGeometry(edgeData), selectedMat);
          line.renderOrder = 1401;
          scene.add(line);
          selectedLinesRef.current.set(id, line);
        }
      }
    }

    const now = performance.now();
    if (hoverLineRef.current) applyLinePulse(hoverLineRef.current, 1, now);
    const selectedLine = selectedLinesRef.current.values().next().value as THREE.Line | undefined;
    if (selectedLine) applyLinePulse(selectedLine, 1, now);
  });

  return null;
}
