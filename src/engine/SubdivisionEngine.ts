/**
 * SubdivisionEngine — Catmull-Clark subdivision surface kernel (D139).
 *
 * Takes a FormCage (control cage defined by vertices, edges, faces) and
 * produces smooth THREE.BufferGeometry via N rounds of Catmull-Clark subdivision.
 *
 * Algorithm reference: Ed Catmull & Jim Clark (1978). Each round:
 *   1. Face point  = centroid of face vertices
 *   2. Edge point  = avg(edge-midpoint, adj-face-points) for interior edges;
 *                    edge midpoint for boundary edges
 *   3. Updated vertex = (Q + 2R + (n-3)v) / n  for interior vertices;
 *                       (v + R) / 2             for boundary vertices
 *   4. Each n-gon face → n quads using: orig-vert, edge-pt, face-pt, edge-pt
 */

import * as THREE from 'three';
import type { FormCage } from '../types/cad';

// ─── Internal mesh representation ────────────────────────────────────────────

interface CCMesh {
  /** Flat array: [x0,y0,z0, x1,y1,z1, …] */
  positions: Float32Array;
  vertexCount: number;
  /** Each face = ordered list of vertex indices */
  faces: number[][];
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function getPos(positions: Float32Array, idx: number): [number, number, number] {
  return [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
}

function setPos(positions: Float32Array, idx: number, p: [number, number, number]): void {
  positions[idx * 3] = p[0];
  positions[idx * 3 + 1] = p[1];
  positions[idx * 3 + 2] = p[2];
}

function avgPoints(pts: [number, number, number][]): [number, number, number] {
  const n = pts.length;
  if (n === 0) return [0, 0, 0];
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
  return [x / n, y / n, z / n];
}

// ─── Core kernel ─────────────────────────────────────────────────────────────

export class SubdivisionEngine {
  // ── Public API ─────────────────────────────────────────────────────────────

  /** Subdivide a FormCage N times and return a smooth triangulated geometry. */
  static subdivide(cage: FormCage, levels: number): THREE.BufferGeometry {
    let mesh = SubdivisionEngine.cageToMesh(cage);
    for (let i = 0; i < levels; i++) {
      mesh = SubdivisionEngine.catmullClarkStep(mesh);
    }
    return SubdivisionEngine.meshToGeometry(mesh);
  }

  /** Return a cage wireframe geometry (line segments). */
  static cageWireframe(cage: FormCage): THREE.BufferGeometry {
    return SubdivisionEngine.meshToWireframe(SubdivisionEngine.cageToMesh(cage));
  }

  // ── Cage → internal mesh ───────────────────────────────────────────────────

  static cageToMesh(cage: FormCage): CCMesh {
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

    return { positions, vertexCount: cage.vertices.length, faces };
  }

  // ── One Catmull-Clark step ──────────────────────────────────────────────────

  static catmullClarkStep(mesh: CCMesh): CCMesh {
    const { positions, vertexCount: n, faces } = mesh;

    // ── 1. Face points ──────────────────────────────────────────────────────
    const facePoints: [number, number, number][] = faces.map((face) =>
      avgPoints(face.map((vi) => getPos(positions, vi))),
    );

    // ── 2. Build edge → adjacent face index map ─────────────────────────────
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

    // ── 3. Edge points ──────────────────────────────────────────────────────
    const edgePointMap = new Map<string, [number, number, number]>();
    for (const [key, adjFaces] of edgeAdjacentFaces) {
      const [as, bs] = key.split('_').map(Number);
      const pa = getPos(positions, as);
      const pb = getPos(positions, bs);
      let ep: [number, number, number];
      if (adjFaces.length >= 2) {
        // Interior edge: average of endpoints + adjacent face points
        const fp0 = facePoints[adjFaces[0]];
        const fp1 = facePoints[adjFaces[1]];
        ep = [
          (pa[0] + pb[0] + fp0[0] + fp1[0]) / 4,
          (pa[1] + pb[1] + fp0[1] + fp1[1]) / 4,
          (pa[2] + pb[2] + fp0[2] + fp1[2]) / 4,
        ];
      } else {
        // Boundary edge: midpoint only
        ep = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
      }
      edgePointMap.set(key, ep);
    }

    // ── 4. Updated vertex positions ─────────────────────────────────────────
    // Build per-vertex face & edge lists
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
      const nv = adjFaces.length; // valence (# adjacent faces)

      if (nv === 0) {
        newVertPos.push(p);
        continue;
      }

      // Count boundary edges (only 1 adjacent face)
      const boundaryEdges = adjEdgeKeys.filter(
        (k) => (edgeAdjacentFaces.get(k)?.length ?? 0) < 2,
      );

      if (boundaryEdges.length >= 2) {
        // Boundary vertex: average of vertex + adjacent boundary edge midpoints
        const [k0, k1] = boundaryEdges;
        const mid0 = edgePointMap.get(k0)!;
        const mid1 = edgePointMap.get(k1)!;
        newVertPos.push([
          (p[0] + mid0[0] + mid1[0]) / 3,
          (p[1] + mid0[1] + mid1[1]) / 3,
          (p[2] + mid0[2] + mid1[2]) / 3,
        ]);
      } else {
        // Interior vertex: Catmull-Clark formula
        const Q = avgPoints(adjFaces.map((fi) => facePoints[fi]));
        const R = avgPoints(
          adjEdgeKeys.map((k) => {
            const [as, bs] = k.split('_').map(Number);
            const pa = getPos(positions, as);
            const pb = getPos(positions, bs);
            return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2] as [number, number, number];
          }),
        );
        newVertPos.push([
          (Q[0] + 2 * R[0] + (nv - 3) * p[0]) / nv,
          (Q[1] + 2 * R[1] + (nv - 3) * p[1]) / nv,
          (Q[2] + 2 * R[2] + (nv - 3) * p[2]) / nv,
        ]);
      }
    }

    // ── 5. Assign indices to new points ─────────────────────────────────────
    // Layout: [0..n-1] = updated orig verts
    //         [n..n+nFaces-1] = face points
    //         [n+nFaces..] = edge points
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

    // ── 6. Build new quad faces ──────────────────────────────────────────────
    // Each n-gon → n quads: (orig-vert, edge-pt→next, face-pt, edge-pt←prev)
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

    return { positions: newPositions, vertexCount: newVertCount, faces: newFaces };
  }

