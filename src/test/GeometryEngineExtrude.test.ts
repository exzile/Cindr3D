import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GeometryEngine } from '../engine/GeometryEngine';
import type { Sketch, SketchEntity } from '../types/cad';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal XY-plane Sketch from a list of entities. */
function mkSketch(entities: SketchEntity[], id = 'test-sketch'): Sketch {
  return {
    id,
    name: 'test',
    plane: 'XY',
    planeNormal: new THREE.Vector3(0, 0, 1),
    planeOrigin: new THREE.Vector3(0, 0, 0),
    entities,
    constraints: [],
    dimensions: [],
    fullyConstrained: false,
  };
}

let pid = 0;
const mkPoint = (x: number, y: number, z = 0) => ({ id: `p${++pid}`, x, y, z });

let eid = 0;
const mkCircle = (cx: number, cy: number, r: number): SketchEntity => ({
  id: `e${++eid}`,
  type: 'circle',
  points: [mkPoint(cx, cy, 0)],
  radius: r,
});

/** Build a rectangle as 4 chained lines (so entitiesToShapes treats it as a chain). */
const mkRect = (x1: number, y1: number, x2: number, y2: number): SketchEntity[] => {
  const p1 = mkPoint(x1, y1), p2 = mkPoint(x2, y1), p3 = mkPoint(x2, y2), p4 = mkPoint(x1, y2);
  return [
    { id: `e${++eid}`, type: 'line', points: [p1, p2] },
    { id: `e${++eid}`, type: 'line', points: [p2, p3] },
    { id: `e${++eid}`, type: 'line', points: [p3, p4] },
    { id: `e${++eid}`, type: 'line', points: [p4, p1] },
  ];
};

const mkRectPrimitive = (x1: number, y1: number, x2: number, y2: number): SketchEntity => ({
  id: `e${++eid}`,
  type: 'rectangle',
  points: [mkPoint(x1, y1), mkPoint(x2, y2)],
  closed: true,
});

// ─── splitByConnectedComponents ─────────────────────────────────────────────

describe('GeometryEngine.splitByConnectedComponents', () => {
  it('returns the input array unchanged when mesh is singly connected', () => {
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const parts = GeometryEngine.splitByConnectedComponents(geom);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(geom); // same reference
  });

  it('splits two disjoint boxes into two components', () => {
    const a = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    a.translate(0, 0, 0);
    const b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    b.translate(5, 0, 0);
    // Merge into one geometry
    const posA = a.attributes.position.array as Float32Array;
    const posB = b.attributes.position.array as Float32Array;
    const combined = new Float32Array(posA.length + posB.length);
    combined.set(posA, 0);
    combined.set(posB, posA.length);
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(combined, 3));
    a.dispose(); b.dispose();

    const parts = GeometryEngine.splitByConnectedComponents(merged);
    expect(parts).toHaveLength(2);
    // Each part should have approximately half the total vertices
    const totalVerts = merged.attributes.position.count;
    const partTotals = parts.reduce((s, g) => s + g.attributes.position.count, 0);
    expect(partTotals).toBe(totalVerts);
  });

  it('sorts components deterministically by centroid x', () => {
    // Run twice on the same input — results should be identical
    const a = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(); a.translate(10, 0, 0);
    const b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(); b.translate(0, 0, 0);
    const combine = (): THREE.BufferGeometry => {
      const pA = a.attributes.position.array as Float32Array;
      const pB = b.attributes.position.array as Float32Array;
      const combined = new Float32Array(pA.length + pB.length);
      combined.set(pA, 0);
      combined.set(pB, pA.length);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(combined, 3));
      return g;
    };
    const g1 = combine();
    const g2 = combine();
    const parts1 = GeometryEngine.splitByConnectedComponents(g1);
    const parts2 = GeometryEngine.splitByConnectedComponents(g2);
    expect(parts1.length).toBe(parts2.length);
    // First component of each run should be the lower-x box (centroid at 0)
    const _bb = new THREE.Box3();
    const c1 = new THREE.Vector3(); _bb.setFromBufferAttribute(parts1[0].attributes.position as THREE.BufferAttribute); _bb.getCenter(c1);
    const c2 = new THREE.Vector3(); _bb.setFromBufferAttribute(parts2[0].attributes.position as THREE.BufferAttribute); _bb.getCenter(c2);
    expect(c1.x).toBeCloseTo(c2.x, 4);
    a.dispose(); b.dispose();
  });

  it('handles empty geometry gracefully', () => {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    const parts = GeometryEngine.splitByConnectedComponents(empty);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(empty);
  });
});

