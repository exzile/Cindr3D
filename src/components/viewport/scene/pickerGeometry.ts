/**
 * pickerGeometry.ts — shared geometry helpers for face/edge picker overlays.
 *
 * Extracted from the duplicated local helpers that existed in every
 * face/edge picker component (AUDIT-22).
 */

import * as THREE from 'three';

/**
 * Build a fan-triangulated BufferGeometry from an ordered boundary polygon.
 * All pickers use an identical fan from vertex[0] — this is the canonical
 * implementation.
 */
export function buildFaceGeometry(boundary: THREE.Vector3[]): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const n = boundary.length;
  if (n < 3) return geom;
  const positions: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    positions.push(...boundary[0].toArray(), ...boundary[i].toArray(), ...boundary[i + 1].toArray());
  }
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Build a two-point LineSegment BufferGeometry for an edge overlay.
 * Used by ChamferEdgeHighlight, FilletEdgeHighlight, and LipGrooveEdgePicker.
 */
export function buildEdgeGeometry(a: THREE.Vector3, b: THREE.Vector3): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setFromPoints([a, b]);
  return geom;
}
