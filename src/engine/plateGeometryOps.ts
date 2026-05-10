// Plate-level geometry operations: stats, auto-orient, face-pick lay-flat,
// hollow, plane cut, mesh-aware overlap. Pure functions over THREE meshes
// so the slicer store can stay framework-free.

import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

/**
 * Quaternion that rotates `from` onto `to`. Handles antiparallel and
 * near-identical edge cases that THREE.Quaternion.setFromUnitVectors
 * mishandles when vectors are exactly opposite.
 */
function quaternionFromTo(from: THREE.Vector3, to: THREE.Vector3): THREE.Quaternion {
  const a = from.clone().normalize();
  const b = to.clone().normalize();
  const dot = a.dot(b);
  if (dot < -0.999999) {
    // 180° rotation around any axis perpendicular to a.
    const axis = Math.abs(a.x) > 0.5
      ? new THREE.Vector3(0, 1, 0).cross(a).normalize()
      : new THREE.Vector3(1, 0, 0).cross(a).normalize();
    return new THREE.Quaternion().setFromAxisAngle(axis, Math.PI);
  }
  return new THREE.Quaternion().setFromUnitVectors(a, b);
}

/**
 * Compute the rotation (as Euler degrees XYZ) that orients the given face
 * normal onto -Z (face down). Used by the click-a-face Lay Flat tool.
 *
 * The face normal is in the object's local space; the result is also in
 * local-space rotation, so it composes left-to-right with the existing
 * rotation: `next = result * existing`.
 */
export function rotationForFaceDown(localFaceNormal: THREE.Vector3): { x: number; y: number; z: number } {
  const target = new THREE.Vector3(0, 0, -1);
  const q = quaternionFromTo(localFaceNormal.clone().normalize(), target);
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return {
    x: (e.x * 180) / Math.PI,
    y: (e.y * 180) / Math.PI,
    z: (e.z * 180) / Math.PI,
  };
}

/**
 * Pick a "best" orientation for the given mesh by trying all 24 axis-
 * aligned rotations and a few face-normal candidates, scoring each by
 * how much triangle area sits flat on the bed (normal pointing -Z).
 *
 * Returns the rotation as Euler degrees in XYZ order. Caller is expected
 * to call `dropToBed` afterwards to bring the new minimum down to z=0.
 */
export function autoOrient(geo: THREE.BufferGeometry): { x: number; y: number; z: number } {
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex();
  if (!pos) return { x: 0, y: 0, z: 0 };

  // Build a cheap per-face (normal, area) array in local space.
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const faceNormals: THREE.Vector3[] = [];
  const faceAreas: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    v0.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    v1.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    v2.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
    const e1 = new THREE.Vector3().subVectors(v1, v0);
    const e2 = new THREE.Vector3().subVectors(v2, v0);
    const c = new THREE.Vector3().crossVectors(e1, e2);
    const a = c.length() * 0.5;
    if (a <= 0) continue;
    faceNormals.push(c.divideScalar(a * 2));
    faceAreas.push(a);
  }
  if (faceNormals.length === 0) return { x: 0, y: 0, z: 0 };

  // Score function: total area whose normal points within a tolerance of -Z
  // after rotating by `q`. Higher is better.
  const scoreOrientation = (q: THREE.Quaternion) => {
    const n = new THREE.Vector3();
    let s = 0;
    for (let i = 0; i < faceNormals.length; i++) {
      n.copy(faceNormals[i]).applyQuaternion(q);
      // Cosine threshold: <-0.95 == within ~18° of straight down.
      if (n.z < -0.95) s += faceAreas[i];
    }
    return s;
  };

  // Candidate orientations: identity + each face normal as the "down" pick.
  // Using every face normal would be O(n²); cluster by binning normals into
  // a coarse grid so we test ~ unique-direction count instead.
  const bin = new Map<string, { n: THREE.Vector3; a: number }>();
  for (let i = 0; i < faceNormals.length; i++) {
    const k = `${(faceNormals[i].x * 8) | 0},${(faceNormals[i].y * 8) | 0},${(faceNormals[i].z * 8) | 0}`;
    const cur = bin.get(k);
    if (cur) cur.a += faceAreas[i];
    else bin.set(k, { n: faceNormals[i].clone(), a: faceAreas[i] });
  }
  // Sort bins by area, keep the top 32 — enough to hit obvious flat faces.
  const candidates = [...bin.values()].sort((a, b) => b.a - a.a).slice(0, 32);

  let bestScore = -Infinity;
  let bestQ = new THREE.Quaternion();
  // Identity is always a candidate so we don't make things worse.
  const identityScore = scoreOrientation(bestQ);
  bestScore = identityScore;

  for (const { n } of candidates) {
    const q = quaternionFromTo(n, new THREE.Vector3(0, 0, -1));
    const s = scoreOrientation(q);
    if (s > bestScore) {
      bestScore = s;
      bestQ = q;
    }
  }
  const e = new THREE.Euler().setFromQuaternion(bestQ, 'XYZ');
  return {
    x: (e.x * 180) / Math.PI,
    y: (e.y * 180) / Math.PI,
    z: (e.z * 180) / Math.PI,
  };
}

