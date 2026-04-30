import * as THREE from 'three';

// Analytic ray-capsule intersection tests for picking the instanced
// extrusion preview. Three.js's default InstancedMesh.raycast() applies
// each instance's instanceMatrix to the geometry's CPU position attribute
// and intersects triangles — but our capsule is positioned ENTIRELY in the
// shader from per-instance attributes (iA/iB/iRadius), and instanceMatrix
// stays identity. Default raycasting therefore tests every ray against a
// unit capsule at the world origin and picks always returns instanceId 0
// (or misses entirely). This module skips the triangle test and intersects
// the ray against the analytic capsule shape directly, which is also
// faster than triangle iteration for our default 96-tris-per-capsule
// template.

// Scratches for makeCapsuleRaycaster (the outer driver). intersectRayCapsule
// and raySphere keep their OWN scratches below — they must not share these,
// because the outer driver passes its `_rcOrigin`/`_rcDir` into the helpers
// as `rayOrigin`/`rayDir`. If a helper mutated the same scratch in place, the
// next per-instance test would read a corrupted origin.
const _rcInvMat = new THREE.Matrix4();
const _rcOrigin = new THREE.Vector3();
const _rcDir    = new THREE.Vector3();
const _capP0    = new THREE.Vector3();
const _capP1    = new THREE.Vector3();
const _capLocal = new THREE.Vector3();
const _capWorld = new THREE.Vector3();

// Scratches private to intersectRayCapsule.
const _icBA = new THREE.Vector3();
const _icOA = new THREE.Vector3();

// Scratches private to raySphere.
const _rsOC = new THREE.Vector3();

/**
 * Ray vs swept-sphere capsule intersection. Returns the smallest non-negative
 * `t` along the ray where it enters the capsule, or `null` if it misses.
 *
 * The capsule is the locus of points within `radius` of the segment p0..p1 —
 * cylinder body plus hemispherical caps at each endpoint. Algorithm follows
 * the standard analytic form (e.g. Inigo Quilez's rayCapsuleIntersect): solve
 * the quadratic for the cylinder, then fall back to a sphere test at the
 * relevant endpoint when the cylinder solution lands outside the segment.
 */
export function intersectRayCapsule(
  rayOrigin: THREE.Vector3,
  rayDir: THREE.Vector3,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  radius: number,
): number | null {
  const ba = _icBA.copy(p1).sub(p0);
  const oa = _icOA.copy(rayOrigin).sub(p0);
  const baba = ba.dot(ba);
  if (baba < 1e-12) {
    // Degenerate segment — fall back to ray-sphere on p0.
    return raySphere(rayOrigin, rayDir, p0, radius);
  }
  const bard = ba.dot(rayDir);
  const baoa = ba.dot(oa);
  const rdoa = rayDir.dot(oa);
  const oaoa = oa.dot(oa);

  const a = baba - bard * bard;
  const b = baba * rdoa - baoa * bard;
  const c = baba * oaoa - baoa * baoa - radius * radius * baba;
  const h = b * b - a * c;

  if (h >= 0) {
    const sqh = Math.sqrt(h);
    // Two intersection candidates with the infinite cylinder; pick the
    // nearer one. Fall through to cap tests if neither is within the
    // segment's length.
    for (const sign of [-1, 1] as const) {
      if (a < 1e-12) break;
      const t = (-b + sign * sqh) / a;
      if (t < 0) continue;
      const y = baoa + t * bard;
      if (y >= 0 && y <= baba) return t;
    }
  }

  // Cap tests: pick the endpoint whose hemisphere the ray closest approach
  // sits over (y < 0 → p0 cap, y > baba → p1 cap), then ray-sphere there.
  const t0 = raySphere(rayOrigin, rayDir, p0, radius);
  const t1 = raySphere(rayOrigin, rayDir, p1, radius);
  if (t0 === null) return t1;
  if (t1 === null) return t0;
  return t0 < t1 ? t0 : t1;
}

function raySphere(
  rayOrigin: THREE.Vector3,
  rayDir: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
): number | null {
  const oc = _rsOC.copy(rayOrigin).sub(center);
  const b = oc.dot(rayDir);
  const c = oc.dot(oc) - radius * radius;
  const h = b * b - c;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : null;
}

/**
 * Custom InstancedMesh.raycast that tests the ray against analytic capsules
 * defined by per-instance iA/iB/iRadius attributes. Attach via
 * `mesh.raycast = makeCapsuleRaycaster(...)` after construction.
 *
 * The mesh's `boundingSphere` is used for early rejection of the whole
 * draw call (caller is expected to set it from buildLayerInstances output).
 */
export function makeCapsuleRaycaster(
  mesh: THREE.InstancedMesh,
  iA: Float32Array,
  iB: Float32Array,
  iRadius: Float32Array,
  count: number,
) {
  return function raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    if (count === 0) return;
    const matrixWorld = mesh.matrixWorld;
    const sphere = mesh.geometry.boundingSphere;
    if (sphere !== null) {
      const worldSphere = new THREE.Sphere().copy(sphere).applyMatrix4(matrixWorld);
      if (raycaster.ray.intersectsSphere(worldSphere) === false) return;
    }

    // Inverse-transform the ray into the mesh's local space ONCE so each
    // per-instance test stays a few dot products and a sqrt.
    _rcInvMat.copy(matrixWorld).invert();
    _rcOrigin.copy(raycaster.ray.origin).applyMatrix4(_rcInvMat);
    _rcDir.copy(raycaster.ray.direction).transformDirection(_rcInvMat);

    for (let i = 0; i < count; i++) {
      _capP0.set(iA[i * 3], iA[i * 3 + 1], iA[i * 3 + 2]);
      _capP1.set(iB[i * 3], iB[i * 3 + 1], iB[i * 3 + 2]);
      // Use the larger of the two end radii so a tapered capsule's hit test
      // is conservative. Picking precision at the half-mm level isn't
      // affected by this slack.
      const radius = Math.max(iRadius[i * 2], iRadius[i * 2 + 1]);
      const t = intersectRayCapsule(_rcOrigin, _rcDir, _capP0, _capP1, radius);
      if (t === null) continue;

      // Reconstruct the world-space hit point + distance so callers get the
      // same Intersection shape Three.js produces for normal meshes. Allocate
      // the returned Vector3 (callers may retain it across frames); the
      // intermediate stays on a scratch.
      _capLocal.copy(_rcDir).multiplyScalar(t).add(_rcOrigin);
      const worldPoint = _capWorld.copy(_capLocal).applyMatrix4(matrixWorld).clone();
      const distance = raycaster.ray.origin.distanceTo(worldPoint);
      if (distance < raycaster.near || distance > raycaster.far) continue;

      intersects.push({
        distance,
        point: worldPoint,
        object: mesh,
        instanceId: i,
      });
    }
    intersects.sort((a, b) => a.distance - b.distance);
  };
}