  // ── Mesh → THREE geometry ──────────────────────────────────────────────────

  /** Fan-triangulate all faces and return an indexed BufferGeometry. */
  static meshToGeometry(mesh: CCMesh): THREE.BufferGeometry {
    const indexArr: number[] = [];
    for (const face of mesh.faces) {
      for (let i = 1; i < face.length - 1; i++) {
        indexArr.push(face[0], face[i], face[i + 1]);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geo.setIndex(indexArr);
    geo.computeVertexNormals();
    return geo;
  }

  /** Extract unique edges as a LineSegments-compatible geometry. */
  static meshToWireframe(mesh: CCMesh): THREE.BufferGeometry {
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

  // ── Cage primitive factories ───────────────────────────────────────────────

  /** Create a standard 6-face box control cage. */
  static createBoxCageData(
    width = 20,
    height = 20,
    depth = 20,
    idPrefix = '',
  ): {
    vertices: FormCage['vertices'];
    edges: FormCage['edges'];
    faces: FormCage['faces'];
  } {
    const hw = width / 2, hh = height / 2, hd = depth / 2;
    const rawVerts: [number, number, number][] = [
      [-hw, -hh, -hd], [hw, -hh, -hd], [hw, hh, -hd], [-hw, hh, -hd],
      [-hw, -hh,  hd], [hw, -hh,  hd], [hw, hh,  hd], [-hw, hh,  hd],
    ];
    const vertices = rawVerts.map((position, i) => ({
      id: `${idPrefix}v${i}`,
      position,
      crease: 0,
    }));

    // Face vertex indices (quads, outward normals)
    const faceVIs: number[][] = [
      [0, 3, 2, 1], // -Z face (front, looking -Z)
      [4, 5, 6, 7], // +Z face (back)
      [0, 4, 7, 3], // -X face (left)
      [1, 2, 6, 5], // +X face (right)
      [0, 1, 5, 4], // -Y face (bottom)
      [3, 7, 6, 2], // +Y face (top)
    ];

    const edgeSet = new Set<string>();
    const edges: FormCage['edges'] = [];
    let eid = 0;
    for (const fvi of faceVIs) {
      for (let i = 0; i < fvi.length; i++) {
        const a = fvi[i], b = fvi[(i + 1) % fvi.length];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ id: `${idPrefix}e${eid++}`, vertexIds: [`${idPrefix}v${a}`, `${idPrefix}v${b}`], crease: 0 });
        }
      }
    }

    const faces = faceVIs.map((vi, fi) => ({
      id: `${idPrefix}f${fi}`,
      vertexIds: vi.map((i) => `${idPrefix}v${i}`),
    }));

    return { vertices, edges, faces };
  }
}
