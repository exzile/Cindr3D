/**
 * OCC-10.1 — Loft through cross-section profiles.
 * Uses BRepOffsetAPI_ThruSections for solid lofts.
 * Ruled loft: straight-line ruled surface between sections.
 * Smooth loft: SetSmoothing(true) for curvature-continuous blending.
 */
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import type { OccPlaneFrame } from '../plane';
import { type SketchProfile, sketchProfileToWires } from './sketchToWire';

type OccLoftApi = OcctRaw & {
  BRepOffsetAPI_ThruSections_1: new (isSolid: boolean, ruled: boolean, pres3d: number) => {
    AddWire(wire: unknown): void;
    AddVertex(vertex: unknown): void;
    SetSmoothing(useSmoothing: boolean): void;
    CheckCompatibility(check: boolean): void;
    Build(progress: unknown): void;
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

  const loftMaker = new occ.BRepOffsetAPI_ThruSections_1(true, ruled, tol);
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

  const progress = new occ.Message_ProgressRange_1();
  try {
    loftMaker.Build(progress);
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
    progress.delete?.();
    for (const w of builtWires) w.delete();
    loftMaker.delete();
  }
}
