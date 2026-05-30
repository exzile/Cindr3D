import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { sketchShapeToWires } from '../sketchToWire';

// Fake OCC kernel that records which analytic edge builders sketchShapeToWires
// invokes. Proves arcs/circles build true gp_Circ / arc edges (not polygons), and
// that an unsupported curve (spline) aborts to null so the caller can fall back.

function makeFakeOcc() {
  const calls = { line: 0, circle: 0, arc: 0, wire: 0, polygon: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edge = (kind: string) => ({ kind, delete() {} });
  const oc = {
    gp_Pnt_3: class { constructor() {} delete() {} },
    gp_Dir_4: class { constructor() {} delete() {} },
    gp_Ax2_3: class { constructor() {} delete() {} },
    gp_Circ_2: class { constructor() {} delete() {} },
    BRepBuilderAPI_MakeEdge_3: class { IsDone() { return true; } Edge() { calls.line++; return edge('line'); } delete() {} },
    BRepBuilderAPI_MakeEdge_8: class { IsDone() { return true; } Edge() { calls.circle++; return edge('circle'); } delete() {} },
    // Arc edge: gp_Circ + two endpoints (MakeEdge_24 throws on arc handles in the real build).
    BRepBuilderAPI_MakeEdge_10: class { IsDone() { return true; } Edge() { calls.arc++; return edge('arc'); } delete() {} },
    BRepBuilderAPI_MakePolygon_1: class { Add_1() {} Close() {} IsDone() { return true; } Wire() { calls.polygon++; return { delete() {} }; } delete() {} },
    BRepBuilderAPI_MakeWire_1: class {
      private done = true;
      Add_1() {}
      IsDone() { return this.done; }
      Wire() { calls.wire++; return {}; }
      delete() {}
    },
  };
  return { oc, calls };
}

const FRAME = {
  origin: new THREE.Vector3(0, 0, 0),
  normal: new THREE.Vector3(0, 0, 1),
  uDir: new THREE.Vector3(1, 0, 0),
  vDir: new THREE.Vector3(0, 1, 0),
};

describe('sketchShapeToWires (OCC-15 analytic profile)', () => {
  it('builds analytic line + circle edges for a rectangle with a circular hole', () => {
    const shape = new THREE.Shape();
    shape.moveTo(-20, -15); shape.lineTo(20, -15); shape.lineTo(20, 15); shape.lineTo(-20, 15); shape.lineTo(-20, -15);
    const hole = new THREE.Path();
    hole.absarc(6, 0, 6, 0, Math.PI * 2, false); // full circle → EllipseCurve
    shape.holes.push(hole);

    const { oc, calls } = makeFakeOcc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wires = sketchShapeToWires(oc as any, shape, FRAME);

    expect(wires).not.toBeNull();
    expect(wires!.holeWires).toHaveLength(1);
    expect(calls.line).toBeGreaterThanOrEqual(4); // rectangle sides
    expect(calls.circle).toBe(1);                 // hole built as ONE gp_Circ edge, not a polygon
    expect(calls.polygon).toBe(0);                // never falls to the faceted polygon path
  });

  it('builds an analytic arc edge for a partial circular arc', () => {
    const shape = new THREE.Shape();
    // Half-disc: start at (10,0), arc over the top to (-10,0), close along the diameter.
    shape.moveTo(10, 0);
    shape.absarc(0, 0, 10, 0, Math.PI, false);
    shape.lineTo(10, 0);

    const { oc, calls } = makeFakeOcc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wires = sketchShapeToWires(oc as any, shape, FRAME);
    expect(wires).not.toBeNull();
    expect(calls.arc).toBeGreaterThanOrEqual(1); // partial arc → analytic arc edge
  });

  it('refits arcs from a FACETED point-loop (all-LineCurve) profile', () => {
    // Mimics the region path: sample an analytic half-disc to points, then rebuild
    // a Shape FROM THE POINTS so every curve is a LineCurve (arc data lost).
    const analytic = new THREE.Shape();
    analytic.moveTo(10, 0);
    analytic.absarc(0, 0, 10, 0, Math.PI, false);
    analytic.lineTo(10, 0);
    const faceted = new THREE.Shape(analytic.getPoints(64).map((p) => new THREE.Vector2(p.x, p.y)));
    expect(faceted.curves.every((c) => c.type === 'LineCurve')).toBe(true); // truly faceted input

    const { oc, calls } = makeFakeOcc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wires = sketchShapeToWires(oc as any, faceted, FRAME);
    expect(wires).not.toBeNull();
    expect(calls.arc).toBeGreaterThanOrEqual(1);  // the sampled arc run is recovered as an arc edge
    expect(calls.line).toBeLessThan(10);          // NOT ~64 facet line edges
  });

  it('keeps the final vertex of a point-built rectangle (no diagonal collapse)', () => {
    // Regression: computeAtomicRegions builds `new THREE.Shape(points)` with NO closing
    // duplicate, so `.curves` has N-1 LineCurves and the last vertex lives only in the
    // last curve's v2. Taking curves.map(c => c.v1) alone DROPS it; for a rectangle the
    // loop then re-closes across the missing corner diagonally → a triangle (extrude
    // "cut in half"). The builder must include that final vertex → all 4 sides present.
    const rect = new THREE.Shape([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(40, 0),
      new THREE.Vector2(40, 30),
      new THREE.Vector2(0, 30), // load-bearing final corner, only present as last curve's v2
    ]);
    expect(rect.curves).toHaveLength(3); // point-built: 3 segments, 4th (closing) is implicit
    expect(rect.curves.every((c) => c.type === 'LineCurve')).toBe(true);

    const { oc, calls } = makeFakeOcc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wires = sketchShapeToWires(oc as any, rect, FRAME);
    expect(wires).not.toBeNull();
    expect(calls.line).toBe(4); // all four rectangle sides — NOT 3 (the diagonal-collapsed triangle)
  });

  it('returns null (fall back to faceted path) when the profile contains a spline', () => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.splineThru([new THREE.Vector2(5, 5), new THREE.Vector2(10, 0)]);
    shape.lineTo(0, 0);

    const { oc } = makeFakeOcc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wires = sketchShapeToWires(oc as any, shape, FRAME);
    expect(wires).toBeNull();
  });
});
