export type EdgeSelectionCage = {
  vertices: { id: string }[];
  edges: { id: string; vertexIds: [string, string] }[];
  faces: { id: string; vertexIds: string[] }[];
};

/**
 * Finds the edge loop containing a given starting edge.
 */
export function findEdgeLoop(cage: EdgeSelectionCage, startEdgeId: string): string[] {
  const edgeById = new Map<string, { id: string; vertexIds: [string, string] }>();
  for (const e of cage.edges) edgeById.set(e.id, e);

  const startEdge = edgeById.get(startEdgeId);
  if (!startEdge) return [];

  const vertToFaces = new Map<string, number[]>();
  cage.faces.forEach((f, fi) => {
    for (const vid of f.vertexIds) {
      if (!vertToFaces.has(vid)) vertToFaces.set(vid, []);
      vertToFaces.get(vid)!.push(fi);
    }
  });

  const edgeKeyToId = new Map<string, string>();
  for (const e of cage.edges) {
    const [a, b] = e.vertexIds;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    edgeKeyToId.set(key, e.id);
  }

  const stepLoop = (curV: string, arrivalEdgeId: string): { nextEdgeId: string; nextV: string } | null => {
    const arrivalEdge = edgeById.get(arrivalEdgeId)!;
    const otherV = arrivalEdge.vertexIds[0] === curV ? arrivalEdge.vertexIds[1] : arrivalEdge.vertexIds[0];

    const facesOfCur = vertToFaces.get(curV) ?? [];
    const facesOfOther = new Set(vertToFaces.get(otherV) ?? []);
    const adjFaceIndices = facesOfCur.filter((fi) => facesOfOther.has(fi));

    for (const fi of adjFaceIndices) {
      const face = cage.faces[fi];
      if (face.vertexIds.length !== 4) continue;

      const vids = face.vertexIds;
      const iCur = vids.indexOf(curV);
      const iOther = vids.indexOf(otherV);
      if (iCur === -1 || iOther === -1) continue;

      const remaining = vids.filter((_, k) => k !== iCur && k !== iOther);
      if (remaining.length !== 2) continue;

      const [rA, rB] = remaining;
      const oppKey = rA < rB ? `${rA}|${rB}` : `${rB}|${rA}`;
      const oppEdgeId = edgeKeyToId.get(oppKey);
      if (!oppEdgeId || oppEdgeId === arrivalEdgeId) continue;

      const iOpposite = (iCur + 2) % 4;
      const nextV = vids[iOpposite];

      return { nextEdgeId: oppEdgeId, nextV };
    }
    return null;
  };

  const loopEdges: string[] = [startEdgeId];
  const visited = new Set<string>([startEdgeId]);

  const [vA, vB] = startEdge.vertexIds;

  let curV = vB;
  let curEdge = startEdgeId;
  for (;;) {
    const step = stepLoop(curV, curEdge);
    if (!step) break;
    if (step.nextEdgeId === startEdgeId) break;
    if (visited.has(step.nextEdgeId)) break;
    visited.add(step.nextEdgeId);
    loopEdges.push(step.nextEdgeId);
    curEdge = step.nextEdgeId;
    curV = step.nextV;
  }

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

  return [...backEdges.reverse(), ...loopEdges];
}

/**
 * Finds the edge ring containing a given edge.
 */
export function findEdgeRing(cage: EdgeSelectionCage, startEdgeId: string): string[] {
  const edgeById = new Map<string, { id: string; vertexIds: [string, string] }>();
  for (const e of cage.edges) edgeById.set(e.id, e);

  const startEdge = edgeById.get(startEdgeId);
  if (!startEdge) return [];

  const edgeKeyToId = new Map<string, string>();
  for (const e of cage.edges) {
    const [a, b] = e.vertexIds;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    edgeKeyToId.set(key, e.id);
  }

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

  let curEdge = startEdgeId;
  for (;;) {
    const nexts = ringStep(curEdge).filter((id) => !visited.has(id));
    if (nexts.length === 0) break;
    const nextEdge = nexts[0];
    if (nextEdge === startEdgeId) break;
    visited.add(nextEdge);
    ringEdges.push(nextEdge);
    curEdge = nextEdge;
  }

  return ringEdges;
}
