/**
 * OCC-3.4 — Sketch-based revolve.
 * Converts a SketchProfile + plane frame into a solid via
 * BRepPrimAPI_MakeRevol_2 around a world-space axis.
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import type { OccPlaneFrame } from '../plane';
import { type SketchProfile, sketchProfileToWires, wireToFace } from './sketchToWire';

type OccRevolveApi = OcctRaw & {
  BRepPrimAPI_MakeRevol_2: new (shape: unknown, axis: unknown, angle: number, copy: boolean) => { Build(progress: unknown): void; Shape(): unknown; delete(): void };
  BRepAlgoAPI_Fuse_3: new (a: unknown, b: unknown) => { SetNonDestructive?(v: boolean): void; Build(p?: unknown): void; IsDone?(): boolean; HasErrors?(): boolean; Shape(): unknown; delete(): void };
  Message_ProgressRange_1: new () => { delete?: () => void };
};

export interface OccRevolveOptions {
  id?: string;
  sourceFeatureId?: string;
  /** When set, also revolve in the opposite direction by this angle and union. */
  side2AngleRad?: number;
}

export async function occRevolve(
  profile: SketchProfile,
  axis: { origin: THREE.Vector3; direction: THREE.Vector3 },
  angleRad: number,
  frame: OccPlaneFrame,
  options: OccRevolveOptions = {},
): Promise<BRepBody> {
  const { oc } = await getOcc();
  return occRevolveWithInstance(oc, profile, axis, angleRad, frame, options);
}

export function occRevolveWithInstance(
  oc: OcctRaw,
  profile: SketchProfile,
  axis: { origin: THREE.Vector3; direction: THREE.Vector3 },
  angleRad: number,
  frame: OccPlaneFrame,
  options: OccRevolveOptions = {},
): BRepBody {
  const occ = oc as OccRevolveApi;
  const wires = sketchProfileToWires(oc, profile, frame);
  if (!wires) throw new Error('[occRevolve] failed to build wires from profile');

  const face = wireToFace(oc, wires.outerWire, wires.holeWires);
  wires.outerWire.delete();
  for (const hw of wires.holeWires) hw.delete();
  if (!face) throw new Error('[occRevolve] failed to build face from wires');

  const { origin, direction } = axis;
  const dir = direction.clone().normalize();

  const occOrigin = new oc.gp_Pnt_3(origin.x, origin.y, origin.z);
  const occDir = new oc.gp_Dir_4(dir.x, dir.y, dir.z);
  const occAxis = new oc.gp_Ax1_2(occOrigin, occDir);

  const clampedAngle = THREE.MathUtils.clamp(angleRad, -Math.PI * 2, Math.PI * 2);

  const revol = new occ.BRepPrimAPI_MakeRevol_2(face, occAxis, clampedAngle, true);
  const progress = new occ.Message_ProgressRange_1();
  let resultShape: unknown;
  try {
    revol.Build(progress);
    resultShape = revol.Shape();
  } finally {
    progress.delete?.();
    revol.delete();
  }

  // Two-sided: also revolve in the negative direction and fuse
  if (options.side2AngleRad !== undefined && Math.abs(options.side2AngleRad) > 1e-6) {
    const clampedAngle2 = THREE.MathUtils.clamp(Math.abs(options.side2AngleRad), 0, Math.PI * 2);
    const revol2 = new occ.BRepPrimAPI_MakeRevol_2(face, occAxis, -clampedAngle2, true);
    const progress2 = new occ.Message_ProgressRange_1();
    let side2Shape: unknown;
    try {
      revol2.Build(progress2);
      side2Shape = revol2.Shape();
    } finally {
      progress2.delete?.();
      revol2.delete();
    }
    const fuse = new occ.BRepAlgoAPI_Fuse_3(resultShape, side2Shape);
    fuse.SetNonDestructive?.(true);
    fuse.Build();
    if (fuse.IsDone?.() !== false && !fuse.HasErrors?.()) {
      resultShape = fuse.Shape();
    }
    fuse.delete();
    // BRepAlgoAPI_Fuse takes shapes by reference (not ownership) — delete side2Shape ourselves
    (side2Shape as { delete?: () => void }).delete?.();
  }

  occAxis.delete();
  occDir.delete();
  occOrigin.delete();
  face.delete();

  return makeBRepBodyFromOccShape(oc, resultShape, {
    id: options.id,
    sourceFeatureId: options.sourceFeatureId,
  });
}
