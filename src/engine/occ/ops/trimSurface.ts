/**
 * OCC surface trim: cuts a source BRep surface with a trimmer surface/body
 * and returns the desired half.
 *
 * Uses BRepAlgoAPI_Section to find intersection edges, then
 * BRepFeat_SplitShape to split the source along those edges.
 * The desired half is determined by comparing the centroid of each
 * resulting piece against the trimmer's oriented bounding box centre.
 *
 * Falls back gracefully (returns null) when the two shapes don't intersect
 * or when OCC fails, so the caller can use the THREE mesh fallback.
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { runEdgeOpBuild } from './adjacency';

type OccTrimApi = OcctRaw & {
  BRepAlgoAPI_Section_3: new (s1: unknown, s2: unknown, performNow: boolean) => {
    ComputePCurveOn1(b: boolean): void;
    Build(progress?: unknown): void;
    IsDone(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  BRepFeat_SplitShape: new (shape: unknown) => {
    Add(wire: unknown, face: unknown): void;
    Build(progress?: unknown): void;
    IsDone(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  BRep_Builder: new () => {
    MakeShell?(shell: unknown): void;
    MakeWire(wire: unknown): void;
    Add(container: unknown, shape: unknown): void;
    delete(): void;
  };
  TopoDS_Wire: new () => { delete(): void };
  TopoDS_Compound: new () => { delete(): void };
  TopExp_Explorer_2: new (shape: unknown, find: unknown, avoid: unknown) => {
    More(): boolean;
    Current(): { delete(): void };
    Next(): void;
    delete(): void;
  };
  TopAbs_ShapeEnum: {
    TopAbs_EDGE: unknown;
    TopAbs_FACE: unknown;
    TopAbs_SHELL: unknown;
    TopAbs_SHAPE: unknown;
  };
  TopoDS: {
    Face_1(s: unknown): unknown;
    Edge_1(s: unknown): unknown;
  };
  GProp_GProps: new () => { Mass(): number; CentreOfMass(): { X(): number; Y(): number; Z(): number; delete(): void }; delete(): void };
  BRepGProp: { SurfaceProperties(shape: unknown, props: unknown): void };
  Bnd_Box: new () => {
    SetGap(g: number): void;
    IsVoid(): boolean;
    CornerMin(): { X(): number; Y(): number; Z(): number; delete(): void };
    CornerMax(): { X(): number; Y(): number; Z(): number; delete(): void };
    delete(): void;
  };
  BRepBndLib: { Add(shape: unknown, box: unknown): void };
  Message_ProgressRange_1: new () => { delete?: () => void };
};

export interface OccTrimSurfaceOptions {
  id?: string;
  sourceFeatureId?: string;
}

export async function occTrimSurface(
  sourceBody: BRepBody,
  trimmerBody: BRepBody,
  keepSide: 'inside' | 'outside',
  options: OccTrimSurfaceOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occTrimSurfaceWithInstance(oc, sourceBody, trimmerBody, keepSide, options);
}

export function occTrimSurfaceWithInstance(
  oc: OcctRaw,
  sourceBody: BRepBody,
  trimmerBody: BRepBody,
  keepSide: 'inside' | 'outside',
  options: OccTrimSurfaceOptions = {},
): BRepBody | null {
  const occ = oc as OccTrimApi;
  const ownedResources: Array<{ delete(): void }> = [];

  try {
    const srcShape = occDeref(oc, sourceBody.shape, oc.TopoDS_Shape);
    const trimShape = occDeref(oc, trimmerBody.shape, oc.TopoDS_Shape);

    // ── Step 1: Section — find intersection between source and trimmer ────────
    const sectionMaker = new occ.BRepAlgoAPI_Section_3(srcShape, trimShape, false);
    ownedResources.push(sectionMaker);
    try { sectionMaker.ComputePCurveOn1?.(true); } catch { /* optional */ }
    const pr = new occ.Message_ProgressRange_1();
    try {
      sectionMaker.Build(pr);
    } finally {
      pr.delete?.();
    }
    if (!sectionMaker.IsDone()) return null;
    const sectionShape = sectionMaker.Shape(); // VIEW — do not delete

    // ── Step 2: Collect intersection edges into a wire ────────────────────────
    const wire = new occ.TopoDS_Wire();
    ownedResources.push(wire);
    const builder = new occ.BRep_Builder();
    ownedResources.push(builder);
    builder.MakeWire(wire);
    let edgeCount = 0;
    const edgeExp = new occ.TopExp_Explorer_2(
      sectionShape,
      occ.TopAbs_ShapeEnum.TopAbs_EDGE,
      occ.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    try {
      while (edgeExp.More()) {
        const edge = edgeExp.Current();
        try {
          builder.Add(wire, edge);
          edgeCount++;
        } finally {
          edge.delete();
        }
        edgeExp.Next();
      }
    } finally {
      edgeExp.delete();
    }
    if (edgeCount === 0) return null; // no intersection

    // ── Step 3: Find the first face of the source to split ───────────────────
    // BRepFeat_SplitShape.Add() needs (wire, face). For simple surfaces
    // (single face or few faces), we try each source face.
    const srcFaces: unknown[] = [];
    const faceExp = new occ.TopExp_Explorer_2(
      srcShape,
      occ.TopAbs_ShapeEnum.TopAbs_FACE,
      occ.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    try {
      while (faceExp.More()) {
        const f = faceExp.Current();
        srcFaces.push(occ.TopoDS.Face_1(f)); // VIEW
        f.delete();
        faceExp.Next();
      }
    } finally {
      faceExp.delete();
    }
    if (srcFaces.length === 0) return null;

    // ── Step 4: Split source shape along the section wire ────────────────────
    const splitter = new occ.BRepFeat_SplitShape(srcShape);
    ownedResources.push(splitter);
    // Add wire to each source face (wire may only intersect some faces, but
    // BRepFeat handles the no-op case safely).
    for (const face of srcFaces) {
      try { splitter.Add(wire, face); } catch { /* face may not be intersected */ }
    }
    runEdgeOpBuild(oc, splitter);
    if (!splitter.IsDone()) return null;

    const splitShape = splitter.Shape(); // VIEW

    // ── Step 5: Compute the trimmer's centre for side classification ──────────
    // Use the bounding box centroid of the trimmer as the "inside" reference.
    const trimmerCentre = new THREE.Vector3();
    try {
      const bndBox = new occ.Bnd_Box();
      bndBox.SetGap(0);
      occ.BRepBndLib?.Add(trimShape, bndBox);
      if (!bndBox.IsVoid()) {
        const cMin = bndBox.CornerMin();
        const cMax = bndBox.CornerMax();
        trimmerCentre.set(
          (cMin.X() + cMax.X()) / 2,
          (cMin.Y() + cMax.Y()) / 2,
          (cMin.Z() + cMax.Z()) / 2,
        );
        cMin.delete(); cMax.delete();
      }
      bndBox.delete();
    } catch { /* BRepBndLib may not be available */ }

    // ── Step 6: Collect result shells/faces, classify by side ─────────────────
    // Gather all faces of the split result and group them into two halves
    // by testing their centroid against the trimmer centre.
    interface FacePiece { face: unknown; centroid: THREE.Vector3 }
    const pieces: FacePiece[] = [];

    const resultExp = new occ.TopExp_Explorer_2(
      splitShape,
      occ.TopAbs_ShapeEnum.TopAbs_FACE,
      occ.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    try {
      while (resultExp.More()) {
        const rawFace = resultExp.Current(); // owned
        const face = occ.TopoDS.Face_1(rawFace); // VIEW
        let cx = 0, cy = 0, cz = 0;
        try {
          const props = new occ.GProp_GProps();
          occ.BRepGProp?.SurfaceProperties(face, props);
          const c = props.CentreOfMass();
          cx = c.X(); cy = c.Y(); cz = c.Z();
          c.delete();
          props.delete();
        } catch { /* use origin as fallback */ }
        pieces.push({ face, centroid: new THREE.Vector3(cx, cy, cz) });
        rawFace.delete();
        resultExp.Next();
      }
    } finally {
      resultExp.delete();
    }

    if (pieces.length === 0) return null;

    // Classify each face: inside = closer to trimmer centre; outside = farther.
    // Sort distances and split at the true midpoint so that for the common two-piece
    // case exactly one face is kept per side.
    const dists = pieces.map((p) => p.centroid.distanceTo(trimmerCentre));
    const sorted = dists.slice().sort((a, b) => a - b);
    const midpoint = (sorted[0] + sorted[sorted.length - 1]) / 2;
    const keptFaces = pieces.filter((_, i) =>
      keepSide === 'inside' ? dists[i] <= midpoint : dists[i] > midpoint,
    );
    if (keptFaces.length === 0) return null;

    // ── Step 7: Sew kept faces into a shell → BRepBody ───────────────────────
    const compound = new occ.TopoDS_Compound();
    // Do NOT push compound into ownedResources — makeBRepBodyFromOccShape transfers
    // ownership of the shape, so the finally-block delete would cause a double-free.
    const cBuilder = new occ.BRep_Builder();
    ownedResources.push(cBuilder);
    // Use MakeCompound if available (more portable than MakeShell for open surfaces)
    try {
      (cBuilder as unknown as { MakeCompound(c: unknown): void }).MakeCompound(compound);
    } catch {
      try { compound.delete(); } catch { /* ok */ }
      return null;
    }
    for (const p of keptFaces) {
      try { cBuilder.Add(compound, p.face); } catch { /* skip */ }
    }

    return makeBRepBodyFromOccShape(oc, compound, {
      id: options.id,
      sourceFeatureId: options.sourceFeatureId,
    });
  } catch (err) {
    console.warn('[occTrimSurface] failed:', err);
    return null;
  } finally {
    for (const r of ownedResources) { try { r.delete?.(); } catch { /* ok */ } }
  }
}
