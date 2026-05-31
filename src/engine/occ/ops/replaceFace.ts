/**
 * OCC-21.3 — Replace Face.
 *
 * Replaces one or more source faces on a solid body with a new bounding
 * surface by computing the target face's plane and subtracting the halfspace
 * that lies between the source faces and the target plane.
 *
 * This works for planar target surfaces (the common case). Non-planar target
 * surfaces return null with a console warning.
 *
 * `isTangentChain`: when true, the source face set is expanded via
 * `expandTangentFaceChain` before the cut — mirrors Fusion's tangent-chain
 * face propagation.
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { expandTangentFaceChain } from './faceAdjacency';
import { sketchPlaneFromFace } from '../geomSurface';
import { performOccBooleanWithInstance } from './booleanCore';

// ── Local OCC API surface needed to build the halfspace box ─────────────────

type OccReplaceFaceApi = OcctRaw & {
  BRepPrimAPI_MakeBox_4: new (origin: unknown, dx: number, dy: number, dz: number) => {
    Shape(): unknown;
    delete(): void;
  };
  BRepBuilderAPI_Transform_2: new (shape: unknown, trsf: unknown, copy: boolean) => {
    Shape(): unknown;
    delete(): void;
  };
  gp_Pnt_3: new (x: number, y: number, z: number) => { delete(): void };
  gp_Vec_4: new (x: number, y: number, z: number) => { delete(): void };
  gp_Dir_4: new (x: number, y: number, z: number) => { delete(): void };
  gp_Ax2_2: new (origin: unknown, mainDir: unknown, xDir: unknown) => { delete(): void };
  gp_Trsf_1: new () => {
    SetValues(
      a11: number, a12: number, a13: number, a14: number,
      a21: number, a22: number, a23: number, a24: number,
      a31: number, a32: number, a33: number, a34: number,
    ): void;
    delete(): void;
  };
};

// Half-size of the cutting box in each transverse direction (metres equivalent).
// Large enough to cover any reasonable body.
const HALF_SIZE = 200_000;
// Depth of the cutting box in the cut direction (metres equivalent).
const HALF_DEPTH = 100_000;

export interface OccReplaceFaceOptions {
  id?: string;
  sourceFeatureId?: string;
  isTangentChain?: boolean;
}

// ── Public async entry point ─────────────────────────────────────────────────

export async function occReplaceFace(
  body: BRepBody,
  sourceFaceIds: number[],
  targetFaceId: number,
  options: OccReplaceFaceOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occReplaceFaceWithInstance(oc, body, sourceFaceIds, targetFaceId, options);
}

// ── Synchronous implementation (already-loaded OCC instance) ─────────────────

export function occReplaceFaceWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  sourceFaceIds: number[],
  targetFaceId: number,
  options: OccReplaceFaceOptions = {},
): BRepBody | null {
  if (sourceFaceIds.length === 0) return null;

  // Optionally expand source set via tangent-face walk.
  const resolvedSourceIds = options.isTangentChain
    ? expandTangentFaceChain(oc, body, sourceFaceIds)
    : sourceFaceIds;

  // Get the plane of the target face — this is the replacement surface.
  const targetPlane = sketchPlaneFromFace(oc, body, targetFaceId);
  if (!targetPlane) {
    console.warn('[occReplaceFace] target face is not planar — non-planar replace face not supported');
    return null;
  }

  // Get the centroid of one source face to determine which side of the target
  // plane we need to cut away.
  const srcPlane = sketchPlaneFromFace(oc, body, resolvedSourceIds[0]);
  // Fall back to a point slightly offset from target origin if source plane unavailable.
  const srcOrigin: THREE.Vector3 = srcPlane?.frame.origin.clone()
    ?? targetPlane.frame.origin.clone().addScaledVector(targetPlane.frame.normal, 10);

  // Determine which side of the target plane the source face lies on.
  // We cut away that side, effectively pushing the body face to the target plane.
  const toSrc = srcOrigin.clone().sub(targetPlane.frame.origin);
  const dot = toSrc.dot(targetPlane.frame.normal);

  // The cut normal points AWAY from the body (toward the side we remove).
  // If dot >= 0, the source is on the positive-normal side → cut positive.
  // If dot < 0,  the source is on the negative-normal side → cut negative.
  const cutNormal = dot >= 0
    ? targetPlane.frame.normal.clone()
    : targetPlane.frame.normal.clone().negate();

  // Build the cutting halfspace body.
  const halfspaceTool = buildHalfspaceBox(oc, targetPlane.frame.origin, cutNormal, targetPlane.frame.uDir);
  if (!halfspaceTool) {
    console.warn('[occReplaceFace] failed to build halfspace cutter');
    return null;
  }

  // Subtract the halfspace from the body.
  const result = performOccBooleanWithInstance(oc, 'subtract', body, halfspaceTool, {
    id: options.id,
    sourceFeatureId: options.sourceFeatureId,
  });

  halfspaceTool.dispose();
  return result;
}

// ── Halfspace builder ────────────────────────────────────────────────────────

/**
 * Build a large box that occupies the halfspace on the `cutNormal` side of
 * `planeOrigin`. The box is built in a local frame aligned with the plane and
 * extends HALF_DEPTH in the cut direction from the plane surface.
 *
 * Returns a temporary BRepBody (caller must call `.dispose()` after the
 * boolean operation).
 */
