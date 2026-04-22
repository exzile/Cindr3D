import * as THREE from 'three';
import type { FormCage } from '../../types/cad';

type CageData = {
  vertices: FormCage['vertices'];
  edges: FormCage['edges'];
  faces: FormCage['faces'];
};

/** Create a standard 6-face box control cage. */
export function createBoxCageData(
  width = 20,
  height = 20,
  depth = 20,
  idPrefix = '',
): CageData {
  const hw = width / 2; const hh = height / 2; const hd = depth / 2;
  const rawVerts: [number, number, number][] = [
    [-hw, -hh, -hd], [hw, -hh, -hd], [hw, hh, -hd], [-hw, hh, -hd],
    [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd],
  ];
  const vertices = rawVerts.map((position, i) => ({
    id: `${idPrefix}v${i}`,
    position,
    crease: 0,
  }));

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
      const a = fvi[i]; const b = fvi[(i + 1) % fvi.length];
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
export function createPlaneCageData(width = 20, height = 20, idPrefix = ''): CageData {
  const hw = width / 2; const hh = height / 2;
  const rawVerts: [number, number, number][] = [
    [-hw, 0, -hh],
    [hw, 0, -hh],
    [hw, 0, hh],
    [-hw, 0, hh],
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
      const a = fvi[i]; const b = fvi[(i + 1) % fvi.length];
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

/** Create a cylinder cage with quad sides and n-gon caps. */
export function createCylinderCageData(radius = 10, height = 20, segments = 4, idPrefix = ''): CageData {
  const hh = height / 2;
  const rawVerts: [number, number, number][] = [];

  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI / segments) * i;
    rawVerts.push([radius * Math.cos(angle), -hh, radius * Math.sin(angle)]);
  }
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI / segments) * i;
    rawVerts.push([radius * Math.cos(angle), hh, radius * Math.sin(angle)]);
  }

  const vertices = rawVerts.map((position, i) => ({ id: `${idPrefix}v${i}`, position, crease: 0 }));

  const faceVIs: number[][] = [];
  for (let i = 0; i < segments; i++) {
    const b0 = i;
    const b1 = (i + 1) % segments;
    const t0 = i + segments;
    const t1 = ((i + 1) % segments) + segments;
    faceVIs.push([b0, b1, t1, t0]);
  }
  faceVIs.push(Array.from({ length: segments }, (_, i) => i + segments));
  faceVIs.push(Array.from({ length: segments }, (_, i) => segments - 1 - i));

  const edgeSet = new Set<string>();
  const edges: FormCage['edges'] = [];
  let eid = 0;
  for (const fvi of faceVIs) {
    for (let i = 0; i < fvi.length; i++) {
      const a = fvi[i]; const b = fvi[(i + 1) % fvi.length];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ id: `${idPrefix}e${eid++}`, vertexIds: [`${idPrefix}v${a}`, `${idPrefix}v${b}`], crease: 0 });
      }
    }
  }

  const faces = faceVIs.map((vi, fi) => ({ id: `${idPrefix}f${fi}`, vertexIds: vi.map((i) => `${idPrefix}v${i}`) }));
  return { vertices, edges, faces };
}

/** Build a T-Spline tube cage by sweeping a ring of vertices along a path. */
export function createPipeCageData(pathPoints: THREE.Vector3[], radius: number, segments: number, idPrefix: string): CageData {
  if (pathPoints.length < 2 || segments < 3) return { vertices: [], edges: [], faces: [] };
  const N = pathPoints.length;
  const S = segments;

  const tangents = pathPoints.map((_, i) => {
    if (i === 0) return pathPoints[1].clone().sub(pathPoints[0]).normalize();
    if (i === N - 1) return pathPoints[N - 1].clone().sub(pathPoints[N - 2]).normalize();
    return pathPoints[i + 1].clone().sub(pathPoints[i - 1]).normalize();
  });

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

/** Create a cube-sphere cage: box vertices normalized to lie on a sphere. */
export function createSphereCageData(radius = 10, idPrefix = ''): CageData {
  const s = 1 / Math.sqrt(3);
  const rawVerts: [number, number, number][] = [
    [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
    [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s],
  ];
  const scaledVerts: [number, number, number][] = rawVerts.map(([x, y, z]) => [x * radius, y * radius, z * radius]);

  const vertices = scaledVerts.map((position, i) => ({ id: `${idPrefix}v${i}`, position, crease: 0 }));

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
      const a = fvi[i]; const b = fvi[(i + 1) % fvi.length];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ id: `${idPrefix}e${eid++}`, vertexIds: [`${idPrefix}v${a}`, `${idPrefix}v${b}`], crease: 0 });
      }
    }
  }

  const faces = faceVIs.map((vi, fi) => ({ id: `${idPrefix}f${fi}`, vertexIds: vi.map((i) => `${idPrefix}v${i}`) }));
  return { vertices, edges, faces };
}

