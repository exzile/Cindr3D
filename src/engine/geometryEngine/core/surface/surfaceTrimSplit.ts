import * as THREE from 'three';
import { extractWorldTriangles as extractWorldTrianglesUtil } from '../../intersectionUtils';

type TriReader = {
  triCount: number;
  getTri: (triangleIndex: number) => [number, number, number];
  getWorldVertex: (vertexIndex: number) => THREE.Vector3;
};

function createTriReader(mesh: THREE.Mesh): TriReader {
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry;
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const indices = geometry.index;
  const triCount = indices ? indices.count / 3 : positions.count / 3;
  const matrixWorld = mesh.matrixWorld;

  return {
    triCount,
    getTri: (triangleIndex: number): [number, number, number] => {
      if (indices) {
        return [
          indices.getX(triangleIndex * 3),
          indices.getX(triangleIndex * 3 + 1),
          indices.getX(triangleIndex * 3 + 2),
        ];
      }
      return [triangleIndex * 3, triangleIndex * 3 + 1, triangleIndex * 3 + 2];
    },
    getWorldVertex: (vertexIndex: number): THREE.Vector3 => {
      const vertex = new THREE.Vector3(
        positions.getX(vertexIndex),
        positions.getY(vertexIndex),
        positions.getZ(vertexIndex),
      );
      return vertex.applyMatrix4(matrixWorld);
    },
  };
}

