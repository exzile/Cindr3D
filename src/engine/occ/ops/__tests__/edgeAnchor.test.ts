import { describe, expect, it } from 'vitest';
import { computeEdgeAnchor, findEdgeByAnchor } from '../edgeAnchor';
import { createBRepBody, type BRepBody } from '../../brepBody';
import { OccHandle } from '../../occHandle';

// Fake OCC curve kernel exercising the trim-invariant matching in edgeAnchor:
// BRepAdaptor_Curve_2 over line / circle edges + gp_Pnt_1 + GeomAbs_CurveType.
// The key property under test: a line edge whose segment was SHORTENED (its
// midpoint moved) still re-matches its original anchor, because matching is by
// the infinite line, not the midpoint — this is what lets a sequential fillet
// re-find a corner edge after a neighbouring fillet trimmed it.

type Vec3 = [number, number, number];
const LINE = { tag: 'line' };
const CIRCLE = { tag: 'circle' };

interface LineEdge { kind: 'line'; p: Vec3; d: Vec3; t0: number; t1: number }
interface CircleEdge { kind: 'circle'; c: Vec3; ax: Vec3; r: number; t0: number; t1: number }
interface OtherEdge { kind: 'other'; mid: Vec3 }
type EdgeGeom = LineEdge | CircleEdge | OtherEdge;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeOcc(): any {
  return {
    TopoDS_Shape: undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TopoDS: { Edge_1: (s: any) => s },
    GeomAbs_CurveType: { GeomAbs_Line: LINE, GeomAbs_Circle: CIRCLE },
    gp_Pnt_1: class {
      x = 0; y = 0; z = 0;
      _set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; }
      X() { return this.x; } Y() { return this.y; } Z() { return this.z; }
      delete() {}
    },
    BRepAdaptor_Curve_2: class {
      private g: EdgeGeom;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(edge: any) { this.g = edge.geom as EdgeGeom; }
      GetType() { return this.g.kind === 'line' ? LINE : this.g.kind === 'circle' ? CIRCLE : { tag: 'spline' }; }
      FirstParameter() { return this.g.kind === 'other' ? 0 : this.g.t0; }
      LastParameter() { return this.g.kind === 'other' ? 1 : this.g.t1; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      D0(u: number, p: any) {
        if (this.g.kind === 'line') {
          p._set(this.g.p[0] + this.g.d[0] * u, this.g.p[1] + this.g.d[1] * u, this.g.p[2] + this.g.d[2] * u);
        } else if (this.g.kind === 'circle') {
          // point on circle in the z=const plane (axis assumed +z for the fake)
          p._set(this.g.c[0] + this.g.r * Math.cos(u), this.g.c[1] + this.g.r * Math.sin(u), this.g.c[2]);
        } else {
          p._set(this.g.mid[0], this.g.mid[1], this.g.mid[2]);
        }
      }
      Line() {
        const g = this.g as LineEdge;
        return {
          Location: () => ({ X: () => g.p[0], Y: () => g.p[1], Z: () => g.p[2], delete() {} }),
          Direction: () => ({ X: () => g.d[0], Y: () => g.d[1], Z: () => g.d[2], delete() {} }),
          delete() {},
        };
      }
      Circle() {
        const g = this.g as CircleEdge;
        return {
          Location: () => ({ X: () => g.c[0], Y: () => g.c[1], Z: () => g.c[2], delete() {} }),
          Axis: () => ({ Direction: () => ({ X: () => g.ax[0], Y: () => g.ax[1], Z: () => g.ax[2], delete() {} }), delete() {} }),
          Radius: () => g.r,
          delete() {},
        };
      }
      delete() {}
    },
  };
}

function bodyFromEdges(edges: EdgeGeom[]): BRepBody {
  const shape = new OccHandle(1, 'TopoDS_Shape', () => {}, { ptr: 1, delete() {} });
  const edgeIds = new Map<number, OccHandle<unknown>>();
  edges.forEach((geom, i) => edgeIds.set(i, new OccHandle(100 + i, 'TopoDS_Edge', () => {}, { ptr: 100 + i, geom, delete() {} })));
  return createBRepBody({ shape, edgeIds, faceIds: new Map(), vertexIds: new Map() });
}

describe('edgeAnchor', () => {
  it('re-matches a line edge after it is shortened (trim-invariant)', () => {
    const oc = makeOcc();
    // Original edge: x-axis segment [0,10], midpoint (5,0,0).
    const original = bodyFromEdges([{ kind: 'line', p: [0, 0, 0], d: [1, 0, 0], t0: 0, t1: 10 }]);
    const anchor = computeEdgeAnchor(oc, original, 0);
    expect(anchor?.kind).toBe('line');

    // Rebuilt body: the SAME line shortened to [1,10] (midpoint now 5.5,0,0) at a
    // different id, plus a parallel decoy line offset 5mm in y.
    const rebuilt = bodyFromEdges([
      { kind: 'line', p: [0, 5, 0], d: [1, 0, 0], t0: 0, t1: 10 }, // decoy (id 0)
      { kind: 'line', p: [0, 0, 0], d: [1, 0, 0], t0: 1, t1: 10 }, // shortened original (id 1)
    ]);
    expect(findEdgeByAnchor(oc, rebuilt, anchor!)).toBe(1);
  });

  it('matches a circle by centre + radius and rejects a different radius', () => {
    const oc = makeOcc();
    const original = bodyFromEdges([{ kind: 'circle', c: [2, 3, 0], ax: [0, 0, 1], r: 5, t0: 0, t1: Math.PI }]);
    const anchor = computeEdgeAnchor(oc, original, 0);
    expect(anchor?.kind).toBe('circle');

    const rebuilt = bodyFromEdges([
      { kind: 'circle', c: [2, 3, 0], ax: [0, 0, 1], r: 8, t0: 0, t1: Math.PI }, // wrong radius (id 0)
      { kind: 'circle', c: [2, 3, 0], ax: [0, 0, 1], r: 5, t0: 0.2, t1: Math.PI }, // same circle, retrimmed (id 1)
    ]);
    expect(findEdgeByAnchor(oc, rebuilt, anchor!)).toBe(1);
  });

  it('returns null when no edge matches the anchor', () => {
    const oc = makeOcc();
    const original = bodyFromEdges([{ kind: 'line', p: [0, 0, 0], d: [1, 0, 0], t0: 0, t1: 10 }]);
    const anchor = computeEdgeAnchor(oc, original, 0);
    // Rebuilt body has only an unrelated, non-collinear line.
    const rebuilt = bodyFromEdges([{ kind: 'line', p: [0, 0, 0], d: [0, 1, 0], t0: 0, t1: 10 }]);
    expect(findEdgeByAnchor(oc, rebuilt, anchor!)).toBeNull();
  });
});
