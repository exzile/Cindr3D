import * as THREE from 'three';

export interface MeshRepairReport {
  vertices: number;
  triangles: number;
  duplicateVertices: number;
  nonManifoldEdges: number;
  boundaryEdges: number;
  degenerateFaces: number;
}

const key = (x: number, y: number, z: number, tolerance: number) =>
  `${Math.round(x / tolerance)},${Math.round(y / tolerance)},${Math.round(z / tolerance)}`;

function triangleIndices(geometry: THREE.BufferGeometry): number[] {
  const position = geometry.getAttribute('position');
  if (!position) return [];
  if (geometry.index) return Array.from(geometry.index.array as ArrayLike<number>);
  return Array.from({ length: position.count }, (_, index) => index);
}

export function analyzeMeshGeometry(geometry: THREE.BufferGeometry, tolerance = 1e-5): MeshRepairReport {
  const position = geometry.getAttribute('position');
  if (!position) {
    return { vertices: 0, triangles: 0, duplicateVertices: 0, nonManifoldEdges: 0, boundaryEdges: 0, degenerateFaces: 0 };
  }

  const seen = new Set<string>();
  let duplicateVertices = 0;
  for (let i = 0; i < position.count; i += 1) {
    const k = key(position.getX(i), position.getY(i), position.getZ(i), tolerance);
    if (seen.has(k)) duplicateVertices += 1;
    seen.add(k);
  }

  const indices = triangleIndices(geometry);
  const edges = new Map<string, number>();
  let degenerateFaces = 0;
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    va.fromBufferAttribute(position, a);
    vb.fromBufferAttribute(position, b);
    vc.fromBufferAttribute(position, c);
    if (ab.subVectors(vb, va).cross(ac.subVectors(vc, va)).lengthSq() <= tolerance * tolerance) degenerateFaces += 1;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const edge = u < v ? `${u}:${v}` : `${v}:${u}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edges.values()) {
    if (count === 1) boundaryEdges += 1;
    else if (count > 2) nonManifoldEdges += 1;
  }

  return {
    vertices: position.count,
    triangles: Math.floor(indices.length / 3),
    duplicateVertices,
    nonManifoldEdges,
    boundaryEdges,
    degenerateFaces,
  };
}

export function weldMeshVertices(geometry: THREE.BufferGeometry, tolerance = 1e-5): THREE.BufferGeometry {
  const needsExpand = !geometry.index;
  const source = needsExpand ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute('position');
  const normal = source.getAttribute('normal');
  if (!position) {
    if (needsExpand) source.dispose();
    return geometry.clone();
  }

  const vertexMap = new Map<string, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < position.count; i += 1) {
    const k = key(position.getX(i), position.getY(i), position.getZ(i), tolerance);
    let nextIndex = vertexMap.get(k);
    if (nextIndex === undefined) {
      nextIndex = positions.length / 3;
      vertexMap.set(k, nextIndex);
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      if (normal) normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
    indices.push(nextIndex);
  }

  if (needsExpand) source.dispose();

  const next = new THREE.BufferGeometry();
  next.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) next.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  next.setIndex(indices);
  next.computeVertexNormals();
  next.computeBoundingBox();
  next.computeBoundingSphere();
  return next;
}

export function autoRepairMeshGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  return weldMeshVertices(geometry);
}
