/**
 * OCC-6.4 — Derive a SketchPlane (and OccPlaneFrame) from a BRep face.
 *
 * Only planar faces are accepted (Geom_Plane). Returns null for cylinders,
 * cones, tori, or other curved surfaces — sketch attachment requires a flat face.
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

  const rawFace = occDeref(oc, handle, oc.TopoDS_Face);
  try {
    return sketchPlaneFromRawFace(oc, rawFace);
  } finally {
    rawFace.delete?.();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sketchPlaneFromRawFace(oc: OcctRaw, rawFace: any): BRepFacePlane | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loc: any | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loc = new (oc as any).TopLoc_Location_1();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const surf = (oc as any).BRep_Tool.Surface_2(rawFace, loc);
    if (surf.IsNull?.()) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geomPlane = (oc as any).Handle_Geom_Plane.DownCast(surf);
    if (geomPlane.IsNull?.()) return null; // Not a planar face

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plane: any = geomPlane.get().Pln();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ax3: any = plane.Position();

    const o = ax3.Location();
    const n = ax3.Direction();
    const x = ax3.XDirection();

    const origin = new THREE.Vector3(o.X(), o.Y(), o.Z());
    const normal = new THREE.Vector3(n.X(), n.Y(), n.Z()).normalize();
    const xDir = new THREE.Vector3(x.X(), x.Y(), x.Z()).normalize();

    // If the face has a location transform, apply it to origin+axes
    if (!loc.IsIdentity()) {
      const trsf = loc.IsIdentity() ? null : loc.Transformation();
      if (trsf) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gp = new (oc as any).gp_Pnt_3(origin.x, origin.y, origin.z);
        gp.Transform(trsf);
        origin.set(gp.X(), gp.Y(), gp.Z());
        gp.delete();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gdir = new (oc as any).gp_Dir_4(normal.x, normal.y, normal.z);
        gdir.Transform(trsf);
        normal.set(gdir.X(), gdir.Y(), gdir.Z());
        gdir.delete();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gxdir = new (oc as any).gp_Dir_4(xDir.x, xDir.y, xDir.z);
        gxdir.Transform(trsf);
        xDir.set(gxdir.X(), gxdir.Y(), gxdir.Z());
        gxdir.delete();
        trsf.delete();
      }
    }


    // Honor face orientation — reversed faces flip the normal
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (rawFace.Orientation_1?.() === (oc as any).TopAbs_Orientation.TopAbs_REVERSED) {
      normal.negate();
    }

    const frame = createOccPlaneFrame(origin, normal, xDir);

    return {
      frame,
      areaEstimate: 0, // will be computed by caller if needed
    };
  } catch {
    return null;
  } finally {
    loc?.delete();
  }
}

/**
 * Quick check: is the face planar?
 * Cheaper than extracting the full frame when you only need a bool.
 */
export function isFacePlanar(oc: OcctRaw, body: BRepBody, faceId: number): boolean {
  return sketchPlaneFromFace(oc, body, faceId) !== null;
}
