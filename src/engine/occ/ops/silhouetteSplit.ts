/**
 * OCC-21.4e — REAL silhouette split (view-dependent outline imprint).
 *
 * Fusion's Silhouette Split imprints the body's silhouette curves — the locus
 * where the surface is tangent to the view direction (surface normal ⊥ view) —
 * onto its faces, then optionally divides the body there.
 *
 * Unlike the (renamed) "Planar Split", this is NOT a flat halfspace cut: the
 * split curve depends on the view direction and the surface curvature.
 *
 * SCOPE (this spike):
 *   - SUPPORTED: cylindrical faces. A cylinder's silhouette along a view
 *     direction is the two axial rulings at azimuth ±normalize(axis × view).
 *     This is the canonical case (a cylinder's two outline lines) and is
 *     derived in closed form — see `cylinderSilhouetteRulings` (pure, tested).
 *   - operation 'faces-only' (Fusion FacesOnly): imprint the rulings onto the
 *     cylindrical face(s) via BRepFeat_SplitShape. The body's volume and solid
 *     topology are unchanged; the cylindrical face is subdivided along the
 *     outline. This is what this op realizes.
 *   - DEFERRED (documented, returns the faces-only result with a warning):
 *     'solid-body' / 'shelled-body' modes (need a parting-surface solid split),
 *     and non-cylindrical surfaces (sphere → outline circle; cone → slant
 *     rulings; freeform → marching / HLR). Tracked as follow-up.
 *
 * Requires TKFeat (BRepFeat_SplitShape) — added to the loader alongside this op.
 *
 * VIEW vs owned: occDeref / TopoDS.Face_1 / maker.Edge() are VIEWs (never
 * deleted); gp_*, makers, BRep_Builder, wires, the splitter are owned and freed
 * in `finally`. makeBRepBodyFromOccShape copies what it needs before we free.
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { runEdgeOpBuild } from './adjacency';

// ── Pure geometry core (no OCC) ──────────────────────────────────────────────

export interface RulingSegment {
  start: [number, number, number];
  end: [number, number, number];
}

export interface CylinderSilhouetteParams {
  /** Cylinder axis reference point (the surface's v=0 location). */
  axisLoc: [number, number, number];
  /** Cylinder axis direction (need not be unit — normalized internally). */
  axisDir: [number, number, number];
  radius: number;
  /** Face's axial parameter range (BRepAdaptor First/Last V parameter). */
  vMin: number;
  vMax: number;
}

/**
 * The two silhouette rulings of a cylinder seen along `viewDir`.
 *
 * A cylinder's surface normal at azimuth θ is the radial direction. The
 * silhouette is where that normal ⊥ viewDir; because the radial direction is
 * already ⊥ axis, the two solutions are the directions ⊥ BOTH axis and view,
 * i.e. ±normalize(axis × view). Each ruling is the axial line at that radial
 * offset, spanning the face's [vMin, vMax].
 *
 * Returns [] when the view is (near) parallel to the axis — then the silhouette
 * is the end-cap circle, not a pair of rulings (out of scope for this op).
 */
export function cylinderSilhouetteRulings(
  p: CylinderSilhouetteParams,
  viewDir: [number, number, number],
): RulingSegment[] {
  const axis = new THREE.Vector3(...p.axisDir);
  if (axis.lengthSq() < 1e-12) return [];
  axis.normalize();
  const view = new THREE.Vector3(...viewDir);
  if (view.lengthSq() < 1e-12) return [];
  view.normalize();

  const cross = new THREE.Vector3().crossVectors(axis, view);
  // |axis × view| = sin(angle); near 0 ⇒ view ∥ axis ⇒ no ruling silhouette.
  if (cross.lengthSq() < 1e-8) return [];
  const radial = cross.normalize();

  const loc = new THREE.Vector3(...p.axisLoc);
  const segs: RulingSegment[] = [];
  for (const sign of [1, -1]) {
    const r = radial.clone().multiplyScalar(sign * p.radius);
    const base = loc.clone().add(r);
    const start = base.clone().addScaledVector(axis, p.vMin);
    const end = base.clone().addScaledVector(axis, p.vMax);
    segs.push({
      start: [start.x, start.y, start.z],
      end: [end.x, end.y, end.z],
    });
  }
  return segs;
}

// ── OCC API surface ───────────────────────────────────────────────────────────

interface GpScalarObj { delete?(): void }
interface GpXyzObj { X(): number; Y(): number; Z(): number; delete?(): void }

