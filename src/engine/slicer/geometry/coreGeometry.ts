import * as THREE from 'three';
import type { Box3 } from 'three';
import type { Contour, Segment, Triangle } from '../../../types/slicer-pipeline.types';

const TRIANGLE_Z_EPSILON = 1e-7;
const triangleZBounds = new WeakMap<Triangle, { minZ: number; maxZ: number }>();

function updateTriangleZBounds(tri: Triangle): void {
  triangleZBounds.set(tri, {
    minZ: Math.min(tri.v0.z, tri.v1.z, tri.v2.z),
    maxZ: Math.max(tri.v0.z, tri.v1.z, tri.v2.z),
  });
}

function getTriangleZBounds(tri: Triangle): { minZ: number; maxZ: number } {
  let bounds = triangleZBounds.get(tri);
  if (!bounds) {
    bounds = {
      minZ: Math.min(tri.v0.z, tri.v1.z, tri.v2.z),
      maxZ: Math.max(tri.v0.z, tri.v1.z, tri.v2.z),
    };
    triangleZBounds.set(tri, bounds);
  }
  return bounds;
}

function weldTriangleVertices(triangles: Triangle[]): void {
  const GRID = 1e-3;
  const canon = new Map<string, THREE.Vector3>();
  const snap = (v: THREE.Vector3): THREE.Vector3 => {
    const kx = Math.round(v.x / GRID);
    const ky = Math.round(v.y / GRID);
    const kz = Math.round(v.z / GRID);
    const key = `${kx},${ky},${kz}`;
    let c = canon.get(key);
    if (!c) {
      c = new THREE.Vector3(kx * GRID, ky * GRID, kz * GRID);
      canon.set(key, c);
    }
    return c;
  };
  const vkey = (v: THREE.Vector3) => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
  const edgeKey = (a: THREE.Vector3, b: THREE.Vector3): string => {
    const ka = vkey(a);
    const kb = vkey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  for (const t of triangles) {
    t.v0 = snap(t.v0);
    t.v1 = snap(t.v1);
    t.v2 = snap(t.v2);
    t.edgeKey01 = edgeKey(t.v0, t.v1);
    t.edgeKey12 = edgeKey(t.v1, t.v2);
    t.edgeKey20 = edgeKey(t.v2, t.v0);
    updateTriangleZBounds(t);
  }
}

function repairTriangleNormals(triangles: Triangle[]): void {
  if (triangles.length === 0) return;

  const vkey = (v: THREE.Vector3) => `${v.x},${v.y},${v.z}`;
  type EdgeRef = { tri: number; dir: 1 | -1 };
  const edgeMap = new Map<string, EdgeRef[]>();
  const edgeKey = (a: THREE.Vector3, b: THREE.Vector3): { key: string; dir: 1 | -1 } => {
    const ka = vkey(a); const kb = vkey(b);
    if (ka < kb) return { key: `${ka}|${kb}`, dir: 1 };
    return { key: `${kb}|${ka}`, dir: -1 };
  };
  const addEdge = (a: THREE.Vector3, b: THREE.Vector3, triIdx: number) => {
    const { key, dir } = edgeKey(a, b);
    let list = edgeMap.get(key);
    if (!list) { list = []; edgeMap.set(key, list); }
    list.push({ tri: triIdx, dir });
  };
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    addEdge(t.v0, t.v1, i);
    addEdge(t.v1, t.v2, i);
    addEdge(t.v2, t.v0, i);
  }

  const visited = new Uint8Array(triangles.length);
  const flip = (ti: number) => {
    const t = triangles[ti];
    const tmp = t.v1; t.v1 = t.v2; t.v2 = tmp;
    t.normal.multiplyScalar(-1);
    const newEdges: Array<[THREE.Vector3, THREE.Vector3]> = [
      [t.v0, t.v1], [t.v1, t.v2], [t.v2, t.v0],
    ];
    for (const [a, b] of newEdges) {
      const { key, dir } = edgeKey(a, b);
      const list = edgeMap.get(key);
      if (!list) continue;
      for (const e of list) if (e.tri === ti) e.dir = dir;
    }
  };

  for (let seed = 0; seed < triangles.length; seed++) {
    if (visited[seed]) continue;
    visited[seed] = 1;
    const queue: number[] = [seed];
    while (queue.length > 0) {
      const curIdx = queue.shift()!;
      const cur = triangles[curIdx];
      const edges: Array<[THREE.Vector3, THREE.Vector3]> = [
        [cur.v0, cur.v1], [cur.v1, cur.v2], [cur.v2, cur.v0],
      ];
      for (const [a, b] of edges) {
        const { key, dir: curDir } = edgeKey(a, b);
        const list = edgeMap.get(key);
        if (!list) continue;
        for (const c of list) {
          if (c.tri === curIdx) continue;
          if (visited[c.tri]) continue;
          if (c.dir === curDir) flip(c.tri);
          visited[c.tri] = 1;
          queue.push(c.tri);
        }
      }
    }
  }

  let topIdx = 0;
  let topZ = -Infinity;
  for (let i = 0; i < triangles.length; i++) {
    const cz = (triangles[i].v0.z + triangles[i].v1.z + triangles[i].v2.z) / 3;
    if (cz > topZ) { topZ = cz; topIdx = i; }
  }
  if (triangles[topIdx].normal.z < 0) {
    for (let i = 0; i < triangles.length; i++) flip(i);
  }
}

