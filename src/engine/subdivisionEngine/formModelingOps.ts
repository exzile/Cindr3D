import type { FormCage, FormVertex, FormEdge, FormFace } from '../../types/cad';

/** FM1 — Insert Edge */
export function insertEdge(cage: FormCage, faceId: string): FormCage {
  const face = cage.faces.find((f) => f.id === faceId);
  if (!face || face.vertexIds.length !== 4) return cage;

  const [vA, vB, vC, vD] = face.vertexIds;

  const vertById = new Map<string, FormVertex>();
  for (const v of cage.vertices) vertById.set(v.id, v);

  const midpoint = (idA: string, idB: string): [number, number, number] => {
    const a = vertById.get(idA)!.position;
    const b = vertById.get(idB)!.position;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  };

  const ts = Date.now();
  const mAB: FormVertex = { id: `${faceId}-ie-${ts}-mAB`, position: midpoint(vA, vB), crease: 0 };
  const mCD: FormVertex = { id: `${faceId}-ie-${ts}-mCD`, position: midpoint(vC, vD), crease: 0 };

  const newEdge: FormEdge = { id: `${faceId}-ie-${ts}-e`, vertexIds: [mAB.id, mCD.id], crease: 0 };

  const eAmAB: FormEdge = { id: `${faceId}-ie-${ts}-eA-mAB`, vertexIds: [vA, mAB.id], crease: 0 };
  const emABB: FormEdge = { id: `${faceId}-ie-${ts}-mAB-B`, vertexIds: [mAB.id, vB], crease: 0 };
  const eCmCD: FormEdge = { id: `${faceId}-ie-${ts}-eC-mCD`, vertexIds: [vC, mCD.id], crease: 0 };
  const emCDD: FormEdge = { id: `${faceId}-ie-${ts}-mCD-D`, vertexIds: [mCD.id, vD], crease: 0 };

  const face1: FormFace = { id: `${faceId}-ie-${ts}-f1`, vertexIds: [vA, mAB.id, mCD.id, vD] };
  const face2: FormFace = { id: `${faceId}-ie-${ts}-f2`, vertexIds: [mAB.id, vB, vC, mCD.id] };

  const edgeKeyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const removedEdgeKeys = new Set([edgeKeyOf(vA, vB), edgeKeyOf(vC, vD)]);
  const keptEdges = cage.edges.filter((e) => {
    const k = edgeKeyOf(e.vertexIds[0], e.vertexIds[1]);
    return !removedEdgeKeys.has(k);
  });

  return {
    ...cage,
    vertices: [...cage.vertices, mAB, mCD],
    edges: [...keptEdges, eAmAB, emABB, eCmCD, emCDD, newEdge],
    faces: [...cage.faces.filter((f) => f.id !== faceId), face1, face2],
  };
}

/** FM2 — Insert Point */
export function insertPoint(cage: FormCage, edgeId: string, t = 0.5): FormCage {
  const edge = cage.edges.find((e) => e.id === edgeId);
  if (!edge) return cage;

  const [idA, idB] = edge.vertexIds;
  const vertById = new Map<string, FormVertex>();
  for (const v of cage.vertices) vertById.set(v.id, v);

  const a = vertById.get(idA)!.position;
  const b = vertById.get(idB)!.position;
  const newPos: [number, number, number] = [
    a[0] + t * (b[0] - a[0]),
    a[1] + t * (b[1] - a[1]),
    a[2] + t * (b[2] - a[2]),
  ];

  const ts = Date.now();
  const newVert: FormVertex = { id: `${edgeId}-ip-${ts}`, position: newPos, crease: edge.crease };

  const edgeA: FormEdge = { id: `${edgeId}-ip-${ts}-ea`, vertexIds: [idA, newVert.id], crease: edge.crease };
  const edgeB: FormEdge = { id: `${edgeId}-ip-${ts}-eb`, vertexIds: [newVert.id, idB], crease: edge.crease };

  const newFaces: FormFace[] = cage.faces.map((f) => {
    const vids = f.vertexIds;
    let insertAt = -1;
    for (let i = 0; i < vids.length; i++) {
      const next = (i + 1) % vids.length;
      if ((vids[i] === idA && vids[next] === idB) || (vids[i] === idB && vids[next] === idA)) {
        insertAt = i;
        break;
      }
    }
    if (insertAt === -1) return f;
    const updated = [...vids];
    updated.splice(insertAt + 1, 0, newVert.id);
    return { id: f.id, vertexIds: updated };
  });

  return {
    ...cage,
    vertices: [...cage.vertices, newVert],
    edges: [...cage.edges.filter((e) => e.id !== edgeId), edgeA, edgeB],
    faces: newFaces,
  };
}

