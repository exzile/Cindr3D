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

function remappedTriangleIndices(geometry: THREE.BufferGeometry, tolerance: number): number[] {
  const position = geometry.getAttribute('position');
  if (!position) return [];

  const vertexMap = new Map<string, number>();
  const remapped: number[] = [];
  for (const sourceIndex of triangleIndices(geometry)) {
    const k = key(position.getX(sourceIndex), position.getY(sourceIndex), position.getZ(sourceIndex), tolerance);
    let nextIndex = vertexMap.get(k);
    if (nextIndex === undefined) {
      nextIndex = vertexMap.size;
      vertexMap.set(k, nextIndex);
    }
    remapped.push(nextIndex);
  }
  return remapped;
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

  const sourceIndices = triangleIndices(geometry);
  const indices = remappedTriangleIndices(geometry, tolerance);
  const edges = new Map<string, number>();
  let degenerateFaces = 0;
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  for (let i = 0; i + 2 < indices.length; i += 3) {
    const sourceA = sourceIndices[i];
    const sourceB = sourceIndices[i + 1];
    const sourceC = sourceIndices[i + 2];
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    va.fromBufferAttribute(position, sourceA);
    vb.fromBufferAttribute(position, sourceB);
    vc.fromBufferAttribute(position, sourceC);
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
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!position) {
    return geometry.clone();
  }

  const vertexMap = new Map<string, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (const sourceIndex of triangleIndices(geometry)) {
    const k = key(position.getX(sourceIndex), position.getY(sourceIndex), position.getZ(sourceIndex), tolerance);
    let nextIndex = vertexMap.get(k);
    if (nextIndex === undefined) {
      nextIndex = positions.length / 3;
      vertexMap.set(k, nextIndex);
      positions.push(position.getX(sourceIndex), position.getY(sourceIndex), position.getZ(sourceIndex));
      if (normal) normals.push(normal.getX(sourceIndex), normal.getY(sourceIndex), normal.getZ(sourceIndex));
    }
    indices.push(nextIndex);
  }

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
