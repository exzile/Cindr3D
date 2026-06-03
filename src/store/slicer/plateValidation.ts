import * as THREE from 'three';
import type { PlateObject } from '../../types/slicer';

export interface PlateValidation {
  outOfBounds: string[];
  overlapping: Array<[string, string]>;
  issuesById: Map<string, string[]>;
  hasIssues: boolean;
}

interface ObjectAabb {
  id: string;
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

interface ObjectObb {
  id: string;
  center: THREE.Vector3;
  halfExtents: THREE.Vector3;
  axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

function worldObb(obj: PlateObject): ObjectObb | null {
  const sx = (obj.scale?.x ?? 1) * (obj.mirrorX ? -1 : 1);
  const sy = (obj.scale?.y ?? 1) * (obj.mirrorY ? -1 : 1);
  const sz = (obj.scale?.z ?? 1) * (obj.mirrorZ ? -1 : 1);
  // rotation is stored in radians throughout the slicer store
  const rx = obj.rotation?.x ?? 0;
  const ry = obj.rotation?.y ?? 0;
  const rz = obj.rotation?.z ?? 0;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  const minLocal = new THREE.Vector3(obj.boundingBox.min.x, obj.boundingBox.min.y, obj.boundingBox.min.z);
  const maxLocal = new THREE.Vector3(obj.boundingBox.max.x, obj.boundingBox.max.y, obj.boundingBox.max.z);
  if (!isFinite(minLocal.x) || !isFinite(maxLocal.x)) return null;
  // OBB centre in world: rotate the local-AABB centre then translate.
  const centerLocal = minLocal.clone().add(maxLocal).multiplyScalar(0.5);
  centerLocal.set(centerLocal.x * sx, centerLocal.y * sy, centerLocal.z * sz).applyQuaternion(q);
  const center = new THREE.Vector3(obj.position.x, obj.position.y, obj.position.z).add(centerLocal);
  // Half-extents along the rotated local axes (signed scale already baked
  // into the magnitudes; abs because half-extents are unsigned).
  const halfExtents = new THREE.Vector3(
    Math.abs((maxLocal.x - minLocal.x) * 0.5 * sx),
    Math.abs((maxLocal.y - minLocal.y) * 0.5 * sy),
    Math.abs((maxLocal.z - minLocal.z) * 0.5 * sz),
  );
  const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize();
  const ay = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize();
  const az = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
  return { id: obj.id, center, halfExtents, axes: [ax, ay, az] };
}

/**
 * Separating-Axis-Theorem OBB-vs-OBB intersection test. Returns true if
 * the two oriented bounding boxes overlap (penetration > eps along every
 * tested axis). Standard Gottschalk implementation.
 */
function obbsOverlap(a: ObjectObb, b: ObjectObb, eps = 0.01): boolean {
  const T = b.center.clone().sub(a.center);
  const R: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const AbsR: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      R[i][j] = a.axes[i].dot(b.axes[j]);
      AbsR[i][j] = Math.abs(R[i][j]) + 1e-6;
    }
  }
  const tA = [a.halfExtents.x, a.halfExtents.y, a.halfExtents.z];
  const tB = [b.halfExtents.x, b.halfExtents.y, b.halfExtents.z];
  const Tarr = [T.dot(a.axes[0]), T.dot(a.axes[1]), T.dot(a.axes[2])];

  // Test axes A0, A1, A2
  for (let i = 0; i < 3; i++) {
    const ra = tA[i];
    const rb = tB[0] * AbsR[i][0] + tB[1] * AbsR[i][1] + tB[2] * AbsR[i][2];
    if (Math.abs(Tarr[i]) > ra + rb + eps) return false;
  }
  // Test axes B0, B1, B2
  for (let i = 0; i < 3; i++) {
    const ra = tA[0] * AbsR[0][i] + tA[1] * AbsR[1][i] + tA[2] * AbsR[2][i];
    const rb = tB[i];
    const t = Math.abs(Tarr[0] * R[0][i] + Tarr[1] * R[1][i] + Tarr[2] * R[2][i]);
    if (t > ra + rb + eps) return false;
  }
  // Test cross-product axes (9 of them)
  const cross = (i: number, j: number) => {
    const ra = tA[(i + 1) % 3] * AbsR[(i + 2) % 3][j] + tA[(i + 2) % 3] * AbsR[(i + 1) % 3][j];
    const rb = tB[(j + 1) % 3] * AbsR[i][(j + 2) % 3] + tB[(j + 2) % 3] * AbsR[i][(j + 1) % 3];
    const t = Math.abs(
      Tarr[(i + 2) % 3] * R[(i + 1) % 3][j]
      - Tarr[(i + 1) % 3] * R[(i + 2) % 3][j],
    );
    return t <= ra + rb + eps;
  };
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (!cross(i, j)) return false;
  return true;
}

/**
 * Compute the world-space axis-aligned bounding box of a plate object after
 * its full transform (translation, rotation, scale, mirror). Used by both
 * out-of-bounds and overlap detection.
 */
