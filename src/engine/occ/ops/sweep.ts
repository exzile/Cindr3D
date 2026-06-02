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

  const profileWires = sketchProfileToWires(oc, profile, profileFrame);
  if (!profileWires) throw new Error('[occSweep] failed to build profile wires');

  const useAdvanced =
    options.guideWire !== undefined ||
    (options.orientation !== undefined && options.orientation !== 'perpendicular');

  let resultShape: unknown;

  if (!useAdvanced) {
    // Surface mode: sweep the wire (open) instead of a face (closed solid).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profileShape: unknown = options.surface
      ? profileWires.outerWire
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

  return makeBRepBodyFromOccShape(oc, resultShape, {
    id: options.id,
    sourceFeatureId: options.sourceFeatureId,
  });
}