/** FM3 — Bridge */
export function bridge(cage: FormCage, loop1VertIds: string[], loop2VertIds: string[]): FormCage {
  const n = loop1VertIds.length;
  if (n < 2 || loop2VertIds.length !== n) return cage;

  const ts = Date.now();
  const newEdges: FormEdge[] = [];
  const newFaces: FormFace[] = [];

  for (let i = 0; i < n; i++) {
    newEdges.push({ id: `br-${ts}-se${i}`, vertexIds: [loop1VertIds[i], loop2VertIds[i]], crease: 0 });
  }

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    newFaces.push({ id: `br-${ts}-f${i}`, vertexIds: [loop1VertIds[i], loop1VertIds[j], loop2VertIds[j], loop2VertIds[i]] });
  }

  return { ...cage, edges: [...cage.edges, ...newEdges], faces: [...cage.faces, ...newFaces] };
}

/** FM4 — Fill Hole */
export function fillHole(cage: FormCage, boundaryEdgeId: string): FormCage {
  const edge = cage.edges.find((e) => e.id === boundaryEdgeId);
  if (!edge) return cage;

  const edgeKeyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeFaceCount = new Map<string, number>();
  for (const f of cage.faces) {
    const vids = f.vertexIds;
    for (let i = 0; i < vids.length; i++) {
      const k = edgeKeyOf(vids[i], vids[(i + 1) % vids.length]);
      edgeFaceCount.set(k, (edgeFaceCount.get(k) ?? 0) + 1);
    }
  }

  const boundaryAdj = new Map<string, string[]>();
  const addBoundaryEdge = (a: string, b: string) => {
    const k = edgeKeyOf(a, b);
    if ((edgeFaceCount.get(k) ?? 0) === 1) {
      if (!boundaryAdj.has(a)) boundaryAdj.set(a, []);
      if (!boundaryAdj.has(b)) boundaryAdj.set(b, []);
      boundaryAdj.get(a)!.push(b);
      boundaryAdj.get(b)!.push(a);
    }
  };

  for (const f of cage.faces) {
    const vids = f.vertexIds;
    for (let i = 0; i < vids.length; i++) {
      addBoundaryEdge(vids[i], vids[(i + 1) % vids.length]);
    }
  }

  const startKey = edgeKeyOf(edge.vertexIds[0], edge.vertexIds[1]);
  if ((edgeFaceCount.get(startKey) ?? 0) !== 1) return cage;

  const loop: string[] = [edge.vertexIds[0], edge.vertexIds[1]];
  const visited = new Set<string>([edge.vertexIds[0], edge.vertexIds[1]]);
  let prev = edge.vertexIds[0];
  let cur = edge.vertexIds[1];
  for (;;) {
    const neighbors = boundaryAdj.get(cur) ?? [];
    const next = neighbors.find((n) => n !== prev && !visited.has(n));
    if (!next) break;
    loop.push(next);
    visited.add(next);
    prev = cur;
    cur = next;
  }

  if (loop.length < 3) return cage;

  const vertById = new Map<string, FormVertex>();
  for (const v of cage.vertices) vertById.set(v.id, v);

  let cx = 0; let cy = 0; let cz = 0;
  for (const vid of loop) {
    const p = vertById.get(vid)!.position;
    cx += p[0]; cy += p[1]; cz += p[2];
  }
  const n = loop.length;
  const ts = Date.now();
  const centroid: FormVertex = { id: `fh-${ts}-c`, position: [cx / n, cy / n, cz / n], crease: 0 };

  const spokeEdges: FormEdge[] = loop.map((vid, i) => ({ id: `fh-${ts}-sp${i}`, vertexIds: [centroid.id, vid], crease: 0 }));

  const newFaces: FormFace[] = loop.map((vid, i) => ({ id: `fh-${ts}-f${i}`, vertexIds: [centroid.id, vid, loop[(i + 1) % n]] }));

  return {
    ...cage,
    vertices: [...cage.vertices, centroid],
    edges: [...cage.edges, ...spokeEdges],
    faces: [...cage.faces, ...newFaces],
  };
}

