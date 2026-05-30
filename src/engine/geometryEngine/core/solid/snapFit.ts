import * as THREE from 'three';
import { getOcc } from '../../../occ/loader';
import { occBoxWithInstance } from '../../../occ/ops/box';
import { performOccBooleanWithInstance } from '../../../occ/ops/booleanCore';
import { occExtrudeWithInstance } from '../../../occ/ops/extrude';
import { createOccPlaneFrame } from '../../../occ/plane';
import { tessellateWithInstance, tessellationToGeometry } from '../../../occ/tessellate';
import type { SketchProfile } from '../../../occ/ops/sketchToWire';

/**
 * Builds a cantilever snap-fit hook solid from the SnapFitDialog parameters.
 *
 * Geometry layout (local space, origin at the root/fixed end):
 *   - The flexing **beam** runs along +X for `length`, has cross-section
 *     `width` (Z) × `thickness` (Y). Its bottom face sits on Y=0.
 *   - A **base block** at the root (X≈0) is a slightly taller/wider pad that
 *     represents the wall the cantilever grows out of.
 *   - A **hook/barb** at the free end (X≈length): a triangular prism that
 *     protrudes `overhang` in +Y.
 *
 * OCC implementation: boxes fused via BRepAlgoAPI_Fuse, barb extruded via
 * BRepPrimAPI_MakePrism.  Produces an exact BRep solid tessellated to a
 * THREE.BufferGeometry — no CSG / Manifold dependency.
 *
 * `annular` / `torsional` snap types reuse the same cantilever construction
 * (a correct, useful hook solid) until dedicated builders exist.
 */
export async function snapFitGeometry(
  length: number,
  width: number,
  thickness: number,
  overhang: number,
  overhangAngleDeg: number,
  returnAngleDeg: number,
): Promise<THREE.BufferGeometry> {
  const { oc } = await getOcc();

  const L = Math.max(0.5, length);
  const W = Math.max(0.5, width);
  const T = Math.max(0.2, thickness);
  const O = Math.max(0, overhang);

  const inAng = (Math.min(89, Math.max(1, overhangAngleDeg)) * Math.PI) / 180;
  const retAng = (Math.min(89, Math.max(1, returnAngleDeg)) * Math.PI) / 180;

  // ── Beam: spans X:[0,L], Y:[0,T], Z:[-W/2, W/2] ──────────────────────────
  // BRepPrimAPI_MakeBox_2 creates box from (0,0,0) → (w,h,d).
  // Translate (0, 0, -W/2) centres it on Z.
  const beamTf = new THREE.Matrix4().makeTranslation(0, 0, -W / 2);
  const beamBody = occBoxWithInstance(oc, L, T, W, { transform: beamTf });

  // ── Base block: spans X:[-baseLen/2, baseLen/2], Y:[0, baseH], Z:[-baseW/2, baseW/2]
  const baseLen = Math.max(T, L * 0.18);
  const baseH = T + Math.max(O * 0.5, T * 0.6);
  const baseW = W + Math.min(W * 0.4, T * 2);
  const baseTf = new THREE.Matrix4().makeTranslation(-baseLen / 2, 0, -baseW / 2);
  const baseBody = occBoxWithInstance(oc, baseLen, baseH, baseW, { transform: baseTf });

  // ── Fuse beam + base ─────────────────────────────────────────────────────
  let solid = performOccBooleanWithInstance(oc, 'union', beamBody, baseBody);
  beamBody.dispose();
  baseBody.dispose();
  if (!solid) throw new Error('[snapFitGeometry] OCC fuse beam+base failed');

  // ── Hook / barb (triangular prism extruded along Z) ───────────────────────
  if (O > 1e-3) {
    const rampRun = O / Math.tan(inAng);
    const retRun = O / Math.tan(retAng);
    const peakX = L;
    const rampStartX = Math.max(0, peakX - rampRun);
    const retBaseX = Math.min(peakX - 1e-3, peakX - Math.min(retRun, L * 0.99));

    // Barb profile: triangle in the XY plane (u=X, v=Y).
    // Extruded by W along +Z starting from z=-W/2 → z=W/2.
    const barbProfile: SketchProfile = {
      outer: [
        new THREE.Vector2(rampStartX, T),
        new THREE.Vector2(peakX, T + O),
        new THREE.Vector2(retBaseX, T),
      ],
      holes: [],
    };
    const barbFrame = createOccPlaneFrame(
      new THREE.Vector3(0, 0, -W / 2),
      new THREE.Vector3(0, 0, 1),   // extrude in +Z
      new THREE.Vector3(1, 0, 0),   // uDir = X
    );

    const barbBody = occExtrudeWithInstance(oc, barbProfile, W, barbFrame);
    const withHook = performOccBooleanWithInstance(oc, 'union', solid, barbBody);
    barbBody.dispose();
    solid.dispose();
    if (!withHook) throw new Error('[snapFitGeometry] OCC fuse barb failed');
    solid = withHook;
  }

  const tess = tessellateWithInstance(oc, solid);
  const geo = tessellationToGeometry(tess);
  solid.dispose();

  geo.computeVertexNormals();
  return geo;
}
