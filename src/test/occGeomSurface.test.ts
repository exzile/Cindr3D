import { describe, expect, it } from 'vitest';
import { createBRepBody } from '../engine/occ/brepBody';
import { sketchPlaneFromFace, sketchPlaneFromRawFace } from '../engine/occ/geomSurface';
import { OccHandle } from '../engine/occ/occHandle';
import type { OcctRaw } from '../engine/occ/types';

// geomSurface now uses BRepAdaptor_Surface (GetType / Plane) instead of
// BRep_Tool.Surface + Handle_Geom_Plane.DownCast (the old path threw build-wide:
// Surface_2 was the 1-arg overload and Handle_Geom_Plane.DownCast was undefined).
// These stubs mirror the adaptor path and assert the TopoDS.Face_1 cast is applied.

const PLANE = { tag: 'plane' };
const CYLINDER = { tag: 'cylinder' };
const REVERSED = { tag: 'reversed' };

interface StubOpts {
  surfaceType: unknown;        // PLANE → planar; anything else → non-planar
  normal: [number, number, number];
  reversed?: boolean;
  onAdaptorFace?: (face: { __face1?: boolean }) => void;
}

function xyz(x: number, y: number, z: number) {
  return { X: () => x, Y: () => y, Z: () => z, delete() {} };
}

function makeStub(o: StubOpts): OcctRaw {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oc: any = {
    TopoDS_Shape: function TopoDSShape() {},
    // occDeref → wrapPointer(ptr, ctor). Return a raw "shape" (NOT a face).
    wrapPointer: (ptr: number) => ({ ptr, __shape: true }),
    // The cast under test: Face_1 turns the Shape into a real TopoDS_Face.
    TopoDS: {
      Face_1: (s: { ptr?: number }) => ({
        ...s,
        __face1: true,
        Orientation_1: () => (o.reversed ? REVERSED : { tag: 'forward' }),
      }),
    },
    GeomAbs_SurfaceType: { GeomAbs_Plane: PLANE },
    TopAbs_Orientation: { TopAbs_REVERSED: REVERSED },
    BRepAdaptor_Surface_2: class {
      constructor(face: { __face1?: boolean }) {
        // Mirror embind's strict type check: a raw TopoDS_Shape (no Face_1 cast)
        // would throw here. Capturing it lets the test assert the cast happened.
        o.onAdaptorFace?.(face);
        if (!face || face.__face1 !== true) {
          throw new Error('BindingError: Expected a TopoDS_Face');
        }
      }
      GetType() { return o.surfaceType; }
      Plane() {
        return {
          Position: () => ({
            Location: () => xyz(0, 0, 5),
            Direction: () => xyz(...o.normal),
            XDirection: () => xyz(1, 0, 0),
            delete() {},
          }),
          delete() {},
        };
      }
      delete() {}
    },
  };
  return oc as OcctRaw;
}

function bodyWithFace7() {
  return createBRepBody({
    shape: new OccHandle(1, 'shape', () => {}),
    faceIds: new Map([[7, new OccHandle(7, 'face', () => {})]]),
  });
}

describe('OCC geom surface helpers (BRepAdaptor path)', () => {
  it('returns a frame for a planar face, casting the shape to a TopoDS_Face first', () => {
    let adaptorFace: { __face1?: boolean } | null = null;
    const oc = makeStub({ surfaceType: PLANE, normal: [0, 0, 1], onAdaptorFace: (f) => { adaptorFace = f; } });
    const body = bodyWithFace7();

    const result = sketchPlaneFromFace(oc, body, 7);
    expect(result).not.toBeNull();
    expect(result!.frame.normal.z).toBeCloseTo(1);
    // The BRepAdaptor must have received a Face_1-cast face, not a raw shape.
    expect(adaptorFace).not.toBeNull();
    expect(adaptorFace!.__face1).toBe(true);

    body.dispose();
  });

  it('returns null for a non-planar (cylindrical) face', () => {
    const oc = makeStub({ surfaceType: CYLINDER, normal: [0, 0, 1] });
    const body = bodyWithFace7();
    expect(sketchPlaneFromFace(oc, body, 7)).toBeNull();
    body.dispose();
  });

  it('flips the normal for a REVERSED face', () => {
    const oc = makeStub({ surfaceType: PLANE, normal: [0, 0, 1], reversed: true });
    // sketchPlaneFromRawFace expects an already-cast face that carries Orientation_1.
    const rawFace = { __face1: true, Orientation_1: () => REVERSED };
    const result = sketchPlaneFromRawFace(oc, rawFace);
    expect(result).not.toBeNull();
    expect(result!.frame.normal.z).toBeCloseTo(-1);
  });

  it('returns null when the face id is not on the body', () => {
    const oc = makeStub({ surfaceType: PLANE, normal: [0, 0, 1] });
    const body = bodyWithFace7();
    expect(sketchPlaneFromFace(oc, body, 999)).toBeNull();
    body.dispose();
  });
});