type OccSilhouetteApi = OcctRaw & {
  BRepAdaptor_Surface_2: new (face: unknown, restricted: boolean) => {
    GetType(): unknown;
    FirstVParameter(): number;
    LastVParameter(): number;
    Cylinder(): {
      Axis(): { Location(): GpXyzObj; Direction(): GpXyzObj; delete?(): void };
      Radius(): number;
      delete?(): void;
    };
    delete(): void;
  };
  GeomAbs_SurfaceType: { GeomAbs_Cylinder?: unknown };
  gp_Pnt_3: new (x: number, y: number, z: number) => GpScalarObj;
  BRepBuilderAPI_MakeEdge_3: new (p1: unknown, p2: unknown) => {
    IsDone(): boolean;
    Edge(): unknown; // VIEW — owned by the maker
    delete(): void;
  };
  BRep_Builder: new () => {
    MakeWire(wire: unknown): void;
    Add(wire: unknown, edge: unknown): void;
    delete(): void;
  };
  TopoDS_Wire: new () => { delete(): void };
  BRepFeat_SplitShape: new (shape: unknown) => {
    Add(wireOrEdge: unknown, face: unknown): void;
    Build(progress?: unknown): void;
    IsDone(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  TopoDS: { Face_1(s: unknown): unknown };
};

function enumEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const av = (a as { value?: unknown })?.value;
  const bv = (b as { value?: unknown })?.value;
  return av !== undefined && (av === bv || av === b);
}

export type SilhouetteOperation = 'faces-only' | 'solid-body' | 'shelled-body';

export interface SilhouetteSplitOptions {
  id?: string;
  sourceFeatureId?: string;
  /** Only 'faces-only' is geometrically realized; others fall back to it + warn. */
  operation?: SilhouetteOperation;
}

// ── Public async entry ─────────────────────────────────────────────────────────

export async function occSilhouetteSplit(
  body: BRepBody,
  viewDir: [number, number, number],
  options: SilhouetteSplitOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occSilhouetteSplitWithInstance(oc, body, viewDir, options);
}

// ── Sync implementation ─────────────────────────────────────────────────────────

/**
 * Read a cylindrical face's parameters into plain numbers, disposing all OCC
 * temporaries before returning. Returns null for non-cylindrical faces.
 */
function readCylinderFace(occ: OccSilhouetteApi, rawFace: unknown): CylinderSilhouetteParams | null {
  let adaptor: InstanceType<OccSilhouetteApi['BRepAdaptor_Surface_2']> | null = null;
  try {
    adaptor = new occ.BRepAdaptor_Surface_2(rawFace, true);
    if (!enumEq(adaptor.GetType(), occ.GeomAbs_SurfaceType?.GeomAbs_Cylinder)) return null;
    const vMin = adaptor.FirstVParameter();
    const vMax = adaptor.LastVParameter();
    const cyl = adaptor.Cylinder();
    const ax = cyl.Axis();
    const loc = ax.Location();
    const dir = ax.Direction();
    try {
      const radius = cyl.Radius();
      return {
        axisLoc: [loc.X(), loc.Y(), loc.Z()],
        axisDir: [dir.X(), dir.Y(), dir.Z()],
        radius,
        vMin,
        vMax,
      };
    } finally {
      loc.delete?.();
      dir.delete?.();
      ax.delete?.();
      cyl.delete?.();
    }
  } catch {
    return null;
  } finally {
    adaptor?.delete();
  }
}

export function occSilhouetteSplitWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  viewDir: [number, number, number],
  options: SilhouetteSplitOptions = {},
): BRepBody | null {
  const occ = oc as OccSilhouetteApi;

  if (typeof occ.BRepFeat_SplitShape !== 'function') {
    console.warn('[occSilhouetteSplit] BRepFeat_SplitShape unavailable (TKFeat not loaded)');
    return null;
  }
  if (options.operation && options.operation !== 'faces-only') {
    console.warn(`[occSilhouetteSplit] operation '${options.operation}' not yet implemented — imprinting faces only`);
  }

  // VIEW — never delete.
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);

  const owned: Array<{ delete(): void }> = [];
  // Per-face (faceVIEW, [ruling wires]) to feed the splitter.
  const splitPlan: Array<{ face: unknown; wires: unknown[] }> = [];

  try {
    for (const [, handle] of body.faceIds) {
      // rawFace is a VIEW — never delete.
      const rawFace = occ.TopoDS.Face_1(occDeref(oc, handle, oc.TopoDS_Shape));
      const params = readCylinderFace(occ, rawFace);
      if (!params) continue;

      const rulings = cylinderSilhouetteRulings(params, viewDir);
      if (rulings.length === 0) continue;

      const wires: unknown[] = [];
      for (const seg of rulings) {
        const p1 = new occ.gp_Pnt_3(...seg.start);
        const p2 = new occ.gp_Pnt_3(...seg.end);
        owned.push(p1, p2);
        const edgeMaker = new occ.BRepBuilderAPI_MakeEdge_3(p1, p2);
        owned.push(edgeMaker);
        if (!edgeMaker.IsDone()) continue;
        const edge = edgeMaker.Edge(); // VIEW owned by maker (kept alive in `owned`)

        const wire = new occ.TopoDS_Wire();
        const builder = new occ.BRep_Builder();
        owned.push(wire, builder);
        builder.MakeWire(wire);
        builder.Add(wire, edge);
        wires.push(wire);
      }
      if (wires.length > 0) splitPlan.push({ face: rawFace, wires });
    }

    if (splitPlan.length === 0) {
      console.warn('[occSilhouetteSplit] no cylindrical silhouette found for this view direction');
      return null;
    }

    const splitter = new occ.BRepFeat_SplitShape(rawShape);
    owned.push(splitter);
    for (const { face, wires } of splitPlan) {
      for (const wire of wires) splitter.Add(wire, face);
    }
    runEdgeOpBuild(oc, splitter);
    if (!splitter.IsDone()) {
      console.warn('[occSilhouetteSplit] BRepFeat_SplitShape failed');
      return null;
    }

    const resultShape = splitter.Shape(); // VIEW — copied by makeBRepBodyFromOccShape
    return makeBRepBodyFromOccShape(oc, resultShape, {
      id: options.id,
      sourceFeatureId: options.sourceFeatureId,
    });
  } catch (e) {
    console.warn('[occSilhouetteSplit] threw:', e);
    return null;
  } finally {
    for (const r of owned) {
      try { r.delete(); } catch { /* ignore */ }
    }
    // rawShape + per-face VIEWs from occDeref/Face_1 are NOT deleted.
  }
}