function trianglePlaneIntersection(
  tri: Triangle,
  z: number,
): [{ pt: THREE.Vector3; edgeKey: string }, { pt: THREE.Vector3; edgeKey: string }] | null {
  const EPS = 1e-7;
  const { v0, v1, v2 } = tri;
  const z0 = v0.z === z ? z + EPS : v0.z;
  const z1 = v1.z === z ? z + EPS : v1.z;
  const z2 = v2.z === z ? z + EPS : v2.z;

  const hits: Array<{ pt: THREE.Vector3; edgeKey: string }> = [];
  const edges: Array<[THREE.Vector3, number, THREE.Vector3, number, string]> = [
    [v0, z0, v1, z1, tri.edgeKey01],
    [v1, z1, v2, z2, tri.edgeKey12],
    [v2, z2, v0, z0, tri.edgeKey20],
  ];

  for (const [a, az, b, bz, key] of edges) {
    if ((az < z && bz > z) || (bz < z && az > z)) {
      const t = (z - az) / (bz - az);
      hits.push({
        pt: new THREE.Vector3(
          a.x + t * (b.x - a.x),
          a.y + t * (b.y - a.y),
          z,
        ),
        edgeKey: key,
      });
    }
  }

  return hits.length >= 2 ? [hits[0], hits[1]] : null;
}

export function extractTriangles(
  geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
): Triangle[] {
  const triangles: Triangle[] = [];

  for (const { geometry, transform } of geometries) {
    const posAttr = geometry.getAttribute('position');
    if (!posAttr) continue;

    const index = geometry.getIndex();
    const getVertex = (idx: number): THREE.Vector3 => new THREE.Vector3(
      posAttr.getX(idx),
      posAttr.getY(idx),
      posAttr.getZ(idx),
    ).applyMatrix4(transform);

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const v0 = getVertex(index.getX(i));
        const v1 = getVertex(index.getX(i + 1));
        const v2 = getVertex(index.getX(i + 2));
        const edge1 = new THREE.Vector3().subVectors(v1, v0);
        const edge2 = new THREE.Vector3().subVectors(v2, v0);
        const cross = new THREE.Vector3().crossVectors(edge1, edge2);
        if (cross.lengthSq() < 1e-12) continue;
        const normal = cross.normalize();
        const tri = { v0, v1, v2, normal, edgeKey01: '', edgeKey12: '', edgeKey20: '' };
        updateTriangleZBounds(tri);
        triangles.push(tri);
      }
    } else {
      for (let i = 0; i < posAttr.count; i += 3) {
        const v0 = getVertex(i);
        const v1 = getVertex(i + 1);
        const v2 = getVertex(i + 2);
        const edge1 = new THREE.Vector3().subVectors(v1, v0);
        const edge2 = new THREE.Vector3().subVectors(v2, v0);
        const cross = new THREE.Vector3().crossVectors(edge1, edge2);
        if (cross.lengthSq() < 1e-12) continue;
        const normal = cross.normalize();
        const tri = { v0, v1, v2, normal, edgeKey01: '', edgeKey12: '', edgeKey20: '' };
        updateTriangleZBounds(tri);
        triangles.push(tri);
      }
    }
  }

  weldTriangleVertices(triangles);
  repairTriangleNormals(triangles);
  return triangles;
}

export function computeBBox(triangles: Triangle[]): Box3 {
  const box = new THREE.Box3();
  for (const tri of triangles) {
    box.expandByPoint(tri.v0);
    box.expandByPoint(tri.v1);
    box.expandByPoint(tri.v2);
  }
  return box;
}

