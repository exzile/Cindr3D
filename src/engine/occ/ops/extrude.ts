/**
 * OCC-3.3 -- Sketch-based extrude.
 * Converts a SketchProfile (UV polygon) + plane frame into a solid via
 * BRepPrimAPI_MakePrism_1.
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import type { OccPlaneFrame } from '../plane';
import { type SketchProfile, sketchProfileToWires, sketchShapeToWires, takeOccOwnedResources, wireToFace } from './sketchToWire';

type OccExtrudeApi = OcctRaw & {
  BRepBuilderAPI_Transform_2: new (shape: unknown, trsf: unknown, copy: boolean) => { Shape(): unknown; delete(): void };
  BRepPrimAPI_MakePrism_1: new (shape: unknown, vector: unknown, copy: boolean, canonize: boolean) => { Build(): void; Shape(): unknown; delete(): void };
  BRepAlgoAPI_Fuse_3: new (a: unknown, b: unknown) => { SetNonDestructive?(v: boolean): void; Build(p?: unknown): void; IsDone?(): boolean; HasErrors?(): boolean; Shape(): unknown; delete(): void };
  BRepOffsetAPI_DraftAngle_1: new (shape: unknown) => { Add(face: unknown, dir: unknown, angle: number, plane: unknown): void; Build(progress: unknown): void; IsDone?(): boolean; HasErrors?(): boolean; Shape(): unknown; delete(): void };
  BRepAdaptor_Surface_2: new (face: unknown, restricted: boolean) => { FirstUParameter(): number; LastUParameter(): number; FirstVParameter(): number; LastVParameter(): number; Value(u: number, v: number): { X(): number; Y(): number; Z(): number; delete(): void }; delete(): void };
  Message_ProgressRange_1: new () => { delete?: () => void };
  gp_Dir_4: new (x: number, y: number, z: number) => { delete(): void };
  gp_Pnt_3: new (x: number, y: number, z: number) => { delete(): void };
  gp_Pln_3: new (origin: unknown, normal: unknown) => { delete(): void };
  gp_Trsf_1: new () => { SetTranslation_1(vector: unknown): void; delete(): void };
  gp_Vec_4: new (x: number, y: number, z: number) => { delete(): void };
  TopExp_Explorer_2: new (shape: unknown, toFind: unknown, avoid: unknown) => { More(): boolean; Current(): { delete(): void }; Next(): void; delete(): void };
  TopoDS: { Face_1(shape: unknown): unknown };
  TopAbs_ShapeEnum: { TopAbs_FACE: unknown; TopAbs_SHAPE: unknown };
};

export interface OccExtrudeOptions {
  id?: string;
  sourceFeatureId?: string;
  /**
   * OCC-15: original THREE.Shape for the profile. When present, arcs/circles are
   * built as ANALYTIC OCC edges (gp_Circ / arc) instead of the faceted ~96-point
   * polygon derived from `profile`. Falls back to the polygon path if the shape
   * contains a curve type we don't build analytically (ellipse, spline, bezier).
   */
  profileShape?: THREE.Shape;
  symmetric?: boolean;
  /** When set, also extrude in the opposite direction by this distance and union. */
  twoSideDist?: number;
  /** Draft/taper angle in degrees for the primary (side-1) extrusion. Positive = outward, negative = inward. */
  taperAngle?: number;
  /** Draft/taper angle in degrees for the secondary (side-2) extrusion when using two-sided extrude.
   *  Falls back to taperAngle when not specified. */
  taperAngle2?: number;
}

export interface OccExtrudedShape {
  shape: unknown;
  ownedResources: Array<{ delete?: () => void }>;
  dispose(): void;
}

export async function occExtrude(
  profile: SketchProfile,
  distance: number,
  frame: OccPlaneFrame,
  options: OccExtrudeOptions = {},
): Promise<BRepBody> {
  const { oc } = await getOcc();
  return occExtrudeWithInstance(oc, profile, distance, frame, options);
}

export function occExtrudeWithInstance(
  oc: OcctRaw,
  profile: SketchProfile,
  distance: number,
  frame: OccPlaneFrame,
  options: OccExtrudeOptions = {},
): BRepBody {
  const extruded = occExtrudeShapeWithInstance(oc, profile, distance, frame, options);
  let consumed = false;
  try {
    const body = makeBRepBodyFromOccShape(oc, extruded.shape, {
      id: options.id,
      sourceFeatureId: options.sourceFeatureId,
      ownedResources: extruded.ownedResources,
    });
    consumed = true;
    return body;
  } finally {
    if (!consumed) extruded.dispose();
  }
}

