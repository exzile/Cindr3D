import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { serializeFeature, deserializeFeature } from '../store/cadStore';
import { GeometryEngine } from '../engine/GeometryEngine';
import type { Feature, Sketch, SketchEntity } from '../types/cad';

// ─── Helpers ────────────────────────────────────────────────────────────────

let pid = 0, eid = 0;
const mkPoint = (x: number, y: number, z = 0) => ({ id: `p${++pid}`, x, y, z });
const mkCircle = (cx: number, cy: number, r: number): SketchEntity => ({
  id: `e${++eid}`, type: 'circle', points: [mkPoint(cx, cy, 0)], radius: r,
});
function mkSketch(entities: SketchEntity[], id = 'test-sketch'): Sketch {
  return {
    id, name: 'test', plane: 'XY',
    planeNormal: new THREE.Vector3(0, 0, 1),
    planeOrigin: new THREE.Vector3(0, 0, 0),
    entities, constraints: [], dimensions: [], fullyConstrained: false,
  };
}

// ─── serializeFeature / deserializeFeature round-trip ───────────────────────

describe('Persistence round-trip', () => {
  it('non-mesh feature survives round-trip', () => {
    const feature: Feature = {
      id: 'f1',
      name: 'Extrude 1',
      type: 'extrude',
      sketchId: 's1',
      params: { distance: 10, direction: 'positive', operation: 'new-body' },
      visible: true,
      suppressed: false,
      timestamp: 123,
    };
    const serialized = serializeFeature(feature);
    // Serialized shouldn't include a mesh (this feature didn't have one)
    expect(serialized).not.toHaveProperty('mesh');
    expect(serialized.params.distance).toBe(10);
    const round = deserializeFeature(serialized as Feature);
    expect(round.id).toBe('f1');
    expect(round.params.distance).toBe(10);
    expect(round.mesh).toBeUndefined();
  });

  it('mesh feature geometry survives round-trip', () => {
    const geom = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
    const mesh = new THREE.Mesh(geom);
    const feature: Feature = {
      id: 'f2',
      name: 'Import 1',
      type: 'import',
      params: {},
      mesh,
      visible: true,
      suppressed: false,
      timestamp: 456,
    };
    const serialized = serializeFeature(feature);
    // The serialized snapshot should include _meshData with a position array
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((serialized as any)._meshData).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meshData = (serialized as any)._meshData;
    expect(meshData.position).toBeInstanceOf(Array);
    expect(meshData.position.length).toBe(geom.attributes.position.count * 3);

    const round = deserializeFeature(serialized as Feature);
    expect(round.mesh).toBeDefined();
    expect(round.mesh instanceof THREE.Mesh).toBe(true);
    const roundGeom = (round.mesh as THREE.Mesh).geometry;
    expect(roundGeom.attributes.position.count).toBe(geom.attributes.position.count);
  });

  it('WeakMap cache returns identical object for same non-mesh feature reference', () => {
    const feature: Feature = {
      id: 'f3', name: 'x', type: 'extrude', params: {},
      visible: true, suppressed: false, timestamp: 1,
    };
    const a = serializeFeature(feature);
    const b = serializeFeature(feature);
    // Same Feature reference → cache hit → same SerializedFeature reference
    expect(a).toBe(b);
  });

  it('mesh feature topology metadata survives round-trip', () => {
    const geom = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    geom.userData._topoV = 10;
    geom.userData.topology = {
      edges: [{
        id: 'edge-a',
        kind: 'crease',
        polyline: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)],
      }],
    };
    const feature: Feature = {
      id: 'f-topology', name: 'x', type: 'import', params: {}, mesh: new THREE.Mesh(geom),
      visible: true, suppressed: false, timestamp: 1,
    };

    const serialized = serializeFeature(feature);
    const round = deserializeFeature(serialized as Feature);
    const roundGeom = (round.mesh as THREE.Mesh).geometry;

    expect(roundGeom.userData._topoV).toBe(10);
    expect(roundGeom.userData.topology.edges[0].id).toBe('edge-a');
    geom.dispose();
  });

  it('changed feature reference produces new serialized snapshot', () => {
    const geom = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const mesh = new THREE.Mesh(geom);
    const f1: Feature = {
      id: 'f4', name: 'x', type: 'import', params: { distance: 5 }, mesh,
      visible: true, suppressed: false, timestamp: 1,
    };
    const f2: Feature = {
      id: 'f4', name: 'x', type: 'import', params: { distance: 10 }, mesh,
      visible: true, suppressed: false, timestamp: 1,
    };
    const a = serializeFeature(f1);
    const b = serializeFeature(f2);
    // Different Feature references → different serialized snapshots
    expect(a).not.toBe(b);
    expect(a.params.distance).toBe(5);
    expect(b.params.distance).toBe(10);
    geom.dispose();
  });

  it('rehydrated features share the same material singleton', () => {
    const g1 = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const g2 = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
    const mkFeature = (id: string, mesh: THREE.Mesh): Feature => ({
      id, name: id, type: 'import', params: {}, mesh,
      visible: true, suppressed: false, timestamp: 1,
    });
    const s1 = serializeFeature(mkFeature('a', new THREE.Mesh(g1)));
    const s2 = serializeFeature(mkFeature('b', new THREE.Mesh(g2)));
    const r1 = deserializeFeature(s1 as Feature);
    const r2 = deserializeFeature(s2 as Feature);
    // Two rehydrated features share the same module-level material — the
    // leak fix from the audit.
    expect((r1.mesh as THREE.Mesh).material).toBe((r2.mesh as THREE.Mesh).material);
    g1.dispose(); g2.dispose();
  });
});