/** FM5 — Weld */
export function weld(cage: FormCage, vertexIds: string[]): FormCage {
  if (vertexIds.length < 2) return cage;
  const idSet = new Set(vertexIds);

  const vertById = new Map<string, FormVertex>();
  for (const v of cage.vertices) vertById.set(v.id, v);

  let cx = 0; let cy = 0; let cz = 0;
  let count = 0;
  for (const vid of vertexIds) {
    const v = vertById.get(vid);
    if (!v) continue;
    cx += v.position[0]; cy += v.position[1]; cz += v.position[2];
    count++;
  }
  if (count === 0) return cage;

  const ts = Date.now();
  const mergedId = `weld-${ts}-v`;
  const merged: FormVertex = { id: mergedId, position: [cx / count, cy / count, cz / count], crease: 0 };

  const remap = (vid: string) => (idSet.has(vid) ? mergedId : vid);

  const newVertices = [...cage.vertices.filter((v) => !idSet.has(v.id)), merged];

  const seenEdgeKeys = new Set<string>();
  const newEdges: FormEdge[] = [];
  for (const e of cage.edges) {
    const a = remap(e.vertexIds[0]);
    const b = remap(e.vertexIds[1]);
    if (a === b) continue;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seenEdgeKeys.has(k)) continue;
    seenEdgeKeys.add(k);
    newEdges.push({ ...e, vertexIds: [a, b] });
  }

  const newFaces: FormFace[] = cage.faces.map((f) => {
    const remapped = f.vertexIds.map(remap);
    const deduped: string[] = [remapped[0]];
    for (let i = 1; i < remapped.length; i++) {
      if (remapped[i] !== deduped[deduped.length - 1]) deduped.push(remapped[i]);
    }
    if (deduped[0] === deduped[deduped.length - 1]) deduped.pop();
    return { id: f.id, vertexIds: deduped };
  }).filter((f) => f.vertexIds.length >= 3);

  return { ...cage, vertices: newVertices, edges: newEdges, faces: newFaces };
}

/** FM6 — Unweld */
export function unweld(cage: FormCage, vertexId: string): FormCage {
  const original = cage.vertices.find((v) => v.id === vertexId);
  if (!original) return cage;

  const ts = Date.now();
  const newVertices: FormVertex[] = cage.vertices.filter((v) => v.id !== vertexId);
  const copyIds: string[] = [];

  const affectedFaces = cage.faces.filter((f) => f.vertexIds.includes(vertexId));
  affectedFaces.forEach((_, fi) => {
    const copyId = `unweld-${ts}-${fi}`;
    copyIds.push(copyId);
    newVertices.push({ id: copyId, position: [...original.position] as [number, number, number], crease: original.crease });
  });

  const newFaces: FormFace[] = cage.faces.map((f) => {
    const fi = affectedFaces.indexOf(f);
    if (fi === -1) return f;
    return { id: f.id, vertexIds: f.vertexIds.map((vid) => (vid === vertexId ? copyIds[fi] : vid)) };
  });

  const seenEdgeKeys = new Set<string>();
  const newEdges: FormEdge[] = [];

  for (const e of cage.edges) {
    if (!e.vertexIds.includes(vertexId)) {
      const k = e.vertexIds[0] < e.vertexIds[1] ? `${e.vertexIds[0]}|${e.vertexIds[1]}` : `${e.vertexIds[1]}|${e.vertexIds[0]}`;
      if (!seenEdgeKeys.has(k)) { seenEdgeKeys.add(k); newEdges.push(e); }
    }
  }

  for (const e of cage.edges) {
    if (!e.vertexIds.includes(vertexId)) continue;
    const other = e.vertexIds[0] === vertexId ? e.vertexIds[1] : e.vertexIds[0];
    for (const copyId of copyIds) {
      const k = copyId < other ? `${copyId}|${other}` : `${other}|${copyId}`;
      if (!seenEdgeKeys.has(k)) {
        seenEdgeKeys.add(k);
        newEdges.push({ id: `${e.id}-uw-${copyId}`, vertexIds: [copyId, other], crease: e.crease });
      }
    }
  }

  return { ...cage, vertices: newVertices, edges: newEdges, faces: newFaces };
}