function worldAabb(obj: PlateObject): ObjectAabb | null {
  const sx = (obj.scale?.x ?? 1) * (obj.mirrorX ? -1 : 1);
  const sy = (obj.scale?.y ?? 1) * (obj.mirrorY ? -1 : 1);
  const sz = (obj.scale?.z ?? 1) * (obj.mirrorZ ? -1 : 1);
  // rotation is stored in radians throughout the slicer store
  const rx = obj.rotation?.x ?? 0;
  const ry = obj.rotation?.y ?? 0;
  const rz = obj.rotation?.z ?? 0;
  const mat = new THREE.Matrix4().compose(
    new THREE.Vector3(obj.position.x, obj.position.y, obj.position.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  const corners = [
    [obj.boundingBox.min.x, obj.boundingBox.min.y, obj.boundingBox.min.z],
    [obj.boundingBox.max.x, obj.boundingBox.min.y, obj.boundingBox.min.z],
    [obj.boundingBox.min.x, obj.boundingBox.max.y, obj.boundingBox.min.z],
    [obj.boundingBox.max.x, obj.boundingBox.max.y, obj.boundingBox.min.z],
    [obj.boundingBox.min.x, obj.boundingBox.min.y, obj.boundingBox.max.z],
    [obj.boundingBox.max.x, obj.boundingBox.min.y, obj.boundingBox.max.z],
    [obj.boundingBox.min.x, obj.boundingBox.max.y, obj.boundingBox.max.z],
    [obj.boundingBox.max.x, obj.boundingBox.max.y, obj.boundingBox.max.z],
  ];
  const v = new THREE.Vector3();
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of corners) {
    v.set(x, y, z).applyMatrix4(mat);
    if (!isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)) return null;
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }
  return { id: obj.id, min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

const EPS = 0.01; // ~10 microns; below this we don't flag overlap or oob

export function validatePlate(
  plateObjects: PlateObject[],
  buildVolume: { x: number; y: number; z: number },
  options: { originCenter?: boolean } = {},
): PlateValidation {
  const issuesById = new Map<string, string[]>();
  const outOfBounds: string[] = [];
  const overlapping: Array<[string, string]> = [];

  const visible = plateObjects.filter((o) => !o.hidden);
  const aabbs: ObjectAabb[] = [];
  for (const obj of visible) {
    const a = worldAabb(obj);
    if (!a) continue;
    aabbs.push(a);
  }

  // Build volume in plate-local coordinates (origin at corner unless
  // `originCenter`, in which case the bed is centered on (0,0)).
  const minBed = options.originCenter
    ? { x: -buildVolume.x / 2, y: -buildVolume.y / 2, z: 0 }
    : { x: 0, y: 0, z: 0 };
  const maxBed = options.originCenter
    ? { x: buildVolume.x / 2, y: buildVolume.y / 2, z: buildVolume.z }
    : { x: buildVolume.x, y: buildVolume.y, z: buildVolume.z };

  for (const a of aabbs) {
    if (
      a.min.x < minBed.x - EPS || a.max.x > maxBed.x + EPS
      || a.min.y < minBed.y - EPS || a.max.y > maxBed.y + EPS
      || a.min.z < minBed.z - EPS || a.max.z > maxBed.z + EPS
    ) {
      outOfBounds.push(a.id);
      const list = issuesById.get(a.id) ?? [];
      list.push('Outside build volume');
      issuesById.set(a.id, list);
    }
  }

  // First-pass AABB cull, then accurate OBB SAT for any pair that survives.
  // For typical 1-10 plate counts this is effectively free; the OBB step
  // eliminates most false positives caused by rotated thin parts whose
  // world-AABBs overlap but whose oriented boxes don't.
  const obbs = visible.map((o) => worldObb(o)).filter((x): x is ObjectObb => !!x);
  const obbById = new Map(obbs.map((o) => [o.id, o]));
  for (let i = 0; i < aabbs.length; i++) {
    for (let j = i + 1; j < aabbs.length; j++) {
      const a = aabbs[i];
      const b = aabbs[j];
      const overlapX = a.min.x < b.max.x - EPS && a.max.x > b.min.x + EPS;
      const overlapY = a.min.y < b.max.y - EPS && a.max.y > b.min.y + EPS;
      const overlapZ = a.min.z < b.max.z - EPS && a.max.z > b.min.z + EPS;
      if (!(overlapX && overlapY && overlapZ)) continue;
      const oa = obbById.get(a.id);
      const ob = obbById.get(b.id);
      if (oa && ob && !obbsOverlap(oa, ob, EPS)) continue;
      overlapping.push([a.id, b.id]);
      for (const id of [a.id, b.id]) {
        const list = issuesById.get(id) ?? [];
        if (!list.includes('Overlapping with another object')) {
          list.push('Overlapping with another object');
        }
        issuesById.set(id, list);
      }
    }
  }

  return {
    outOfBounds,
    overlapping,
    issuesById,
    hasIssues: outOfBounds.length > 0 || overlapping.length > 0,
  };
}
