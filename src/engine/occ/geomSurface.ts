/**
 * OCC-6.4 — Derive a SketchPlane (and OccPlaneFrame) from a BRep face.
 *
 * Only planar faces are accepted (GeomAbs_Plane). Returns null for cylinders,
 * cones, tori, or other curved surfaces — sketch attachment requires a flat face.
 *
 * Uses BRepAdaptor_Surface (GetType / Plane) rather than
 * BRep_Tool.Surface + Handle_Geom_Plane.DownCast: in this opencascade.js build
 * `BRep_Tool.Surface_2` is the 1-ARG overload (the location-aware one is
 * `Surface_1(F, L)`) and `Handle_Geom_Plane.DownCast` is **undefined**, so the old
 * path always threw → every planar face was reported non-planar. The adaptor path
 * also folds in the face's location automatically (no manual TopLoc transform).
 */
import * as THREE from 'three';
import type { OcctRaw } from './types';
import type { BRepBody } from './brepBody';
import { occDeref } from './brepBody';
import { createOccPlaneFrame, type OccPlaneFrame } from './plane';

export interface BRepFacePlane {
  frame: OccPlaneFrame;
  /** Signed area of the face boundary in the plane's UV space. Positive = CCW. */
  areaEstimate: number;
}

interface GpXyz { X(): number; Y(): number; Z(): number; delete?(): void }
interface OccGeomSurfaceApi extends OcctRaw {
  BRepAdaptor_Surface_2: new (face: unknown, restricted: boolean) => {
    GetType(): unknown;
    Plane(): {
      Position(): {
        Location(): GpXyz;
        Direction(): GpXyz;
        XDirection(): GpXyz;
        delete?(): void;
      };
      delete?(): void;
    };
    delete(): void;
  };
  GeomAbs_SurfaceType: { GeomAbs_Plane?: unknown };
  TopoDS: { Face_1(s: unknown): unknown };
  TopAbs_Orientation: { TopAbs_REVERSED?: unknown };
}

/** Embind enum members compare by identity in some builds and by `.value` in others. */
function enumEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const av = (a as { value?: unknown })?.value;
  const bv = (b as { value?: unknown })?.value;
  return av !== undefined && (av === bv || av === b);
}

/**
 * Extract a planar frame from a BRep face identified by faceId.
 * Returns null if the face is not planar (cylinder, sphere, torus, etc.).
 */
export function sketchPlaneFromFace(
  oc: OcctRaw,
  body: BRepBody,
  faceId: number,
): BRepFacePlane | null {
  const handle = body.faceIds.get(faceId);
  if (!handle) return null;

  // occDeref returns a TopoDS_Shape; BRepAdaptor_Surface_2 needs a real
  // TopoDS_Face. TopoDS.Face_1 is a VIEW — do NOT delete it.
  const occ = oc as OccGeomSurfaceApi;
  const rawFace = occ.TopoDS.Face_1(occDeref(oc, handle, oc.TopoDS_Shape));
  return sketchPlaneFromRawFace(oc, rawFace);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sketchPlaneFromRawFace(oc: OcctRaw, rawFace: any): BRepFacePlane | null {
  const occ = oc as OccGeomSurfaceApi;
  let adaptor: InstanceType<OccGeomSurfaceApi['BRepAdaptor_Surface_2']> | null = null;
  try {
    adaptor = new occ.BRepAdaptor_Surface_2(rawFace, true);
    if (!enumEq(adaptor.GetType(), occ.GeomAbs_SurfaceType?.GeomAbs_Plane)) {
      return null; // not a planar face
    }

    const pln = adaptor.Plane();
    const ax3 = pln.Position();
    const o = ax3.Location();
    const n = ax3.Direction();
    const x = ax3.XDirection();
    try {
      const origin = new THREE.Vector3(o.X(), o.Y(), o.Z());
      const normal = new THREE.Vector3(n.X(), n.Y(), n.Z()).normalize();
      const xDir = new THREE.Vector3(x.X(), x.Y(), x.Z()).normalize();

      // Honour face orientation — a REVERSED face flips the outward normal.
      if (rawFace.Orientation_1?.() === occ.TopAbs_Orientation?.TopAbs_REVERSED) {
        normal.negate();
      }

      const frame = createOccPlaneFrame(origin, normal, xDir);
      return { frame, areaEstimate: 0 };
    } finally {
      o.delete?.();
      n.delete?.();
      x.delete?.();
      ax3.delete?.();
      pln.delete?.();
    }
  } catch {
    return null;
  } finally {
    adaptor?.delete();
  }
}

/**
 * Quick check: is the face planar?
 * Cheaper than extracting the full frame when you only need a bool.
 */
export function isFacePlanar(oc: OcctRaw, body: BRepBody, faceId: number): boolean {
  return sketchPlaneFromFace(oc, body, faceId) !== null;
}