/** FM7 — Flatten */
export function flatten(
  cage: FormCage,
  vertexIds: string[],
  planeNormal: [number, number, number],
  planeOffset: number,
): FormCage {
  const idSet = new Set(vertexIds);
  const [nx, ny, nz] = planeNormal;
  const lenSq = nx * nx + ny * ny + nz * nz;
  if (lenSq === 0) return cage;
  const invLen = 1 / Math.sqrt(lenSq);
  const [nnx, nny, nnz] = [nx * invLen, ny * invLen, nz * invLen];

  const newVertices = cage.vertices.map((v) => {
    if (!idSet.has(v.id)) return v;
    const [x, y, z] = v.position;
    const dist = x * nnx + y * nny + z * nnz - planeOffset;
    return {
      ...v,
      position: [x - dist * nnx, y - dist * nny, z - dist * nnz] as [number, number, number],
    };
  });

  return { ...cage, vertices: newVertices };
}

/** FM8 — Make Uniform */
export function makeUniform(cage: FormCage, iterations = 3): FormCage {
  const adjMap = new Map<string, Set<string>>();
  for (const v of cage.vertices) adjMap.set(v.id, new Set());
  for (const e of cage.edges) {
    adjMap.get(e.vertexIds[0])?.add(e.vertexIds[1]);
    adjMap.get(e.vertexIds[1])?.add(e.vertexIds[0]);
  }

  let positions = new Map<string, [number, number, number]>();
  for (const v of cage.vertices) positions.set(v.id, [...v.position] as [number, number, number]);

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Map<string, [number, number, number]>();
    for (const v of cage.vertices) {
      const neighbors = Array.from(adjMap.get(v.id) ?? []);
      if (neighbors.length === 0) {
        next.set(v.id, positions.get(v.id)!);
        continue;
      }
      let ax = 0; let ay = 0; let az = 0;
      for (const nid of neighbors) {
        const np = positions.get(nid)!;
        ax += np[0]; ay += np[1]; az += np[2];
      }
      const n = neighbors.length;
      next.set(v.id, [ax / n, ay / n, az / n]);
    }
    positions = next;
  }

  const newVertices = cage.vertices.map((v) => ({ ...v, position: positions.get(v.id)! }));
  return { ...cage, vertices: newVertices };
}