export function occExtrudeShapeWithInstance(
  oc: OcctRaw,
  profile: SketchProfile,
  distance: number,
  frame: OccPlaneFrame,
  options: OccExtrudeOptions = {},
): OccExtrudedShape {
  // OCC-15: prefer the analytic wire (true arc/circle edges) when the original
  // THREE.Shape is available and contains only buildable curve types; otherwise
  // fall back to the faceted point-loop polygon path.
  let wires: { outerWire: unknown; holeWires: unknown[] } | null = null;
  if (options.profileShape) {
    try {
      wires = sketchShapeToWires(oc, options.profileShape, frame);
    } catch (e) {
      console.warn('[occExtrude] analytic shape wire build threw; using faceted fallback:', e);
      wires = null;
    }
  }
  if (!wires) wires = sketchProfileToWires(oc, profile, frame);
  if (!wires) throw new Error('[occExtrude] failed to build wires from profile');

  const face = wireToFace(oc, wires.outerWire, wires.holeWires, frame);
  // takeOccOwnedResources already transfers polygonMaker (which owns outerWire) and
  // holeWire polygonMakers into profileResources. Do NOT push outerWire/holeWires
  // themselves -- they are wrapPointer VIEWs of their respective polygonMaker's
  // internal Wire(). Pushing them alongside their owning builders causes a
  // double-destroy (polygonMaker.delete() + wire.delete() -> same C++ memory freed twice).
  const profileResources = face ? takeOccOwnedResources(face) : [];

  if (!face) throw new Error('[occExtrude] failed to build face from wires');

  return occExtrudeFaceShapeWithInstance(oc, face, distance, frame, options, profileResources);
}

