/**
 * OCC rib / stiffener — thin solid extruded from an open sketch profile.
 *
 * Mirrors the THREE-based `extrudeThinSketch` geometry but produces a real OCC
 * BRep solid that is filletable and can participate in boolean operations.
 *
 * Algorithm:
 *   1. Project the sketch's line entities onto the sketch plane (uDir/vDir axes)
 *      → 2-D open polyline.
 *   2. Offset the polyline by ±thickness/2 using miter joints (identical to
 *      the THREE extrudeThinSketch implementation).
 *   3. Build a closed 3-D face from the resulting 2-D loop using the proven
 *      MakeEdge_7 + MakeWire_1 + MakeFace_18 binding chain.
 *   4. Extrude via BRepPrimAPI_MakePrism_1 in the sketch-normal direction.
 *      Symmetric direction: build two prisms (±height/2) and union them via
 *      BRepAlgoAPI_Fuse; fall back to single-direction if Fuse is not bound.
 */
import type { Sketch } from '../../../types/cad';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { createOccPlaneFrameFromSketch } from '../plane';
import { runEdgeOpBuild } from './adjacency';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyOcc = any;

interface Pt2 { u: number; v: number }
interface Pt3 { x: number; y: number; z: number }

// ── 2-D miter-offset (ported from extrudeThinSketch) ─────────────────────────

function offsetPolyline(pts: Pt2[], delta: number): Pt2[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }));
  const result: Pt2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const curr = pts[i];
    const next = pts[(i + 1) % pts.length];
    const d1 = { x: curr.u - prev.u, y: curr.v - prev.v };
    const d2 = { x: next.u - curr.u, y: next.v - curr.v };
    const l1 = Math.hypot(d1.x, d1.y);
    const l2 = Math.hypot(d2.x, d2.y);
    if (l1 < 1e-10 || l2 < 1e-10) { result.push({ ...curr }); continue; }
    const s1 = { x: d1.x / l1, y: d1.y / l1 };
    const s2 = { x: d2.x / l2, y: d2.y / l2 };
    const n1 = { x: -s1.y, y: s1.x };
    const n2 = { x: -s2.y, y: s2.x };
    const avg = { x: n1.x + n2.x, y: n1.y + n2.y };
    const avgLen = Math.hypot(avg.x, avg.y);
    if (avgLen < 1e-10) { result.push({ ...curr }); continue; }
    const norm = { x: avg.x / avgLen, y: avg.y / avgLen };
    const dot = n1.x * norm.x + n1.y * norm.y;
    const scale = dot > 0.01 ? 1 / dot : 1;
    result.push({ u: curr.u + norm.x * delta * scale, v: curr.v + norm.y * delta * scale });
  }
  return result;
}

// ── OCC face builder ──────────────────────────────────────────────────────────

interface FaceResult {
  face: AnyOcc;
  ownedResources: Array<{ delete?(): void }>;
}

function buildFaceFromLoop(oc: AnyOcc, pts3d: Pt3[]): FaceResult | null {
  const owned: Array<{ delete?(): void }> = [];
  try {
    const occPts = pts3d.map((p) => new oc.gp_Pnt_3(p.x, p.y, p.z));
    owned.push(...occPts);

    const wireMaker = new oc.BRepBuilderAPI_MakeWire_1();
    owned.push(wireMaker);

    // Build edges connecting consecutive points; close the loop.
    // MakeEdge_3 is the (gp_Pnt, gp_Pnt) overload in this WASM build
    // (MakeEdge_7 requires 3 args — overload numbers vary by WASM build).
    const MakeEdge = oc.BRepBuilderAPI_MakeEdge_3 ?? oc.BRepBuilderAPI_MakeEdge_7;
    const loop = [...occPts, occPts[0]];

    // Add_1 = Add(TopoDS_Edge); Add_2 = Add(TopoDS_Wire).
    // Overload numbers vary by build — probe once with the first edge to find
    // the edge-accepting overload.
    let addEdgeFn: ((edge: AnyOcc) => void) | null = null;
    const firstEm = new MakeEdge(loop[0], loop[1]);
    owned.push(firstEm);
    if (firstEm.IsDone()) {
      const firstEdge = firstEm.Edge();
      for (const variant of ['Add_1', 'Add_2', 'Add_3', 'Add']) {
        if (typeof wireMaker[variant] !== 'function') continue;
        try {
          wireMaker[variant](firstEdge);
          addEdgeFn = (e: AnyOcc) => wireMaker[variant](e);
          break;
        } catch { /* wrong overload — try next */ }
      }
    }
    if (!addEdgeFn) return null; // no working Add(edge) overload found

    for (let i = 1; i < loop.length - 1; i++) {
      const em = new MakeEdge(loop[i], loop[i + 1]);
      owned.push(em);
      if (em.IsDone()) addEdgeFn(em.Edge());
    }
    if (!wireMaker.IsDone()) return null;

    // BRepBuilderAPI_MakeFace_15(wire, onlyPlane=false) accepts raw TopoDS_Shape.
    // Use _15 which sketchToWire.ts also uses; if unavailable fall back to _18.
    const rawWire = wireMaker.Wire();
    const FaceCtor = oc.BRepBuilderAPI_MakeFace_15 ?? oc.BRepBuilderAPI_MakeFace_18;
    const faceMaker = new FaceCtor(rawWire, false);
    owned.push(faceMaker);
    if (!faceMaker.IsDone()) return null;

    return { face: faceMaker.Face(), ownedResources: owned };
  } catch {
    for (const r of owned) { try { r.delete?.(); } catch { /* ignore */ } }
    return null;
  }
}

