import * as THREE from 'three';
import { reverseNormals as reverseNormalsOp } from '../../operations/meshOps';

export function offsetSurface(mesh: THREE.Mesh, distance: number): THREE.BufferGeometry {
  const source = mesh.geometry;
  const geometry = source.clone();
  geometry.computeVertexNormals();

  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const normals = geometry.attributes.normal as THREE.BufferAttribute;

  // Move each vertex along its normal by `distance`.
  for (let i = 0; i < positions.count; i++) {
    positions.setXYZ(
      i,
      positions.getX(i) + normals.getX(i) * distance,
      positions.getY(i) + normals.getY(i) * distance,
      positions.getZ(i) + normals.getZ(i) * distance,
    );
  }
  positions.needsUpdate = true;

  // Remove degenerate triangles (zero-area) that result from concave regions
  // self-intersecting during inward offsets. This prevents visual artefacts
  // without requiring a full mesh boolean.
  const indexAttr = geometry.index;
  if (indexAttr) {
    const MIN_AREA_SQ = 1e-10;
    const keepIndices: number[] = [];
    const _a = new THREE.Vector3();
    const _b = new THREE.Vector3();
    const _c = new THREE.Vector3();
    const _ab = new THREE.Vector3();
    const _ac = new THREE.Vector3();
    for (let t = 0; t < indexAttr.count; t += 3) {
      const ia = indexAttr.getX(t);
      const ib = indexAttr.getX(t + 1);
      const ic = indexAttr.getX(t + 2);
      _a.set(positions.getX(ia), positions.getY(ia), positions.getZ(ia));
      _b.set(positions.getX(ib), positions.getY(ib), positions.getZ(ib));
      _c.set(positions.getX(ic), positions.getY(ic), positions.getZ(ic));
      _ab.subVectors(_b, _a);
      _ac.subVectors(_c, _a);
      if (_ab.cross(_ac).lengthSq() >= MIN_AREA_SQ) {
        keepIndices.push(ia, ib, ic);
      }
    }
    geometry.setIndex(keepIndices);
  }

  if (distance < 0) reverseNormalsOp(geometry);
  else geometry.computeVertexNormals();

  return geometry;
}

export function extendSurface(
  mesh: THREE.Mesh,
  distance: number,
  mode: 'natural' | 'tangent' | 'perpendicular',
): THREE.BufferGeometry {
  const source = mesh.geometry;
  source.computeVertexNormals();

  const positions = source.attributes.position as THREE.BufferAttribute;
  const normals = source.attributes.normal as THREE.BufferAttribute;
  const indices = source.index;
  const triCount = indices ? indices.count / 3 : positions.count / 3;
  const getIndex = (tri: number, slot: number): number =>
    indices ? indices.getX(tri * 3 + slot) : tri * 3 + slot;

  const edgeTriCount = new Map<string, number>();
  const directedEdges: Array<[number, number]> = [];
  for (let t = 0; t < triCount; t++) {
    const a = getIndex(t, 0);
    const b = getIndex(t, 1);
    const c = getIndex(t, 2);
    for (const [ea, eb] of [[a, b], [b, c], [c, a]] as const) {
      const key = ea < eb ? `${ea},${eb}` : `${eb},${ea}`;
      edgeTriCount.set(key, (edgeTriCount.get(key) ?? 0) + 1);
      directedEdges.push([ea, eb]);
    }
  }

  const boundaryEdges: Array<[number, number]> = [];
  for (const [ea, eb] of directedEdges) {
    const key = ea < eb ? `${ea},${eb}` : `${eb},${ea}`;
    if (edgeTriCount.get(key) === 1 && !boundaryEdges.some(([x, y]) => x === ea && y === eb)) {
      boundaryEdges.push([ea, eb]);
    }
  }

  const originalPositions: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    originalPositions.push(positions.getX(i), positions.getY(i), positions.getZ(i));
  }

  const originalIndices: number[] = [];
  for (let t = 0; t < triCount; t++) {
    originalIndices.push(getIndex(t, 0), getIndex(t, 1), getIndex(t, 2));
  }

  const nextPositions: number[] = [...originalPositions];
  const nextIndices: number[] = [...originalIndices];

  const getVertex = (index: number) =>
    new THREE.Vector3(positions.getX(index), positions.getY(index), positions.getZ(index));
  const getVertexNormal = (index: number) =>
    new THREE.Vector3(normals.getX(index), normals.getY(index), normals.getZ(index)).normalize();

  const extensionDir = (
    va: THREE.Vector3,
    vb: THREE.Vector3,
    na: THREE.Vector3,
    nb: THREE.Vector3,
  ): { da: THREE.Vector3; db: THREE.Vector3 } => {
    const edgeDir = vb.clone().sub(va).normalize();
    if (mode === 'perpendicular') {
      return {
        da: new THREE.Vector3().crossVectors(edgeDir, na).normalize(),
        db: new THREE.Vector3().crossVectors(edgeDir, nb).normalize(),
      };
    }

    const da = new THREE.Vector3().crossVectors(na, edgeDir).normalize();
    const db = new THREE.Vector3().crossVectors(nb, edgeDir).normalize();
    if (mode === 'natural') {
      const avg = da.clone().add(db).normalize();
      return { da: avg.clone(), db: avg.clone() };
    }
    return { da, db };
  };

  const baseCount = positions.count;
  for (const [ai, bi] of boundaryEdges) {
    const va = getVertex(ai);
    const vb = getVertex(bi);
    const na = getVertexNormal(ai);
    const nb = getVertexNormal(bi);
    const { da, db } = extensionDir(va, vb, na, nb);
    const vc = va.clone().addScaledVector(da, distance);
    const vd = vb.clone().addScaledVector(db, distance);

    const ci = nextPositions.length / 3;
    nextPositions.push(vc.x, vc.y, vc.z);
    const di = nextPositions.length / 3;
    nextPositions.push(vd.x, vd.y, vd.z);

    const ciIdx = baseCount + (ci - baseCount);
    const diIdx = baseCount + (di - baseCount);
    nextIndices.push(ai, bi, diIdx);
    nextIndices.push(ai, diIdx, ciIdx);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(nextPositions, 3));
  geometry.setIndex(nextIndices);
  geometry.computeVertexNormals();
  return geometry;
}