/** FM9 — Pull to Limit Surface */
export function pullToLimitSurface(cage: FormCage): FormCage {
  const adjMap = new Map<string, Set<string>>();
  for (const v of cage.vertices) adjMap.set(v.id, new Set());
  for (const e of cage.edges) {
    adjMap.get(e.vertexIds[0])?.add(e.vertexIds[1]);
    adjMap.get(e.vertexIds[1])?.add(e.vertexIds[0]);
  }

  const vertFaces = new Map<string, FormFace[]>();
  for (const v of cage.vertices) vertFaces.set(v.id, []);
  for (const f of cage.faces) {
    for (const vid of f.vertexIds) vertFaces.get(vid)?.push(f);
  }

  const edgeFaceCount = new Map<string, number>();
  const edgeKeyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const f of cage.faces) {
    const vids = f.vertexIds;
    for (let i = 0; i < vids.length; i++) {
      const k = edgeKeyOf(vids[i], vids[(i + 1) % vids.length]);
      edgeFaceCount.set(k, (edgeFaceCount.get(k) ?? 0) + 1);
    }
  }

  const vertById = new Map<string, FormVertex>();
  for (const v of cage.vertices) vertById.set(v.id, v);

  const newVertices = cage.vertices.map((v) => {
    const neighbors = Array.from(adjMap.get(v.id) ?? []);
    const faces = vertFaces.get(v.id) ?? [];
    const n = faces.length;

    if (n === 0 || neighbors.length === 0) return v;

    const isBoundary = neighbors.some((nid) => {
      const k = edgeKeyOf(v.id, nid);
      return (edgeFaceCount.get(k) ?? 0) < 2;
    });

    const [vx, vy, vz] = v.position;

    if (isBoundary) {
      const bNeighbors = neighbors.filter((nid) => {
        const k = edgeKeyOf(v.id, nid);
        return (edgeFaceCount.get(k) ?? 0) < 2;
      });
      if (bNeighbors.length === 0) return v;
      let ax = vx; let ay = vy; let az = vz;
      for (const nid of bNeighbors) {
        const np = vertById.get(nid)!.position;
        ax += np[0]; ay += np[1]; az += np[2];
      }
      const total = bNeighbors.length + 1;
      return { ...v, position: [ax / total, ay / total, az / total] as [number, number, number] };
    }

    const alpha = 3 / (2 * n);
    const beta = 1 / (4 * n);
    const keep = 1 - alpha - beta;

    let ax = 0; let ay = 0; let az = 0;
    for (const nid of neighbors) {
      const np = vertById.get(nid)!.position;
      ax += np[0]; ay += np[1]; az += np[2];
    }
    const avgN = neighbors.length;
    ax /= avgN; ay /= avgN; az /= avgN;

    let fx = 0; let fy = 0; let fz = 0;
    for (const f of faces) {
      let cx = 0; let cy = 0; let cz = 0;
      for (const fvid of f.vertexIds) {
        const fp = vertById.get(fvid)!.position;
        cx += fp[0]; cy += fp[1]; cz += fp[2];
      }
      const fn = f.vertexIds.length;
      fx += cx / fn; fy += cy / fn; fz += cz / fn;
    }
    fx /= n; fy /= n; fz /= n;

    return {
      ...v,
      position: [
        keep * vx + alpha * ax + beta * fx,
        keep * vy + alpha * ay + beta * fy,
        keep * vz + alpha * az + beta * fz,
      ] as [number, number, number],
    };
  });

  return { ...cage, vertices: newVertices };
}

/** FM10 — Interpolate */
export function interpolateToPoints(cage: FormCage, targetPoints: [number, number, number][]): FormCage {
  if (targetPoints.length === 0) return cage;

  const updates = new Map<string, [number, number, number]>();
  for (const tp of targetPoints) {
    let bestId = '';
    let bestDist = Infinity;
    for (const v of cage.vertices) {
      const [vx, vy, vz] = v.position;
      const d =
        (tp[0] - vx) * (tp[0] - vx) +
        (tp[1] - vy) * (tp[1] - vy) +
        (tp[2] - vz) * (tp[2] - vz);
      if (d < bestDist) { bestDist = d; bestId = v.id; }
    }
    if (bestId) updates.set(bestId, tp);
  }

  const newVertices = cage.vertices.map((v) => (updates.has(v.id) ? { ...v, position: updates.get(v.id)! } : v));
  return { ...cage, vertices: newVertices };
}

