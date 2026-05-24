import { describe, expect, it } from 'vitest';
import { createBRepBody, invalidateBRepTessellation } from '../engine/occ/brepBody';
import { alignByteCount, mallocAligned } from '../engine/occ/heap';
import { OccHandle } from '../engine/occ/occHandle';

function fakeHandle(ptr = 1): { handle: OccHandle<unknown>; get disposeCount(): number } {
  let disposeCount = 0;
  return {
    handle: new OccHandle(ptr, 'TestShape', () => {
      disposeCount += 1;
    }),
    get disposeCount() {
      return disposeCount;
    },
  };
}

describe('OCC support utilities', () => {
  it('disposes a BRep body shape, topology handles, mesh, and cached tessellation', () => {
    const shape = fakeHandle(1);
    const face = fakeHandle(2);
    const edge = fakeHandle(3);
    const vertex = fakeHandle(4);
    const mesh = { disposeCount: 0, dispose() { this.disposeCount += 1; } };
    const body = createBRepBody({
      id: 'body-1',
      revision: 7,
      shape: shape.handle,
      faceIds: new Map([[1, face.handle]]),
      edgeIds: new Map([[2, edge.handle]]),
      vertexIds: new Map([[3, vertex.handle]]),
      mesh: mesh as never,
      tessellation: {
        positions: new Float32Array([0, 0, 0]),
        normals: new Float32Array([0, 1, 0]),
        faceIds: new Uint32Array([1]),
        edgePolylines: new Map([[2, new Float32Array([0, 0, 0, 1, 0, 0])]]),
      },
    });

    body.dispose();

    expect(shape.disposeCount).toBe(1);
    expect(face.disposeCount).toBe(1);
    expect(edge.disposeCount).toBe(1);
    expect(vertex.disposeCount).toBe(1);
    expect(mesh.disposeCount).toBe(1);
    expect(body.faceIds.size).toBe(0);
    expect(body.edgeIds.size).toBe(0);
    expect(body.vertexIds.size).toBe(0);
    expect(body.mesh).toBeUndefined();
    expect(body._tessellation).toBeUndefined();
  });

  it('invalidates derived display data and bumps the body revision', () => {
    const mesh = { disposeCount: 0, dispose() { this.disposeCount += 1; } };
    const body = createBRepBody({
      shape: fakeHandle().handle,
      mesh: mesh as never,
      tessellation: {
        positions: new Float32Array(),
        normals: new Float32Array(),
        faceIds: new Uint32Array(),
        edgePolylines: new Map(),
      },
    });
    const previousRevision = body.revision;

    invalidateBRepTessellation(body);

    expect(body.revision).toBeGreaterThan(previousRevision);
    expect(mesh.disposeCount).toBe(1);
    expect(body.mesh).toBeUndefined();
    expect(body._tessellation).toBeUndefined();
  });

  it('aligns OCC heap allocations and frees them once', () => {
    const freed: number[] = [];
    const occ = {
      malloc: (bytes: number) => bytes + 1000,
      free: (ptr: number) => {
        freed.push(ptr);
      },
    };

    expect(alignByteCount(9)).toBe(16);

    const allocation = mallocAligned(occ, 9);
    expect(allocation.bytes).toBe(16);
    expect(allocation.ptr).toBe(1016);

    allocation.free();
    allocation.free();

    expect(freed).toEqual([1016]);
  });
});
