/**
 * OCC-10.1 — Loft through cross-section profiles.
 * Uses BRepOffsetAPI_ThruSections for solid lofts and open shells (surface mode).
 * Ruled loft: straight-line ruled surface between sections.
 * Smooth loft: SetSmoothing(true) for curvature-continuous blending.
 * Surface mode (options.surface=true): isSolid=false → open shell BRepBody.
 */
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import type { OccPlaneFrame } from '../plane';
import { type SketchProfile, sketchProfileToWires } from './sketchToWire';
import { runEdgeOpBuild } from './adjacency';

type OccLoftApi = OcctRaw & {
  BRepOffsetAPI_ThruSections_1: new (isSolid: boolean, ruled: boolean, pres3d: number) => {
    AddWire(wire: unknown): void;
    AddVertex(vertex: unknown): void;
    SetSmoothing(useSmoothing: boolean): void;
    CheckCompatibility(check: boolean): void;
    Build(progress?: unknown): void;
    IsDone(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  Message_ProgressRange_1: new () => { delete?: () => void };
  TopExp_Explorer_2: new (shape: unknown, toFind: unknown, toAvoid: unknown) => {
    More(): boolean;
    Current(): { delete(): void };
    Next(): void;
    delete(): void;
  };
};

export interface OccLoftOptions {
  id?: string;
  sourceFeatureId?: string;
  ruled?: boolean;
  closed?: boolean;
  smooth?: boolean;
  tolerance?: number;
  /** When true, produce an open shell (surface body) instead of a capped solid. */
  surface?: boolean;
}

export async function occLoft(
  sections: SketchProfile[],
  frames: OccPlaneFrame[],
  options: OccLoftOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occLoftWithInstance(oc, sections, frames, options);
}

export function occLoftWithInstance(
  oc: OcctRaw,
  sections: SketchProfile[],
  frames: OccPlaneFrame[],
  options: OccLoftOptions = {},
): BRepBody | null {
  if (sections.length < 2) {
    console.warn('[occLoft] need at least 2 sections');
    return null;
  }
  if (sections.length !== frames.length) {
    console.warn('[occLoft] sections and frames arrays must have the same length');
    return null;
  }

  const occ = oc as OccLoftApi;
  const ruled = options.ruled ?? false;
  const smooth = options.smooth ?? !ruled;
  const tol = options.tolerance ?? 1e-6;

  const isSolid = options.surface !== true;
  const loftMaker = new occ.BRepOffsetAPI_ThruSections_1(isSolid, ruled, tol);
  loftMaker.SetSmoothing(smooth);
  loftMaker.CheckCompatibility(false);

  const builtWires: Array<{ delete(): void }> = [];

  for (let i = 0; i < sections.length; i++) {
    const wires = sketchProfileToWires(oc, sections[i], frames[i]);
    if (!wires) {
      console.warn(`[occLoft] failed to build wire for section ${i}`);
      for (const w of builtWires) w.delete();
      loftMaker.delete();
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loftMaker.AddWire(wires.outerWire as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    builtWires.push(wires.outerWire as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const hw of wires.holeWires) (hw as any).delete();
  }

  // Close the loft by re-adding the first section as the last.
  if (options.closed && builtWires.length >= 2) {
    const firstWires = sketchProfileToWires(oc, sections[0], frames[0]);
    if (firstWires) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loftMaker.AddWire(firstWires.outerWire as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      builtWires.push(firstWires.outerWire as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const hw of firstWires.holeWires) (hw as any).delete();
    }
  }

  try {
    runEdgeOpBuild(oc, loftMaker);
    if (!loftMaker.IsDone()) {
      console.warn('[occLoft] BRepOffsetAPI_ThruSections.IsDone() = false');
      return null;
    }
    const resultShape = loftMaker.Shape();
    return makeBRepBodyFromOccShape(oc, resultShape, {
      id: options.id,
      sourceFeatureId: options.sourceFeatureId,
    });
  } catch (e) {
    console.warn('[occLoft] threw during Build/Shape:', e);
    return null;
  } finally {
    for (const w of builtWires) w.delete();
    loftMaker.delete();
  }
}
