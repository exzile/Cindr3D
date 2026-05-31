/**
 * OCC-10.5 / OCC-10.6 — Rectangular and circular patterns.
 * Each copy is produced via BRepBuilderAPI_Transform (translation or rotation).
 * All copies are fused into a single compound solid via BRepAlgoAPI_Fuse.
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { runEdgeOpBuild } from './adjacency';

type OccPatternApi = OcctRaw & {
  BRepBuilderAPI_Transform_2: new (shape: unknown, trsf: unknown, copy: boolean) => { Shape(): unknown; delete(): void };
  BRepAlgoAPI_Fuse_3: new (shape1: unknown, shape2: unknown) => {
    SetNonDestructive?(v: boolean): void;
    Build(progress?: unknown): void;
    IsDone?(): boolean;
    HasErrors?(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  Message_ProgressRange_1: new () => { delete?: () => void };
  gp_Trsf_1: new () => {
    SetTranslation_1(vec: unknown): void;
    SetRotation(axis: unknown, angle: number): void;
    delete(): void;
  };
  gp_Vec_4: new (x: number, y: number, z: number) => { delete(): void };
  gp_Ax1_2: new (origin: unknown, dir: unknown) => { delete(): void };
  gp_Pnt_3: new (x: number, y: number, z: number) => { delete(): void };
  gp_Dir_4: new (x: number, y: number, z: number) => { delete(): void };
};

export interface OccRectangularPatternOptions {
  id?: string;
  sourceFeatureId?: string;
}

export interface OccCircularPatternOptions {
  id?: string;
  sourceFeatureId?: string;
}

// ── Rectangular pattern ───────────────────────────────────────────────────────

export async function occRectangularPattern(
  body: BRepBody,
  countX: number,
  spacingX: number,
  countY: number,
  spacingY: number,
  dirX: THREE.Vector3,
  dirY: THREE.Vector3,
  options: OccRectangularPatternOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occRectangularPatternWithInstance(oc, body, countX, spacingX, countY, spacingY, dirX, dirY, options);
}

export function occRectangularPatternWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  countX: number,
  spacingX: number,
  countY: number,
  spacingY: number,
  dirX: THREE.Vector3,
  dirY: THREE.Vector3,
  options: OccRectangularPatternOptions = {},
): BRepBody | null {
  if (countX < 1 || countY < 1) return null;
  if (countX === 1 && countY === 1) return body;

  const occ = oc as OccPatternApi;
  const nx = dirX.clone().normalize();
  const ny = dirY.clone().normalize();
  const rawOriginal = occDeref(oc, body.shape, oc.TopoDS_Shape);

  const copies: unknown[] = [];
  let copiesTransferred = false;

  try {
    for (let i = 0; i < countX; i++) {
      for (let j = 0; j < countY; j++) {
        if (i === 0 && j === 0) {
          copies.push(rawOriginal);
          continue;
        }
        const dx = nx.x * i * spacingX + ny.x * j * spacingY;
        const dy = nx.y * i * spacingX + ny.y * j * spacingY;
        const dz = nx.z * i * spacingX + ny.z * j * spacingY;

        const vec = new occ.gp_Vec_4(dx, dy, dz);
        const trsf = new occ.gp_Trsf_1();
        let transformer: InstanceType<OccPatternApi['BRepBuilderAPI_Transform_2']> | null = null;
        try {
          trsf.SetTranslation_1(vec);
          transformer = new occ.BRepBuilderAPI_Transform_2(rawOriginal, trsf, true);
          copies.push(transformer.Shape());
        } finally {
          transformer?.delete();
          trsf.delete();
          vec.delete();
        }
      }
    }
    copiesTransferred = true;
    return fuseShapes(occ, oc, copies, options);
  } finally {
    if (!copiesTransferred) {
      for (const shape of copies) releaseOccShape(shape);
    }
  }
}

// ── Circular pattern ──────────────────────────────────────────────────────────

export async function occCircularPattern(
  body: BRepBody,
  axis: { origin: THREE.Vector3; direction: THREE.Vector3 },
  count: number,
  totalAngleRad: number,
  options: OccCircularPatternOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occCircularPatternWithInstance(oc, body, axis, count, totalAngleRad, options);
}

export function occCircularPatternWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  axis: { origin: THREE.Vector3; direction: THREE.Vector3 },
  count: number,
  totalAngleRad: number,
  options: OccCircularPatternOptions = {},
): BRepBody | null {
  if (count < 1) return null;
  if (count === 1) return body;

  const occ = oc as OccPatternApi;
  const rawOriginal = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const deltaAngle = totalAngleRad / count;

  const occOrigin = new occ.gp_Pnt_3(axis.origin.x, axis.origin.y, axis.origin.z);
  const d = axis.direction.clone().normalize();
  const occDir = new occ.gp_Dir_4(d.x, d.y, d.z);
  const occAxis = new occ.gp_Ax1_2(occOrigin, occDir);

  const copies: unknown[] = [];
  let copiesTransferred = false;

  try {
    for (let i = 0; i < count; i++) {
      if (i === 0) {
        copies.push(rawOriginal);
        continue;
      }
      const trsf = new occ.gp_Trsf_1();
      let transformer: InstanceType<OccPatternApi['BRepBuilderAPI_Transform_2']> | null = null;
      try {
        trsf.SetRotation(occAxis, i * deltaAngle);
        transformer = new occ.BRepBuilderAPI_Transform_2(rawOriginal, trsf, true);
        copies.push(transformer.Shape());
      } finally {
        transformer?.delete();
        trsf.delete();
      }
    }
    copiesTransferred = true;
    return fuseShapes(occ, oc, copies, options);
  } finally {
    if (!copiesTransferred) {
      for (const shape of copies) releaseOccShape(shape);
    }
    occAxis.delete();
    occDir.delete();
    occOrigin.delete();
  }
}

// ── Shared fuse helper ────────────────────────────────────────────────────────

function fuseShapes(
  occ: OccPatternApi,
  oc: OcctRaw,
  shapes: unknown[],
  options: { id?: string; sourceFeatureId?: string },
): BRepBody | null {
  if (shapes.length === 0) return null;
  if (shapes.length === 1) {
    return makeBRepBodyFromOccShape(oc, shapes[0], options);
  }

  const liveShapes = new Set(shapes);
  let accumulated = shapes[0];
  try {
  for (let k = 1; k < shapes.length; k++) {
    const fuse = new occ.BRepAlgoAPI_Fuse_3(accumulated, shapes[k]);
    fuse.SetNonDestructive?.(true);
    try {
      runEdgeOpBuild(oc, fuse);
      if (fuse.IsDone?.() === false || fuse.HasErrors?.()) {
        console.warn(`[occPattern] fuse step ${k} failed — using compound`);
        liveShapes.delete(shapes[k]);
        releaseOccShape(shapes[k]);
        continue;
      }
      const previous = accumulated;
      const next = fuse.Shape();
      accumulated = next;
      liveShapes.add(next);
      liveShapes.delete(previous);
      releaseOccShape(previous);
      liveShapes.delete(shapes[k]);
      releaseOccShape(shapes[k]);
    } finally {
      fuse.delete();
    }
  }

  liveShapes.delete(accumulated);
  return makeBRepBodyFromOccShape(oc, accumulated, options);
  } finally {
    for (const shape of liveShapes) releaseOccShape(shape);
  }
}

function releaseOccShape(shape: unknown): void {
  (shape as { delete?: () => void } | null | undefined)?.delete?.();
}