/** FM11 — Thicken Cage */
export function thickenCage(cage: FormCage, thickness: number): FormCage {
  const half = thickness / 2;

  const vertNormal = new Map<string, [number, number, number]>();
  for (const v of cage.vertices) vertNormal.set(v.id, [0, 0, 0]);

  const vertById = new Map<string, FormVertex>();
  for (const v of cage.vertices) vertById.set(v.id, v);

  for (const f of cage.faces) {
    if (f.vertexIds.length < 3) continue;
    const p0 = vertById.get(f.vertexIds[0])!.position;
    const p1 = vertById.get(f.vertexIds[1])!.position;
    const p2 = vertById.get(f.vertexIds[2])!.position;
    const ux = p1[0] - p0[0]; const uy = p1[1] - p0[1]; const uz = p1[2] - p0[2];
    const wx = p2[0] - p0[0]; const wy = p2[1] - p0[1]; const wz = p2[2] - p0[2];
    const fnx = uy * wz - uz * wy;
    const fny = uz * wx - ux * wz;
    const fnz = ux * wy - uy * wx;
    for (const vid of f.vertexIds) {
      const n = vertNormal.get(vid)!;
      n[0] += fnx; n[1] += fny; n[2] += fnz;
    }
  }

  for (const [, n] of vertNormal) {
    const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (len > 0) { n[0] /= len; n[1] /= len; n[2] /= len; }
  }

  const ts = Date.now();

  const outerVerts: FormVertex[] = cage.vertices.map((v) => {
    const n = vertNormal.get(v.id)!;
    return {
      id: `tk-${ts}-o-${v.id}`,
      position: [v.position[0] + half * n[0], v.position[1] + half * n[1], v.position[2] + half * n[2]],
      crease: v.crease,
    };
  });

  const innerVerts: FormVertex[] = cage.vertices.map((v) => {
    const n = vertNormal.get(v.id)!;
    return {
      id: `tk-${ts}-i-${v.id}`,
      position: [v.position[0] - half * n[0], v.position[1] - half * n[1], v.position[2] - half * n[2]],
      crease: v.crease,
    };
  });

  const outerIdOf = (vid: string) => `tk-${ts}-o-${vid}`;
  const innerIdOf = (vid: string) => `tk-${ts}-i-${vid}`;

  const outerFaces: FormFace[] = cage.faces.map((f, fi) => ({ id: `tk-${ts}-of${fi}`, vertexIds: f.vertexIds.map(outerIdOf) }));
  const innerFaces: FormFace[] = cage.faces.map((f, fi) => ({ id: `tk-${ts}-if${fi}`, vertexIds: [...f.vertexIds].reverse().map(innerIdOf) }));

  const seenEdgeKeys = new Set<string>();
  const allEdges: FormEdge[] = [];
  let ei = 0;

  const addEdge = (a: string, b: string, crease = 0) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seenEdgeKeys.has(k)) return;
    seenEdgeKeys.add(k);
    allEdges.push({ id: `tk-${ts}-e${ei++}`, vertexIds: [a, b], crease });
  };

  for (const e of cage.edges) {
    addEdge(outerIdOf(e.vertexIds[0]), outerIdOf(e.vertexIds[1]), e.crease);
    addEdge(innerIdOf(e.vertexIds[0]), innerIdOf(e.vertexIds[1]), e.crease);
  }

  const edgeFaceCount = new Map<string, number>();
  const edgeKeyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const f of cage.faces) {
    const vids = f.vertexIds;
    for (let i = 0; i < vids.length; i++) {
      const k = edgeKeyOf(vids[i], vids[(i + 1) % vids.length]);
      edgeFaceCount.set(k, (edgeFaceCount.get(k) ?? 0) + 1);
    }
  }

  const sideFaces: FormFace[] = [];
  let sfi = 0;
  for (const f of cage.faces) {
    const vids = f.vertexIds;
    for (let i = 0; i < vids.length; i++) {
      const a = vids[i];
      const b = vids[(i + 1) % vids.length];
      if ((edgeFaceCount.get(edgeKeyOf(a, b)) ?? 0) === 1) {
        const oa = outerIdOf(a); const ob = outerIdOf(b);
        const ia = innerIdOf(a); const ib = innerIdOf(b);
        sideFaces.push({ id: `tk-${ts}-sf${sfi++}`, vertexIds: [oa, ob, ib, ia] });
        addEdge(oa, ia);
        addEdge(ob, ib);
      }
    }
  }

  return {
    ...cage,
    vertices: [...outerVerts, ...innerVerts],
    edges: allEdges,
    faces: [...outerFaces, ...innerFaces, ...sideFaces],
  };
}
