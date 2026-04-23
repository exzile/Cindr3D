import * as THREE from 'three';
import type { FormCage } from '../../types/cad';
import { avgPoints, edgeKey, getPos, setPos } from './utils/meshUtils';

export interface CCMesh {
  positions: Float32Array;
  vertexCount: number;
  faces: number[][];
  creaseWeights: Map<string, number>;
}

export function cageToMesh(cage: FormCage): CCMesh {
  const idToIdx = new Map<string, number>();
  cage.vertices.forEach((v, i) => idToIdx.set(v.id, i));

  const positions = new Float32Array(cage.vertices.length * 3);
  cage.vertices.forEach((v, i) => setPos(positions, i, v.position));

  const faces = cage.faces.map((f) =>
    f.vertexIds.map((id) => {
      const idx = idToIdx.get(id);
      if (idx === undefined) throw new Error(`Unknown vertex id: ${id}`);
      return idx;
    }),
  );

  const creaseWeights = new Map<string, number>();
  for (const edge of cage.edges) {
    if (edge.crease > 0) {
      const ai = idToIdx.get(edge.vertexIds[0]);
      const bi = idToIdx.get(edge.vertexIds[1]);
      if (ai !== undefined && bi !== undefined) {
        creaseWeights.set(edgeKey(ai, bi), edge.crease);
      }
    }
  }

  return { positions, vertexCount: cage.vertices.length, faces, creaseWeights };
}

