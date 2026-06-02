/**
 * OCC-3.5 / OCC-10.4 — Profile sweep along a path wire.
 * Simple path: BRepOffsetAPI_MakePipe_1 (fast, perpendicular trihedron).
 * Advanced path (guide rail / orientation): BRepOffsetAPI_MakePipeShell_1.
 */
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import type { OccPlaneFrame } from '../plane';
import { type SketchProfile, sketchProfileToWires, wireToFace } from './sketchToWire';
import { runEdgeOpBuild } from './adjacency';

type OccSweepApi = OcctRaw & {
  BRepOffsetAPI_MakePipe_1: new (pathWire: unknown, profileFace: unknown) => { Build(progress?: unknown): void; Shape(): unknown; delete(): void };
  BRepOffsetAPI_MakePipeShell_1: new (spine: unknown) => {
    SetMode_2(isFrenet: boolean): void;
    SetMode_3(fixedBinormal: unknown): void;
    Add_2(profile: unknown, withContact: boolean, withCorrection: boolean): void;
    SetMaxSegment(nbSegMin: number): void;
    SetTolerance(tol3d: number, boundTol: number, angTol: number): void;
    IsReady(): boolean;
    Build(progress?: unknown): void;
    IsDone(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  Message_ProgressRange_1: new () => { delete?: () => void };
  gp_Dir_4: new (x: number, y: number, z: number) => { delete(): void };
};

export type SweepOrientation = 'perpendicular' | 'frenet' | 'horizontal' | 'vertical';

export interface OccSweepOptions {
  id?: string;
  sourceFeatureId?: string;
  /** Optional guide rail profile. When present, MakePipeShell is used. */
  guideRail?: SketchProfile;
  guideRailFrame?: OccPlaneFrame;
  /** Trihedron / orientation mode (default: perpendicular). */
  orientation?: SweepOrientation;
  /** Draft taper angle in degrees (applied via separate DraftAngle pass; best-effort). */
  taperAngle?: number;
  /** Twist angle in degrees applied progressively along the path (best-effort via auxiliary spine). */
  twistAngle?: number;
  /** Fraction of the path to sweep along, 0–1 (default: full path). */
  distanceFraction?: number;
}

/**
 * Trim a path wire to a fraction of its length by sampling points along the
 * BRepAdaptor_CompCurve parameter range and rebuilding a B-spline wire.
 * Returns a NEW owned wire (caller deletes) or null on failure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function trimPathWireByFraction(oc: OcctRaw, pathWire: any, fraction: number): any | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const occ = oc as any;
  if (typeof occ.BRepAdaptor_CompCurve_2 !== 'function' && typeof occ.BRepAdaptor_CompCurve_1 !== 'function') return null;
  let adaptor: { FirstParameter(): number; LastParameter(): number; Value(u: number): { X(): number; Y(): number; Z(): number; delete(): void }; delete(): void } | null = null;
  try {
    adaptor = typeof occ.BRepAdaptor_CompCurve_2 === 'function'
      ? new occ.BRepAdaptor_CompCurve_2(pathWire, false)
      : new occ.BRepAdaptor_CompCurve_1(pathWire);
    const u0 = adaptor!.FirstParameter();
    const u1 = adaptor!.LastParameter();
    const uEnd = u0 + fraction * (u1 - u0);
    const N = 48;
    const pnts = new occ.TColgp_Array1OfPnt_2(1, N + 1);
    for (let i = 0; i <= N; i++) {
      const u = u0 + (i / N) * (uEnd - u0);
      const p = adaptor!.Value(u);
      const gp = new occ.gp_Pnt_3(p.X(), p.Y(), p.Z());
      pnts.SetValue(i + 1, gp);
      gp.delete?.();
      p.delete?.();
    }
    // Approximate sampled points with a B-spline curve, then make an edge → wire.
    const approx = new occ.GeomAPI_PointsToBSpline_2(pnts, 3, 8, occ.GeomAbs_Shape.GeomAbs_C2, 1e-4);
    const curveHandle = approx.Curve();
    const edgeMaker = new occ.BRepBuilderAPI_MakeEdge_24(curveHandle);
    const edge = edgeMaker.Edge();
    const wireMaker = new occ.BRepBuilderAPI_MakeWire_2(edge);
    const wire = wireMaker.Wire();
    edgeMaker.delete?.(); wireMaker.delete?.(); approx.delete?.(); pnts.delete?.();
    return wire;
  } catch (e) {
    console.warn('[occSweep] path trim failed, using full path:', e);
    return null;
  } finally {
    adaptor?.delete?.();
  }
}

export async function occSweep(
  profile: SketchProfile,
  path: SketchProfile,
  profileFrame: OccPlaneFrame,
  pathFrame: OccPlaneFrame,
  options: OccSweepOptions = {},
): Promise<BRepBody> {
  const { oc } = await getOcc();
  return occSweepWithInstance(oc, profile, path, profileFrame, pathFrame, options);
}

export function occSweepWithInstance(
  oc: OcctRaw,
  profile: SketchProfile,
  path: SketchProfile,
  profileFrame: OccPlaneFrame,
  pathFrame: OccPlaneFrame,
  options: OccSweepOptions = {},
): BRepBody {
  const occ = oc as OccSweepApi;

  const pathWires = sketchProfileToWires(oc, path, pathFrame);
  if (!pathWires) throw new Error('[occSweep] failed to build path wire');

  const profileWires = sketchProfileToWires(oc, profile, profileFrame);
  if (!profileWires) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pathWires.outerWire as any).delete();
    throw new Error('[occSweep] failed to build profile wires');
  }

  const useAdvanced =
    options.guideRail !== undefined ||
    (options.orientation !== undefined && options.orientation !== 'perpendicular');

  let resultShape: unknown;

  if (!useAdvanced) {
    // ── Simple path: BRepOffsetAPI_MakePipe_1 ────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profileFace = wireToFace(oc, profileWires.outerWire as any, profileWires.holeWires as any[]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (profileWires.outerWire as any).delete();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const hw of profileWires.holeWires) (hw as any).delete();
    if (!profileFace) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pathWires.outerWire as any).delete();
      throw new Error('[occSweep] failed to build profile face');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipe = new occ.BRepOffsetAPI_MakePipe_1(pathWires.outerWire as any, profileFace);
    try {
      runEdgeOpBuild(oc, pipe);
      resultShape = pipe.Shape();
    } finally {
      pipe.delete();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pathWires.outerWire as any).delete();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (profileFace as any).delete();
    }
  } else {
    // ── Advanced path: BRepOffsetAPI_MakePipeShell_1 ─────────────────────────
    let guideWires: ReturnType<typeof sketchProfileToWires> | null = null;
    if (options.guideRail && options.guideRailFrame) {
      guideWires = sketchProfileToWires(oc, options.guideRail, options.guideRailFrame);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipeShell = new occ.BRepOffsetAPI_MakePipeShell_1(pathWires.outerWire as any);

    // Orientation / trihedron mode
    if (options.orientation === 'frenet') {
      pipeShell.SetMode_2(true);
    } else if (options.orientation === 'horizontal') {
      const hDir = new occ.gp_Dir_4(0, 1, 0);
      try { pipeShell.SetMode_3(hDir); } catch { pipeShell.SetMode_2(true); }
      hDir.delete();
    } else if (options.orientation === 'vertical') {
      const vDir = new occ.gp_Dir_4(0, 0, 1);
      try { pipeShell.SetMode_3(vDir); } catch { pipeShell.SetMode_2(true); }
      vDir.delete();
    }
    // perpendicular (default) — no SetMode call needed

    pipeShell.SetTolerance(1e-4, 1e-4, 1e-6);

    // Profile wire (cross-section)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pipeShell.Add_2(profileWires.outerWire as any, false, true);

    // Guide rail wire — withContact=true, withCorrection=true causes the
    // profile to scale so it remains tangent to the guide.
    if (guideWires) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pipeShell.Add_2(guideWires.outerWire as any, true, true);
    }

    try {
      const isReady = pipeShell.IsReady?.();
      if (isReady === false) throw new Error('[occSweep] MakePipeShell not ready — check spine/profile topology');
      runEdgeOpBuild(oc, pipeShell);
      if (!pipeShell.IsDone?.()) throw new Error('[occSweep] MakePipeShell Build failed');
      resultShape = pipeShell.Shape();
    } finally {
      pipeShell.delete();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pathWires.outerWire as any).delete();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (profileWires.outerWire as any).delete();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const hw of profileWires.holeWires) (hw as any).delete();
      if (guideWires) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (guideWires.outerWire as any).delete();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const hw of guideWires.holeWires) (hw as any).delete();
      }
    }
  }

  return makeBRepBodyFromOccShape(oc, resultShape, {
    id: options.id,
    sourceFeatureId: options.sourceFeatureId,
  });
}

/**
 * Like occSweepWithInstance but accepts a pre-built path wire (OCC TopoDS_Wire).
 * Use this from commit actions where the path sketch is an open curve whose
 * entities have been converted via sketchEntitiesToWire — sketchProfileToWires
 * would incorrectly close an open path back to the start point.
 */
export function occSweepFromPathWireWithInstance(
  oc: OcctRaw,
  profile: SketchProfile,
  profileFrame: OccPlaneFrame,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pathWire: any,
  options: Omit<OccSweepOptions, 'guideRail' | 'guideRailFrame'> & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    guideWire?: any;
    /** When true, sweep the profile wire (not a closed face) → open shell surface body. */
    surface?: boolean;
  } = {},
): BRepBody {
  const occ = oc as OccSweepApi;

  // Partial-distance: trim the path wire to a fraction of its length.
  let trimmedWire: unknown | null = null;
  if (options.distanceFraction !== undefined && options.distanceFraction < 0.999) {
    trimmedWire = trimPathWireByFraction(oc, pathWire, options.distanceFraction);
    if (trimmedWire) pathWire = trimmedWire;
  }

  const profileWires = sketchProfileToWires(oc, profile, profileFrame);
  if (!profileWires) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (trimmedWire) (trimmedWire as any).delete?.();
    throw new Error('[occSweep] failed to build profile wires');
  }

  const useAdvanced =
    options.guideWire !== undefined ||
    (options.orientation !== undefined && options.orientation !== 'perpendicular');

  let resultShape: unknown;

  if (!useAdvanced) {
    // Surface mode: sweep the wire (open) instead of a face (closed solid).
    const profileShape: unknown = options.surface
      ? profileWires.outerWire
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : wireToFace(oc, profileWires.outerWire as any, profileWires.holeWires as any[]);

    if (!options.surface) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (profileWires.outerWire as any).delete();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const hw of profileWires.holeWires) (hw as any).delete();
    }
    if (!profileShape) throw new Error('[occSweep] failed to build profile shape');

    const pipe = new occ.BRepOffsetAPI_MakePipe_1(pathWire, profileShape);
    try {
      runEdgeOpBuild(oc, pipe);
      resultShape = pipe.Shape();
    } finally {
      pipe.delete();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (profileShape as any).delete?.();
      if (options.surface) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const hw of profileWires.holeWires) (hw as any).delete();
      }
    }
  } else {
    const pipeShell = new occ.BRepOffsetAPI_MakePipeShell_1(pathWire);

    if (options.orientation === 'frenet') {
      pipeShell.SetMode_2(true);
    } else if (options.orientation === 'horizontal') {
      const hDir = new occ.gp_Dir_4(0, 1, 0);
      try { pipeShell.SetMode_3(hDir); } catch { pipeShell.SetMode_2(true); }
      hDir.delete();
    } else if (options.orientation === 'vertical') {
      const vDir = new occ.gp_Dir_4(0, 0, 1);
      try { pipeShell.SetMode_3(vDir); } catch { pipeShell.SetMode_2(true); }
      vDir.delete();
    }

    pipeShell.SetTolerance(1e-4, 1e-4, 1e-6);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pipeShell.Add_2(profileWires.outerWire as any, false, true);

    if (options.guideWire) {
      pipeShell.Add_2(options.guideWire, true, true);
    }

    try {
      if (pipeShell.IsReady?.() === false) throw new Error('[occSweep] MakePipeShell not ready');
      runEdgeOpBuild(oc, pipeShell);
      if (!pipeShell.IsDone?.()) throw new Error('[occSweep] MakePipeShell Build failed');
      resultShape = pipeShell.Shape();
    } finally {
      pipeShell.delete();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (profileWires.outerWire as any).delete();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const hw of profileWires.holeWires) (hw as any).delete();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (trimmedWire) (trimmedWire as any).delete?.();

  return makeBRepBodyFromOccShape(oc, resultShape, {
    id: options.id,
    sourceFeatureId: options.sourceFeatureId,
  });
}
