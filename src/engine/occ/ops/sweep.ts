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

type OccSweepApi = OcctRaw & {
  BRepOffsetAPI_MakePipe_1: new (pathWire: unknown, profileFace: unknown) => { Build(progress: unknown): void; Shape(): unknown; delete(): void };
  BRepOffsetAPI_MakePipeShell_1: new (spine: unknown) => {
    SetMode_2(isFrenet: boolean): void;
    SetMode_3(fixedBinormal: unknown): void;
    Add_2(profile: unknown, withContact: boolean, withCorrection: boolean): void;
    SetMaxSegment(nbSegMin: number): void;
    SetTolerance(tol3d: number, boundTol: number, angTol: number): void;
    IsReady(): boolean;
    Build(progress: unknown): void;
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
    pathWires.outerWire.delete();
    throw new Error('[occSweep] failed to build profile wires');
  }

  const useAdvanced =
    options.guideRail !== undefined ||
    (options.orientation !== undefined && options.orientation !== 'perpendicular');

  let resultShape: unknown;

  if (!useAdvanced) {
    // ── Simple path: BRepOffsetAPI_MakePipe_1 ────────────────────────────────
    const profileFace = wireToFace(oc, profileWires.outerWire, profileWires.holeWires);
    profileWires.outerWire.delete();
    for (const hw of profileWires.holeWires) hw.delete();
    if (!profileFace) {
      pathWires.outerWire.delete();
      throw new Error('[occSweep] failed to build profile face');
    }

    const pipe = new occ.BRepOffsetAPI_MakePipe_1(pathWires.outerWire, profileFace);
    const progress = new occ.Message_ProgressRange_1();
    try {
      pipe.Build(progress);
      resultShape = pipe.Shape();
    } finally {
      progress.delete?.();
      pipe.delete();
      pathWires.outerWire.delete();
      profileFace.delete();
    }
  } else {
    // ── Advanced path: BRepOffsetAPI_MakePipeShell_1 ─────────────────────────
    let guideWires: ReturnType<typeof sketchProfileToWires> | null = null;
    if (options.guideRail && options.guideRailFrame) {
      guideWires = sketchProfileToWires(oc, options.guideRail, options.guideRailFrame);
    }

    const pipeShell = new occ.BRepOffsetAPI_MakePipeShell_1(pathWires.outerWire);

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
    pipeShell.Add_2(profileWires.outerWire, false, true);

    // Guide rail wire — withContact=true, withCorrection=true causes the
    // profile to scale so it remains tangent to the guide.
    if (guideWires) {
      pipeShell.Add_2(guideWires.outerWire, true, true);
    }

    const progress = new occ.Message_ProgressRange_1();
    try {
      const isReady = pipeShell.IsReady?.();
      if (isReady === false) throw new Error('[occSweep] MakePipeShell not ready — check spine/profile topology');
      pipeShell.Build(progress);
      if (!pipeShell.IsDone?.()) throw new Error('[occSweep] MakePipeShell Build failed');
      resultShape = pipeShell.Shape();
    } finally {
      progress.delete?.();
      pipeShell.delete();
      pathWires.outerWire.delete();
      profileWires.outerWire.delete();
      for (const hw of profileWires.holeWires) hw.delete();
      if (guideWires) {
        guideWires.outerWire.delete();
        for (const hw of guideWires.holeWires) hw.delete();
      }
    }
  }

  return makeBRepBodyFromOccShape(oc, resultShape, {
    id: options.id,
    sourceFeatureId: options.sourceFeatureId,
  });
}