// ── public API ────────────────────────────────────────────────────────────────

export interface OccRibOptions {
  id?: string;
  sourceFeatureId?: string;
}

/**
 * Build an OCC rib/stiffener solid from an open sketch profile.
 *
 * @param sketch    — sketch whose line entities form the rib centre-line
 * @param height    — extrusion distance (mm, > 0)
 * @param thickness — rib wall thickness (mm, > 0)
 * @param direction — 'normal': towards +normal; 'flip': towards −normal;
 *                    'symmetric': height/2 each way (single extrusion if Fuse
 *                    binding is unavailable in this WASM build).
 */
export function occRibWithInstance(
  oc: OcctRaw,
  sketch: Sketch,
  height: number,
  thickness: number,
  direction: 'normal' | 'flip' | 'symmetric',
  options: OccRibOptions = {},
): BRepBody | null {
  if (sketch.entities.length === 0 || height <= 0 || thickness <= 0) return null;

  const occ = oc as AnyOcc;

  // ── 1. Get sketch axes ────────────────────────────────────────────────────
  const frame = createOccPlaneFrameFromSketch(sketch);
  const { origin, uDir, vDir, normal } = frame;

  // ── 2. Project line entities → 2-D polyline ───────────────────────────────
  const project = (p: { x: number; y: number; z: number }): Pt2 => {
    const dx = p.x - origin.x, dy = p.y - origin.y, dz = p.z - origin.z;
    return {
      u: dx * uDir.x + dy * uDir.y + dz * uDir.z,
      v: dx * vDir.x + dy * vDir.y + dz * vDir.z,
    };
  };

  const outline: Pt2[] = [];
  for (const entity of sketch.entities) {
    if (entity.type === 'line' && entity.points.length >= 2) {
      if (outline.length === 0) outline.push(project(entity.points[0]));
      outline.push(project(entity.points[1]));
    }
  }
  if (outline.length < 2) return null;

  // ── 3. Offset polyline to create closed thin profile ─────────────────────
  const half = thickness / 2;
  const outer2D = offsetPolyline(outline, +half);
  const inner2D = offsetPolyline(outline, -half);
  const profile2D: Pt2[] = [...outer2D, ...inner2D.slice().reverse()];
  if (profile2D.length < 3) return null;

  // ── 4. Lift 2-D profile to 3-D world space ────────────────────────────────
  const profile3D: Pt3[] = profile2D.map(({ u, v }) => ({
    x: origin.x + uDir.x * u + vDir.x * v,
    y: origin.y + uDir.y * u + vDir.y * v,
    z: origin.z + uDir.z * u + vDir.z * v,
  }));

  // ── 5. Build planar OCC face ───────────────────────────────────────────────
  const faceResult = buildFaceFromLoop(occ, profile3D);
  if (!faceResult) {
    console.warn('[occRib] failed to build face from rib profile');
    return null;
  }
  const { face, ownedResources } = faceResult;

  // ── 6. Extrude ────────────────────────────────────────────────────────────
  try {
    if (direction === 'symmetric') {
      // Build two prisms, union if BRepAlgoAPI_Fuse is available.
      const hh = height / 2;

      const vecUp   = new occ.gp_Vec_4( normal.x * hh,  normal.y * hh,  normal.z * hh);
      const vecDown = new occ.gp_Vec_4(-normal.x * hh, -normal.y * hh, -normal.z * hh);
      ownedResources.push(vecUp, vecDown);

      const prismUp = new occ.BRepPrimAPI_MakePrism_1(face, vecUp, true, true);
      ownedResources.push(prismUp);
      runEdgeOpBuild(oc, prismUp);
      const shapeUp = prismUp.Shape();

      // Try to union with the downward half.
      if (typeof occ.BRepAlgoAPI_Fuse === 'function') {
        const prismDown = new occ.BRepPrimAPI_MakePrism_1(face, vecDown, true, true);
        ownedResources.push(prismDown);
        runEdgeOpBuild(oc, prismDown);
        const shapeDown = prismDown.Shape();

        const fuse = new occ.BRepAlgoAPI_Fuse(shapeUp, shapeDown);
        ownedResources.push(fuse);
        fuse.Build?.();
        if (fuse.IsDone?.() !== false) {
          return makeBRepBodyFromOccShape(oc, fuse.Shape(), {
            id: options.id, sourceFeatureId: options.sourceFeatureId,
          });
        }
        console.warn('[occRib] symmetric fuse failed; falling back to single-direction');
      } else {
        console.warn('[occRib] symmetric: BRepAlgoAPI_Fuse not bound; using single-direction extrusion');
      }
      // Fallback: just the upward half.
      return makeBRepBodyFromOccShape(oc, shapeUp, {
        id: options.id, sourceFeatureId: options.sourceFeatureId,
      });
    }

    // Normal or flip: single prism.
    const sign = direction === 'flip' ? -1 : 1;
    const vec = new occ.gp_Vec_4(
      normal.x * height * sign,
      normal.y * height * sign,
      normal.z * height * sign,
    );
    ownedResources.push(vec);

    const prism = new occ.BRepPrimAPI_MakePrism_1(face, vec, true, true);
    ownedResources.push(prism);
    runEdgeOpBuild(oc, prism);
    const shape = prism.Shape();

    return makeBRepBodyFromOccShape(oc, shape, {
      id: options.id, sourceFeatureId: options.sourceFeatureId,
    });
  } catch (e) {
    console.warn('[occRib] Build threw:', e);
    return null;
  } finally {
    for (const r of ownedResources) { try { r.delete?.(); } catch { /* ignore */ } }
  }
}
