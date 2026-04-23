import * as THREE from 'three';
import type { FormCage } from '../../types/cad';

type FaceVertexIndices = number[][];

export function buildIndexedCage(
  rawVerts: Array<[number, number, number]>,
  faceVertexIndices: FaceVertexIndices,
  idPrefix = '',
): { vertices: FormCage['vertices']; edges: FormCage['edges']; faces: FormCage['faces'] } {
  const vertices = rawVerts.map((position, index) => ({
    id: `${idPrefix}v${index}`,
    position,
    crease: 0,
  }));

  const edgeSet = new Set<string>();
  const edges: FormCage['edges'] = [];
  let edgeIndex = 0;
  for (const face of faceVertexIndices) {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index];
      const b = face[(index + 1) % face.length];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push({
        id: `${idPrefix}e${edgeIndex++}`,
        vertexIds: [`${idPrefix}v${a}`, `${idPrefix}v${b}`],
        crease: 0,
      });
    }
  }

  const faces = faceVertexIndices.map((face, index) => ({
    id: `${idPrefix}f${index}`,
    vertexIds: face.map((vertexIndex) => `${idPrefix}v${vertexIndex}`),
  }));

  return { vertices, edges, faces };
}

export function computePathFrames(pathPoints: THREE.Vector3[]): {
  tangents: THREE.Vector3[];
  normals: THREE.Vector3[];
  binormals: THREE.Vector3[];
} {
  const pointCount = pathPoints.length;
  const tangents = pathPoints.map((_, index) => {
    if (index === 0) return pathPoints[1].clone().sub(pathPoints[0]).normalize();
    if (index === pointCount - 1) return pathPoints[pointCount - 1].clone().sub(pathPoints[pointCount - 2]).normalize();
    return pathPoints[index + 1].clone().sub(pathPoints[index - 1]).normalize();
  });

  const normals: THREE.Vector3[] = new Array(pointCount);
  const binormals: THREE.Vector3[] = new Array(pointCount);
  const initialUp = Math.abs(tangents[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  normals[0] = initialUp.clone().sub(tangents[0].clone().multiplyScalar(initialUp.dot(tangents[0]))).normalize();
  binormals[0] = tangents[0].clone().cross(normals[0]).normalize();

  for (let index = 1; index < pointCount; index += 1) {
    const rotationAxis = tangents[index - 1].clone().cross(tangents[index]);
    if (rotationAxis.length() < 1e-6) {
      normals[index] = normals[index - 1].clone();
    } else {
      rotationAxis.normalize();
      const angle = Math.acos(Math.max(-1, Math.min(1, tangents[index - 1].dot(tangents[index]))));
      normals[index] = normals[index - 1]
        .clone()
        .applyMatrix4(new THREE.Matrix4().makeRotationAxis(rotationAxis, angle))
        .normalize();
    }
    binormals[index] = tangents[index].clone().cross(normals[index]).normalize();
  }

  return { tangents, normals, binormals };
}

export function buildGridEdgesAndFaces(
  ringCount: number,
  segmentCount: number,
  idPrefix: string,
  closeRings = true,
): { edges: FormCage['edges']; faces: FormCage['faces'] } {
  const vertexId = (ring: number, segment: number) => `${idPrefix}v${ring}_${segment}`;
  const edgeId = (a: string, b: string) => `${idPrefix}e_${a}_${b}`;

  const edges: FormCage['edges'] = [];
  for (let ring = 0; ring < ringCount; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const nextSegment = closeRings ? (segment + 1) % segmentCount : segment + 1;
      if (nextSegment >= segmentCount) continue;
      edges.push({
        id: edgeId(vertexId(ring, segment), vertexId(ring, nextSegment)),
        vertexIds: [vertexId(ring, segment), vertexId(ring, nextSegment)],
        crease: 0,
      });
    }
  }

  for (let ring = 0; ring < ringCount - 1; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      edges.push({
        id: edgeId(vertexId(ring, segment), vertexId(ring + 1, segment)),
        vertexIds: [vertexId(ring, segment), vertexId(ring + 1, segment)],
        crease: 0,
      });
    }
  }

  const faces: FormCage['faces'] = [];
  for (let ring = 0; ring < ringCount - 1; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const nextSegment = closeRings ? (segment + 1) % segmentCount : segment + 1;
      if (nextSegment >= segmentCount) continue;
      faces.push({
        id: `${idPrefix}f${ring}_${segment}`,
        vertexIds: [
          vertexId(ring, segment),
          vertexId(ring, nextSegment),
          vertexId(ring + 1, nextSegment),
          vertexId(ring + 1, segment),
        ],
      });
    }
  }

  return { edges, faces };
}