export function thickenSurface(
  mesh: THREE.Mesh,
  thickness: number,
  direction: 'inside' | 'outside' | 'symmetric',
): THREE.BufferGeometry {
  const t = Math.abs(thickness);
  let outerDist: number;
  let innerDist: number;
  if (direction === 'outside') {
    outerDist = t;
    innerDist = 0;
  } else if (direction === 'inside') {
    outerDist = 0;
    innerDist = -t;
  } else {
    outerDist = t / 2;
    innerDist = -(t / 2);
  }

  const source = mesh.geometry;
  source.computeVertexNormals();
  const positions = source.attributes.position as THREE.BufferAttribute;
  const normals = source.attributes.normal as THREE.BufferAttribute;
  const indices = source.index;
  const triCount = indices ? indices.count / 3 : positions.count / 3;
  const getIndex = (tri: number, slot: number): number =>
    indices ? indices.getX(tri * 3 + slot) : tri * 3 + slot;

  const makeShell = (dist: number, flipWinding: boolean): { positions: number[]; indices: number[] } => {
    const shellPositions: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      shellPositions.push(
        positions.getX(i) + normals.getX(i) * dist,
        positions.getY(i) + normals.getY(i) * dist,
        positions.getZ(i) + normals.getZ(i) * dist,
      );
    }
    const shellIndices: number[] = [];
    for (let t2 = 0; t2 < triCount; t2++) {
      const a = getIndex(t2, 0);
      const b = getIndex(t2, 1);
      const c = getIndex(t2, 2);
      if (flipWinding) shellIndices.push(a, c, b);
      else shellIndices.push(a, b, c);
    }
    return { positions: shellPositions, indices: shellIndices };
  };

  const outer = makeShell(outerDist, false);
  const inner = makeShell(innerDist, true);

  const edgeCount = new Map<string, number>();
  const directedEdges: Array<[number, number]> = [];
  for (let t2 = 0; t2 < triCount; t2++) {
    const a = getIndex(t2, 0);
    const b = getIndex(t2, 1);
    const c = getIndex(t2, 2);
    for (const [ea, eb] of [[a, b], [b, c], [c, a]] as const) {
      const key = ea < eb ? `${ea},${eb}` : `${eb},${ea}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      directedEdges.push([ea, eb]);
    }
  }

  const boundaryEdges: Array<[number, number]> = [];
  for (const [ea, eb] of directedEdges) {
    const key = ea < eb ? `${ea},${eb}` : `${eb},${ea}`;
    if (edgeCount.get(key) === 1 && !boundaryEdges.some(([x, y]) => x === ea && y === eb)) {
      boundaryEdges.push([ea, eb]);
    }
  }

  const outerVertexCount = positions.count;
  const allPositions: number[] = [...outer.positions, ...inner.positions];
  const allIndices: number[] = [...outer.indices];
  for (const index of inner.indices) allIndices.push(index + outerVertexCount);

  for (const [ai, bi] of boundaryEdges) {
    const innerA = ai + outerVertexCount;
    const innerB = bi + outerVertexCount;
    allIndices.push(ai, bi, innerB);
    allIndices.push(ai, innerB, innerA);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
  geometry.setIndex(allIndices);
  geometry.computeVertexNormals();
  return geometry;
}
