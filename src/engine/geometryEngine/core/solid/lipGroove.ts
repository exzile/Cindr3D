import * as THREE from 'three';
import { getOcc } from '../../../occ/loader';
import { occBoxWithInstance } from '../../../occ/ops/box';
import { performOccBooleanWithInstance } from '../../../occ/ops/booleanCore';
import { tessellateWithInstance, tessellationToGeometry } from '../../../occ/tessellate';

/**
 * Builds a representative **Lip and Groove** mating-edge pair from the
 * LipGrooveDialog parameters.
 *
 * Lip & Groove is the joint used where two printed enclosure halves meet on a
 * parting line: one half carries a raised rectangular **lip** rib running along
 * its edge, the mating half carries a matching **groove** channel so the two
 * shells locate and seal. The dialog only collects cross-section dimensions
 * (no picked body / edge), so this builds a self-contained demonstrator solid:
 * two short wall segments laid side-by-side along a straight parting edge —
 * the left wall gets the lip, the right wall gets the groove. The user can
 * position / combine the result against their own enclosure halves.
 *
 * Local space (origin centred on the wall pair):
 *   - The parting edge runs along +X for `runLength`.
 *   - Each wall segment is a block `wallThk` deep (Z) × `wallHt` tall (Y),
 *     with its mating face on the X–Y plane (Z = 0). The two walls are split
 *     across X with a small gap so lip and groove read as separate halves.
 *   - The lip is a `lipWidth` (Z) × `lipHeight` (Y) rectangular bead extruded
 *     along the full run, fused onto the left wall's top edge.
 *   - The groove is the mating channel — `grooveWidth` × `grooveDepth` plus the
 *     `clearance` added all round so the printed lip drops in with a fit gap —
 *     OCC-subtracted from the right wall's top edge.
 *
 * OCC implementation: all primitives are BRepPrimAPI_MakeBox; fuse/subtract via
 * BRepAlgoAPI_Fuse / BRepAlgoAPI_Cut. Produces an exact BRep solid tessellated
 * to a THREE.BufferGeometry — no CSG / Manifold dependency.
 */
export async function lipGrooveGeometry(
  lipWidth: number,
  lipHeight: number,
  grooveWidth: number,
  grooveDepth: number,
  clearance: number,
  includeGroove: boolean,
): Promise<THREE.BufferGeometry> {
  const { oc } = await getOcc();

  const lipW = Math.max(0.1, lipWidth);
  const lipH = Math.max(0.1, lipHeight);
  const clr = Math.max(0, clearance);
  // The groove must clear the lip: enforce a channel at least as big as the
  // lip plus the clearance gap on every side, then honour the user's larger
  // explicit values if they asked for a wider/deeper channel.
  const grvW = Math.max(grooveWidth, lipW + 2 * clr);
  const grvD = Math.max(grooveDepth, lipH + clr);

  // Wall sized so the lip sits proud and the groove never breaches the back.
  const wallThk = Math.max(grvW + 2, lipW + 2);
  const wallHt = Math.max(grvD + 3, lipH + 3);
  const runLength = Math.max(20, lipW * 8);
  const gap = 0.5; // visual split between the two halves along X
  const segLen = (runLength - gap) / 2;

  // ── Left wall: MakeBox_2(segLen, wallHt, wallThk) ─────────────────────────
  // Translate so its centre sits at (-runLength/2 + segLen/2, wallHt/2, 0).
  // OCC origin = min-corner = centre - dim/2 = (-runLength/2, 0, -wallThk/2).
  const leftWallTf = new THREE.Matrix4().makeTranslation(-runLength / 2, 0, -wallThk / 2);
  const leftWallBody = occBoxWithInstance(oc, segLen, wallHt, wallThk, { transform: leftWallTf });

  // ── Lip bead: MakeBox_2(segLen, lipH, lipW) ───────────────────────────────
  // Centre at (-runLength/2 + segLen/2, wallHt + lipH/2, 0).
  // OCC origin = (-runLength/2, wallHt, -lipW/2).
  const lipTf = new THREE.Matrix4().makeTranslation(-runLength / 2, wallHt, -lipW / 2);
  const lipBody = occBoxWithInstance(oc, segLen, lipH, lipW, { transform: lipTf });

  // ── Fuse left wall + lip ─────────────────────────────────────────────────
  const lipHalf = performOccBooleanWithInstance(oc, 'union', leftWallBody, lipBody);
  leftWallBody.dispose();
  lipBody.dispose();
  if (!lipHalf) throw new Error('[lipGrooveGeometry] OCC fuse left wall + lip failed');

  // ── Right wall: MakeBox_2(segLen, wallHt, wallThk) ───────────────────────
  // Centre at (runLength/2 - segLen/2, wallHt/2, 0).
  // OCC origin = (runLength/2 - segLen, 0, -wallThk/2).
  const rightWallTf = new THREE.Matrix4().makeTranslation(runLength / 2 - segLen, 0, -wallThk / 2);
  const rightWallBody = occBoxWithInstance(oc, segLen, wallHt, wallThk, { transform: rightWallTf });

  // Start with the plain right wall; optionally subtract the groove channel.
  let rightSide = rightWallBody;

  if (includeGroove) {
    // Cutter: MakeBox_2(segLen+1, grvD+1, grvW).
    // THREE.js centre: (runLength/2 - segLen/2, wallHt - grvD/2 + 1, 0)
    // OCC min-corner:  (runLength/2 - segLen - 0.5, wallHt - grvD + 0.5, -grvW/2)
    // Top of cutter protrudes ~1.5 mm above wallHt so the groove face opens cleanly.
    const cutterTf = new THREE.Matrix4().makeTranslation(
      runLength / 2 - segLen - 0.5,
      wallHt - grvD + 0.5,
      -grvW / 2,
    );
    const cutterBody = occBoxWithInstance(oc, segLen + 1, grvD + 1, grvW, { transform: cutterTf });
    const grooved = performOccBooleanWithInstance(oc, 'subtract', rightWallBody, cutterBody);
    cutterBody.dispose();
    rightWallBody.dispose();
    if (!grooved) throw new Error('[lipGrooveGeometry] OCC subtract groove failed');
    rightSide = grooved;
  }

  // ── Fuse lip half + right side ────────────────────────────────────────────
  const solid = performOccBooleanWithInstance(oc, 'union', lipHalf, rightSide);
  lipHalf.dispose();
  rightSide.dispose();
  if (!solid) throw new Error('[lipGrooveGeometry] OCC fuse halves failed');

  const tess = tessellateWithInstance(oc, solid);
  const geo = tessellationToGeometry(tess);
  solid.dispose();

  geo.computeVertexNormals();
  return geo;
}
