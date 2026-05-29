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
    GC_MakeArcOfCircle_4: class { IsDone() { return true; } Value() { return {}; } delete() {} },
    BRepBuilderAPI_MakeEdge_3: class { IsDone() { return true; } Edge() { calls.line++; return edge('line'); } delete() {} },
    BRepBuilderAPI_MakeEdge_8: class { IsDone() { return true; } Edge() { calls.circle++; return edge('circle'); } delete() {} },
    BRepBuilderAPI_MakeEdge_24: class { IsDone() { return true; } Edge() { calls.arc++; return edge('arc'); } delete() {} },
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
    expect(calls.arc).toBeGreaterThanOrEqual(1); // partial arc → GC_MakeArcOfCircle
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