// ─── createProfileSketch atomic-region hole path ────────────────────────────

describe('createProfileSketch', () => {
  it('single circle profile produces a synthetic sketch with one closed loop', () => {
    const sketch = mkSketch([mkCircle(0, 0, 2)]);
    const flat = GeometryEngine.sketchToProfileShapesFlat(sketch);
    expect(flat).toHaveLength(1);
    const profileSketch = GeometryEngine.createProfileSketch(sketch, 0);
    expect(profileSketch).not.toBeNull();
    const shapes = GeometryEngine.sketchToShapes(profileSketch!);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].holes).toHaveLength(0);
  });

  it('does not throw for any profile in a rect+circle sketch', () => {
    // Robustness: even though individual atomic regions might occasionally
    // be too small/thin to produce a valid synthetic sketch (in which case
    // createProfileSketch returns null), it must never THROW. This catches
    // regressions where e.g. polygon-clipping output with duplicate holes
    // would crash the serialization path.
    const p1 = mkPoint(-5, -3), p2 = mkPoint(5, -3), p3 = mkPoint(5, 3), p4 = mkPoint(-5, 3);
    const rectEntities: SketchEntity[] = [
      { id: `e${++eid}`, type: 'line', points: [p1, p2] },
      { id: `e${++eid}`, type: 'line', points: [p2, p3] },
      { id: `e${++eid}`, type: 'line', points: [p3, p4] },
      { id: `e${++eid}`, type: 'line', points: [p4, p1] },
    ];
    const sketch = mkSketch([...rectEntities, mkCircle(0, 0, 1)]);
    const flat = GeometryEngine.sketchToProfileShapesFlat(sketch);
    for (let i = 0; i < flat.length; i++) {
      expect(() => GeometryEngine.createProfileSketch(sketch, i)).not.toThrow();
    }
  });
});

// ─── computeAtomicRegions partition invariant ───────────────────────────────

describe('computeAtomicRegions partition invariant', () => {
  it('atomic regions cover the union and do not overlap (approx. by area)', () => {
    // For 2 overlapping circles, the sum of atomic-region areas should
    // approximately equal the union of the 2 circles' areas (PIE / sum-of-
    // parts invariant). Disjoint atomic regions means sum(areas) = union(areas).
    const sketch = mkSketch([mkCircle(0, 0, 1), mkCircle(1, 0, 1)]);
    const flat = GeometryEngine.sketchToProfileShapesFlat(sketch);

    // Sum of all atomic-region areas (skip originals by filtering out the
    // two whose size matches a circle). Actually simpler: identify the
    // atomic regions as those that are NOT duplicates of circle originals.
    // Since dedup keeps originals when sigs match, we need to look at only
    // atomic pieces. For 2 overlapping circles, atomic regions are:
    //   lens (A∩B), A\B, B\A — each unique.
    // Plus the 2 original circles. So 5 shapes total.
    const areaOf = (shape: import('three').Shape): number => {
      const pts = shape.getPoints(64);
      let a = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
      }
      return Math.abs(a) * 0.5;
    };

    // Identify atomic regions = those not near-identical in area to a circle.
    // Circle area = π * r² = π. Atomic regions (lens, crescent) have
    // significantly smaller areas.
    const circleArea = Math.PI * 1 * 1;
    const atomic = flat.filter((s) => Math.abs(areaOf(s) - circleArea) > circleArea * 0.05);
    expect(atomic.length).toBeGreaterThanOrEqual(3);

    const atomicTotalArea = atomic.reduce((s, shape) => s + areaOf(shape), 0);
    // Union area of two unit circles with centers 1 apart (analytical):
    //   Intersection = 2r² · acos(d/(2r)) − (d/2) · √(4r² − d²)
    //                = 2 · acos(0.5) − (1/2) · √3
    //                = 2π/3 − √3/2 ≈ 1.228
    //   Union = 2πr² − intersection = 2π − (2π/3 − √3/2) = 4π/3 + √3/2 ≈ 5.055
    const expectedUnionArea = 4 * Math.PI / 3 + Math.sqrt(3) / 2;
    expect(atomicTotalArea).toBeCloseTo(expectedUnionArea, 1);
  });

  it('handles 5 overlapping circles without error (stress test)', () => {
    const sketch = mkSketch([
      mkCircle(0, 0, 1.5),
      mkCircle(1, 0, 1.5),
      mkCircle(0.5, 0.866, 1.5),
      mkCircle(-0.5, 0.5, 1.5),
      mkCircle(0.5, -0.5, 1.5),
    ]);
    // The incremental-union optimisation should handle this without an
    // exponential blowup. Allow up to 200ms — should be well under that.
    const start = performance.now();
    const flat = GeometryEngine.sketchToProfileShapesFlat(sketch);
    const dur = performance.now() - start;
    expect(flat.length).toBeGreaterThan(5);
    expect(dur).toBeLessThan(500);
  });
});