export function sliceTrianglesAtZ(
  triangles: Triangle[],
  z: number,
  offsetX: number,
  offsetY: number,
): Segment[] {
  const segments: Segment[] = [];
  for (const tri of triangles) {
    const { minZ, maxZ } = getTriangleZBounds(tri);
    if (z < minZ - TRIANGLE_Z_EPSILON || z > maxZ + TRIANGLE_Z_EPSILON) continue;
    const pts = trianglePlaneIntersection(tri, z);
    if (!pts) continue;
    segments.push({
      a: new THREE.Vector2(pts[0].pt.x + offsetX, pts[0].pt.y + offsetY),
      b: new THREE.Vector2(pts[1].pt.x + offsetX, pts[1].pt.y + offsetY),
      edgeKeyA: pts[0].edgeKey,
      edgeKeyB: pts[1].edgeKey,
    });
  }
  return segments;
}

export function connectSegments(segments: Segment[]): THREE.Vector2[][] {
  if (segments.length === 0) return [];

  const byEdge = new Map<string, Array<{ idx: number; isA: boolean }>>();
  const addEdgeRef = (key: string, idx: number, isA: boolean) => {
    if (!key) return;
    let list = byEdge.get(key);
    if (!list) { list = []; byEdge.set(key, list); }
    list.push({ idx, isA });
  };

  const GRID = 0.01;
  const posKey = (p: THREE.Vector2) => `${Math.round(p.x / GRID)},${Math.round(p.y / GRID)}`;
  const byPos = new Map<string, Array<{ idx: number; isA: boolean }>>();
  const addPosRef = (p: THREE.Vector2, idx: number, isA: boolean) => {
    const k = posKey(p);
    let list = byPos.get(k);
    if (!list) { list = []; byPos.set(k, list); }
    list.push({ idx, isA });
  };

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    addEdgeRef(s.edgeKeyA, i, true);
    addEdgeRef(s.edgeKeyB, i, false);
    addPosRef(s.a, i, true);
    addPosRef(s.b, i, false);
  }

  const used = new Uint8Array(segments.length);
  const findNext = (endpointEdgeKey: string, endpointPos: THREE.Vector2): { idx: number; isA: boolean } | null => {
    if (endpointEdgeKey) {
      const list = byEdge.get(endpointEdgeKey);
      if (list) {
        for (const cand of list) if (!used[cand.idx]) return cand;
      }
    }
    const plist = byPos.get(posKey(endpointPos));
    if (plist) {
      for (const cand of plist) if (!used[cand.idx]) return cand;
    }
    return null;
  };

  const contours: THREE.Vector2[][] = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    const s0 = segments[i];
    const contour: THREE.Vector2[] = [s0.a.clone(), s0.b.clone()];
    used[i] = 1;
    let tailEdgeKey = s0.edgeKeyB;
    let tailPos = s0.b;
    let guard = segments.length + 4;
    while (guard-- > 0) {
      const next = findNext(tailEdgeKey, tailPos);
      if (!next) break;
      used[next.idx] = 1;
      const seg = segments[next.idx];
      const otherPt = next.isA ? seg.b : seg.a;
      const otherEdgeKey = next.isA ? seg.edgeKeyB : seg.edgeKeyA;
      contour.push(otherPt.clone());
      tailPos = otherPt;
      tailEdgeKey = otherEdgeKey;
    }
    if (contour.length >= 3) contours.push(contour);
  }

  return contours;
}

export function classifyContours(
  rawContours: THREE.Vector2[][],
  contourBBox: (contour: THREE.Vector2[]) => { minX: number; minY: number; maxX: number; maxY: number },
  pointInContour: (point: THREE.Vector2, contour: THREE.Vector2[]) => boolean,
  signedArea: (points: THREE.Vector2[]) => number,
): Contour[] {
  const contours = rawContours.map((points) => ({
    points,
    area: signedArea(points),
    isOuter: true,
  }));

  const bboxes = contours.map((c) => contourBBox(c.points));
  for (let i = 0; i < contours.length; i++) {
    const pts = contours[i].points;
    if (pts.length < 3) {
      contours[i].isOuter = false;
      continue;
    }

    const centroid = pts.reduce(
      (acc, p) => {
        acc.x += p.x;
        acc.y += p.y;
        return acc;
      },
      { x: 0, y: 0 },
    );
    centroid.x /= pts.length;
    centroid.y /= pts.length;
    const sample = pts[0].clone().lerp(new THREE.Vector2(centroid.x, centroid.y), 1e-4);

    let depth = 0;
    for (let j = 0; j < contours.length; j++) {
      if (i === j) continue;
      const bb = bboxes[j];
      if (sample.x < bb.minX || sample.x > bb.maxX || sample.y < bb.minY || sample.y > bb.maxY) continue;
      if (pointInContour(sample, contours[j].points)) depth++;
    }

    const isOuter = depth % 2 === 0;
    contours[i].isOuter = isOuter;
    const isCCW = contours[i].area >= 0;
    if (isCCW !== isOuter) {
      contours[i].points.reverse();
      contours[i].area = -contours[i].area;
    }
  }

  return contours;
}
