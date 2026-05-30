import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBRepBody } from '../engine/occ/brepBody';
import { BRepBodyRegistry } from '../engine/occ/bodyRegistry';
import { OccHandle } from '../engine/occ/occHandle';
import { createOccPlaneFrame, planePointToWorld, worldPointToPlane } from '../engine/occ/plane';
import { assignTopologyIds, createBRepIdAllocator, maxTopologyId } from '../engine/occ/topologyIds';

function fakeHandle(ptr: number): { handle: OccHandle<unknown>; get disposed(): number } {
  let disposed = 0;
  return {
    handle: new OccHandle(ptr, 'TestShape', () => {
      disposed += 1;
    }),
    get disposed() {
      return disposed;
    },
  };
}

describe('OCC topology support utilities', () => {
  it('allocates deterministic topology ids and honors reservations', () => {
    const allocator = createBRepIdAllocator(10);
    expect(allocator.peek()).toBe(10);
    allocator.reserve(10);
    allocator.reserve(12);

    expect(allocator.next()).toBe(11);
    expect(allocator.next()).toBe(13);
  });

  it('assigns topology ids by handle pointer', () => {
    const a = fakeHandle(100);
    const b = fakeHandle(200);
    const duplicateA = fakeHandle(100);

    const assigned = assignTopologyIds([a.handle, b.handle, duplicateA.handle], createBRepIdAllocator(1));

    // byPtr maps ptr → first-seen id (deduped by pointer).
    expect(assigned.byPtr.get(100)).toBe(1);
    expect(assigned.byPtr.get(200)).toBe(2);
    // ids assigns a monotonic id to every handle (no dedup); 3 handles → 3 ids.
    // The first handle with ptr=100 wins byPtr; both ptr=100 handles get their own id.
    expect(Array.from(assigned.ids.keys())).toEqual([1, 2, 3]);
    expect(assigned.ids.get(1)).toBe(a.handle);
    expect(assigned.ids.get(2)).toBe(b.handle);
    expect(assigned.ids.get(3)).toBe(duplicateA.handle);
  });

  it('tracks max topology ids across maps', () => {
    expect(maxTopologyId(new Map([[1, 'a']]), new Map([[9, 'b']]), new Map([[4, 'c']]))).toBe(9);
  });

  it('registers, queries, and disposes BRep bodies by feature id', () => {
    const shape = fakeHandle(1);
    const registry = new BRepBodyRegistry();
    const body = createBRepBody({
      id: 'body-a',
      shape: shape.handle,
      sourceFeatureId: 'feature-a',
    });

    registry.add(body);

    expect(registry.get('body-a')).toBe(body);
    expect(registry.getByFeature('feature-a')).toEqual([body]);
    expect(registry.snapshot()).toEqual({
      bodyCount: 1,
      bodyIds: ['body-a'],
      featureIds: ['feature-a'],
    });

    expect(registry.delete('body-a')).toBe(true);
    expect(shape.disposed).toBe(1);
    expect(registry.getByFeature('feature-a')).toEqual([]);
  });

  it('round-trips points through OCC plane frames', () => {
    const frame = createOccPlaneFrame(
      new THREE.Vector3(10, 20, 30),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0),
    );

    const planePoint = new THREE.Vector2(5, -3);
    const worldPoint = planePointToWorld(frame, planePoint);
    const roundTrip = worldPointToPlane(frame, worldPoint);

    expect(worldPoint.toArray()).toEqual([15, 20, 33]);
    expect(roundTrip.x).toBeCloseTo(5);
    expect(roundTrip.y).toBeCloseTo(-3);
  });
});