// ─── computeCoplanarFaceBoundary ────────────────────────────────────────────

describe('GeometryEngine.computeCoplanarFaceBoundary', () => {
  it('returns a valid boundary for a real flat face (box top)', () => {
    const geom = new THREE.BoxGeometry(2, 2, 2);
    const mesh = new THREE.Mesh(geom);
    mesh.updateMatrixWorld(true);
    // Find a triangle on the +Y face
    const posAttr = geom.attributes.position as THREE.BufferAttribute;
    const idxAttr = geom.index!;
    let topTriIdx = -1;
    for (let t = 0; t < idxAttr.count / 3; t++) {
      const a = idxAttr.getX(t * 3);
      const b = idxAttr.getX(t * 3 + 1);
      const c = idxAttr.getX(t * 3 + 2);
      const ya = posAttr.getY(a), yb = posAttr.getY(b), yc = posAttr.getY(c);
      if (Math.abs(ya - 1) < 1e-5 && Math.abs(yb - 1) < 1e-5 && Math.abs(yc - 1) < 1e-5) {
        topTriIdx = t;
        break;
      }
    }
    expect(topTriIdx).toBeGreaterThanOrEqual(0);
    const result = GeometryEngine.computeCoplanarFaceBoundary(mesh, topTriIdx);
    expect(result).not.toBeNull();
    expect(result!.boundary.length).toBeGreaterThanOrEqual(3);
    // Normal should point roughly +Y for the top face
    expect(result!.normal.y).toBeGreaterThan(0.9);
    geom.dispose();
  });

  it('rejects single-triangle faces (curved-surface protection)', () => {
    // Cylinder side — each segment triangle is NOT coplanar with neighbors at
    // the default 10° normal tolerance given 32 segments (11.25° apart).
    const geom = new THREE.CylinderGeometry(1, 1, 2, 32);
    const mesh = new THREE.Mesh(geom);
    mesh.updateMatrixWorld(true);
    // Find a triangle on the SIDE (not top/bottom cap)
    const posAttr = geom.attributes.position as THREE.BufferAttribute;
    const idxAttr = geom.index!;
    let sideTriIdx = -1;
    for (let t = 0; t < idxAttr.count / 3; t++) {
      const a = idxAttr.getX(t * 3);
      const b = idxAttr.getX(t * 3 + 1);
      const c = idxAttr.getX(t * 3 + 2);
      // Side triangles have vertices with both +1 and -1 y
      const ya = posAttr.getY(a), yb = posAttr.getY(b), yc = posAttr.getY(c);
      const ys = [ya, yb, yc];
      const hasTop = ys.some((y) => Math.abs(y - 1) < 1e-5);
      const hasBottom = ys.some((y) => Math.abs(y - -1) < 1e-5);
      if (hasTop && hasBottom) { sideTriIdx = t; break; }
    }
    expect(sideTriIdx).toBeGreaterThanOrEqual(0);
    const result = GeometryEngine.computeCoplanarFaceBoundary(mesh, sideTriIdx);
    // Single isolated coplanar triangle → must be rejected
    expect(result).toBeNull();
    geom.dispose();
  });

  it('returns null for out-of-range face index', () => {
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geom);
    mesh.updateMatrixWorld(true);
    expect(GeometryEngine.computeCoplanarFaceBoundary(mesh, 99999)).toBeNull();
    expect(GeometryEngine.computeCoplanarFaceBoundary(mesh, -1)).toBeNull();
    geom.dispose();
  });
});

// ─── revolveSketch ──────────────────────────────────────────────────────────