function makeIndexedGeometry(positions: number[], indices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function derivePlaneFromMesh(mesh: THREE.Mesh): THREE.Plane | null {
  mesh.updateWorldMatrix(true, false);
  const triangles = extractWorldTrianglesUtil(mesh);
  if (triangles.length === 0) return null;

  // Accumulate weighted centroid and normal from ALL triangles (area-weighted).
  // This gives a best-fit plane for non-axis-aligned surface trimmers, not just
  // the first triangle's plane.
  const centroid = new THREE.Vector3();
  const weightedNormal = new THREE.Vector3();
  let totalArea = 0;
  const _ab = new THREE.Vector3();
  const _ac = new THREE.Vector3();
  for (const [p0, p1, p2] of triangles) {
    _ab.subVectors(p1, p0);
    _ac.subVectors(p2, p0);
    const cross = new THREE.Vector3().crossVectors(_ab, _ac);
    const area = cross.length() * 0.5;
    centroid.addScaledVector(p0, area / 3);
    centroid.addScaledVector(p1, area / 3);
    centroid.addScaledVector(p2, area / 3);
    weightedNormal.add(cross);
    totalArea += area;
  }
  if (totalArea < 1e-12) {
    const [p0, p1, p2] = triangles[0];
    _ab.subVectors(p1, p0);
    _ac.subVectors(p2, p0);
    const fallbackNormal = new THREE.Vector3().crossVectors(_ab, _ac).normalize();
    return new THREE.Plane().setFromNormalAndCoplanarPoint(fallbackNormal, p0);
  }
  centroid.divideScalar(totalArea * 3);
  weightedNormal.normalize();
  return new THREE.Plane().setFromNormalAndCoplanarPoint(weightedNormal, centroid);
}

function pushTriangle(
  positions: number[],
  indices: number[],
  v0: THREE.Vector3,
  v1: THREE.Vector3,
  v2: THREE.Vector3,
): void {
  const base = positions.length / 3;
  positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
  indices.push(base, base + 1, base + 2);
}

function edgeIntersect(
  vertexA: THREE.Vector3,
  distanceA: number,
  vertexB: THREE.Vector3,
  distanceB: number,
): THREE.Vector3 {
  const t = distanceA / (distanceA - distanceB);
  return new THREE.Vector3().lerpVectors(vertexA, vertexB, t);
}

export function trimSurface(
  mesh: THREE.Mesh,
  trimmerMesh: THREE.Mesh,
  keepSide: 'inside' | 'outside',
): THREE.BufferGeometry {
  const cuttingPlane = derivePlaneFromMesh(trimmerMesh);
  if (!cuttingPlane) return mesh.geometry.clone();

  const { triCount, getTri, getWorldVertex } = createTriReader(mesh);
  const keptPositions: number[] = [];
  const keptIndices: number[] = [];

  for (let triangleIndex = 0; triangleIndex < triCount; triangleIndex++) {
    const [a, b, c] = getTri(triangleIndex);
    const worldA = getWorldVertex(a);
    const worldB = getWorldVertex(b);
    const worldC = getWorldVertex(c);
    const centroid = new THREE.Vector3().addVectors(worldA, worldB).add(worldC).divideScalar(3);
    const keep = keepSide === 'outside'
      ? cuttingPlane.distanceToPoint(centroid) >= 0
      : cuttingPlane.distanceToPoint(centroid) < 0;
    if (!keep) continue;
    pushTriangle(keptPositions, keptIndices, worldA, worldB, worldC);
  }

  return makeIndexedGeometry(keptPositions, keptIndices);
}

export function splitSurface(
  mesh: THREE.Mesh,
  splitter: THREE.Mesh | THREE.Plane,
): THREE.BufferGeometry[] {
  const plane = splitter instanceof THREE.Plane ? splitter : derivePlaneFromMesh(splitter);
  if (!plane) return [mesh.geometry.clone(), new THREE.BufferGeometry()];

  const { triCount, getTri, getWorldVertex } = createTriReader(mesh);
  const posA: number[] = [];
  const idxA: number[] = [];
  const posB: number[] = [];
  const idxB: number[] = [];
  const tolerance = 1e-6;

  for (let triangleIndex = 0; triangleIndex < triCount; triangleIndex++) {
    const [a, b, c] = getTri(triangleIndex);
    const vertices = [getWorldVertex(a), getWorldVertex(b), getWorldVertex(c)];
    const distances = vertices.map((vertex) => plane.distanceToPoint(vertex));
    const sides = distances.map((distance) => (distance > tolerance ? 1 : distance < -tolerance ? -1 : 0));

    if (sides[0] >= 0 && sides[1] >= 0 && sides[2] >= 0) {
      pushTriangle(posA, idxA, vertices[0], vertices[1], vertices[2]);
      continue;
    }
    if (sides[0] <= 0 && sides[1] <= 0 && sides[2] <= 0) {
      pushTriangle(posB, idxB, vertices[0], vertices[1], vertices[2]);
      continue;
    }

    let loneIndex = -1;
    for (let i = 0; i < 3; i++) {
      const other0 = (i + 1) % 3;
      const other1 = (i + 2) % 3;
      if (
        (sides[i] > 0 && sides[other0] <= 0 && sides[other1] <= 0) ||
        (sides[i] < 0 && sides[other0] >= 0 && sides[other1] >= 0)
      ) {
        loneIndex = i;
        break;
      }
    }

    if (loneIndex === -1) {
      const centroidDistance = (distances[0] + distances[1] + distances[2]) / 3;
      if (centroidDistance >= 0) pushTriangle(posA, idxA, vertices[0], vertices[1], vertices[2]);
      else pushTriangle(posB, idxB, vertices[0], vertices[1], vertices[2]);
      continue;
    }

    const pairIndex0 = (loneIndex + 1) % 3;
    const pairIndex1 = (loneIndex + 2) % 3;
    const loneVertex = vertices[loneIndex];
    const pairVertex0 = vertices[pairIndex0];
    const pairVertex1 = vertices[pairIndex1];
    const cut0 = edgeIntersect(loneVertex, distances[loneIndex], pairVertex0, distances[pairIndex0]);
    const cut1 = edgeIntersect(loneVertex, distances[loneIndex], pairVertex1, distances[pairIndex1]);

    const loneIsPositive = sides[loneIndex] > 0;
    const lonePositions = loneIsPositive ? posA : posB;
    const loneIndices = loneIsPositive ? idxA : idxB;
    const pairPositions = loneIsPositive ? posB : posA;
    const pairIndices = loneIsPositive ? idxB : idxA;

    pushTriangle(lonePositions, loneIndices, loneVertex, cut0, cut1);
    pushTriangle(pairPositions, pairIndices, pairVertex0, pairVertex1, cut0);
    pushTriangle(pairPositions, pairIndices, pairVertex1, cut1, cut0);
  }

  return [makeIndexedGeometry(posA, idxA), makeIndexedGeometry(posB, idxB)];
}

export function untrimSurface(mesh: THREE.Mesh, expandFactor = 1.5): THREE.BufferGeometry {
  const geometry = mesh.geometry;
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const { triCount, getTri, getWorldVertex } = createTriReader(mesh);
  const bounds = new THREE.Box3().setFromBufferAttribute(positions);
  bounds.applyMatrix4(mesh.matrixWorld);

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  bounds.getCenter(center);
  bounds.getSize(size);
  const expandedBounds = new THREE.Box3(
    center.clone().sub(size.clone().multiplyScalar(expandFactor * 0.5)),
    center.clone().add(size.clone().multiplyScalar(expandFactor * 0.5)),
  );

  const edgeCount = new Map<string, number>();
  const edgeVertexMap = new Map<string, [number, number]>();
  for (let triangleIndex = 0; triangleIndex < triCount; triangleIndex++) {
    const [a, b, c] = getTri(triangleIndex);
    for (const [edgeA, edgeB] of [[a, b], [b, c], [c, a]] as const) {
      const key = `${Math.min(edgeA, edgeB)}-${Math.max(edgeA, edgeB)}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      if (!edgeVertexMap.has(key)) edgeVertexMap.set(key, [edgeA, edgeB]);
    }
  }

  const boundaryEdges: [number, number][] = [];
  for (const [key, count] of edgeCount) {
    if (count === 1) boundaryEdges.push(edgeVertexMap.get(key)!);
  }

  let averageNormal = new THREE.Vector3();
  for (let triangleIndex = 0; triangleIndex < triCount; triangleIndex++) {
    const [a, b, c] = getTri(triangleIndex);
    const worldA = getWorldVertex(a);
    const worldB = getWorldVertex(b);
    const worldC = getWorldVertex(c);
    averageNormal.add(
      new THREE.Vector3().crossVectors(worldB.clone().sub(worldA), worldC.clone().sub(worldA)),
    );
  }
  if (averageNormal.lengthSq() < 1e-12) averageNormal = new THREE.Vector3(0, 1, 0);
  else averageNormal.normalize();

  const allPositions: number[] = [];
  const allIndices: number[] = [];
  for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex++) {
    const worldVertex = getWorldVertex(vertexIndex);
    allPositions.push(worldVertex.x, worldVertex.y, worldVertex.z);
  }
  for (let triangleIndex = 0; triangleIndex < triCount; triangleIndex++) {
    const [a, b, c] = getTri(triangleIndex);
    allIndices.push(a, b, c);
  }

  const clampToBox = (start: THREE.Vector3, direction: THREE.Vector3): THREE.Vector3 => {
    let tMin = 0;
    let tMax = Infinity;
    for (const axis of ['x', 'y', 'z'] as const) {
      const origin = start[axis];
      const delta = direction[axis];
      if (Math.abs(delta) < 1e-12) continue;
      const t1 = (expandedBounds.min[axis] - origin) / delta;
      const t2 = (expandedBounds.max[axis] - origin) / delta;
      tMin = Math.max(tMin, Math.min(t1, t2));
      tMax = Math.min(tMax, Math.max(t1, t2));
    }
    if (tMax < tMin || tMax <= 0) return start.clone().addScaledVector(direction, 1);
    return start.clone().addScaledVector(direction, Math.max(tMin, 0.1));
  };

  for (const [edgeA, edgeB] of boundaryEdges) {
    const worldA = getWorldVertex(edgeA);
    const worldB = getWorldVertex(edgeB);
    const edgeDirection = worldB.clone().sub(worldA).normalize();
    const outwardDirection = new THREE.Vector3().crossVectors(averageNormal, edgeDirection).normalize();
    if (outwardDirection.dot(center.clone().sub(worldA)) > 0) outwardDirection.negate();

    const extendedA = clampToBox(worldA, outwardDirection);
    const extendedB = clampToBox(worldB, outwardDirection);
    const base = allPositions.length / 3;
    allPositions.push(
      worldA.x, worldA.y, worldA.z,
      worldB.x, worldB.y, worldB.z,
      extendedB.x, extendedB.y, extendedB.z,
      extendedA.x, extendedA.y, extendedA.z,
    );
    allIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return makeIndexedGeometry(allPositions, allIndices);
}