export function catmullClarkStep(mesh: CCMesh): CCMesh {
  const { positions, vertexCount: n, faces, creaseWeights } = mesh;
  const facePoints: [number, number, number][] = faces.map((face) => avgPoints(face.map((vi) => getPos(positions, vi))));

  const edgeAdjacentFaces = new Map<string, number[]>();
  faces.forEach((face, fi) => {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const key = edgeKey(a, b);
      if (!edgeAdjacentFaces.has(key)) edgeAdjacentFaces.set(key, []);
      edgeAdjacentFaces.get(key)!.push(fi);
    }
  });

  const edgePointMap = new Map<string, [number, number, number]>();
  for (const [key, adjFaces] of edgeAdjacentFaces) {
    const [as, bs] = key.split('_').map(Number);
    const pa = getPos(positions, as);
    const pb = getPos(positions, bs);
    const midpoint: [number, number, number] = [
      (pa[0] + pb[0]) / 2,
      (pa[1] + pb[1]) / 2,
      (pa[2] + pb[2]) / 2,
    ];
    let ep: [number, number, number];
    if (adjFaces.length >= 2) {
      const c = creaseWeights.get(key) ?? 0;
      if (c >= 1) {
        ep = midpoint;
      } else {
        const fp0 = facePoints[adjFaces[0]];
        const fp1 = facePoints[adjFaces[1]];
        const smooth: [number, number, number] = [
          (pa[0] + pb[0] + fp0[0] + fp1[0]) / 4,
          (pa[1] + pb[1] + fp0[1] + fp1[1]) / 4,
          (pa[2] + pb[2] + fp0[2] + fp1[2]) / 4,
        ];
        ep = c <= 0
          ? smooth
          : [
              smooth[0] + c * (midpoint[0] - smooth[0]),
              smooth[1] + c * (midpoint[1] - smooth[1]),
              smooth[2] + c * (midpoint[2] - smooth[2]),
            ];
      }
    } else {
      ep = midpoint;
    }
    edgePointMap.set(key, ep);
  }

  const vertFaceList: number[][] = Array.from({ length: n }, () => []);
  const vertEdgeSet: Set<string>[] = Array.from({ length: n }, () => new Set());
  faces.forEach((face, fi) => {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      vertFaceList[a].push(fi);
      const key = edgeKey(a, b);
      vertEdgeSet[a].add(key);
      vertEdgeSet[b].add(key);
    }
  });

  const newVertPos: [number, number, number][] = [];
  for (let vi = 0; vi < n; vi++) {
    const p = getPos(positions, vi);
    const adjFaces = vertFaceList[vi];
    const adjEdgeKeys = Array.from(vertEdgeSet[vi]);
    const nv = adjFaces.length;
    if (nv === 0) {
      newVertPos.push(p);
      continue;
    }

    const boundaryEdges = adjEdgeKeys.filter((k) => (edgeAdjacentFaces.get(k)?.length ?? 0) < 2);
    const sharpEdgeKeys = adjEdgeKeys.filter((k) => (creaseWeights.get(k) ?? 0) >= 1);
    const semiSharpEdgeKeys = adjEdgeKeys.filter((k) => {
      const c = creaseWeights.get(k) ?? 0;
      return c > 0 && c < 1;
    });

    if (boundaryEdges.length >= 2 || sharpEdgeKeys.length >= 2) {
      const [k0, k1] = boundaryEdges.length >= 2 ? boundaryEdges : sharpEdgeKeys;
      const mid0 = edgePointMap.get(k0)!;
      const mid1 = edgePointMap.get(k1)!;
      newVertPos.push([(p[0] + mid0[0] + mid1[0]) / 3, (p[1] + mid0[1] + mid1[1]) / 3, (p[2] + mid0[2] + mid1[2]) / 3]);
    } else {
      const Q = avgPoints(adjFaces.map((fi) => facePoints[fi]));
      const R = avgPoints(
        adjEdgeKeys.map((k) => {
          const [as, bs] = k.split('_').map(Number);
          const pa = getPos(positions, as);
          const pb = getPos(positions, bs);
          return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2] as [number, number, number];
        }),
      );
      const smoothPos: [number, number, number] = [
        (Q[0] + 2 * R[0] + (nv - 3) * p[0]) / nv,
        (Q[1] + 2 * R[1] + (nv - 3) * p[1]) / nv,
        (Q[2] + 2 * R[2] + (nv - 3) * p[2]) / nv,
      ];
      if (semiSharpEdgeKeys.length >= 2) {
        const sorted = [...semiSharpEdgeKeys].sort((a, b) => (creaseWeights.get(b) ?? 0) - (creaseWeights.get(a) ?? 0));
        const [k0, k1] = sorted;
        const mid0 = edgePointMap.get(k0)!;
        const mid1 = edgePointMap.get(k1)!;
        const creasePos: [number, number, number] = [(p[0] + mid0[0] + mid1[0]) / 3, (p[1] + mid0[1] + mid1[1]) / 3, (p[2] + mid0[2] + mid1[2]) / 3];
        const t = Math.min(1, creaseWeights.get(k0) ?? 0);
        newVertPos.push([
          smoothPos[0] + t * (creasePos[0] - smoothPos[0]),
          smoothPos[1] + t * (creasePos[1] - smoothPos[1]),
          smoothPos[2] + t * (creasePos[2] - smoothPos[2]),
        ]);
      } else {
        newVertPos.push(smoothPos);
      }
    }
  }

  const facePointOffset = n;
  const edgeKeys = Array.from(edgeAdjacentFaces.keys());
  const edgePointOffset = n + faces.length;
  const newVertCount = n + faces.length + edgeKeys.length;

  const newPositions = new Float32Array(newVertCount * 3);
  for (let vi = 0; vi < n; vi++) setPos(newPositions, vi, newVertPos[vi]);
  for (let fi = 0; fi < faces.length; fi++) setPos(newPositions, facePointOffset + fi, facePoints[fi]);
  for (let ei = 0; ei < edgeKeys.length; ei++) setPos(newPositions, edgePointOffset + ei, edgePointMap.get(edgeKeys[ei])!);

  const edgeKeyToNewIdx = new Map<string, number>();
  edgeKeys.forEach((k, i) => edgeKeyToNewIdx.set(k, edgePointOffset + i));

  const newFaces: number[][] = [];
  faces.forEach((face, fi) => {
    const fp = facePointOffset + fi;
    for (let i = 0; i < face.length; i++) {
      const va = face[i];
      const vb = face[(i + 1) % face.length];
      const vc = face[(i + face.length - 1) % face.length];
      const epAB = edgeKeyToNewIdx.get(edgeKey(va, vb))!;
      const epCA = edgeKeyToNewIdx.get(edgeKey(vc, va))!;
      newFaces.push([va, epAB, fp, epCA]);
    }
  });

  const newCreaseWeights = new Map<string, number>();
  for (const [key, parentCrease] of creaseWeights) {
    if (parentCrease <= 0) continue;
    const epIdx = edgeKeyToNewIdx.get(key);
    if (epIdx === undefined) continue;
    const [as, bs] = key.split('_').map(Number);
    const childCrease = parentCrease >= 1 ? 1 : Math.max(0, parentCrease - 1);
    if (childCrease > 0) {
      newCreaseWeights.set(edgeKey(as, epIdx), childCrease);
      newCreaseWeights.set(edgeKey(epIdx, bs), childCrease);
    }
  }

  return { positions: newPositions, vertexCount: newVertCount, faces: newFaces, creaseWeights: newCreaseWeights };
}

export function meshToGeometry(mesh: CCMesh): THREE.BufferGeometry {
  const indexArr: number[] = [];
  for (const face of mesh.faces) {
    for (let i = 1; i < face.length - 1; i++) indexArr.push(face[0], face[i], face[i + 1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geo.setIndex(indexArr);
  geo.computeVertexNormals();
  return geo;
}

export function meshToWireframe(mesh: CCMesh): THREE.BufferGeometry {
  const seen = new Set<string>();
  const lineVerts: number[] = [];
  for (const face of mesh.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const key = edgeKey(a, b);
      if (!seen.has(key)) {
        seen.add(key);
        lineVerts.push(
          mesh.positions[a * 3], mesh.positions[a * 3 + 1], mesh.positions[a * 3 + 2],
          mesh.positions[b * 3], mesh.positions[b * 3 + 1], mesh.positions[b * 3 + 2],
        );
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lineVerts), 3));
  return geo;
}