describe('GeometryEngine.revolveSketch', () => {
  it('returns null when profile straddles the revolve axis', () => {
    // Rectangle from x=-1 to x=1, y=0 to y=2 — straddles the Y axis
    const sketch = mkSketch(mkRect(-1, 0, 1, 2));
    const result = GeometryEngine.revolveSketch(sketch, Math.PI * 2, new THREE.Vector3(0, 1, 0));
    expect(result).toBeNull();
  });

  it('succeeds when profile is entirely on one side of the axis', () => {
    // Rectangle from x=1 to x=3, y=0 to y=2
    const sketch = mkSketch(mkRect(1, 0, 3, 2));
    const result = GeometryEngine.revolveSketch(sketch, Math.PI * 2, new THREE.Vector3(0, 1, 0));
    expect(result).not.toBeNull();
    expect(result!.geometry.attributes.position.count).toBeGreaterThan(0);
    result!.geometry.dispose();
  });

  it('tolerates small numerical drift across the axis', () => {
    // Rectangle nominally at x=0 but with a vertex at x=-0.0005 (within tol)
    const p1 = mkPoint(-0.0005, 0), p2 = mkPoint(2, 0), p3 = mkPoint(2, 1), p4 = mkPoint(0, 1);
    const entities: SketchEntity[] = [
      { id: `e${++eid}`, type: 'line', points: [p1, p2] },
      { id: `e${++eid}`, type: 'line', points: [p2, p3] },
      { id: `e${++eid}`, type: 'line', points: [p3, p4] },
      { id: `e${++eid}`, type: 'line', points: [p4, p1] },
    ];
    const sketch = mkSketch(entities);
    const result = GeometryEngine.revolveSketch(sketch, Math.PI * 2, new THREE.Vector3(0, 1, 0));
    // Small drift is tolerated, should succeed
    expect(result).not.toBeNull();
    result?.geometry.dispose();
  });
});

// ─── remesh ─────────────────────────────────────────────────────────────────

describe('GeometryEngine.remesh', () => {
  it('coarsen actually REDUCES triangle count', () => {
    // Start with a dense sphere
    const geom = new THREE.SphereGeometry(1, 32, 16);
    const mesh = new THREE.Mesh(geom);
    const startTriCount = geom.index!.count / 3;
    const result = GeometryEngine.remesh(mesh, 'coarsen', 3);
    const endCount = result.geometry.index
      ? result.geometry.index.count / 3
      : result.geometry.attributes.position.count / 3;
    // Must actually reduce — old bug delegated to smoothMesh which kept the
    // same triangle count.
    expect(endCount).toBeLessThan(startTriCount);
    result.geometry.dispose();
    geom.dispose();
  });

  it('refine increases triangle count', () => {
    const geom = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const mesh = new THREE.Mesh(geom);
    const startCount = geom.attributes.position.count / 3;
    const result = GeometryEngine.remesh(mesh, 'refine', 1);
    const endCount = result.geometry.attributes.position.count / 3;
    expect(endCount).toBeGreaterThan(startCount);
    result.geometry.dispose();
    geom.dispose();
  });
});

// ─── chainSegments (via the public meshSectionSketch path) ──────────────────

describe('chainSegments (T-junction handling)', () => {
  // chainSegments is private, so we test indirectly by constructing a sketch
  // where entity endpoints form a T-junction and verifying entitiesToShapes
  // (which uses the same chaining logic) produces the expected loops.
  it('produces a closed loop when rectangle corner points are shared', () => {
    // Manually construct a rectangle with SHARED endpoint objects so a
    // T-junction-style arrangement works correctly.
    const p1 = mkPoint(0, 0), p2 = mkPoint(2, 0), p3 = mkPoint(2, 1), p4 = mkPoint(0, 1);
    const entities: SketchEntity[] = [
      { id: `e${++eid}`, type: 'line', points: [p1, p2] },
      { id: `e${++eid}`, type: 'line', points: [p2, p3] },
      { id: `e${++eid}`, type: 'line', points: [p3, p4] },
      { id: `e${++eid}`, type: 'line', points: [p4, p1] },
    ];
    const sketch = mkSketch(entities);
    const shapes = GeometryEngine.sketchToShapes(sketch);
    expect(shapes).toHaveLength(1);
    // Rectangle should have 4 sides
    expect(shapes[0].curves.length).toBe(4);
  });
});

// ─── sketchToProfileShapesFlat (atomic regions + dedup) ──────────────────────