export function occExtrudeFaceShapeWithInstance(
  oc: OcctRaw,
  face: unknown,
  distance: number,
  frame: OccPlaneFrame,
  options: OccExtrudeOptions = {},
  profileResources: Array<{ delete?: () => void }> = [],
): OccExtrudedShape {
  const occ = oc as OccExtrudeApi;
  const ownedResources: Array<{ delete?: () => void }> = [];
  const dir = frame.normal.clone();
  let startFace = face;

  if (options.symmetric) {
    // Offset face by -distance/2 in normal direction first
    const halfBack = dir.clone().multiplyScalar(-distance / 2);
    const trsf = new occ.gp_Trsf_1();
    const offset = new occ.gp_Vec_4(halfBack.x, halfBack.y, halfBack.z);
    trsf.SetTranslation_1(offset);
    const mover = new occ.BRepBuilderAPI_Transform_2(face, trsf, true);
    startFace = mover.Shape();
    mover.delete();
    offset.delete();
    trsf.delete();
    (face as { delete?: () => void }).delete?.();
  }

  /** Apply BRepOffsetAPI_DraftAngle to a shape along `dir` with neutral plane at frame.origin. */
  function applyDraftAngle(shape: unknown, taperDeg: number, neutralOrigin: THREE.Vector3): unknown {
    if (Math.abs(taperDeg) <= 0.001) return shape;
    const taperRad = THREE.MathUtils.degToRad(taperDeg);
    const drafter = new occ.BRepOffsetAPI_DraftAngle_1(shape);
    const pullDir = new occ.gp_Dir_4(dir.x, dir.y, dir.z);
    const planePnt = new occ.gp_Pnt_3(neutralOrigin.x, neutralOrigin.y, neutralOrigin.z);
    const planeNrm = new occ.gp_Dir_4(dir.x, dir.y, dir.z);
    const neutralPlane = new occ.gp_Pln_3(planePnt, planeNrm);

    const allFaces: unknown[] = [];
    const lateralIndices: number[] = [];
    const explorer = new occ.TopExp_Explorer_2(
      shape,
      occ.TopAbs_ShapeEnum.TopAbs_FACE,
      occ.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (explorer.More()) {
      const s = explorer.Current();
      const rawFace = occ.TopoDS.Face_1(s);
      s.delete();
      let dotAbs = 1;
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
        const fnx = ay * bz - az * by, fny = az * bx - ax * bz, fnz = ax * by - ay * bx;
        const len = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz);
        p0.delete(); p1.delete(); p2.delete(); surf.delete();
        if (len > 1e-10) dotAbs = Math.abs((fnx * dir.x + fny * dir.y + fnz * dir.z) / len);
      } catch { /* assume not lateral */ }
      if (dotAbs < 0.5) lateralIndices.push(allFaces.length);
      allFaces.push(rawFace);
      explorer.Next();
    }
    explorer.delete();

    let addedAny = false;
    for (const idx of lateralIndices) {
      try { drafter.Add(allFaces[idx], pullDir, taperRad, neutralPlane); addedAny = true; } catch { /* skip face */ }
    }

    let resultShape = shape;
    if (addedAny) {
      const draftProg = new occ.Message_ProgressRange_1();
      try {
        drafter.Build(draftProg);
        if (drafter.IsDone?.() !== false && !drafter.HasErrors?.()) {
          resultShape = drafter.Shape();
        } else {
          console.warn('[occExtrude] DraftAngle Build failed -- using untapered shape');
        }
      } catch (e) {
        console.warn('[occExtrude] DraftAngle threw:', e);
      } finally {
        draftProg.delete?.();
      }
    }

    drafter.delete();
    for (const f of allFaces) (f as { delete(): void }).delete();
    neutralPlane.delete();
    planeNrm.delete();
    planePnt.delete();
    pullDir.delete();
    return resultShape;
  }

  const extDir = new oc.gp_Vec_4(
    dir.x * distance,
    dir.y * distance,
    dir.z * distance,
  );

  const prism = new occ.BRepPrimAPI_MakePrism_1(startFace, extDir, true, true);
  let resultShape: unknown;
  try {
    prism.Build();
    resultShape = prism.Shape();
  } catch (error) {
    prism.delete();
    throw error;
  } finally {
    extDir.delete();
  }
  ownedResources.push(prism);

  // Two-sided: extrude in the negative direction by twoSideDist and fuse.
  // When taperAngle2 differs from taperAngle, apply taper separately per-side before fusing
  // so each side uses its own draft angle.
  if (options.twoSideDist !== undefined && options.twoSideDist > 0 && !options.symmetric) {
    const negDir = new occ.gp_Vec_4(-dir.x * options.twoSideDist, -dir.y * options.twoSideDist, -dir.z * options.twoSideDist);
    const prism2 = new occ.BRepPrimAPI_MakePrism_1(startFace, negDir, true, true);
    let side2Shape: unknown;
    try {
      prism2.Build();
      side2Shape = prism2.Shape();
    } finally {
      prism2.delete();
      negDir.delete();
    }

    const ta1 = options.taperAngle ?? 0;
    const ta2 = options.taperAngle2 ?? ta1;
    const tapersDiffer = Math.abs(ta1 - ta2) > 0.001;

    if (tapersDiffer) {
      // Apply taper per-side before fusing; side-2 neutral plane is offset by -twoSideDist along normal
      const side2Origin = frame.origin.clone().addScaledVector(dir, -options.twoSideDist);
      resultShape = applyDraftAngle(resultShape, ta1, frame.origin);
      side2Shape = applyDraftAngle(side2Shape, ta2, side2Origin);
    }

    const fuse = new occ.BRepAlgoAPI_Fuse_3(resultShape, side2Shape);
    fuse.SetNonDestructive?.(true);
    fuse.Build();
    if (fuse.IsDone?.() !== false && !fuse.HasErrors?.()) {
      resultShape = fuse.Shape();
    }
    fuse.delete();
    // BRepAlgoAPI_Fuse takes shapes by reference (not ownership) -- delete side2Shape ourselves
    (side2Shape as { delete?: () => void }).delete?.();

    if (tapersDiffer) {
      // Taper already applied per-side; skip the unified pass below.
      // Defer face/resource cleanup -- see comment at end of function.
      // NOTE: do NOT push startFace separately. startFace = faceMaker.Face() which is a
      // wrapPointer VIEW of faceMaker's internal TopoDS_Face. faceMaker is already in
      // profileResources. Pushing startFace would double-destroy that memory at disposal.
      ownedResources.push(...profileResources);
      return {
        shape: resultShape,
        ownedResources,
        dispose() {
          try { (resultShape as { delete?: () => void }).delete?.(); } catch { /* already freed by makeBRepBodyFromOccShape error path */ }
          for (const resource of ownedResources) {
            try { resource.delete?.(); } catch { /* already freed */ }
          }
        },
      };
    }
  }

  // Single taper applied to the (possibly already fused) shape
  resultShape = applyDraftAngle(resultShape, options.taperAngle ?? 0, frame.origin);

  // Defer cleanup of profileResources instead of deleting them eagerly. In the
  // WASM build, BRepPrimAPI_MakePrism_1 may retain shallow references to the
  // face/wire builder data; freeing them immediately can corrupt the prism's
  // internal geometry and poison subsequent OCC operations.
  // NOTE: do NOT push startFace separately. In the non-symmetric case startFace
  // IS face = faceMaker.Face() -- a wrapPointer VIEW of faceMaker's internal
  // TopoDS_Face. faceMaker is already in profileResources. Double-pushing would
  // call ~TopoDS_Face() on faceMaker-owned memory twice -> WASM heap corruption.
  ownedResources.push(...profileResources);

  return {
    shape: resultShape,
    ownedResources,
    dispose() {
      try { (resultShape as { delete?: () => void }).delete?.(); } catch { /* already freed by makeBRepBodyFromOccShape error path */ }
      for (const resource of ownedResources) {
        try { resource.delete?.(); } catch { /* already freed */ }
      }
    },
  };
}

/** Convenience: extrude a simple rectangular profile (no holes). */
export function occExtrudeRect(
  oc: OcctRaw,
  width: number,
  height: number,
  distance: number,
  frame: OccPlaneFrame,
  options: OccExtrudeOptions = {},
): BRepBody {
  const hw = width / 2;
  const hh = height / 2;
  const profile: SketchProfile = {
    outer: [
      new THREE.Vector2(-hw, -hh),
      new THREE.Vector2( hw, -hh),
      new THREE.Vector2( hw,  hh),
      new THREE.Vector2(-hw,  hh),
    ],
    holes: [],
  };
  return occExtrudeWithInstance(oc, profile, distance, frame, options);
}
