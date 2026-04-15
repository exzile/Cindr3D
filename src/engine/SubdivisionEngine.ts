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
  /**
   * Per-edge crease weight, keyed by canonical edgeKey(a,b).
   * 0 = smooth (default when absent), 1 = fully sharp.
   * Values in (0,1) are semi-sharp: linearly interpolated between rules.
   */
  creaseWeights: Map<string, number>;
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

    // Build crease weight map from cage edges (skip 0-weight edges for compactness)
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

  // ── One Catmull-Clark step ──────────────────────────────────────────────────

  static catmullClarkStep(mesh: CCMesh): CCMesh {
    const { positions, vertexCount: n, faces, creaseWeights } = mesh;

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

    // ── 3. Edge points (crease-aware) ───────────────────────────────────────
    const edgePointMap = new Map<string, [number, number, number]>();
    for (const [key, adjFaces] of edgeAdjacentFaces) {
      const [as, bs] = key.split('_').map(Number);
      const pa = getPos(positions, as);
      const pb = getPos(positions, bs);
      // Simple midpoint (used for boundary edges, sharp creases, and as the
      // "sharp" end of the semi-sharp blend)
      const midpoint: [number, number, number] = [
        (pa[0] + pb[0]) / 2,
        (pa[1] + pb[1]) / 2,
        (pa[2] + pb[2]) / 2,
      ];
      let ep: [number, number, number];
      if (adjFaces.length >= 2) {
        const c = creaseWeights.get(key) ?? 0;
        if (c >= 1) {
          // Fully sharp: use midpoint (no face influence)
          ep = midpoint;
        } else {
          // Smooth CC formula
          const fp0 = facePoints[adjFaces[0]];
          const fp1 = facePoints[adjFaces[1]];
          const smooth: [number, number, number] = [
            (pa[0] + pb[0] + fp0[0] + fp1[0]) / 4,
            (pa[1] + pb[1] + fp0[1] + fp1[1]) / 4,
            (pa[2] + pb[2] + fp0[2] + fp1[2]) / 4,
          ];
          if (c <= 0) {
            ep = smooth;
          } else {
            // Semi-sharp: lerp between smooth and sharp
            ep = [
              smooth[0] + c * (midpoint[0] - smooth[0]),
              smooth[1] + c * (midpoint[1] - smooth[1]),
              smooth[2] + c * (midpoint[2] - smooth[2]),
            ];
          }
        }
      } else {
        // Boundary edge: midpoint only
        ep = midpoint;
      }
      edgePointMap.set(key, ep);
    }

    // ── 4. Updated vertex positions (crease-aware) ──────────────────────────
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

      // Collect crease edges adjacent to this vertex
      const sharpEdgeKeys = adjEdgeKeys.filter((k) => (creaseWeights.get(k) ?? 0) >= 1);
      const semiSharpEdgeKeys = adjEdgeKeys.filter((k) => {
        const c = creaseWeights.get(k) ?? 0;
        return c > 0 && c < 1;
      });

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
      } else if (sharpEdgeKeys.length >= 2) {
        // Crease vertex rule: vertex lies on 2+ fully sharp edges
        // Use the "crease vertex" formula: average of vertex + midpoints of the
        // two sharpest crease edges
        const [k0, k1] = sharpEdgeKeys;
        const mid0 = edgePointMap.get(k0)!;
        const mid1 = edgePointMap.get(k1)!;
        newVertPos.push([
          (p[0] + mid0[0] + mid1[0]) / 3,
          (p[1] + mid0[1] + mid1[1]) / 3,
          (p[2] + mid0[2] + mid1[2]) / 3,
        ]);
      } else if (sharpEdgeKeys.length === 1 && semiSharpEdgeKeys.length === 0) {
        // Dart vertex (exactly one sharp edge): smooth rule applies
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
      } else if (semiSharpEdgeKeys.length >= 2) {
        // Semi-sharp vertex: blend between smooth and crease vertex rules
        // Pick the two highest-crease semi-sharp edges for the crease formula
        const sorted = [...semiSharpEdgeKeys].sort(
          (a, b) => (creaseWeights.get(b) ?? 0) - (creaseWeights.get(a) ?? 0),
        );
        const [k0, k1] = sorted;
        const mid0 = edgePointMap.get(k0)!;
        const mid1 = edgePointMap.get(k1)!;
        const creasePos: [number, number, number] = [
          (p[0] + mid0[0] + mid1[0]) / 3,
          (p[1] + mid0[1] + mid1[1]) / 3,
          (p[2] + mid0[2] + mid1[2]) / 3,
        ];
        // Smooth rule
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
        // Use the max crease weight of the two semi-sharp edges as blend factor
        const t = Math.min(1, (creaseWeights.get(k0) ?? 0));
        newVertPos.push([
          smoothPos[0] + t * (creasePos[0] - smoothPos[0]),
          smoothPos[1] + t * (creasePos[1] - smoothPos[1]),
          smoothPos[2] + t * (creasePos[2] - smoothPos[2]),
        ]);
      } else {
        // Interior smooth vertex: Catmull-Clark formula
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

    // ── 7. Propagate crease weights to child edges ───────────────────────────
    // Each parent edge (a,b) with edge-point ep splits into two child edges:
    //   (a, ep) and (ep, b).
    // Child crease weight = max(0, parentCrease - 1) for semi-sharp "decay";
    // fully sharp edges (crease >= 1) stay fully sharp (child = 1).
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

  // ── Edge loop / ring selection ─────────────────────────────────────────────

  /**
   * Finds the edge loop containing a given starting edge.
   *
   * An edge loop follows a consistent direction across a cage: at each vertex,
   * the "opposite" edge is the one that continues in the same row direction
   * (for quad-dominant cages, this means the edge across the quad face).
   *
   * @param cage        The FormCage (or equivalent cage structure)
   * @param startEdgeId ID of the edge to start from
   * @returns           Ordered array of edge IDs in the loop (may be open or closed)
   */
  static findEdgeLoop(
    cage: { vertices: { id: string }[]; edges: { id: string; vertexIds: [string, string] }[]; faces: { id: string; vertexIds: string[] }[] },
    startEdgeId: string,
  ): string[] {
    // Build lookup maps
    const edgeById = new Map<string, { id: string; vertexIds: [string, string] }>();
    for (const e of cage.edges) edgeById.set(e.id, e);

    const startEdge = edgeById.get(startEdgeId);
    if (!startEdge) return [];

    // Build map: vertexId → list of face indices that contain it
    const vertToFaces = new Map<string, number[]>();
    cage.faces.forEach((f, fi) => {
      for (const vid of f.vertexIds) {
        if (!vertToFaces.has(vid)) vertToFaces.set(vid, []);
        vertToFaces.get(vid)!.push(fi);
      }
    });

    // Build map: canonical edge key "vA|vB" (sorted) → edge id
    const edgeKeyToId = new Map<string, string>();
    for (const e of cage.edges) {
      const [a, b] = e.vertexIds;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeKeyToId.set(key, e.id);
    }

    /**
     * Given the current vertex `curV` and the edge we arrived on (`arrivalEdgeId`),
     * find the "opposite" edge in the adjacent quad face and return it, along with
     * the next vertex to continue from.
     * Returns null at boundaries or non-quad faces.
     */
    const stepLoop = (curV: string, arrivalEdgeId: string): { nextEdgeId: string; nextV: string } | null => {
      const arrivalEdge = edgeById.get(arrivalEdgeId)!;
      const otherV = arrivalEdge.vertexIds[0] === curV ? arrivalEdge.vertexIds[1] : arrivalEdge.vertexIds[0];

      // Find all faces that contain both curV and otherV (i.e. adjacent to the arrival edge)
      const facesOfCur = vertToFaces.get(curV) ?? [];
      const facesOfOther = new Set(vertToFaces.get(otherV) ?? []);
      const adjFaceIndices = facesOfCur.filter((fi) => facesOfOther.has(fi));

      for (const fi of adjFaceIndices) {
        const face = cage.faces[fi];
        if (face.vertexIds.length !== 4) continue; // only quads

        const vids = face.vertexIds;
        // Find the index of curV and otherV in this face
        const iCur = vids.indexOf(curV);
        const iOther = vids.indexOf(otherV);
        if (iCur === -1 || iOther === -1) continue;

        // The arrival edge is between iCur and iOther.
        // For a quad [v0, v1, v2, v3], the opposite edge to edge (v_i, v_j) is the
        // edge connecting the remaining two vertices.
        // Determine the two "other" vertices (not curV or otherV).
        const remaining = vids.filter((_, k) => k !== iCur && k !== iOther);
        if (remaining.length !== 2) continue;

        const [rA, rB] = remaining;
        const oppKey = rA < rB ? `${rA}|${rB}` : `${rB}|${rA}`;
        const oppEdgeId = edgeKeyToId.get(oppKey);
        if (!oppEdgeId || oppEdgeId === arrivalEdgeId) continue;

        // The next vertex: the one in the opposite edge that is "across" from curV.
        // In a quad [v0,v1,v2,v3] with arrival edge (v0,v1), the opposite edge is
        // (v2,v3). We continue from the vertex in rA/rB that is NOT adjacent to curV
        // along the face perimeter — i.e. the one opposite curV in the quad.
        // Opposite vertex across a quad from curV: index (iCur + 2) % 4
        const iOpposite = (iCur + 2) % 4;
        const nextV = vids[iOpposite];

        return { nextEdgeId: oppEdgeId, nextV };
      }
      return null; // boundary or T-junction
    };

    const loopEdges: string[] = [startEdgeId];
    const visited = new Set<string>([startEdgeId]);

    const [vA, vB] = startEdge.vertexIds;

    // Walk forward (from vB, having arrived via startEdge)
    let curV = vB;
    let curEdge = startEdgeId;
    for (;;) {
      const step = stepLoop(curV, curEdge);
      if (!step) break;
      if (step.nextEdgeId === startEdgeId) break; // closed loop
      if (visited.has(step.nextEdgeId)) break;    // cycle guard
      visited.add(step.nextEdgeId);
      loopEdges.push(step.nextEdgeId);
      curEdge = step.nextEdgeId;
      curV = step.nextV;
    }

    // Walk backward (from vA, having arrived via startEdge)
    curV = vA;
    curEdge = startEdgeId;
    const backEdges: string[] = [];
    for (;;) {
      const step = stepLoop(curV, curEdge);
      if (!step) break;
      if (step.nextEdgeId === startEdgeId) break;
      if (visited.has(step.nextEdgeId)) break;
      visited.add(step.nextEdgeId);
      backEdges.push(step.nextEdgeId);
      curEdge = step.nextEdgeId;
      curV = step.nextV;
    }

    // Prepend the backward edges (reversed so the array is ordered start→end)
    return [...backEdges.reverse(), ...loopEdges];
  }

  /**
   * Finds the edge ring containing a given edge.
   *
   * An edge ring connects edges that are separated by exactly one face —
   * each step goes across a quad face to the parallel edge on the other side.
   *
   * @param cage        The cage
   * @param startEdgeId Starting edge ID
   * @returns           Ordered array of edge IDs in the ring
   */
  static findEdgeRing(
    cage: { vertices: { id: string }[]; edges: { id: string; vertexIds: [string, string] }[]; faces: { id: string; vertexIds: string[] }[] },
    startEdgeId: string,
  ): string[] {
    const edgeById = new Map<string, { id: string; vertexIds: [string, string] }>();
    for (const e of cage.edges) edgeById.set(e.id, e);

    const startEdge = edgeById.get(startEdgeId);
    if (!startEdge) return [];

    // Build map: canonical edge key "vA|vB" (sorted) → edge id
    const edgeKeyToId = new Map<string, string>();
    for (const e of cage.edges) {
      const [a, b] = e.vertexIds;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeKeyToId.set(key, e.id);
    }

    // Build map: canonical edge key → list of face indices adjacent to it
    const edgeToFaces = new Map<string, number[]>();
    cage.faces.forEach((f, fi) => {
      const vids = f.vertexIds;
      for (let i = 0; i < vids.length; i++) {
        const a = vids[i];
        const b = vids[(i + 1) % vids.length];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
        edgeToFaces.get(key)!.push(fi);
      }
    });

    /**
     * Given an edge, step across an adjacent quad face to the parallel (opposite) edge.
     * Returns all next-edge candidates (one per adjacent face).
     */
    const ringStep = (edgeId: string): string[] => {
      const edge = edgeById.get(edgeId);
      if (!edge) return [];
      const [eA, eB] = edge.vertexIds;
      const key = eA < eB ? `${eA}|${eB}` : `${eB}|${eA}`;
      const adjFaceIndices = edgeToFaces.get(key) ?? [];
      const results: string[] = [];

      for (const fi of adjFaceIndices) {
        const face = cage.faces[fi];
        if (face.vertexIds.length !== 4) continue;

        const vids = face.vertexIds;
        const iA = vids.indexOf(eA);
        const iB = vids.indexOf(eB);
        if (iA === -1 || iB === -1) continue;

        // Opposite edge = the two vertices not in this edge
        const remaining = vids.filter((_, k) => k !== iA && k !== iB);
        if (remaining.length !== 2) continue;

        const [rA, rB] = remaining;
        const oppKey = rA < rB ? `${rA}|${rB}` : `${rB}|${rA}`;
        const oppEdgeId = edgeKeyToId.get(oppKey);
        if (oppEdgeId && oppEdgeId !== edgeId) {
          results.push(oppEdgeId);
        }
      }
      return results;
    };

    const ringEdges: string[] = [startEdgeId];
    const visited = new Set<string>([startEdgeId]);

    // Walk the ring in both directions across faces
    // Forward: take the first unvisited next edge
    let curEdge = startEdgeId;
    for (;;) {
      const nexts = ringStep(curEdge).filter((id) => !visited.has(id));
      if (nexts.length === 0) break;
      const nextEdge = nexts[0];
      if (nextEdge === startEdgeId) break; // closed ring
      visited.add(nextEdge);
      ringEdges.push(nextEdge);
      curEdge = nextEdge;
    }

    return ringEdges;
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

  /** Create a single quad face (plane) in the XZ plane (Y=0). */
  static createPlaneCageData(
    width = 20,
    height = 20,
    idPrefix = '',
  ): {
    vertices: FormCage['vertices'];
    edges: FormCage['edges'];
    faces: FormCage['faces'];
  } {
    const hw = width / 2, hh = height / 2;
    const rawVerts: [number, number, number][] = [
      [-hw, 0, -hh],
      [ hw, 0, -hh],
      [ hw, 0,  hh],
      [-hw, 0,  hh],
    ];
    const vertices = rawVerts.map((position, i) => ({
      id: `${idPrefix}v${i}`,
      position,
      crease: 0,
    }));

    const faceVIs: number[][] = [[0, 1, 2, 3]];

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

  /** Create a cylinder cage with quad sides and n-gon caps. segments=4 for quad-friendly output. */
  static createCylinderCageData(
    radius = 10,
    height = 20,
    segments = 4,
    idPrefix = '',
  ): {
    vertices: FormCage['vertices'];
    edges: FormCage['edges'];
    faces: FormCage['faces'];
  } {
    const hh = height / 2;
    const rawVerts: [number, number, number][] = [];

    // Bottom ring then top ring
    for (let i = 0; i < segments; i++) {
      const angle = (2 * Math.PI / segments) * i;
      rawVerts.push([radius * Math.cos(angle), -hh, radius * Math.sin(angle)]);
    }
    for (let i = 0; i < segments; i++) {
      const angle = (2 * Math.PI / segments) * i;
      rawVerts.push([radius * Math.cos(angle), hh, radius * Math.sin(angle)]);
    }

    const vertices = rawVerts.map((position, i) => ({
      id: `${idPrefix}v${i}`,
      position,
      crease: 0,
    }));

    // Side quads: bottom[i], bottom[i+1], top[i+1], top[i]
    const faceVIs: number[][] = [];
    for (let i = 0; i < segments; i++) {
      const b0 = i;
      const b1 = (i + 1) % segments;
      const t0 = i + segments;
      const t1 = ((i + 1) % segments) + segments;
      faceVIs.push([b0, b1, t1, t0]);
    }
    // Top cap: top ring in order
    faceVIs.push(Array.from({ length: segments }, (_, i) => i + segments));
    // Bottom cap: bottom ring in reverse order
    faceVIs.push(Array.from({ length: segments }, (_, i) => segments - 1 - i));

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

  /**
   * Build a T-Spline tube cage by sweeping a ring of vertices along a path.
   * Uses parallel-transport frames (rotation-minimizing) to orient the rings.
   */
  static createPipeCageData(
    pathPoints: THREE.Vector3[],
    radius: number,
    segments: number,
    idPrefix: string,
  ): {
    vertices: FormCage['vertices'];
    edges: FormCage['edges'];
    faces: FormCage['faces'];
  } {
    if (pathPoints.length < 2 || segments < 3) return { vertices: [], edges: [], faces: [] };
    const N = pathPoints.length;
    const S = segments;

    // Tangents
    const tangents = pathPoints.map((_, i) => {
      if (i === 0) return pathPoints[1].clone().sub(pathPoints[0]).normalize();
      if (i === N - 1) return pathPoints[N - 1].clone().sub(pathPoints[N - 2]).normalize();
      return pathPoints[i + 1].clone().sub(pathPoints[i - 1]).normalize();
    });

    // Rotation-minimizing transport frames
    const normals: THREE.Vector3[] = new Array(N);
    const binormals: THREE.Vector3[] = new Array(N);
    const initUp = Math.abs(tangents[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    normals[0] = initUp.clone().sub(tangents[0].clone().multiplyScalar(initUp.dot(tangents[0]))).normalize();
    binormals[0] = tangents[0].clone().cross(normals[0]).normalize();
    for (let i = 1; i < N; i++) {
      const b = tangents[i - 1].clone().cross(tangents[i]);
      if (b.length() < 1e-6) {
        normals[i] = normals[i - 1].clone();
      } else {
        b.normalize();
        const angle = Math.acos(Math.max(-1, Math.min(1, tangents[i - 1].dot(tangents[i]))));
        normals[i] = normals[i - 1].clone().applyMatrix4(new THREE.Matrix4().makeRotationAxis(b, angle)).normalize();
      }
      binormals[i] = tangents[i].clone().cross(normals[i]).normalize();
    }

    const vid = (ring: number, seg: number) => `${idPrefix}v${ring}_${seg}`;
    const vertices: FormCage['vertices'] = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < S; j++) {
        const angle = (j / S) * Math.PI * 2;
        const offset = normals[i].clone().multiplyScalar(radius * Math.cos(angle))
          .add(binormals[i].clone().multiplyScalar(radius * Math.sin(angle)));
        const pos = pathPoints[i].clone().add(offset);
        vertices.push({ id: vid(i, j), position: [pos.x, pos.y, pos.z], crease: 0 });
      }
    }

    const edges: FormCage['edges'] = [];
    const faces: FormCage['faces'] = [];
    const eid = (a: string, b: string) => `${idPrefix}e_${a}_${b}`;

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < S; j++) {
        edges.push({ id: eid(vid(i, j), vid(i, (j + 1) % S)), vertexIds: [vid(i, j), vid(i, (j + 1) % S)], crease: 0 });
      }
    }
    for (let i = 0; i < N - 1; i++) {
      for (let j = 0; j < S; j++) {
        edges.push({ id: eid(vid(i, j), vid(i + 1, j)), vertexIds: [vid(i, j), vid(i + 1, j)], crease: 0 });
      }
    }
    for (let i = 0; i < N - 1; i++) {
      for (let j = 0; j < S; j++) {
        const jn = (j + 1) % S;
        faces.push({ id: `${idPrefix}f${i}_${j}`, vertexIds: [vid(i, j), vid(i, jn), vid(i + 1, jn), vid(i + 1, j)] });
      }
    }

    return { vertices, edges, faces };
  }

  /** Create a cube-sphere cage: box vertices normalized to lie on a sphere. Catmull-Clark rounds it. */
  static createSphereCageData(
    radius = 10,
    idPrefix = '',
  ): {
    vertices: FormCage['vertices'];
    edges: FormCage['edges'];
    faces: FormCage['faces'];
  } {
    // Start with a unit cube and normalize each vertex to the sphere radius
    const s = 1 / Math.sqrt(3); // normalize: [±1,±1,±1] / sqrt(3)
    const rawVerts: [number, number, number][] = [
      [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
      [-s, -s,  s], [s, -s,  s], [s, s,  s], [-s, s,  s],
    ];
    // Scale to radius
    const scaledVerts: [number, number, number][] = rawVerts.map(
      ([x, y, z]) => [x * radius, y * radius, z * radius],
    );

    const vertices = scaledVerts.map((position, i) => ({
      id: `${idPrefix}v${i}`,
      position,
      crease: 0,
    }));

    // Same 6-face topology as the box
    const faceVIs: number[][] = [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 4, 7, 3],
      [1, 2, 6, 5],
      [0, 1, 5, 4],
      [3, 7, 6, 2],
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

  /** Create a torus cage. majorSegs and minorSegs default to 4 for quad-friendly output. */
  static createTorusCageData(
    majorRadius = 15,
    minorRadius = 3,
    majorSegs = 4,
    minorSegs = 4,
    idPrefix = '',
  ): {
    vertices: FormCage['vertices'];
    edges: FormCage['edges'];
    faces: FormCage['faces'];
  } {
    const rawVerts: [number, number, number][] = [];
    for (let i = 0; i < majorSegs; i++) {
      const angleMajor = (2 * Math.PI / majorSegs) * i;
      const cx = majorRadius * Math.cos(angleMajor);
      const cz = majorRadius * Math.sin(angleMajor);
      for (let j = 0; j < minorSegs; j++) {
        const angleMinor = (2 * Math.PI / minorSegs) * j;
        rawVerts.push([
          cx + minorRadius * Math.cos(angleMinor) * Math.cos(angleMajor),
          minorRadius * Math.sin(angleMinor),
          cz + minorRadius * Math.cos(angleMinor) * Math.sin(angleMajor),
        ]);
      }
    }

    const vertices = rawVerts.map((position, i) => ({
      id: `${idPrefix}v${i}`,
      position,
      crease: 0,
    }));

    // Quad faces: (i,j) → (i,j), (i+1,j), (i+1,j+1), (i,j+1) with modular wrap
    const faceVIs: number[][] = [];
    for (let i = 0; i < majorSegs; i++) {
      for (let j = 0; j < minorSegs; j++) {
        const i1 = (i + 1) % majorSegs;
        const j1 = (j + 1) % minorSegs;
        faceVIs.push([
          i  * minorSegs + j,
          i1 * minorSegs + j,
          i1 * minorSegs + j1,
          i  * minorSegs + j1,
        ]);
      }
    }

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

  /**
   * Creates cage data for a T-Spline Extrude: takes an existing set of ring
   * vertices (a closed polygon loop) and extrudes them along a direction vector
   * by the given distance, creating a new ring and quad faces connecting old→new.
   *
   * @param ringVerts         Ordered world-space positions of the ring to extrude (closed loop, do NOT repeat first point)
   * @param direction         Extrusion direction (will be normalised internally)
   * @param distance          Extrusion distance in model units
   * @param idPrefix          Prefix for generated IDs to avoid collisions
   * @param startVertexIndex  Vertex index offset so new vertex IDs don't clash with existing ones
   * @param startEdgeIndex    Edge index offset
   * @param startFaceIndex    Face index offset
   * @param oldRingIds        Optional: actual IDs of the existing ring vertices in order.
   *                          If omitted, IDs are synthesised as `${idPrefix}v${startVertexIndex - N + i}`.
   */
  static createExtrudeCageData(
    ringVerts: THREE.Vector3[],
    direction: THREE.Vector3,
    distance: number,
    idPrefix: string,
    startVertexIndex = 0,
    startEdgeIndex = 0,
    startFaceIndex = 0,
    oldRingIds?: string[],
  ): { vertices: FormCage['vertices']; edges: FormCage['edges']; faces: FormCage['faces'] } {
    const N = ringVerts.length;
    if (N < 2) return { vertices: [], edges: [], faces: [] };

    // 1. Normalise direction (clone so we don't mutate input)
    const dir = direction.clone().normalize().multiplyScalar(distance);

    // Resolve old ring vertex IDs
    const oldIds: string[] = oldRingIds && oldRingIds.length === N
      ? oldRingIds
      : ringVerts.map((_, i) => `${idPrefix}v${startVertexIndex - N + i}`);

    // 2. Create N new vertices = ringVerts[i] + dir
    const newVerts: FormCage['vertices'] = ringVerts.map((rv, i) => ({
      id: `${idPrefix}v${startVertexIndex + i}`,
      position: [rv.x + dir.x, rv.y + dir.y, rv.z + dir.z] as [number, number, number],
      crease: 0,
    }));

    // 3. Create N "side" edges connecting old[i] → new[i]
    const sideEdges: FormCage['edges'] = ringVerts.map((_, i) => ({
      id: `${idPrefix}e${startEdgeIndex + i}`,
      vertexIds: [oldIds[i], `${idPrefix}v${startVertexIndex + i}`] as [string, string],
      crease: 0,
    }));

    // 4. Create N "cap ring" edges connecting new[i] → new[(i+1)%N]
    const capEdges: FormCage['edges'] = newVerts.map((_, i) => ({
      id: `${idPrefix}e${startEdgeIndex + N + i}`,
      vertexIds: [
        `${idPrefix}v${startVertexIndex + i}`,
        `${idPrefix}v${startVertexIndex + (i + 1) % N}`,
      ] as [string, string],
      crease: 0,
    }));

    // 5. Create N quad faces: old[i], old[(i+1)%N], new[(i+1)%N], new[i]
    const faces: FormCage['faces'] = ringVerts.map((_, i) => {
      const iNext = (i + 1) % N;
      return {
        id: `${idPrefix}f${startFaceIndex + i}`,
        vertexIds: [
          oldIds[i],
          oldIds[iNext],
          `${idPrefix}v${startVertexIndex + iNext}`,
          `${idPrefix}v${startVertexIndex + i}`,
        ],
      };
    });

    // 6. Return new vertices, all edges, and faces
    return { vertices: newVerts, edges: [...sideEdges, ...capEdges], faces };
  }

  /**
   * Creates cage data for a T-Spline Revolve: takes a profile polyline
   * (a sequence of 3D points forming a cross-section) and revolves it
   * around an axis to form a cage of quad faces.
   *
   * @param profilePoints  Ordered world-space positions of the profile (NOT closed — first≠last)
   * @param axisOrigin     A point on the revolution axis
   * @param axisDir        Direction of the revolution axis (will be normalised)
   * @param angleDeg       Total revolution angle in degrees (360 = full revolve)
   * @param segments       Number of angular segments (minimum 3)
   * @param idPrefix       Prefix for generated IDs
   */
  static createRevolveCageData(
    profilePoints: THREE.Vector3[],
    axisOrigin: THREE.Vector3,
    axisDir: THREE.Vector3,
    angleDeg: number,
    segments: number,
    idPrefix: string,
  ): { vertices: FormCage['vertices']; edges: FormCage['edges']; faces: FormCage['faces'] } {
    const N = profilePoints.length;
    if (N < 2 || segments < 3) return { vertices: [], edges: [], faces: [] };

    // 1. Normalise axisDir (clone so we don't mutate input)
    const axis = axisDir.clone().normalize();
    const isFullRevolve = Math.abs(angleDeg - 360) < 0.001;
    const lastSeg = isFullRevolve ? segments : segments - 1;

    // 2. Generate rotated vertices: vertex[s][p] = rotate profilePoints[p] by s * angleDeg/segments
    const vertices: FormCage['vertices'] = [];
    for (let s = 0; s < segments; s++) {
      const angleRad = (s * angleDeg / segments) * Math.PI / 180;
      const quat = new THREE.Quaternion();
      quat.setFromAxisAngle(axis, angleRad);
      for (let p = 0; p < N; p++) {
        const rotated = profilePoints[p].clone().sub(axisOrigin).applyQuaternion(quat).add(axisOrigin);
        vertices.push({
          id: `${idPrefix}v${s * N + p}`,
          position: [rotated.x, rotated.y, rotated.z],
          crease: 0,
        });
      }
    }

    const vid = (s: number, p: number) => `${idPrefix}v${s * N + p}`;
    const edges: FormCage['edges'] = [];
    let eid = 0;

    // 3. Profile ring edges: connect vertex[s][p] → vertex[s][p+1] for p = 0..N-2
    for (let s = 0; s < segments; s++) {
      for (let p = 0; p < N - 1; p++) {
        edges.push({
          id: `${idPrefix}e${eid++}`,
          vertexIds: [vid(s, p), vid(s, p + 1)],
          crease: 0,
        });
      }
    }

    // 4. Angular sweep edges: connect vertex[s][p] → vertex[(s+1)%seg][p]
    // For partial revolves, don't wrap last → first
    const sweepLimit = isFullRevolve ? segments : segments - 1;
    for (let s = 0; s < sweepLimit; s++) {
      const sNext = isFullRevolve ? (s + 1) % segments : s + 1;
      for (let p = 0; p < N; p++) {
        edges.push({
          id: `${idPrefix}e${eid++}`,
          vertexIds: [vid(s, p), vid(sNext, p)],
          crease: 0,
        });
      }
    }

    // 5. Quad faces: for s = 0..lastSeg-1 and p = 0..N-2
    const faces: FormCage['faces'] = [];
    let fid = 0;
    for (let s = 0; s < lastSeg; s++) {
      const sNext = isFullRevolve ? (s + 1) % segments : s + 1;
      for (let p = 0; p < N - 1; p++) {
        faces.push({
          id: `${idPrefix}f${fid++}`,
          vertexIds: [vid(s, p), vid(s, p + 1), vid(sNext, p + 1), vid(sNext, p)],
        });
      }
    }

    return { vertices, edges, faces };
  }

  /**
   * T-Spline Loft: blends between N profile rings placed at positions along a
   * straight or interpolated path.
   *
   * Profiles are assumed to be roughly parallel (same vertex count S).
   * The loft places them evenly spaced along the Y axis by default, or uses
   * explicit positions if provided.
   *
   * @param profiles   Array of profile rings (each is a closed polygon in LOCAL 2D
   *                   coords {x,y}). All profiles must have the same number of points S.
   * @param positions  Optional world-space positions for each profile centroid.
   *                   If omitted, profiles are placed at Y = 0, 10, 20, … (10-unit spacing).
   * @param normals    Optional normal direction for each profile plane.
   *                   If omitted, all profiles use (0,1,0) — stacked vertically.
   * @param idPrefix   Prefix for generated IDs
   */
  static createLoftCageData(
    profiles: Array<Array<{ x: number; y: number }>>,
    positions?: THREE.Vector3[],
    normals?: THREE.Vector3[],
    idPrefix = '',
  ): { vertices: FormCage['vertices']; edges: FormCage['edges']; faces: FormCage['faces'] } {
    const P = profiles.length;
    if (P < 2) return { vertices: [], edges: [], faces: [] };

    // Validate: all profiles must have the same point count
    const S = profiles[0].length;
    if (S < 3) return { vertices: [], edges: [], faces: [] };
    for (const prof of profiles) {
      if (prof.length !== S) return { vertices: [], edges: [], faces: [] };
    }

    // Resolve positions (default: Y = 0, 10, 20, …)
    const resolvedPositions: THREE.Vector3[] = positions && positions.length === P
      ? positions
      : profiles.map((_, i) => new THREE.Vector3(0, i * 10, 0));

    // Resolve normals (default: (0,1,0) for all)
    const resolvedNormals: THREE.Vector3[] = normals && normals.length === P
      ? normals
      : profiles.map(() => new THREE.Vector3(0, 1, 0));

    const vid = (i: number, j: number) => `${idPrefix}v${i * S + j}`;

    // Build vertices: for each profile i and point j, place in 3D using local frame
    const vertices: FormCage['vertices'] = [];
    for (let i = 0; i < P; i++) {
      const center = resolvedPositions[i];
      const up = resolvedNormals[i].clone().normalize();

      // Build orthonormal frame (t1, t2) perpendicular to up
      const worldRef = Math.abs(up.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      const t1 = new THREE.Vector3().crossVectors(worldRef, up).normalize();
      const t2 = new THREE.Vector3().crossVectors(up, t1).normalize();

      for (let j = 0; j < S; j++) {
        const px = profiles[i][j].x;
        const py = profiles[i][j].y;
        const pos = center.clone()
          .addScaledVector(t1, px)
          .addScaledVector(t2, py);
        vertices.push({ id: vid(i, j), position: [pos.x, pos.y, pos.z], crease: 0 });
      }
    }

    const edges: FormCage['edges'] = [];
    const faces: FormCage['faces'] = [];
    const eid = (a: string, b: string) => `${idPrefix}e_${a}_${b}`;

    // Profile-ring edges: connect vertex[i][j] → vertex[i][(j+1)%S] at each profile station
    for (let i = 0; i < P; i++) {
      for (let j = 0; j < S; j++) {
        edges.push({
          id: eid(vid(i, j), vid(i, (j + 1) % S)),
          vertexIds: [vid(i, j), vid(i, (j + 1) % S)],
          crease: 0,
        });
      }
    }

    // Loft edges: connect vertex[i][j] → vertex[i+1][j] between profile stations
    for (let i = 0; i < P - 1; i++) {
      for (let j = 0; j < S; j++) {
        edges.push({
          id: eid(vid(i, j), vid(i + 1, j)),
          vertexIds: [vid(i, j), vid(i + 1, j)],
          crease: 0,
        });
      }
    }

    // Quad faces: for i=0..P-2, j=0..S-1
    for (let i = 0; i < P - 1; i++) {
      for (let j = 0; j < S; j++) {
        const jn = (j + 1) % S;
        faces.push({
          id: `${idPrefix}f${i}_${j}`,
          vertexIds: [vid(i, j), vid(i, jn), vid(i + 1, jn), vid(i + 1, j)],
        });
      }
    }

    return { vertices, edges, faces };
  }

  /** Create a quadball cage (same cube-sphere as createSphereCageData). */
  static createQuadballCageData(
    radius = 10,
    idPrefix = '',
  ): {
    vertices: FormCage['vertices'];
    edges: FormCage['edges'];
    faces: FormCage['faces'];
  } {
    return SubdivisionEngine.createSphereCageData(radius, idPrefix);
  }

  /** Create a single quad face (same as plane, named "Face" for manual building). */
  static createFaceCageData(
    size = 10,
    idPrefix = '',
  ): {
    vertices: FormCage['vertices'];
    edges: FormCage['edges'];
    faces: FormCage['faces'];
  } {
    return SubdivisionEngine.createPlaneCageData(size, size, idPrefix);
  }

  /**
   * T-Spline Sweep: sweeps a closed profile ring along a path using
   * parallel-transport (rotation-minimizing) frames — same algorithm as createPipeCageData
   * but the profile shape is arbitrary (not just a circle).
   *
   * @param pathPoints     Ordered world-space positions along the sweep path (at least 2)
   * @param profileRing    Closed profile polygon in LOCAL 2D coords (x,y) — relative to path frame.
   *                       Will be placed in the frame at each path point.
   *                       The ring is treated as closed (last point connects back to first).
   * @param idPrefix       Prefix for generated IDs
   */
  static createSweepCageData(
    pathPoints: THREE.Vector3[],
    profileRing: Array<{ x: number; y: number }>,
    idPrefix: string,
  ): { vertices: FormCage['vertices']; edges: FormCage['edges']; faces: FormCage['faces'] } {
    const N = pathPoints.length;
    const S = profileRing.length;
    if (N < 2 || S < 3) return { vertices: [], edges: [], faces: [] };

    // 1. Compute tangents at each path point
    const tangents = pathPoints.map((_, i) => {
      if (i === 0) return pathPoints[1].clone().sub(pathPoints[0]).normalize();
      if (i === N - 1) return pathPoints[N - 1].clone().sub(pathPoints[N - 2]).normalize();
      return pathPoints[i + 1].clone().sub(pathPoints[i - 1]).normalize();
    });

    // 2. Build rotation-minimizing frames using parallel-transport algorithm
    const normals: THREE.Vector3[] = new Array(N);
    const binormals: THREE.Vector3[] = new Array(N);
    const initUp = Math.abs(tangents[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    normals[0] = initUp.clone().sub(tangents[0].clone().multiplyScalar(initUp.dot(tangents[0]))).normalize();
    binormals[0] = tangents[0].clone().cross(normals[0]).normalize();
    for (let i = 1; i < N; i++) {
      const b = tangents[i - 1].clone().cross(tangents[i]);
      if (b.length() < 1e-6) {
        normals[i] = normals[i - 1].clone();
      } else {
        b.normalize();
        const angle = Math.acos(Math.max(-1, Math.min(1, tangents[i - 1].dot(tangents[i]))));
        normals[i] = normals[i - 1].clone().applyMatrix4(new THREE.Matrix4().makeRotationAxis(b, angle)).normalize();
      }
      binormals[i] = tangents[i].clone().cross(normals[i]).normalize();
    }

    // 3. Generate vertices: for each path point i and profile point j
    const vid = (i: number, j: number) => `${idPrefix}v${i * S + j}`;
    const vertices: FormCage['vertices'] = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < S; j++) {
        const offset = normals[i].clone().multiplyScalar(profileRing[j].x)
          .add(binormals[i].clone().multiplyScalar(profileRing[j].y));
        const pos = pathPoints[i].clone().add(offset);
        vertices.push({ id: vid(i, j), position: [pos.x, pos.y, pos.z], crease: 0 });
      }
    }

    const edges: FormCage['edges'] = [];
    const faces: FormCage['faces'] = [];
    const eid = (a: string, b: string) => `${idPrefix}e_${a}_${b}`;

    // 4. Profile-ring edges: connect vertex[i][j] → vertex[i][(j+1)%S] at each path station
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < S; j++) {
        edges.push({
          id: eid(vid(i, j), vid(i, (j + 1) % S)),
          vertexIds: [vid(i, j), vid(i, (j + 1) % S)],
          crease: 0,
        });
      }
    }

    // 5. Sweep edges: connect vertex[i][j] → vertex[i+1][j]
    for (let i = 0; i < N - 1; i++) {
      for (let j = 0; j < S; j++) {
        edges.push({
          id: eid(vid(i, j), vid(i + 1, j)),
          vertexIds: [vid(i, j), vid(i + 1, j)],
          crease: 0,
        });
      }
    }

    // 6. Quad faces: for i=0..N-2, j=0..S-1
    for (let i = 0; i < N - 1; i++) {
      for (let j = 0; j < S; j++) {
        const jn = (j + 1) % S;
        faces.push({
          id: `${idPrefix}f${i}_${j}`,
          vertexIds: [vid(i, j), vid(i, jn), vid(i + 1, jn), vid(i + 1, j)],
        });
      }
    }

    return { vertices, edges, faces };
  }
}
