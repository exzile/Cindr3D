import * as THREE from 'three';
import type { BRepBody } from '../brepBody';
import type { SketchEntity, SketchPoint } from '../../../types/cad/sketch';

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function occSliceSketch(
  oc: any,
  body: BRepBody,
  planeOrigin: THREE.Vector3,
  planeNormal: THREE.Vector3,
): SketchEntity[] {
  const shape = body.shape?.deref?.();
  if (!shape) return [];

  let sectionMaker: any = null;
  let resultShape: any = null;
  let plane: any = null;
  let face: any = null;
  let faceShape: any = null;
  let pnt: any = null;
  let dir: any = null;
  let ax: any = null;
  let builder: any = null;
  const entities: SketchEntity[] = [];

  try {
    // Build an infinite plane as an OCC face.
    const o = planeOrigin;
    const n = planeNormal.clone().normalize();
    pnt     = new oc.gp_Pnt_3(o.x, o.y, o.z);
    dir     = new oc.gp_Dir_4(n.x, n.y, n.z);
    ax      = new oc.gp_Ax3_2(pnt, dir);
    plane   = new oc.gp_Pln_2(ax);
    builder = new oc.BRepBuilderAPI_MakeFace_1(plane, true);
    face = builder.Face();
    faceShape = face;

    // Run section.
    sectionMaker = new oc.BRepAlgoAPI_Section_3(shape, faceShape, false);
    sectionMaker.ComputePCurveOn1(false);
    sectionMaker.Approximation(true);
    sectionMaker.Build();

    if (!sectionMaker.IsDone()) return [];

    resultShape = sectionMaker.Shape();

    // Walk edges in the section result.
    const edgeExp = new oc.TopExp_Explorer_2(
      resultShape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );

    while (edgeExp.More()) {
      const edgeShape = edgeExp.Current();
      const edge = oc.TopoDS.Edge_1(edgeShape);

      // Sample the edge: get first and last point via BRep_Tool.Curve
      let curve: any = null;
      let first = 0;
      let last = 0;
      try {
        // BRep_Tool.Curve returns (Geom_Curve, first, last) via output params
        const firstRef = { current: 0 };
        const lastRef  = { current: 0 };
        curve = oc.BRep_Tool.Curve_2(edge, firstRef, lastRef);
        first = firstRef.current;
        last  = lastRef.current;
      } catch {
        curve?.delete?.();
        edgeExp.Next();
        continue;
      }

      if (!curve) { edgeExp.Next(); continue; }

      try {
        const p0 = curve.Value(first);
        const p1 = curve.Value(last);

        const x0 = p0.X(); const y0 = p0.Y(); const z0 = p0.Z();
        const x1 = p1.X(); const y1 = p1.Y(); const z1 = p1.Z();

        p0.delete?.();
        p1.delete?.();

        // Skip degenerate edges.
        const dx = x1 - x0; const dy = y1 - y0; const dz = z1 - z0;
        if (dx * dx + dy * dy + dz * dz < 1e-8) { curve.delete?.(); edgeExp.Next(); continue; }

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

      edgeExp.Next();
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
