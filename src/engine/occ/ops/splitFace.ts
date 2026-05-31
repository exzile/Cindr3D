/**
 * OCC-21.2 — Split Face via BRepFeat_SplitShape.
 *
 * Imprints one or more split curves onto a target face of a solid body,
 * subdividing the face without changing the body's volume or topology.
 *
 * The splitting tool is resolved to a wire/edge on the face:
 *   - 'plane'  → BRepAlgoAPI_Section(face, infinite-plane) → extract edges
 *   - 'sketch' → pass wire directly (caller supplies as OCC wire handle)
 *   - 'surface' → BRepAlgoAPI_Section(face, surfaceBody) → extract edges
 *
 * Build() is routed through runEdgeOpBuild for the 0-arg variance.
 * BRepFeat_SplitShape.Shape() is a VIEW — do NOT delete separately.
 */
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { runEdgeOpBuild } from './adjacency';

type OccSplitFaceApi = OcctRaw & {
  BRepFeat_SplitShape: new (shape: unknown) => {
    Add(wire: unknown, face: unknown): void;
    Build(progress?: unknown): void;
    IsDone(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  BRepAlgoAPI_Section: new (s1: unknown, s2: unknown) => {
    Build(progress?: unknown): void;
    IsDone(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  gp_Pln_3: new (origin: unknown, normal: unknown) => { delete(): void };
  gp_Pnt_3: new (x: number, y: number, z: number) => { delete(): void };
  gp_Dir_4: new (x: number, y: number, z: number) => { delete(): void };
  TopoDS: {
    Face_1(s: unknown): unknown;
    Edge_1(s: unknown): unknown;
    Wire_1?(s: unknown): unknown;
    Vertex_1?(s: unknown): unknown;
  };
  TopExp_Explorer_2: new (shape: unknown, find: unknown, avoid: unknown) => {
    More(): boolean;
    Current(): { delete(): void };
    Next(): void;
    delete(): void;
  };
  TopAbs_ShapeEnum: { TopAbs_EDGE: unknown; TopAbs_SHAPE: unknown };
  BRep_Builder: new () => {
    MakeWire(wire: unknown): void;
    Add(wire: unknown, edge: unknown): void;
    delete(): void;
  };
  TopoDS_Wire: new () => { delete(): void };
};

export interface SplitFaceOptions {
  id?: string;
  sourceFeatureId?: string;
}

/**
 * Build a section by cutting the target face with a plane through planeOrigin
 * with the given normal, then extract a wire of edges from the result.
 * Returns the section shape (VIEW from boolOp.Shape()) — do NOT delete.
 */
function buildSectionEdges(
  occ: OccSplitFaceApi,
  rawFace: unknown,
  planeOrigin: { x: number; y: number; z: number },
  planeNormal: { x: number; y: number; z: number },
  ownedResources: Array<{ delete(): void }>,
): unknown | null {
  const occOrigin = new occ.gp_Pnt_3(planeOrigin.x, planeOrigin.y, planeOrigin.z);
  const occNormal = new occ.gp_Dir_4(planeNormal.x, planeNormal.y, planeNormal.z);
  const occPlane = new occ.gp_Pln_3(occOrigin, occNormal);
  ownedResources.push(occOrigin, occNormal, occPlane);

  const sectionOp = new occ.BRepAlgoAPI_Section(rawFace, occPlane);
  ownedResources.push(sectionOp);
  try {
    runEdgeOpBuild(occ as unknown as OcctRaw, sectionOp);
    if (!sectionOp.IsDone()) return null;
    return sectionOp.Shape(); // VIEW
  } catch {
    return null;
  }
}

/**
 * Collect TopAbs_EDGE children from a shape into a wire.
 * Returns null if no edges found. Wire is owned (push to ownedResources).
 */
function edgesIntoWire(
  occ: OccSplitFaceApi,
  sectionShape: unknown,
  ownedResources: Array<{ delete(): void }>,
): unknown | null {
  const wire = new occ.TopoDS_Wire();
  const builder = new occ.BRep_Builder();
  ownedResources.push(wire, builder);
  builder.MakeWire(wire);

  const exp = new occ.TopExp_Explorer_2(
    sectionShape,
    occ.TopAbs_ShapeEnum.TopAbs_EDGE,
    occ.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  let edgeCount = 0;
  try {
    while (exp.More()) {
      const edge = exp.Current();
      try {
        builder.Add(wire, edge);
        edgeCount++;
      } finally {
        edge.delete(); // Current() returns owned copy
      }
      exp.Next();
    }
  } finally {
    exp.delete();
  }
  return edgeCount > 0 ? wire : null;
}

export async function occSplitFace(
  body: BRepBody,
  faceId: number,
  planeOrigin: { x: number; y: number; z: number },
  planeNormal: { x: number; y: number; z: number },
  options: SplitFaceOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occSplitFaceWithInstance(oc, body, faceId, planeOrigin, planeNormal, options);
}

export function occSplitFaceWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  faceId: number,
  planeOrigin: { x: number; y: number; z: number },
  planeNormal: { x: number; y: number; z: number },
  options: SplitFaceOptions = {},
): BRepBody | null {
  const handle = body.faceIds.get(faceId);
  if (!handle) return null;

  const occ = oc as OccSplitFaceApi;
  // rawShape is a VIEW from occDeref — do NOT delete.
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  // rawFace is a VIEW — do NOT delete.
  const rawFace = occ.TopoDS.Face_1(occDeref(oc, handle, oc.TopoDS_Shape));

  const ownedResources: Array<{ delete(): void }> = [];

  try {
    const sectionShape = buildSectionEdges(occ, rawFace, planeOrigin, planeNormal, ownedResources);
    if (!sectionShape) {
      console.warn('[occSplitFace] Section produced no shape');
      return null;
    }

    const wire = edgesIntoWire(occ, sectionShape, ownedResources);
    if (!wire) {
      console.warn('[occSplitFace] No edges in section result');
      return null;
    }

    const splitter = new occ.BRepFeat_SplitShape(rawShape);
    ownedResources.push(splitter);
    splitter.Add(wire, rawFace);
    runEdgeOpBuild(oc, splitter);

    if (!splitter.IsDone()) {
      console.warn('[occSplitFace] BRepFeat_SplitShape failed');
      return null;
    }

    const resultShape = splitter.Shape(); // VIEW — do NOT delete
    return makeBRepBodyFromOccShape(oc, resultShape, options);
  } catch (e) {
    console.warn('[occSplitFace] threw:', e);
    return null;
  } finally {
    for (const r of ownedResources) {
      try { r.delete(); } catch { /* ignore */ }
    }
    // NOTE: rawShape, rawFace are VIEWs from occDeref — do NOT delete.
  }
}