function buildHalfspaceBox(
  oc: OcctRaw,
  planeOrigin: THREE.Vector3,
  cutNormal: THREE.Vector3,
  uDir: THREE.Vector3,
): BRepBody | null {
  const occ = oc as OccReplaceFaceApi;

  // Make a box of size (HALF_SIZE * 2) × (HALF_SIZE * 2) × HALF_DEPTH,
  // centred on the plane in the U/V directions and extending HALF_DEPTH into
  // the cut-normal direction.
  //
  // Strategy: build a simple axis-aligned box, then apply a rotation + translation
  // transform using the target plane's coordinate frame.

  const resources: Array<{ delete(): void }> = [];

  try {
    // BRepPrimAPI_MakeBox_2(dx, dy, dz) builds a box from origin (0,0,0)
    // along +X, +Y, +Z. We'll build it there and transform it.
    let boxShape: unknown;
    {
      const boxMaker = new occ.BRepPrimAPI_MakeBox_2(
        HALF_SIZE * 2,
        HALF_SIZE * 2,
        HALF_DEPTH,
      );
      boxShape = boxMaker.Shape();
      boxMaker.delete();
    }

    // Build a transform: local X = uDir, local Y = vDir, local Z = cutNormal,
    // origin = planeOrigin - HALF_SIZE*uDir - HALF_SIZE*vDir (so the box is
    // centred on the plane in U/V and starts at the plane surface in Z).
    const vDir = new THREE.Vector3().crossVectors(cutNormal, uDir).normalize();

    // 4×3 rotation+translation matrix (column-major in THREE, row-major in OCC SetValues).
    // OCC SetValues expects rows (a11..a14, a21..a24, a31..a34):
    //   [uDir | vDir | cutNormal | translation]
    const tx = planeOrigin.x - HALF_SIZE * uDir.x - HALF_SIZE * vDir.x;
    const ty = planeOrigin.y - HALF_SIZE * uDir.y - HALF_SIZE * vDir.y;
    const tz = planeOrigin.z - HALF_SIZE * uDir.z - HALF_SIZE * vDir.z;

    const trsf = new occ.gp_Trsf_1();
    resources.push(trsf);
    trsf.SetValues(
      uDir.x, vDir.x, cutNormal.x, tx,
      uDir.y, vDir.y, cutNormal.y, ty,
      uDir.z, vDir.z, cutNormal.z, tz,
    );

    const transformer = new occ.BRepBuilderAPI_Transform_2(boxShape, trsf, true);
    resources.push(transformer as unknown as { delete(): void });
    const transformedShape = transformer.Shape();

    return makeBRepBodyFromOccShape(oc, transformedShape, {});
  } catch (err) {
    console.warn('[occReplaceFace] buildHalfspaceBox error:', err);
    return null;
  } finally {
    for (const r of resources) r.delete();
  }
}
