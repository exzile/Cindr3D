import * as THREE from 'three';
import { csgUnion } from './csg';

/**
 * Builds a cantilever snap-fit hook solid from the SnapFitDialog parameters.
 *
 * Geometry layout (local space, origin at the root/fixed end):
 *   - The flexing **beam** runs along +X for `length`, has cross-section
 *     `width` (Z) × `thickness` (Y). Its bottom face sits on Y=0.
 *   - A **base block** at the root (X≈0) is a slightly taller/wider pad that
 *     represents the wall the cantilever grows out of (acts as the fillet/root
 *     so the part reads as anchored rather than a floating bar).
 *   - A **hook/barb** at the free end (X≈length): a triangular prism that
 *     protrudes `overhang` in +Y. The lead-in (insertion) ramp rises at
 *     `overhangAngle` from the beam's top; the **retaining face** drops back
 *     toward the root at `returnAngle` (a smaller return angle ⇒ steeper,
 *     harder-to-release latch — the classic snap behaviour).
 *
 * The three primitives are CSG-unioned into one watertight solid. The result
 * is a plain `THREE.BufferGeometry` in local space — the commit action wraps
 * it in a mesh, positions it, and stores it on the feature so `ExtrudedBodies`
 * renders it via the stored-mesh path.
 *
 * `annular` / `torsional` snap types reuse the same cantilever construction
 * (a correct, useful hook solid) until dedicated builders exist.
 */
export function snapFitGeometry(
  length: number,
  width: number,
  thickness: number,
  overhang: number,
  overhangAngleDeg: number,
  returnAngleDeg: number,
): THREE.BufferGeometry {
  const L = Math.max(0.5, length);
  const W = Math.max(0.5, width);
  const T = Math.max(0.2, thickness);
  const O = Math.max(0, overhang);

  // Clamp the angles into the dialog's intended (0,89] range so tan() stays
  // finite and the ramps don't invert.
  const inAng = (Math.min(89, Math.max(1, overhangAngleDeg)) * Math.PI) / 180;
  const retAng = (Math.min(89, Math.max(1, returnAngleDeg)) * Math.PI) / 180;

  const created: THREE.BufferGeometry[] = [];

  // ── Cantilever beam ──────────────────────────────────────────────────────
  // Box is created centred at origin; translate so it spans X:[0,L], Y:[0,T],
  // centred on Z.
  const beam = new THREE.BoxGeometry(L, T, W);
  beam.translate(L / 2, T / 2, 0);
  created.push(beam);

  // ── Root base block ──────────────────────────────────────────────────────
  // A short, fatter pad anchoring the beam — extends slightly behind the root
  // (−X) and is taller/wider than the beam so the cantilever reads as fixed.
  const baseLen = Math.max(T, L * 0.18);
  const baseH = T + Math.max(O * 0.5, T * 0.6);
  const baseW = W + Math.min(W * 0.4, T * 2);
  const base = new THREE.BoxGeometry(baseLen, baseH, baseW);
  base.translate(baseLen / 2 - baseLen * 0.5, baseH / 2, 0);
  created.push(base);

  let solid = csgUnion(beam, base);

  // ── Hook / barb at the free end ──────────────────────────────────────────
  if (O > 1e-3) {
    // Barb profile in the X–Y plane, extruded across the beam width (Z).
    // Walking from the root side toward the tip: a gentle lead-in (insertion)
    // ramp climbs to the peak at `inAng`, then a steeper retaining face drops
    // back toward the root at `retAng`. The peak (where ramp meets retaining
    // face) is pulled to the tip so the latch sits at the free end.
    const rampRun = O / Math.tan(inAng); // X covered by the lead-in ramp
    const retRun = O / Math.tan(retAng); // X covered by the return face
    const peakX = L; // peak at the very tip of the beam
    const rampStartX = Math.max(0, peakX - rampRun);
    // Retaining face folds back toward the root from the peak; clamp its run
    // so the triangle base never collapses to a degenerate edge.
    const retBaseX = Math.min(peakX - 1e-3, peakX - Math.min(retRun, L * 0.99));

    const shape = new THREE.Shape();
    shape.moveTo(rampStartX, T); // start of the lead-in ramp, on the beam top
    shape.lineTo(peakX, T + O); // climb the insertion ramp to the peak
    shape.lineTo(retBaseX, T); // retaining face back down toward the root
    shape.closePath();

    const barb = new THREE.ExtrudeGeometry(shape, {
      depth: W,
      bevelEnabled: false,
    });
    // ExtrudeGeometry extrudes along +Z from z=0; centre it on the beam width.
    barb.translate(0, 0, -W / 2);
    created.push(barb);

    const withHook = csgUnion(solid, barb);
    solid.dispose();
    solid = withHook;
  }

  // Dispose every intermediate primitive we created (not shared singletons).
  for (const g of created) g.dispose();

  solid.computeVertexNormals();
  return solid;
}
