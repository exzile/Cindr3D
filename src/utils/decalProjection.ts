/**
 * decalProjection — pure helpers for the Decal tool (D192).
 *
 * Builds a THREE.DecalGeometry that projects a flat image onto the picked
 * face of a target mesh, and loads the chosen image into a THREE.Texture.
 * No React, no store — testable in isolation.
 *
 * The projector box is oriented so its +Z axis aligns with the picked face
 * normal (the projection direction). Width/height come from the dialog's
 * scaleU/scaleV (millimetres); rotation spins the decal about the normal.
 */

import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';

// Module-level scratch — DecalGeometry is built off the 60 Hz path (only on
// commit / target-mesh change) but keeping these stable avoids churn and
// documents the no-per-call-allocation intent.
const _z = new THREE.Vector3(0, 0, 1);
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _size = new THREE.Vector3();

export interface DecalPlacement {
  /** World-space point on the face where the decal centres. */
  point: [number, number, number];
  /** Unit world-space face normal (projection direction). */
  normal: [number, number, number];
  /** Decal footprint width in mm (sketch-U). */
  width: number;
  /** Decal footprint height in mm (sketch-V). */
  height: number;
  /** Roll of the decal about the face normal, degrees. */
  rotationDeg: number;
}

/**
 * Build a DecalGeometry projecting onto `targetMesh`. Returns null when the
 * inputs are degenerate (so callers can skip without throwing).
 *
 * The caller owns the returned geometry and MUST dispose it.
 */
export function buildDecalGeometry(
  targetMesh: THREE.Mesh,
  placement: DecalPlacement,
): THREE.BufferGeometry | null {
  const { point, normal, width, height, rotationDeg } = placement;
  if (!(width > 0) || !(height > 0)) return null;

  _n.set(normal[0], normal[1], normal[2]);
  if (_n.lengthSq() < 1e-9) return null;
  _n.normalize();

  // Orientation: align the projector's +Z with the face normal, then roll
  // about that normal by the requested rotation.
  _q.setFromUnitVectors(_z, _n);
  _euler.set(0, 0, THREE.MathUtils.degToRad(rotationDeg));
  _qRoll.setFromEuler(_euler);
  _q.multiply(_qRoll);
  _euler.setFromQuaternion(_q);

  _pos.set(point[0], point[1], point[2]);
  // Depth (z extent of the projector box) — generous so the decal wraps
  // slightly around curvature without being clipped by a thin slab.
  const depth = Math.max(width, height) * 2 + 1;
  _size.set(width, height, depth);

  // DecalGeometry consumes the target mesh's world transform internally, so
  // ensure matrices are current before projecting.
  targetMesh.updateMatrixWorld(true);

  try {
    const geom = new DecalGeometry(targetMesh, _pos, _euler, _size);
    const pos = geom.getAttribute('position');
    if (!pos || pos.count === 0) {
      geom.dispose();
      return null;
    }
    return geom;
  } catch {
    return null;
  }
}

/**
 * Load an image (http(s) URL or data: URL) into a THREE.Texture.
 *
 * THREE.TextureLoader handles both http and data: URLs. Resolves with a
 * texture configured for decal use (sRGB, clamped, no mips). The caller
 * owns the texture and MUST dispose it.
 */
export function loadDecalTexture(src: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('decal: empty image source'));
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      src,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      () => reject(new Error(`decal: failed to load image "${src.slice(0, 64)}"`)),
    );
  });
}

/**
 * Material for a decal mesh. Sits ON the surface without z-fighting
 * (polygonOffset pulls it toward the camera) and shows the host body
 * through transparent regions of the image.
 *
 * The caller owns the material and MUST dispose it (and its `.map`).
 */
export function makeDecalMaterial(texture: THREE.Texture, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: THREE.MathUtils.clamp(opacity, 0, 1),
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}