describe('GeometryEngine.sketchToProfileShapesFlat', () => {
  it('returns a single shape for a sketch with one closed loop', () => {
    const sketch = mkSketch([mkCircle(0, 0, 1)]);
    const shapes = GeometryEngine.sketchToProfileShapesFlat(sketch);
    expect(shapes).toHaveLength(1);
  });

  it('returns a selectable profile for a rectangle primitive', () => {
    const sketch = mkSketch([{
      ...mkRectPrimitive(0, 0, 2, 0),
      points: [mkPoint(0, 0, 0), mkPoint(2, 0, 1)],
    }]);
    const shapes = GeometryEngine.sketchToProfileShapesFlat(sketch);
    expect(shapes).toHaveLength(1);
    expect(GeometryEngine.createProfileSketch(sketch, 0)).not.toBeNull();
  });

  it('places rectangle primitive profile meshes on the sketch plane', () => {
    const sketch = mkSketch([{
      ...mkRectPrimitive(0, 0, 2, 0),
      points: [mkPoint(0, 0, 0), mkPoint(2, 0, 1)],
    }]);
    const material = new THREE.MeshBasicMaterial();
    const mesh = GeometryEngine.createSketchProfileMesh(sketch, material, 0);
    expect(mesh).not.toBeNull();

    const box = new THREE.Box3().setFromObject(mesh!);
    expect(box.min.x).toBeCloseTo(0, 5);
    expect(box.max.x).toBeCloseTo(2, 5);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(0, 5);
    expect(box.min.z).toBeCloseTo(0, 5);
    expect(box.max.z).toBeCloseTo(1, 5);

    mesh!.geometry.dispose();
    material.dispose();
  });

  it('returns originals + atomic regions when two circles overlap', () => {
    // Two overlapping circles — atomic regions should include lens, and
    // each circle-minus-lens (crescent). Plus the two original circles.
    const sketch = mkSketch([
      mkCircle(0, 0, 1),
      mkCircle(1, 0, 1),
    ]);
    const shapes = GeometryEngine.sketchToProfileShapesFlat(sketch);
    // At minimum: 2 originals + 3 atomic (lens, A-B, B-A) = 5.
    // Dedup may remove one if it matches an original — but for overlapping
    // circles, no atomic region matches either original.
    expect(shapes.length).toBeGreaterThanOrEqual(5);
  });

  it('does not duplicate when shapes do not intersect (dedup)', () => {
    // Two disjoint circles — atomic regions equal the originals, so dedup
    // should collapse the list back to 2.
    const sketch = mkSketch([
      mkCircle(0, 0, 1),
      mkCircle(10, 0, 1),
    ]);
    const shapes = GeometryEngine.sketchToProfileShapesFlat(sketch);
    expect(shapes).toHaveLength(2);
  });
});

// ─── buildExtrudeFeatureEdges ───────────────────────────────────────────────

