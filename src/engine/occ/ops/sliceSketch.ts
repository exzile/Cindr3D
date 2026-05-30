import * as THREE from 'three';
import type { OcctRaw } from '../types';
import type { BRepBody } from '../brepBody';
import type { SketchEntity, SketchPoint } from '../../../types/cad/sketch';

type OccSliceApi = OcctRaw & {
  gp_Pnt_3: new (x: number, y: number, z: number) => { delete(): void };
  gp_Dir_4: new (x: number, y: number, z: number) => { delete(): void };
  gp_Ax3_2: new (origin: unknown, normal: unknown) => { delete(): void };
  gp_Pln_2: new (ax3: unknown) => { delete(): void };
  BRepBuilderAPI_MakeFace_1: new (plane: unknown, onlyPlane: boolean) => {
    Face(): { delete(): void };
    delete(): void;
  };
  BRepAlgoAPI_Section_3: new (shape1: unknown, shape2: unknown, performNow: boolean) => {
    ComputePCurveOn1(flag: boolean): void;
    Approximation(flag: boolean): void;
    Build(): void;
    IsDone(): boolean;
    Shape(): { delete?: () => void };
    delete(): void;
  };
  TopExp_Explorer_2: new (shape: unknown, toFind: unknown, toAvoid: unknown) => {
    More(): boolean;
    Current(): { delete(): void };
    Next(): void;
    delete(): void;
  };
  TopoDS: {
    Edge_1(shape: unknown): { delete?: () => void };
  };
  BRep_Tool: {
    Curve_2(
      edge: unknown,
      firstRef: { current: number },
      lastRef: { current: number },
    ): {
      Value(t: number): { X(): number; Y(): number; Z(): number; delete?(): void };
      delete?(): void;
    } | null;
  };
  TopAbs_ShapeEnum: { TopAbs_EDGE: unknown; TopAbs_SHAPE: unknown };
};

function makeId(): string {
  return crypto.randomUUID();
}

function makePoint(x: number, y: number, z: number): SketchPoint {
  return { id: makeId(), x, y, z };
}

/**
 * Slice a BRep body at the given sketch plane and return SketchEntity
 * line segments extracted from the section edges.
 *
 * Uses BRepAlgoAPI_Section to compute the intersection curve between the body
 * and a planar half-space, then walks each edge with BRep_Tool.Curve to
 * sample two endpoints (approximating to straight segments — exact NURBS
 * projection is a future enhancement).
 */
export function occSliceSketch(
  oc: OcctRaw,
  body: BRepBody,
  planeOrigin: THREE.Vector3,
  planeNormal: THREE.Vector3,
): SketchEntity[] {
  const occ = oc as OccSliceApi;
  const shape = body.shape?.deref?.();
  if (!shape) return [];

  let sectionMaker: InstanceType<OccSliceApi['BRepAlgoAPI_Section_3']> | null = null;
  let resultShape: { delete?: () => void } | null = null;
  let plane: { delete(): void } | null = null;
  let face: { delete(): void } | null = null;
  let pnt: { delete(): void } | null = null;
  let dir: { delete(): void } | null = null;
  let ax: { delete(): void } | null = null;
  let builder: { delete(): void } | null = null;
  const entities: SketchEntity[] = [];

  try {
    // Build an infinite plane as an OCC face.
    const o = planeOrigin;
    const n = planeNormal.clone().normalize();
    pnt     = new occ.gp_Pnt_3(o.x, o.y, o.z);
    dir     = new occ.gp_Dir_4(n.x, n.y, n.z);
    ax      = new occ.gp_Ax3_2(pnt, dir);
    plane   = new occ.gp_Pln_2(ax);
    builder = new occ.BRepBuilderAPI_MakeFace_1(plane, true);
    // builder.Face() is a VIEW owned by the builder — do NOT delete it separately.
    face = builder.Face();
    const faceShape = face;

    // Run section.
    sectionMaker = new occ.BRepAlgoAPI_Section_3(shape, faceShape, false);
    sectionMaker.ComputePCurveOn1(false);
    sectionMaker.Approximation(true);
    sectionMaker.Build();

    if (!sectionMaker.IsDone()) return [];

    resultShape = sectionMaker.Shape();

    // Walk edges in the section result.
    const edgeExp = new occ.TopExp_Explorer_2(
      resultShape,
      occ.TopAbs_ShapeEnum.TopAbs_EDGE,
      occ.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );

    while (edgeExp.More()) {
      // edgeShape is the OWNED explorer copy; edge is a TopoDS.Edge_1 VIEW of it
      // (same ptr). Free edgeShape in the finally (every continue path runs it);
      // never delete the VIEW. The old code freed neither → a per-edge heap leak.
      const edgeShape = edgeExp.Current();
      try {
        const edge = occ.TopoDS.Edge_1(edgeShape);

        // Sample the edge: get first and last point via BRep_Tool.Curve
        let curve: ReturnType<OccSliceApi['BRep_Tool']['Curve_2']> = null;
        let first = 0;
        let last = 0;
        try {
          // BRep_Tool.Curve returns (Geom_Curve, first, last) via output params
          const firstRef = { current: 0 };
          const lastRef  = { current: 0 };
          curve = occ.BRep_Tool.Curve_2(edge, firstRef, lastRef);
          first = firstRef.current;
          last  = lastRef.current;
        } catch {
          curve?.delete?.();
          continue;
        }

        if (!curve) continue;

        try {
          const p0 = curve.Value(first);
          const p1 = curve.Value(last);

          const x0 = p0.X(); const y0 = p0.Y(); const z0 = p0.Z();
          const x1 = p1.X(); const y1 = p1.Y(); const z1 = p1.Z();

          p0.delete?.();
          p1.delete?.();

          // Skip degenerate edges.
          const dx = x1 - x0; const dy = y1 - y0; const dz = z1 - z0;
          if (dx * dx + dy * dy + dz * dz < 1e-8) { curve.delete?.(); continue; }

          const entity: SketchEntity = {
            id: makeId(),
            type: 'line',
            points: [makePoint(x0, y0, z0), makePoint(x1, y1, z1)],
            isConstruction: false,
          };
          entities.push(entity);
        } catch {
          // Skip unsamplable edges.
        } finally {
          curve?.delete?.();
          curve = null;
        }
      } finally {
        edgeShape.delete?.();
        edgeExp.Next();
      }
    }

    edgeExp.delete?.();
  } catch {
    // Return whatever was collected.
  } finally {
    sectionMaker?.delete?.();
    resultShape?.delete?.();
    plane?.delete?.();
    face?.delete?.();
    builder?.delete?.();
    ax?.delete?.();
    dir?.delete?.();
    pnt?.delete?.();
  }

  return entities;
}
