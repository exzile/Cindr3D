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
import type { FormCage } from '../../types/cad';
import { avgPoints, edgeKey, getPos, setPos } from './utils/meshUtils';
import {
  findEdgeLoop,
  findEdgeRing,
  type EdgeSelectionCage,
} from './selectionOps';
import {
  createBoxCageData,
  createCylinderCageData,
  createExtrudeCageData,
  createFaceCageData,
  createLoftCageData,
  createPipeCageData,
  createPlaneCageData,
  createQuadballCageData,
  createRevolveCageData,
  createSphereCageData,
  createSweepCageData,
  createTorusCageData,
} from './primitiveFactories';
import {
  bridge,
  fillHole,
  flatten,
  insertEdge,
  insertPoint,
  interpolateToPoints,
  makeUniform,
  pullToLimitSurface,
  thickenCage,
  unweld,
  weld,
} from './formModelingOps';

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

  static findEdgeLoop(cage: EdgeSelectionCage, startEdgeId: string): string[] {
    return findEdgeLoop(cage, startEdgeId);
  }

  static findEdgeRing(cage: EdgeSelectionCage, startEdgeId: string): string[] {
    return findEdgeRing(cage, startEdgeId);
  }

  static createBoxCageData(width = 20, height = 20, depth = 20, idPrefix = '') {
    return createBoxCageData(width, height, depth, idPrefix);
  }

  static createPlaneCageData(width = 20, height = 20, idPrefix = '') {
    return createPlaneCageData(width, height, idPrefix);
  }

  static createCylinderCageData(radius = 10, height = 20, segments = 4, idPrefix = '') {
    return createCylinderCageData(radius, height, segments, idPrefix);
  }

  static createPipeCageData(pathPoints: THREE.Vector3[], radius: number, segments: number, idPrefix: string) {
    return createPipeCageData(pathPoints, radius, segments, idPrefix);
  }

  static createSphereCageData(radius = 10, idPrefix = '') {
    return createSphereCageData(radius, idPrefix);
  }

  static createTorusCageData(majorRadius = 15, minorRadius = 3, majorSegs = 4, minorSegs = 4, idPrefix = '') {
    return createTorusCageData(majorRadius, minorRadius, majorSegs, minorSegs, idPrefix);
  }

  static createExtrudeCageData(
    ringVerts: THREE.Vector3[],
    direction: THREE.Vector3,
    distance: number,
    idPrefix: string,
    startVertexIndex = 0,
    startEdgeIndex = 0,
    startFaceIndex = 0,
    oldRingIds?: string[],
  ) {
    return createExtrudeCageData(
      ringVerts,
      direction,
      distance,
      idPrefix,
      startVertexIndex,
      startEdgeIndex,
      startFaceIndex,
      oldRingIds,
    );
  }

  static createRevolveCageData(
    profilePoints: THREE.Vector3[],
    axisOrigin: THREE.Vector3,
    axisDir: THREE.Vector3,
    angleDeg: number,
    segments: number,
    idPrefix: string,
  ) {
    return createRevolveCageData(profilePoints, axisOrigin, axisDir, angleDeg, segments, idPrefix);
  }

  static createLoftCageData(
    profiles: Array<Array<{ x: number; y: number }>>,
    positions?: THREE.Vector3[],
    normals?: THREE.Vector3[],
    idPrefix = '',
  ) {
    return createLoftCageData(profiles, positions, normals, idPrefix);
  }

  static createQuadballCageData(radius = 10, idPrefix = '') {
    return createQuadballCageData(radius, idPrefix);
  }

  static createFaceCageData(size = 10, idPrefix = '') {
    return createFaceCageData(size, idPrefix);
  }

  static createSweepCageData(
    pathPoints: THREE.Vector3[],
    profileRing: Array<{ x: number; y: number }>,
    idPrefix: string,
  ) {
    return createSweepCageData(pathPoints, profileRing, idPrefix);
  }

  static insertEdge(cage: FormCage, faceId: string): FormCage {
    return insertEdge(cage, faceId);
  }

  static insertPoint(cage: FormCage, edgeId: string, t = 0.5): FormCage {
    return insertPoint(cage, edgeId, t);
  }

  static bridge(cage: FormCage, loop1VertIds: string[], loop2VertIds: string[]): FormCage {
    return bridge(cage, loop1VertIds, loop2VertIds);
  }

  static fillHole(cage: FormCage, boundaryEdgeId: string): FormCage {
    return fillHole(cage, boundaryEdgeId);
  }

  static weld(cage: FormCage, vertexIds: string[]): FormCage {
    return weld(cage, vertexIds);
  }

  static unweld(cage: FormCage, vertexId: string): FormCage {
    return unweld(cage, vertexId);
  }

  static flatten(
    cage: FormCage,
    vertexIds: string[],
    planeNormal: [number, number, number],
    planeOffset: number,
  ): FormCage {
    return flatten(cage, vertexIds, planeNormal, planeOffset);
  }

  static makeUniform(cage: FormCage, iterations = 3): FormCage {
    return makeUniform(cage, iterations);
  }

  static pullToLimitSurface(cage: FormCage): FormCage {
    return pullToLimitSurface(cage);
  }

  static interpolateToPoints(cage: FormCage, targetPoints: [number, number, number][]): FormCage {
    return interpolateToPoints(cage, targetPoints);
  }

  static thickenCage(cage: FormCage, thickness: number): FormCage {
    return thickenCage(cage, thickness);
  }
}
