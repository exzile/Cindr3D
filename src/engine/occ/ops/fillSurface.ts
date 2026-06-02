/**
 * OCC surface fill: builds a BRep face from a closed boundary loop of 3D points.
 *
 * Strategy (in order):
 *  1. BRepBuilderAPI_MakeFace from a planar wire  — works when the loop is coplanar.
 *  2. BRepOffsetAPI_MakeFilling with G0 constraints — handles mildly non-planar loops.
 *  Both require TKGeomAlgo (loaded by the default LIBS list in loader.ts).
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';

type OccFillApi = OcctRaw & {
  gp_Pnt_3: new (x: number, y: number, z: number) => { delete(): void };
  BRepBuilderAPI_MakeEdge_7: new (p1: unknown, p2: unknown) => {
    Edge(): unknown;
    IsDone(): boolean;
    delete(): void;
  };
  BRepBuilderAPI_MakeWire_1: new () => {
    Add_2(edge: unknown): void;
    Wire(): unknown;
    IsDone(): boolean;
    delete(): void;
  };
  BRepBuilderAPI_MakeFace_18: new (wire: unknown, onlyPlane: boolean) => {
    Face(): unknown;
    IsDone(): boolean;
    delete(): void;
  };
  BRepOffsetAPI_MakeFilling_1: new () => {
    Add_2(edge: unknown, order: unknown, isOnBoundary: boolean): void;
    Build(progress?: unknown): void;
    IsDone(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  GeomAbs_Shape: { GeomAbs_C0: unknown; GeomAbs_G1: unknown; GeomAbs_G2: unknown };
  Message_ProgressRange_1: new () => { delete?: () => void };
};

export type FillContinuity = 'G0' | 'G1' | 'G2';

export interface OccFillEdge {
  /** Pre-built OCC TopoDS_Edge (VIEW — do not delete). Pass when the edge comes
   *  from an existing OCC BRep surface so MakeFilling can apply G1/G2 tangency. */
  occEdge?: unknown;
  continuity?: FillContinuity;
}

export interface OccFillOptions {
  id?: string;
  sourceFeatureId?: string;
  /** Optional per-boundary-edge OCC handles + continuity for G1/G2 constraints.
   *  When supplied and edge.occEdge is set, MakeFilling uses it instead of the
   *  linear edge built from the boundary point loop. */
  edgeConstraints?: OccFillEdge[];
}

export async function occFillSurface(
  points: THREE.Vector3[],
  options: OccFillOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occFillSurfaceWithInstance(oc, points, options);
}

export function occFillSurfaceWithInstance(
  oc: OcctRaw,
  points: THREE.Vector3[],
  options: OccFillOptions = {},
): BRepBody | null {
  if (points.length < 3) return null;
  const occ = oc as OccFillApi;

  // Ensure loop is closed (last point == first point for MakeWire)
  const loop = [...points];
  const first = loop[0];
  const last = loop[loop.length - 1];
  if (first.distanceTo(last) > 1e-6) loop.push(first.clone());

  // ── Build OCC edges from consecutive point pairs ────────────────────────────
  const occPts: Array<{ delete(): void }> = [];
  const edges: Array<{ delete(): void }> = [];
  const edgeShapes: unknown[] = [];

  try {
    for (const pt of loop) {
      occPts.push(new occ.gp_Pnt_3(pt.x, pt.y, pt.z));
    }

    for (let i = 0; i < loop.length - 1; i++) {
      const edgeMaker = new occ.BRepBuilderAPI_MakeEdge_7(occPts[i], occPts[i + 1]);
      const done = edgeMaker.IsDone();
      const edge = done ? edgeMaker.Edge() : null;
      edgeMaker.delete();
      if (!edge) return null;
      edges.push(edge as { delete(): void });
      edgeShapes.push(edge);
    }

    // ── Strategy 1: MakeFace from planar wire ───────────────────────────────
    const wireMaker = new occ.BRepBuilderAPI_MakeWire_1();
    for (const e of edgeShapes) {
      wireMaker.Add_2(e);
    }
    const wireOk = wireMaker.IsDone();
    const wire = wireOk ? wireMaker.Wire() : null;
    wireMaker.delete();

    if (wire) {
      try {
        const faceMaker = new occ.BRepBuilderAPI_MakeFace_18(wire, true);
        if (faceMaker.IsDone()) {
          const face = faceMaker.Face();
          faceMaker.delete();
          return makeBRepBodyFromOccShape(oc, face, {
            id: options.id,
            sourceFeatureId: options.sourceFeatureId,
          });
        }
        faceMaker.delete();
      } catch {
        // Non-planar — fall through to MakeFilling
      }

      // ── Strategy 2: BRepOffsetAPI_MakeFilling with continuity constraints ──
      // When OCC edge references are provided (edgeConstraints with occEdge set),
      // use them directly so G1/G2 tangency to adjacent faces is solved correctly.
      // Otherwise fall back to the linear edges built from boundary points (G0 only).
      try {
        const filling = new occ.BRepOffsetAPI_MakeFilling_1();
        const c0 = occ.GeomAbs_Shape?.GeomAbs_C0;
        const c1 = occ.GeomAbs_Shape?.GeomAbs_G1;
        const c2 = occ.GeomAbs_Shape?.GeomAbs_G2;
        if (c0 === undefined) { filling.delete(); throw new Error('GeomAbs_Shape not available'); }

        const constraints = options.edgeConstraints;
        for (let i = 0; i < edgeShapes.length; i++) {
          const constraint = constraints?.[i];
          const orderVal = constraint?.continuity === 'G2' ? c2 :
                           constraint?.continuity === 'G1' ? c1 : c0;
          const edgeToAdd = constraint?.occEdge ?? edgeShapes[i];
          try {
            filling.Add_2(edgeToAdd, orderVal ?? c0, true);
          } catch {
            filling.Add_2(edgeShapes[i], c0, true); // fallback to G0 with built edge
          }
        }
        const pr = new occ.Message_ProgressRange_1();
        filling.Build(pr);
        pr.delete?.();
        if (filling.IsDone()) {
          const filledShape = filling.Shape();
          filling.delete();
          return makeBRepBodyFromOccShape(oc, filledShape, {
            id: options.id,
            sourceFeatureId: options.sourceFeatureId,
          });
        }
        filling.delete();
      } catch {
        // MakeFilling unavailable or failed — return null so caller uses THREE fallback
      }
    }
  } finally {
    for (const e of edges) { try { (e as { delete?: () => void }).delete?.(); } catch { /* ok */ } }
    for (const p of occPts) { try { (p as { delete?: () => void }).delete?.(); } catch { /* ok */ } }
  }

  return null;
}
