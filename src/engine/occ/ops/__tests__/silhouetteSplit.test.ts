/**
 * OCC-21.4e — silhouette split tests.
 *
 * Part 1 (pure math): cylinderSilhouetteRulings is exercised with REAL
 * geometry assertions — this is the verifiable heart of "real silhouette split"
 * (view-dependent outline, not a planar cut).
 *
 * Part 2 (orchestration): occSilhouetteSplitWithInstance with a mocked OCC
 * surface — asserts cylinder faces are imprinted via BRepFeat_SplitShape, that
 * planar faces and axis-parallel views are skipped, and that the binding-missing
 * / no-silhouette cases return null cleanly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks for the orchestration tests ─────────────────────────────────
const RAW_SHAPE = { __view: 'rawShape' };
let madeFromShape: unknown = null;

vi.mock('../../brepBody', () => ({
  occDeref: (_oc: unknown, h: { __faceId?: number }) => (h.__faceId != null ? { __faceDeref: h.__faceId } : RAW_SHAPE),
  makeBRepBodyFromOccShape: (_oc: unknown, shape: unknown) => {
    madeFromShape = shape;
    return { id: 'silhouette-result', shape, faceIds: new Map(), edgeIds: new Map(), vertexIds: new Map() };
  },
}));
vi.mock('../adjacency', () => ({
  runEdgeOpBuild: (_oc: unknown, maker: { Build: () => void }) => maker.Build(),
}));

import { cylinderSilhouetteRulings, occSilhouetteSplitWithInstance } from '../silhouetteSplit';
import type { CylinderSilhouetteParams } from '../silhouetteSplit';

// ── Part 1: pure math ─────────────────────────────────────────────────────────

describe('cylinderSilhouetteRulings (pure)', () => {
  // Z-axis cylinder, radius 5, height 0..10, centred on the origin.
  const zCyl: CylinderSilhouetteParams = {
    axisLoc: [0, 0, 0], axisDir: [0, 0, 1], radius: 5, vMin: 0, vMax: 10,
  };

  it('returns the two outline rulings for a Z-cylinder viewed along +X', () => {
    const segs = cylinderSilhouetteRulings(zCyl, [1, 0, 0]);
    expect(segs).toHaveLength(2);
    // axis(Z) × view(X) = +Y, so rulings sit on the ±Y side at radius 5.
    const ys = segs.map((s) => s.start[1]).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-5, 6);
    expect(ys[1]).toBeCloseTo(5, 6);
    // …and at x = 0 (perpendicular to the view), spanning the full height.
    for (const s of segs) {
      expect(s.start[0]).toBeCloseTo(0, 6);
      expect(s.start[2]).toBeCloseTo(0, 6);  // vMin
      expect(s.end[2]).toBeCloseTo(10, 6);   // vMax
    }
  });

  it('viewing along +Y puts the rulings on the ±X side', () => {
    const segs = cylinderSilhouetteRulings(zCyl, [0, 1, 0]);
    const xs = segs.map((s) => s.start[0]).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-5, 6);
    expect(xs[1]).toBeCloseTo(5, 6);
    for (const s of segs) expect(s.start[1]).toBeCloseTo(0, 6);
  });

  it('rulings are always perpendicular to the view direction (tangency)', () => {
    const view: [number, number, number] = [1, 2, 0];
    const segs = cylinderSilhouetteRulings(zCyl, view);
    expect(segs).toHaveLength(2);
    const vlen = Math.hypot(view[0], view[1], view[2]);
    for (const s of segs) {
      // radial offset vector (start − axis) must be ⊥ view.
      const dot = (s.start[0] * view[0] + s.start[1] * view[1] + s.start[2] * view[2]) / vlen;
      expect(dot).toBeCloseTo(0, 6);
      // and at the correct radius from the axis.
      expect(Math.hypot(s.start[0], s.start[1])).toBeCloseTo(5, 6);
    }
  });

  it('returns [] when the view is parallel to the axis (no ruling silhouette)', () => {
    expect(cylinderSilhouetteRulings(zCyl, [0, 0, 1])).toEqual([]);
    expect(cylinderSilhouetteRulings(zCyl, [0, 0, -1])).toEqual([]);
  });

  it('returns [] for a degenerate (zero) view direction', () => {
    expect(cylinderSilhouetteRulings(zCyl, [0, 0, 0])).toEqual([]);
  });

  it('honors a non-origin axis location and offset V-range', () => {
    const offCyl: CylinderSilhouetteParams = {
      axisLoc: [10, 0, 2], axisDir: [0, 0, 1], radius: 3, vMin: 1, vMax: 4,
    };
    const segs = cylinderSilhouetteRulings(offCyl, [1, 0, 0]);
    expect(segs).toHaveLength(2);
    for (const s of segs) {
      expect(s.start[0]).toBeCloseTo(10, 6);          // x stays at axis x
      expect(Math.abs(s.start[1])).toBeCloseTo(3, 6); // ±radius in Y
      expect(s.start[2]).toBeCloseTo(2 + 1, 6);       // axisLoc.z + vMin
      expect(s.end[2]).toBeCloseTo(2 + 4, 6);         // axisLoc.z + vMax
    }
  });
});

// ── Part 2: orchestration ──────────────────────────────────────────────────────

const ENUM_CYL = 'CYL';
const ENUM_PLANE = 'PLANE';

interface FakeFace { type: string; }

let splitterAdds: Array<{ wire: unknown; face: unknown }>;
let log: string[];

function makeFakeOcc(opts: { hasFeat?: boolean; splitDone?: boolean } = {}) {
  splitterAdds = [];
  log = [];
  const occ: Record<string, unknown> = {
    TopoDS_Shape: undefined,
    GeomAbs_SurfaceType: { GeomAbs_Cylinder: ENUM_CYL },
    TopoDS: { Face_1: (deref: { __faceDeref?: number }) => ({ __faceDeref: deref.__faceDeref }) },
    BRepAdaptor_Surface_2: class {
      private face: FakeFace;
      constructor(face: FakeFace) { this.face = face; }
      GetType() { return this.face.type === 'cyl' ? ENUM_CYL : ENUM_PLANE; }
      FirstVParameter() { return 0; }
      LastVParameter() { return 10; }
      Cylinder() {
        return {
          Axis: () => ({
            Location: () => ({ X: () => 0, Y: () => 0, Z: () => 0, delete() {} }),
            Direction: () => ({ X: () => 0, Y: () => 0, Z: () => 1, delete() {} }),
            delete() {},
          }),
          Radius: () => 5,
          delete() {},
        };
      }
      delete() { log.push('adaptor'); }
    },
    gp_Pnt_3: class { constructor() {} delete() { log.push('pnt'); } },
    BRepBuilderAPI_MakeEdge_3: class {
      IsDone() { return true; }
      Edge() { return { __edge: true }; }
      delete() { log.push('edgeMaker'); }
    },
    BRep_Builder: class {
      MakeWire() {}
      Add() {}
      delete() { log.push('builder'); }
    },
    TopoDS_Wire: class { delete() { log.push('wire'); } },
  };
  if (opts.hasFeat !== false) {
    occ.BRepFeat_SplitShape = class {
      constructor() {}
      Add(wire: unknown, face: unknown) { splitterAdds.push({ wire, face }); }
      Build() {}
      IsDone() { return opts.splitDone ?? true; }
      Shape() { return { __view: 'splitResult' }; }
      delete() { log.push('splitter'); }
    };
  }
  return occ;
}

// faceId handle carries __faceId so the mocked occDeref tags it; the adaptor is
// fed the cast face whose `type` we control via the handle's `kind`.
function bodyWithFaces(kinds: Array<'cyl' | 'plane'>) {
  const faceIds = new Map<number, unknown>();
  kinds.forEach((kind, i) => faceIds.set(i + 1, { __faceId: i + 1, kind }));
  return { id: 'b', shape: { ptr: 1 }, faceIds, edgeIds: new Map(), vertexIds: new Map() };
}

describe('occSilhouetteSplitWithInstance (orchestration)', () => {
  beforeEach(() => { madeFromShape = null; });

  // The fake adaptor reads `.type` off the face it's constructed with; wire the
  // cast face's type from the handle kind via the Face_1 mock.
  function occFor(kinds: Array<'cyl' | 'plane'>, opts?: { hasFeat?: boolean; splitDone?: boolean }) {
    const occ = makeFakeOcc(opts);
    const body = bodyWithFaces(kinds);
    // Map the cast face deref id back to its kind so the adaptor sees the type.
    const kindById = new Map<number, string>();
    body.faceIds.forEach((h, id) => kindById.set(id, (h as { kind: string }).kind));
    // Adaptor is constructed with the cast face object {__faceDeref:id}; translate to {type}.
    const OrigAdaptor = occ.BRepAdaptor_Surface_2 as new (f: { type: string }) => unknown;
    occ.BRepAdaptor_Surface_2 = class {
      private inner: { GetType(): unknown; FirstVParameter(): number; LastVParameter(): number; Cylinder(): unknown; delete(): void };
      constructor(castFace: { __faceDeref?: number }) {
        const kind = kindById.get(castFace.__faceDeref ?? -1) ?? 'plane';
        this.inner = new OrigAdaptor({ type: kind }) as never;
      }
      GetType() { return this.inner.GetType(); }
      FirstVParameter() { return this.inner.FirstVParameter(); }
      LastVParameter() { return this.inner.LastVParameter(); }
      Cylinder() { return this.inner.Cylinder(); }
      delete() { this.inner.delete(); }
    } as never;
    return { occ, body };
  }

  it('imprints both rulings on a cylindrical face and returns a new body', () => {
    const { occ, body } = occFor(['cyl']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = occSilhouetteSplitWithInstance(occ as any, body as any, [1, 0, 0]);
    expect(r).not.toBeNull();
    expect(splitterAdds).toHaveLength(2); // two outline rulings
    expect((madeFromShape as { __view: string }).__view).toBe('splitResult');
  });

  it('skips planar faces (no silhouette) and returns null when none qualify', () => {
    const { occ, body } = occFor(['plane', 'plane']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = occSilhouetteSplitWithInstance(occ as any, body as any, [1, 0, 0]);
    expect(r).toBeNull();
    expect(splitterAdds).toHaveLength(0);
  });

  it('returns null when the view is parallel to a cylinder axis', () => {
    const { occ, body } = occFor(['cyl']);
    // Z-axis cylinder viewed along +Z → no ruling silhouette.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = occSilhouetteSplitWithInstance(occ as any, body as any, [0, 0, 1]);
    expect(r).toBeNull();
  });

  it('returns null when BRepFeat_SplitShape is unavailable (TKFeat not loaded)', () => {
    const { occ, body } = occFor(['cyl'], { hasFeat: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = occSilhouetteSplitWithInstance(occ as any, body as any, [1, 0, 0]);
    expect(r).toBeNull();
  });

  it('returns null when the splitter does not complete', () => {
    const { occ, body } = occFor(['cyl'], { splitDone: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = occSilhouetteSplitWithInstance(occ as any, body as any, [1, 0, 0]);
    expect(r).toBeNull();
  });
});
