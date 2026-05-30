import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { BRepTessellation } from '../engine/occ/brepBody';
import {
  attachTessellationToMesh,
  BREP_BODY_ID_KEY,
  BREP_TESS_KEY,
  buildAllEdgeLineSegments,
  buildEdgeLineGeometry,
  buildFaceHighlightGeometry,
  faceIdAtTriangle,
  getMeshTessellation,
} from '../engine/occ/picking';

function makeTessellation(): BRepTessellation {
  return {
    positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      1, 0, 0, 1, 1, 0, 0, 1, 0,
      0, 0, 1, 1, 0, 1, 0, 1, 1,
    ]),
    normals: new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
      0, 0, 1, 0, 0, 1, 0, 0, 1,
      0, 1, 0, 0, 1, 0, 0, 1, 0,
    ]),
    faceIds: new Uint32Array([7, 7, 11]),
    edgePolylines: new Map([
      [3, new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0])],
      [4, new Float32Array([0, 0, 1, 0, 1, 1])],
      [5, new Float32Array([0, 0, 0])],
    ]),
  };
}

describe('OCC picking helpers', () => {
  it('attaches and retrieves tessellation metadata on a mesh', () => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry());
    const tess = makeTessellation();

    attachTessellationToMesh(mesh, tess, 'body-a');

    expect(mesh.userData[BREP_TESS_KEY]).toBe(tess);
    expect(mesh.userData[BREP_BODY_ID_KEY]).toBe('body-a');
    expect(getMeshTessellation(mesh)).toBe(tess);
  });

  it('maps raycast triangle indexes to stable face ids', () => {
    const tess = makeTessellation();

    expect(faceIdAtTriangle(tess, 0)).toBe(7);
    expect(faceIdAtTriangle(tess, 2)).toBe(11);
    expect(faceIdAtTriangle(tess, 20)).toBe(0);
  });

  it('builds highlight geometry containing only triangles for the requested face', () => {
    const tess = makeTessellation();

    const geo = buildFaceHighlightGeometry(tess, 7);
    const positions = geo.getAttribute('position');
    const normals = geo.getAttribute('normal');

    expect(positions.count).toBe(6);
    expect(normals.count).toBe(6);
    expect(Array.from(positions.array.slice(0, 9))).toEqual(Array.from(tess.positions.slice(0, 9)));

    geo.dispose();
  });

  it('converts edge polylines into line segment geometry', () => {
    const tess = makeTessellation();

    const geo = buildEdgeLineGeometry(tess, 3);
    const positions = geo?.getAttribute('position');

    expect(positions?.count).toBe(4);
    expect(Array.from(positions?.array ?? [])).toEqual([
      0, 0, 0, 1, 0, 0,
      1, 0, 0, 1, 1, 0,
    ]);

    geo?.dispose();
  });

  it('builds tagged edge line objects and skips invalid polylines', () => {
    const tess = makeTessellation();
    const material = new THREE.LineBasicMaterial();

    const lines = buildAllEdgeLineSegments(tess, material);

    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.userData['edgeId'])).toEqual([3, 4]);
    expect(lines.every((line) => line.material === material)).toBe(true);

    for (const line of lines) {
      line.geometry.dispose();
    }
    material.dispose();
  });
});
