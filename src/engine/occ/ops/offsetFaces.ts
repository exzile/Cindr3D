/**
 * OCC-10.7 — Offset faces (press-pull).
 * Moves each selected face along its surface normal by `distance`.
 * Positive distance adds material (fuse), negative removes (cut).
 * Uses BRepPrimAPI_MakePrism on the face as a prism tool, then
 * boolean-fuses or -cuts against the original body.
 */
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';

type OccOffsetFacesApi = OcctRaw & {
  BRepPrimAPI_MakePrism_1: new (shape: unknown, vec: unknown, copy: boolean, canonize: boolean) => {
    Build(): void;
    Shape(): unknown;
    delete(): void;
  };
  BRepAlgoAPI_Fuse_3: new (a: unknown, b: unknown) => {
    SetNonDestructive?(v: boolean): void;
    Build(progress?: unknown): void;
    IsDone?(): boolean;
    HasErrors?(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  BRepAlgoAPI_Cut_3: new (a: unknown, b: unknown) => {
    SetNonDestructive?(v: boolean): void;
    Build(progress?: unknown): void;
    IsDone?(): boolean;
    HasErrors?(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  Message_ProgressRange_1: new () => { delete?: () => void };
  gp_Vec_4: new (x: number, y: number, z: number) => { delete(): void };
  BRepAdaptor_Surface_2: new (face: unknown, restricted: boolean) => {
    FirstUParameter(): number;
    LastUParameter(): number;
    FirstVParameter(): number;
    LastVParameter(): number;
    Value(u: number, v: number): { X(): number; Y(): number; Z(): number; delete(): void };
    delete(): void;
  };
};

export interface OccOffsetFacesOptions {
  id?: string;
  sourceFeatureId?: string;
}

export async function occOffsetFaces(
  body: BRepBody,
  faceIds: number[],
  distance: number,
  options: OccOffsetFacesOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occOffsetFacesWithInstance(oc, body, faceIds, distance, options);
}

export function occOffsetFacesWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  faceIds: number[],
  distance: number,
  options: OccOffsetFacesOptions = {},
): BRepBody | null {
  if (faceIds.length === 0 || Math.abs(distance) < 1e-6) return null;

  const occ = oc as OccOffsetFacesApi;
  const rawBody = occDeref(oc, body.shape, oc.TopoDS_Shape);
  let accumulated: { delete?: () => void } | unknown = rawBody;
  let changed = false;

  try {
    for (const faceId of faceIds) {
      const handle = body.faceIds.get(faceId);
      if (!handle) continue;
      const rawFace = occDeref(oc, handle, oc.TopoDS_Face);
      let prismShape: { delete?: () => void } | null = null;

      try {
        const [nx, ny, nz] = sampleFaceNormal(occ, rawFace);

        const extVec = new occ.gp_Vec_4(
          nx * Math.abs(distance),
          ny * Math.abs(distance),
          nz * Math.abs(distance),
        );
        const prism = new occ.BRepPrimAPI_MakePrism_1(rawFace, extVec, true, true);
        try {
          prism.Build();
          prismShape = prism.Shape() as { delete?: () => void };
        } finally {
          prism.delete();
          extVec.delete();
        }

        const boolProgress = new occ.Message_ProgressRange_1();
        try {
          if (distance > 0) {
            const fuse = new occ.BRepAlgoAPI_Fuse_3(accumulated, prismShape);
            try {
              fuse.SetNonDestructive?.(true);
              fuse.Build(boolProgress);
              if (fuse.IsDone?.() !== false && !fuse.HasErrors?.()) {
                if (changed) (accumulated as { delete?: () => void }).delete?.();
                accumulated = fuse.Shape();
                changed = true;
              }
            } finally {
              fuse.delete();
            }
          } else {
            const cut = new occ.BRepAlgoAPI_Cut_3(accumulated, prismShape);
            try {
              cut.SetNonDestructive?.(true);
              cut.Build(boolProgress);
              if (cut.IsDone?.() !== false && !cut.HasErrors?.()) {
                if (changed) (accumulated as { delete?: () => void }).delete?.();
                accumulated = cut.Shape();
                changed = true;
              }
            } finally {
              cut.delete();
            }
          }
        } finally {
          boolProgress.delete?.();
          prismShape?.delete?.();
        }
      } finally {
        rawFace.delete?.();
      }
    }

    if (!changed) return null;
    return makeBRepBodyFromOccShape(oc, accumulated, options);
  } finally {
    if (!changed) {
      (accumulated as { delete?: () => void }).delete?.();
    }
    rawBody.delete?.();
  }
}

function sampleFaceNormal(occ: OccOffsetFacesApi, rawFace: unknown): [number, number, number] {
  try {
    const surf = new occ.BRepAdaptor_Surface_2(rawFace, true);
    const u0 = surf.FirstUParameter(), u1 = surf.LastUParameter();
    const v0 = surf.FirstVParameter(), v1 = surf.LastVParameter();
    const uC = (u0 + u1) / 2, vC = (v0 + v1) / 2;
    const du = (u1 - u0) * 0.01 || 1e-4;
    const dv = (v1 - v0) * 0.01 || 1e-4;
    const p0 = surf.Value(uC, vC);
    const p1 = surf.Value(uC + du, vC);
    const p2 = surf.Value(uC, vC + dv);
    const ax = p1.X() - p0.X(), ay = p1.Y() - p0.Y(), az = p1.Z() - p0.Z();
    const bx = p2.X() - p0.X(), by = p2.Y() - p0.Y(), bz = p2.Z() - p0.Z();
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    p0.delete(); p1.delete(); p2.delete();
    surf.delete();
    if (len > 1e-10) return [nx / len, ny / len, nz / len];
  } catch { /* fallback */ }
  return [0, 0, 1];
}