/** Create a torus cage. */
export function createTorusCageData(
  majorRadius = 15,
  minorRadius = 3,
  majorSegs = 4,
  minorSegs = 4,
  idPrefix = '',
): CageData {
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

  const vertices = rawVerts.map((position, i) => ({ id: `${idPrefix}v${i}`, position, crease: 0 }));

  const faceVIs: number[][] = [];
  for (let i = 0; i < majorSegs; i++) {
    for (let j = 0; j < minorSegs; j++) {
      const i1 = (i + 1) % majorSegs;
      const j1 = (j + 1) % minorSegs;
      faceVIs.push([
        i * minorSegs + j,
        i1 * minorSegs + j,
        i1 * minorSegs + j1,
        i * minorSegs + j1,
      ]);
    }
  }

  const edgeSet = new Set<string>();
  const edges: FormCage['edges'] = [];
  let eid = 0;
  for (const fvi of faceVIs) {
    for (let i = 0; i < fvi.length; i++) {
      const a = fvi[i]; const b = fvi[(i + 1) % fvi.length];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ id: `${idPrefix}e${eid++}`, vertexIds: [`${idPrefix}v${a}`, `${idPrefix}v${b}`], crease: 0 });
      }
    }
  }

  const faces = faceVIs.map((vi, fi) => ({ id: `${idPrefix}f${fi}`, vertexIds: vi.map((i) => `${idPrefix}v${i}`) }));
  return { vertices, edges, faces };
}

/** Creates cage data for a T-Spline Extrude. */
export function createExtrudeCageData(
  ringVerts: THREE.Vector3[],
  direction: THREE.Vector3,
  distance: number,
  idPrefix: string,
  startVertexIndex = 0,
  startEdgeIndex = 0,
  startFaceIndex = 0,
  oldRingIds?: string[],
): CageData {
  const N = ringVerts.length;
  if (N < 2) return { vertices: [], edges: [], faces: [] };

  const dir = direction.clone().normalize().multiplyScalar(distance);

  const oldIds: string[] = oldRingIds && oldRingIds.length === N
    ? oldRingIds
    : ringVerts.map((_, i) => `${idPrefix}v${startVertexIndex - N + i}`);

  const newVerts: FormCage['vertices'] = ringVerts.map((rv, i) => ({
    id: `${idPrefix}v${startVertexIndex + i}`,
    position: [rv.x + dir.x, rv.y + dir.y, rv.z + dir.z] as [number, number, number],
    crease: 0,
  }));

  const sideEdges: FormCage['edges'] = ringVerts.map((_, i) => ({
    id: `${idPrefix}e${startEdgeIndex + i}`,
    vertexIds: [oldIds[i], `${idPrefix}v${startVertexIndex + i}`] as [string, string],
    crease: 0,
  }));

  const capEdges: FormCage['edges'] = newVerts.map((_, i) => ({
    id: `${idPrefix}e${startEdgeIndex + N + i}`,
    vertexIds: [
      `${idPrefix}v${startVertexIndex + i}`,
      `${idPrefix}v${startVertexIndex + (i + 1) % N}`,
    ] as [string, string],
    crease: 0,
  }));

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

  return { vertices: newVerts, edges: [...sideEdges, ...capEdges], faces };
}

