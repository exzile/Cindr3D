import * as THREE from 'three';
import { csgUnion, csgSubtract } from './csg';

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
 *     along the full run, unioned onto the left wall's top edge.
 *   - The groove is the mating channel — `grooveWidth` × `grooveDepth` plus the
 *     `clearance` added all round so the printed lip drops in with a fit gap —
 *     CSG-subtracted from the right wall's top edge.
 *
 * Returns a plain `THREE.BufferGeometry` in local space; the commit action
 * wraps it in a mesh and stores it on the feature so `ExtrudedBodies` renders
 * it via the stored-mesh path. Every intermediate primitive is disposed (no
 * shared singletons are touched).
 */
export function lipGrooveGeometry(
  lipWidth: number,
  lipHeight: number,
  grooveWidth: number,
  grooveDepth: number,
  clearance: number,
  includeGroove: boolean,
): THREE.BufferGeometry {
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

  const created: THREE.BufferGeometry[] = [];

  // ── Left wall + raised lip ───────────────────────────────────────────────
  const leftWall = new THREE.BoxGeometry(segLen, wallHt, wallThk);
  leftWall.translate(-runLength / 2 + segLen / 2, wallHt / 2, 0);
  created.push(leftWall);

  // Lip bead sits on the wall's top face (Y = wallHt), centred on the mating
  // face (Z = 0), running the full segment length.
  const lip = new THREE.BoxGeometry(segLen, lipH, lipW);
  lip.translate(-runLength / 2 + segLen / 2, wallHt + lipH / 2, 0);
  created.push(lip);

  const lipHalf = csgUnion(leftWall, lip);

  // ── Right wall − groove channel ──────────────────────────────────────────
  const rightWall = new THREE.BoxGeometry(segLen, wallHt, wallThk);
  rightWall.translate(runLength / 2 - segLen / 2, wallHt / 2, 0);
  created.push(rightWall);

  let solid: THREE.BufferGeometry;
  if (includeGroove) {
    // Channel cut down from the top face; overshoot in +Y so CSG opens the
    // top face cleanly instead of leaving a coplanar sliver.
    const cutter = new THREE.BoxGeometry(segLen + 1, grvD + 1, grvW);
    cutter.translate(
      runLength / 2 - segLen / 2,
      wallHt - grvD / 2 + 1, // top of the cutter pokes above the wall by ~1mm
      0,
    );
    created.push(cutter);
    const grooveHalf = csgSubtract(rightWall, cutter);
    solid = csgUnion(lipHalf, grooveHalf);
    lipHalf.dispose();
    grooveHalf.dispose();
  } else {
    solid = csgUnion(lipHalf, rightWall);
    lipHalf.dispose();
  }

  for (const g of created) g.dispose();

  solid.computeVertexNormals();
  return solid;
}