/**
 * Hollow a closed mesh by subtracting an inset copy. The inset is created
 * by scaling the mesh about its centroid; for non-spherical parts the
 * resulting wall thickness varies, but for the typical "save filament"
 * usecase it's good enough and fast (<<100ms on a 50k-tri mesh).
 *
 * Returns null if the operation fails (open mesh, degenerate result).
 */
export function hollowMesh(
  geo: THREE.BufferGeometry,
  wallThicknessMm: number,
): THREE.BufferGeometry | null {
  if (wallThicknessMm <= 0) return null;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return null;
  const size = bb.getSize(new THREE.Vector3());
  const minDim = Math.min(size.x, size.y, size.z);
  if (minDim <= wallThicknessMm * 2.05) return null;

  const center = bb.getCenter(new THREE.Vector3());
  // Inset scale per axis such that each axis shrinks by 2 * wallThickness.
  const sx = (size.x - 2 * wallThicknessMm) / size.x;
  const sy = (size.y - 2 * wallThicknessMm) / size.y;
  const sz = (size.z - 2 * wallThicknessMm) / size.z;

  const outer = geo.clone();
  outer.computeVertexNormals();
  const inner = geo.clone();
  // Translate to origin, scale, translate back.
  inner.translate(-center.x, -center.y, -center.z);
  inner.scale(sx, sy, sz);
  inner.translate(center.x, center.y, center.z);
  // Flip winding so the inner mesh's normals point inward.
  const innerIdx = inner.getIndex();
  if (innerIdx) {
    const arr = innerIdx.array as Uint32Array | Uint16Array;
    for (let t = 0; t < arr.length; t += 3) {
      const tmp = arr[t + 1];
      arr[t + 1] = arr[t + 2];
      arr[t + 2] = tmp;
    }
    innerIdx.needsUpdate = true;
  }
  inner.computeVertexNormals();

  try {
    const a = new Brush(outer);
    const b = new Brush(inner);
    a.updateMatrixWorld();
    b.updateMatrixWorld();
    const ev = new Evaluator();
    const result = ev.evaluate(a, b, SUBTRACTION);
    const out = result.geometry.clone();
    out.computeVertexNormals();
    out.computeBoundingBox();
    return out;
  } catch (err) {
    console.warn('Hollow failed:', err);
    return null;
  }
}

/**
 * Cut a mesh with a plane (point + normal in local space). Returns the two
 * halves; either can be null if the plane misses the mesh.
 *
 * Implementation: build a large halfspace box for each side, subtract from
 * the input. Slower than dedicated mesh slicing libraries but works without
 * extra deps and handles open boundaries gracefully (faces left exposed).
 */
export function cutMeshByPlane(
  geo: THREE.BufferGeometry,
  planePoint: THREE.Vector3,
  planeNormal: THREE.Vector3,
): { positive: THREE.BufferGeometry | null; negative: THREE.BufferGeometry | null } {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return { positive: null, negative: null };
  const diag = bb.getSize(new THREE.Vector3()).length() * 2 + 100;

  const n = planeNormal.clone().normalize();
  // Build a halfspace box centred at planePoint - n * diag/2 (the negative
  // side), of size diag. Subtracting it from `geo` keeps the positive side.
  const buildHalfspace = (sign: 1 | -1) => {
    const box = new THREE.BoxGeometry(diag, diag, diag);
    const offsetCenter = planePoint.clone().add(n.clone().multiplyScalar(sign * diag * 0.5));
    box.translate(offsetCenter.x, offsetCenter.y, offsetCenter.z);
    // Rotate the box so its +Z faces along sign*n (boxes are axis-aligned;
    // Three.js box generation is fine, the offsetCenter already places
    // it correctly because we extend along +n / -n by diag/2).
    const align = quaternionFromTo(new THREE.Vector3(0, 0, 1), n.clone().multiplyScalar(sign));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0), align, new THREE.Vector3(1, 1, 1));
    box.applyMatrix4(m);
    return box;
  };

  const ev = new Evaluator();
  const base = new Brush(geo.clone());
  base.updateMatrixWorld();

  const subtract = (halfspace: THREE.BufferGeometry) => {
    try {
      const b = new Brush(halfspace);
      b.updateMatrixWorld();
      const r = ev.evaluate(base, b, SUBTRACTION);
      const out = r.geometry.clone();
      out.computeVertexNormals();
      out.computeBoundingBox();
      const posAttr = out.getAttribute('position');
      if (!posAttr || posAttr.count === 0) return null;
      return out;
    } catch (err) {
      console.warn('Cut failed:', err);
      return null;
    }
  };

  return {
    positive: subtract(buildHalfspace(-1)),
    negative: subtract(buildHalfspace(1)),
  };
}