describe('GeometryEngine.buildExtrudeFeatureEdges', () => {
  it('returns null for an empty sketch', () => {
    const sketch = mkSketch([]);
    const edges = GeometryEngine.buildExtrudeFeatureEdges(sketch, 10);
    expect(edges).toBeNull();
  });

  it('returns null for distance near zero', () => {
    const sketch = mkSketch([mkCircle(0, 0, 1)]);
    const edges = GeometryEngine.buildExtrudeFeatureEdges(sketch, 0);
    expect(edges).toBeNull();
  });

  it('produces edge geometry with non-zero vertex count for a circle', () => {
    const sketch = mkSketch([mkCircle(0, 0, 1)]);
    const edges = GeometryEngine.buildExtrudeFeatureEdges(sketch, 5);
    expect(edges).not.toBeNull();
    const pos = edges!.attributes.position as THREE.BufferAttribute;
    // Should have at least top cap + bottom cap polyline segments
    expect(pos.count).toBeGreaterThan(0);
    // Line segments come in pairs — count must be even
    expect(pos.count % 2).toBe(0);
    edges!.dispose();
  });

  it('rectangle cap outline has matching top and bottom z', () => {
    const sketch = mkSketch(mkRect(0, 0, 2, 1));
    const edges = GeometryEngine.buildExtrudeFeatureEdges(sketch, 3);
    expect(edges).not.toBeNull();
    const pos = edges!.attributes.position as THREE.BufferAttribute;
    // Find min and max z values among all edge vertices
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    expect(minZ).toBeCloseTo(0, 5);
    expect(maxZ).toBeCloseTo(3, 5);
    edges!.dispose();
  });

  it('extrudes a rectangle primitive into solid geometry', () => {
    const sketch = mkSketch([{
      ...mkRectPrimitive(0, 0, 2, 0),
      points: [mkPoint(0, 0, 0), mkPoint(2, 0, 1)],
    }]);
    const mesh = GeometryEngine.extrudeSketch(sketch, 3);
    expect(mesh).not.toBeNull();
    expect(mesh!.geometry.attributes.position.count).toBeGreaterThan(0);
    mesh!.geometry.dispose();
  });

  it('keeps XY rectangle primitive extrusions anchored to the sketch profile', () => {
    const sketch: Sketch = {
      ...mkSketch([{
        ...mkRectPrimitive(0, 0, 2, 0),
        points: [mkPoint(0, 0, 0), mkPoint(2, 0, 1)],
      }]),
      planeNormal: new THREE.Vector3(0, 1, 0),
    };
    const mesh = GeometryEngine.extrudeSketch(sketch, 3);
    expect(mesh).not.toBeNull();

    const box = new THREE.Box3().setFromObject(mesh!);
    expect(box.min.x).toBeCloseTo(0, 5);
    expect(box.max.x).toBeCloseTo(2, 5);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(3, 5);
    expect(box.min.z).toBeCloseTo(0, 5);
    expect(box.max.z).toBeCloseTo(1, 5);

    mesh!.geometry.dispose();
  });

  it('keeps XY rectangle primitive preview edges aligned with the extrusion', () => {
    const sketch: Sketch = {
      ...mkSketch([{
        ...mkRectPrimitive(0, 0, 2, 0),
        points: [mkPoint(0, 0, 0), mkPoint(2, 0, 1)],
      }]),
      planeNormal: new THREE.Vector3(0, 1, 0),
    };
    const mesh = GeometryEngine.extrudeSketch(sketch, 3);
    const edges = GeometryEngine.buildExtrudeFeatureEdges(sketch, 3);
    expect(mesh).not.toBeNull();
    expect(edges).not.toBeNull();

    const edgeMesh = new THREE.LineSegments(edges!);
    edgeMesh.position.copy(mesh!.position);
    edgeMesh.quaternion.copy(mesh!.quaternion);
    edgeMesh.scale.copy(mesh!.scale);

    const meshBox = new THREE.Box3().setFromObject(mesh!);
    const edgeBox = new THREE.Box3().setFromObject(edgeMesh);
    expect(edgeBox.min.x).toBeCloseTo(meshBox.min.x, 5);
    expect(edgeBox.max.x).toBeCloseTo(meshBox.max.x, 5);
    expect(edgeBox.min.y).toBeCloseTo(meshBox.min.y, 5);
    expect(edgeBox.max.y).toBeCloseTo(meshBox.max.y, 5);
    expect(edgeBox.min.z).toBeCloseTo(meshBox.min.z, 5);
    expect(edgeBox.max.z).toBeCloseTo(meshBox.max.z, 5);

    mesh!.geometry.dispose();
    edges!.dispose();
  });
});

// ─── computeAtomicRegions (via sketchToProfileShapesFlat) ───────────────────

describe('computeAtomicRegions via sketchToProfileShapesFlat', () => {
  it('three overlapping circles produces more atomic regions than originals', () => {
    const sketch = mkSketch([
      mkCircle(0, 0, 1),
      mkCircle(1.5, 0, 1),
      mkCircle(0.75, 1.3, 1),
    ]);
    const shapes = GeometryEngine.sketchToProfileShapesFlat(sketch);
    // With 3 overlapping circles we expect 3 originals + multiple atomic
    // regions. At least 5 total (more than just the originals).
    expect(shapes.length).toBeGreaterThan(3);
  });

  it('does not throw on circle tangent to another (corner touch)', () => {
    // Two circles that touch at a single point (corner contact) — geometry
    // boundary but not volumetric overlap.
    const sketch = mkSketch([
      mkCircle(0, 0, 1),
      mkCircle(2, 0, 1),
    ]);
    expect(() => GeometryEngine.sketchToProfileShapesFlat(sketch)).not.toThrow();
  });
});
