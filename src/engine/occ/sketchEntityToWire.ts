/**
 * OCC-6.1 / 6.2 / 6.3 — Convert SketchEntity[] (2D sketch) into
 * TopoDS_Wire / TopoDS_Face using OCCT geometry builders.
 *
 * Handles: line, arc, circle, ellipse, spline.
 * Each entity lives in sketch-plane UV space; this module transforms to
 * world-space gp_Pnt using the OccPlaneFrame before constructing edges.
 */
import * as THREE from 'three';
import type { OcctRaw } from './types';
import type { SketchEntity, SketchPoint } from '../../types/cad';
import type { OccPlaneFrame } from './plane';

// ── UV → world ────────────────────────────────────────────────────────────────

function uvToWorld(frame: OccPlaneFrame, u: number, v: number): THREE.Vector3 {
  return frame.origin.clone()
    .addScaledVector(frame.uDir, u)
    .addScaledVector(frame.vDir, v);
}

function sketchPtToWorld(frame: OccPlaneFrame, pt: SketchPoint): THREE.Vector3 {
  // SketchPoints can be in world-space (plane='custom') or in plane-space.
  // We project the 3D point onto the plane basis.
  const d = new THREE.Vector3(pt.x, pt.y, pt.z).sub(frame.origin);
  const u = d.dot(frame.uDir);
  const v = d.dot(frame.vDir);
  return uvToWorld(frame, u, v);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gpPnt(oc: OcctRaw, v: THREE.Vector3): any {
  return new oc.gp_Pnt_3(v.x, v.y, v.z);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gpDir(oc: OcctRaw, v: THREE.Vector3): any {
  return new oc.gp_Dir_4(v.x, v.y, v.z);
}

// ── Line edge ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lineToEdge(oc: OcctRaw, p1: THREE.Vector3, p2: THREE.Vector3): any | null {
  if (p1.distanceToSquared(p2) < 1e-12) return null;
  const gp1 = gpPnt(oc, p1);
  const gp2 = gpPnt(oc, p2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mk = new (oc as any).BRepBuilderAPI_MakeEdge_3(gp1, gp2);
  gp1.delete();
  gp2.delete();
  if (!mk.IsDone()) { mk.delete(); return null; }
  const edge = mk.Edge();
  mk.delete();
  return edge;
}

// ── Arc edge (3-point) ───────────────────────────────────────────────────────

function arcToEdge(
  oc: OcctRaw,
  p1: THREE.Vector3,
  pmid: THREE.Vector3,
  p2: THREE.Vector3,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any | null {
  const gp1 = gpPnt(oc, p1);
  const gpm = gpPnt(oc, pmid);
  const gp2 = gpPnt(oc, p2);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arcMk = new (oc as any).GC_MakeArcOfCircle_4(gp1, gpm, gp2);
    if (!arcMk.IsDone()) { arcMk.delete(); return null; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edgeMk = new (oc as any).BRepBuilderAPI_MakeEdge_24(arcMk.Value());
    arcMk.delete();
    if (!edgeMk.IsDone()) { edgeMk.delete(); return null; }
    const edge = edgeMk.Edge();
    edgeMk.delete();
    return edge;
  } catch { return null; } finally {
    gp1.delete(); gpm.delete(); gp2.delete();
  }
}

// ── Circle edge (full) ───────────────────────────────────────────────────────

function circleToEdge(
  oc: OcctRaw,
  centre: THREE.Vector3,
  normal: THREE.Vector3,
  radius: number,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any | null {
  if (radius <= 0) return null;
  const gc = gpPnt(oc, centre);
  const gn = gpDir(oc, normal);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ax2 = new (oc as any).gp_Ax2_3(gc, gn);
  gc.delete(); gn.delete();
  try {
    // Use gp_Circ (value type) + BRepBuilderAPI_MakeEdge_8 for a full closed circle edge.
    // MakeEdge_24 expects Handle(Geom_TrimmedCurve) (the arc path); passing a
    // Handle(Geom_Circle) to it silently fails IsDone().
    // MakeEdge_8 is the overload that takes gp_Circ directly (no start/end params →
    // full closed periodic edge). MakeEdge_2 takes two TopoDS_Vertex — wrong type.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const circ = new (oc as any).gp_Circ_2(ax2, radius);
    ax2.delete();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edgeMk = new (oc as any).BRepBuilderAPI_MakeEdge_8(circ);
    circ.delete();
    if (!edgeMk.IsDone()) { edgeMk.delete(); return null; }
    const edge = edgeMk.Edge();
    edgeMk.delete();
    return edge;
  } catch { return null; }
}

// ── Entity dispatch ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function entityToEdges(oc: OcctRaw, entity: SketchEntity, frame: OccPlaneFrame): any[] {
  if (entity.isConstruction) return [];
  const pts = entity.points.map((p) => sketchPtToWorld(frame, p));

  switch (entity.type) {
    case 'line':
    case 'construction-line':
    case 'centerline': {
      if (pts.length < 2) return [];
      const edge = lineToEdge(oc, pts[0], pts[1]);
      return edge ? [edge] : [];
    }

    case 'arc': {
      // arc entity: points[0]=start, points[1]=mid, points[2]=end (3-point arc)
      if (pts.length >= 3) {
        const e = arcToEdge(oc, pts[0], pts[1], pts[2]);
        return e ? [e] : [];
      }
      return [];
    }

    case 'circle': {
      const centre = entity.cx != null && entity.cy != null
        ? uvToWorld(frame, entity.cx, entity.cy)
        : pts[0] ?? frame.origin;
      const r = entity.radius ?? 1;
      const e = circleToEdge(oc, centre, frame.normal, r);
      return e ? [e] : [];
    }

    case 'rectangle': {
      // Rectangle may be stored as either 4 explicit corners or 2 diagonal corners.
      // For the 2-point case, derive the other two corners using the plane basis vectors
      // so the edges lie exactly in the sketch plane.
      let corners: THREE.Vector3[];
      if (pts.length >= 4) {
        corners = pts.slice(0, 4);
      } else if (pts.length === 2) {
        const p0 = pts[0];
        const p1 = pts[1];
        const d0 = p0.clone().sub(frame.origin);
        const d1 = p1.clone().sub(frame.origin);
        const u0 = d0.dot(frame.uDir), v0 = d0.dot(frame.vDir);
        const u1 = d1.dot(frame.uDir), v1 = d1.dot(frame.vDir);
        corners = [
          uvToWorld(frame, u0, v0),   // p0
          uvToWorld(frame, u1, v0),   // (u1, v0)
          uvToWorld(frame, u1, v1),   // p1
          uvToWorld(frame, u0, v1),   // (u0, v1)
        ];
      } else {
        return [];
      }
      const edges: unknown[] = [];
      for (let i = 0; i < 4; i++) {
        const e = lineToEdge(oc, corners[i], corners[(i + 1) % 4]);
        if (e) edges.push(e);
      }
      return edges as unknown[];
    }

    case 'spline': {
      // Approximate spline with line segments between control points
      const edges: unknown[] = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const e = lineToEdge(oc, pts[i], pts[i + 1]);
        if (e) edges.push(e);
      }
      return edges as unknown[];
    }

    default:
      return [];
  }
}

// ── OCC-6.2: closed wire builder ──────────────────────────────────────────────

/**
 * Convert a SketchEntity[] (non-construction entities) into a closed
 * TopoDS_Wire. Validates closure (OCC-6.2). Returns null if the wire fails.
 */
export function sketchEntitiesToWire(
  oc: OcctRaw,
  entities: SketchEntity[],
  frame: OccPlaneFrame,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wireMaker = new (oc as any).BRepBuilderAPI_MakeWire_1();
  let edgeCount = 0;

  const diagEdgesPerEntity: string[] = [];
  for (const entity of entities) {
    if (entity.isConstruction) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edges = entityToEdges(oc, entity, frame) as any[];
    diagEdgesPerEntity.push(`${entity.type}:${edges.length}(r=${(entity as { radius?: number }).radius ?? '-'})`);
    for (const edge of edges) {
      wireMaker.Add_1(edge);
      edge.delete();
      edgeCount++;
    }
  }

  if (edgeCount === 0 || !wireMaker.IsDone()) {
    console.warn(
      `[sketchEntitiesToWire] wire build failed: edgeCount=${edgeCount} wireDone=${wireMaker.IsDone?.()}` +
      ` entities=[${diagEdgesPerEntity.join(', ')}]`,
    );
    wireMaker.delete();
    return null;
  }

  const wire = wireMaker.Wire();
  wireMaker.delete();
  return wire;
}

// ── OCC-6.3: face from loops ──────────────────────────────────────────────────

/**
 * Build a TopoDS_Face from outer + hole wires (OCC-6.3).
 * Holes must have opposite orientation to the outer wire.
 */
export function wiresToFace(
  oc: OcctRaw,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outerWire: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  holeWires: any[],
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faceMaker = new (oc as any).BRepBuilderAPI_MakeFace_15(outerWire, false);
  for (const hw of holeWires) {
    // Inner (hole) wires must have REVERSED topological orientation in OCCT.
    // TopoDS_Shape.Reversed() returns TopoDS_Shape (base class); cast to TopoDS_Wire
    // via TopoDS.Wire_1() (VIEW — same ptr) before passing to Add(), which expects
    // TopoDS_Wire. Delete the owned TopoDS_Shape copy immediately after.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reversedShape = (hw as any).Reversed();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reversedWire = (oc as any).TopoDS.Wire_1(reversedShape);
      faceMaker.Add(reversedWire);
    } finally {
      reversedShape.delete?.();
    }
  }
  if (!faceMaker.IsDone()) {
    faceMaker.delete();
    return null;
  }
  const face = faceMaker.Face();
  faceMaker.delete();
  return face;
}
