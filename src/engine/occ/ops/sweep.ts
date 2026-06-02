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

type Vec3 = [number, number, number];
const _sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const _len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const _norm = (a: Vec3): Vec3 => { const l = _len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const _dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const _cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

/**
 * Sample N+1 points along a path wire over a parameter sub-range using
 * BRepAdaptor_CompCurve.Value (proven binding; finite-difference tangents avoid
 * the gp_Vec out-param overloads). Returns 3D point tuples or null on failure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function samplePathPoints(oc: OcctRaw, pathWire: any, fraction: number, N: number): Vec3[] | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const occ = oc as any;
  if (typeof occ.BRepAdaptor_CompCurve_2 !== 'function' && typeof occ.BRepAdaptor_CompCurve_1 !== 'function') return null;
  let adaptor: { FirstParameter(): number; LastParameter(): number; Value(u: number): { X(): number; Y(): number; Z(): number; delete?(): void }; delete?(): void } | null = null;
  try {
    adaptor = typeof occ.BRepAdaptor_CompCurve_2 === 'function'
      ? new occ.BRepAdaptor_CompCurve_2(pathWire, false)
      : new occ.BRepAdaptor_CompCurve_1(pathWire);
    const u0 = adaptor!.FirstParameter();
    const u1 = adaptor!.LastParameter();
    const uEnd = u0 + Math.max(0.001, Math.min(1, fraction)) * (u1 - u0);
    const out: Vec3[] = [];
    for (let i = 0; i <= N; i++) {
      const u = u0 + (i / N) * (uEnd - u0);
      const p = adaptor!.Value(u);
      out.push([p.X(), p.Y(), p.Z()]);
      p.delete?.();
    }
    return out;
  } catch (e) {
    console.warn('[occSweep] path sampling failed:', e);
    return null;
  } finally {
    adaptor?.delete?.();
  }
}

/** Build a polyline wire from 3D points using proven MakeEdge_7 + MakeWire_1. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function polylineWire(oc: OcctRaw, pts: Vec3[]): any | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const occ = oc as any;
  try {
    const wireMaker = new occ.BRepBuilderAPI_MakeWire_1();
    const occPts = pts.map((p) => new occ.gp_Pnt_3(p[0], p[1], p[2]));
    for (let i = 0; i < occPts.length - 1; i++) {
      const em = new occ.BRepBuilderAPI_MakeEdge_7(occPts[i], occPts[i + 1]);
      if (em.IsDone()) wireMaker.Add_2(em.Edge());
      em.delete?.();
    }
    const wire = wireMaker.IsDone() ? wireMaker.Wire() : null;
    wireMaker.delete?.();
    for (const gp of occPts) gp.delete?.();
    return wire;
  } catch (e) {
    console.warn('[occSweep] polyline wire build failed:', e);
    return null;
  }
}

/**
 * Trim a path wire to a fraction of its length. Samples the path and rebuilds a
 * polyline wire (proven bindings only — MakeEdge_24/Geom-curve overloads THROW in
 * this opencascade.js build, see sketchToWire.ts). Returns owned wire or null.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function trimPathWireByFraction(oc: OcctRaw, pathWire: any, fraction: number): any | null {
  const pts = samplePathPoints(oc, pathWire, fraction, 64);
  if (!pts || pts.length < 2) return null;
  return polylineWire(oc, pts);
}

/**
 * Twisted sweep: loft the profile through N stations along the path, rotating the
 * cross-section progressively by `twistDeg` (0 at start → full at end). Uses a
 * rotation-minimizing frame computed in JS, then BRepOffsetAPI_ThruSections
 * (proven in loft.ts). Avoids OCC auxiliary-spine SetMode (unreliable overload
 * numbering in this build). Returns the result TopoDS_Shape or null.
 */
function buildTwistedSweepShape(
  oc: OcctRaw,
  profile: SketchProfile,
  profileFrame: OccPlaneFrame,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pathWire: any,
  twistDeg: number,
  fraction: number,
  isSolid: boolean,
): unknown | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const occ = oc as any;
  const STATIONS = 24;
  const pts = samplePathPoints(oc, pathWire, fraction, STATIONS);
  if (!pts || pts.length < 2) return null;

  // Finite-difference tangents
  const tangents: Vec3[] = pts.map((_, i) => {
    if (i === 0) return _norm(_sub(pts[1], pts[0]));
    if (i === pts.length - 1) return _norm(_sub(pts[i], pts[i - 1]));
    return _norm(_sub(pts[i + 1], pts[i - 1]));
  });

  // Rotation-minimizing frame seeded from the profile frame so twist=0 matches a
  // normal sweep's cross-section orientation.
  const fU: Vec3 = [profileFrame.uDir.x, profileFrame.uDir.y, profileFrame.uDir.z];
  let N: Vec3 = _norm(_sub(fU, scale(tangents[0], _dot(fU, tangents[0]))));
  if (_len(N) < 1e-6) {
    // uDir parallel to tangent — pick any perpendicular
    const alt: Vec3 = Math.abs(tangents[0][0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    N = _norm(_sub(alt, scale(tangents[0], _dot(alt, tangents[0]))));
  }
  let B: Vec3 = _norm(_cross(tangents[0], N));

  const twistRad = (twistDeg * Math.PI) / 180;
  const outer = profile.outer;
  const stationWires: unknown[] = [];

  try {
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) {
        // Propagate frame: project previous N onto plane perpendicular to new tangent
        const t = tangents[i];
        N = _norm(_sub(N, scale(t, _dot(N, t))));
        B = _norm(_cross(t, N));
      }
      const theta = twistRad * (i / (pts.length - 1));
      const ct = Math.cos(theta), st = Math.sin(theta);
      const P = pts[i];
      const stationPts: Vec3[] = outer.map((p2) => {
        const u = p2.x * ct - p2.y * st;
        const v = p2.x * st + p2.y * ct;
        return [P[0] + N[0] * u + B[0] * v, P[1] + N[1] * u + B[1] * v, P[2] + N[2] * u + B[2] * v];
      });
      // Close the loop
      if (stationPts.length >= 3) stationPts.push(stationPts[0]);
      const w = polylineWire(oc, stationPts);
      if (w) stationWires.push(w);
    }
    if (stationWires.length < 2) return null;

    const loftMaker = new occ.BRepOffsetAPI_ThruSections_1(isSolid, false, 1e-6);
    loftMaker.SetSmoothing(true);
    loftMaker.CheckCompatibility(false);
    for (const w of stationWires) loftMaker.AddWire(w);
    runEdgeOpBuild(oc, loftMaker);
    if (!loftMaker.IsDone()) { loftMaker.delete?.(); return null; }
    const shape = loftMaker.Shape();
    loftMaker.delete?.();
    return shape;
  } catch (e) {
    console.warn('[occSweep] twisted sweep failed:', e);
    return null;
  } finally {
    for (const w of stationWires) (w as { delete?: () => void }).delete?.();
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

  // ── Twist path: loft the profile through rotated stations along the path ──
  // Uses only proven bindings (ThruSections + polyline wires). When this fails,
  // fall through to the normal (untwisted) sweep so the feature is still created.
  if (options.twistAngle !== undefined && Math.abs(options.twistAngle) > 0.001) {
    const twisted = buildTwistedSweepShape(
      oc, profile, profileFrame, pathWire, options.twistAngle,
      options.distanceFraction ?? 1, !options.surface,
    );
    if (twisted) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (trimmedWire) (trimmedWire as any).delete?.();
      return makeBRepBodyFromOccShape(oc, twisted, { id: options.id, sourceFeatureId: options.sourceFeatureId });
    }
    console.warn('[occSweep] twisted sweep returned null — falling back to untwisted');
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