/** Creates cage data for a T-Spline Revolve. */
export function createRevolveCageData(
  profilePoints: THREE.Vector3[],
  axisOrigin: THREE.Vector3,
  axisDir: THREE.Vector3,
  angleDeg: number,
  segments: number,
  idPrefix: string,
): CageData {
  const N = profilePoints.length;
  if (N < 2 || segments < 3) return { vertices: [], edges: [], faces: [] };

  const axis = axisDir.clone().normalize();
  const isFullRevolve = Math.abs(angleDeg - 360) < 0.001;
  const lastSeg = isFullRevolve ? segments : segments - 1;

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

  for (let s = 0; s < segments; s++) {
    for (let p = 0; p < N - 1; p++) {
      edges.push({ id: `${idPrefix}e${eid++}`, vertexIds: [vid(s, p), vid(s, p + 1)], crease: 0 });
    }
  }

  const sweepLimit = isFullRevolve ? segments : segments - 1;
  for (let s = 0; s < sweepLimit; s++) {
    const sNext = isFullRevolve ? (s + 1) % segments : s + 1;
    for (let p = 0; p < N; p++) {
      edges.push({ id: `${idPrefix}e${eid++}`, vertexIds: [vid(s, p), vid(sNext, p)], crease: 0 });
    }
  }

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

/** T-Spline Loft between profile rings. */
export function createLoftCageData(
  profiles: Array<Array<{ x: number; y: number }>>,
  positions?: THREE.Vector3[],
  normals?: THREE.Vector3[],
  idPrefix = '',
): CageData {
  const P = profiles.length;
  if (P < 2) return { vertices: [], edges: [], faces: [] };

  const S = profiles[0].length;
  if (S < 3) return { vertices: [], edges: [], faces: [] };
  for (const prof of profiles) {
    if (prof.length !== S) return { vertices: [], edges: [], faces: [] };
  }

  const resolvedPositions: THREE.Vector3[] = positions && positions.length === P
    ? positions
    : profiles.map((_, i) => new THREE.Vector3(0, i * 10, 0));

  const resolvedNormals: THREE.Vector3[] = normals && normals.length === P
    ? normals
    : profiles.map(() => new THREE.Vector3(0, 1, 0));

  const vid = (i: number, j: number) => `${idPrefix}v${i * S + j}`;

  const vertices: FormCage['vertices'] = [];
  for (let i = 0; i < P; i++) {
    const center = resolvedPositions[i];
    const up = resolvedNormals[i].clone().normalize();

    const worldRef = Math.abs(up.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    const t1 = new THREE.Vector3().crossVectors(worldRef, up).normalize();
    const t2 = new THREE.Vector3().crossVectors(up, t1).normalize();

    for (let j = 0; j < S; j++) {
      const px = profiles[i][j].x;
      const py = profiles[i][j].y;
      const pos = center.clone().addScaledVector(t1, px).addScaledVector(t2, py);
      vertices.push({ id: vid(i, j), position: [pos.x, pos.y, pos.z], crease: 0 });
    }
  }

  const edges: FormCage['edges'] = [];
  const faces: FormCage['faces'] = [];
  const eid = (a: string, b: string) => `${idPrefix}e_${a}_${b}`;

  for (let i = 0; i < P; i++) {
    for (let j = 0; j < S; j++) {
      edges.push({ id: eid(vid(i, j), vid(i, (j + 1) % S)), vertexIds: [vid(i, j), vid(i, (j + 1) % S)], crease: 0 });
    }
  }

  for (let i = 0; i < P - 1; i++) {
    for (let j = 0; j < S; j++) {
      edges.push({ id: eid(vid(i, j), vid(i + 1, j)), vertexIds: [vid(i, j), vid(i + 1, j)], crease: 0 });
    }
  }

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
export function createQuadballCageData(radius = 10, idPrefix = ''): CageData {
  return createSphereCageData(radius, idPrefix);
}

/** Create a single quad face (same as plane, named "Face" for manual building). */
export function createFaceCageData(size = 10, idPrefix = ''): CageData {
  return createPlaneCageData(size, size, idPrefix);
}

/** T-Spline Sweep along a path with an arbitrary profile ring. */
export function createSweepCageData(
  pathPoints: THREE.Vector3[],
  profileRing: Array<{ x: number; y: number }>,
  idPrefix: string,
): CageData {
  const N = pathPoints.length;
  const S = profileRing.length;
  if (N < 2 || S < 3) return { vertices: [], edges: [], faces: [] };

  const tangents = pathPoints.map((_, i) => {
    if (i === 0) return pathPoints[1].clone().sub(pathPoints[0]).normalize();
    if (i === N - 1) return pathPoints[N - 1].clone().sub(pathPoints[N - 2]).normalize();
    return pathPoints[i + 1].clone().sub(pathPoints[i - 1]).normalize();
  });

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
      faces.push({
        id: `${idPrefix}f${i}_${j}`,
        vertexIds: [vid(i, j), vid(i, jn), vid(i + 1, jn), vid(i + 1, j)],
      });
    }
  }

  return { vertices, edges, faces };
}
