import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { intersectRayCapsule, makeCapsuleRaycaster } from './capsuleRaycast';

// Analytic ray-capsule intersection underpins picking the instanced
// extrusion preview. Three.js's default InstancedMesh.raycast uses CPU
// position + instanceMatrix and would always miss our shader-positioned
// capsules; these tests pin the contract that picking actually hits the
// capsule each instance represents.

describe('intersectRayCapsule', () => {
  const r = 0.5;
  const p0 = new THREE.Vector3(0, 0, 0);
  const p1 = new THREE.Vector3(10, 0, 0);

  it('hits a ray aimed at the cylinder body from straight above', () => {
    const t = intersectRayCapsule(
      new THREE.Vector3(5, 0, 5),
      new THREE.Vector3(0, 0, -1),
      p0, p1, r,
    );
    expect(t).not.toBeNull();
    // Ray enters the top of the cylinder at z = +radius.
    expect(t!).toBeCloseTo(5 - r, 4);
  });

  it('misses when the ray is well outside the start hemisphere', () => {
    const t = intersectRayCapsule(
      new THREE.Vector3(-2, 0, 5),
      new THREE.Vector3(0, 0, -1),
      p0, p1, r,
    );
    expect(t).toBeNull(); // X = -2 is well outside the start cap (r = 0.5)
  });

  it('hits the end hemisphere when the ray is centred over p1', () => {
    const t = intersectRayCapsule(
      new THREE.Vector3(10, 0, 5),
      new THREE.Vector3(0, 0, -1),
      p0, p1, r,
    );
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(5 - r, 4);
  });

  it('hits the start cap a bit past the endpoint along the axis', () => {
    // Just past p0 along -X, within radius — should hit the start hemisphere.
    const t = intersectRayCapsule(
      new THREE.Vector3(-0.3, 0, 5),
      new THREE.Vector3(0, 0, -1),
      p0, p1, r,
    );
    expect(t).not.toBeNull();
  });

  it('misses when the ray clears the body by more than radius (off-axis ray)', () => {
    // Y = 1 puts the ray 1 mm off the capsule's X-axis — well clear of
    // r = 0.1, so it should miss the body and both spherical end caps.
    const t = intersectRayCapsule(
      new THREE.Vector3(5, 1, 5),
      new THREE.Vector3(0, 0, -1),
      p0, p1, 0.1,
    );
    expect(t).toBeNull();
  });

  it('misses when the ray points away from the capsule', () => {
    const t = intersectRayCapsule(
      new THREE.Vector3(5, 0, 5),
      new THREE.Vector3(0, 0, +1),
      p0, p1, r,
    );
    expect(t).toBeNull();
  });

  it('hits a degenerate (zero-length) capsule as a sphere', () => {
    const t = intersectRayCapsule(
      new THREE.Vector3(0, 0, 5),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
      r,
    );
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(5 - r, 4);
  });

  it('hits along an arbitrary axis (not axis-aligned)', () => {
    const t = intersectRayCapsule(
      new THREE.Vector3(0, 5, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(1, 0, 0),
      0.5,
    );
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(5 - 0.5, 4);
  });
});

describe('makeCapsuleRaycaster', () => {
  function makeMesh(iA: Float32Array, iB: Float32Array, iRadius: Float32Array, count: number) {
    const geom = new THREE.BufferGeometry();
    // Bounds spanning every instance — same shape buildLayerInstances emits.
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(5, 0, 0), 12);
    const mat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.InstancedMesh(geom, mat, count);
    mesh.matrixWorld.identity();
    mesh.raycast = makeCapsuleRaycaster(mesh, iA, iB, iRadius, count);
    return mesh;
  }

  it('returns instanceId of the closest capsule to the ray', () => {
    // Three capsules along X, picked with a ray from above the middle one.
    const iA = new Float32Array([
      0, 0, 0,
       5, 0, 0,
      10, 0, 0,
    ]);
    const iB = new Float32Array([
      2, 0, 0,
       7, 0, 0,
      12, 0, 0,
    ]);
    const iRadius = new Float32Array([
      0.4, 0.4,
      0.4, 0.4,
      0.4, 0.4,
    ]);
    const mesh = makeMesh(iA, iB, iRadius, 3);

    const ray = new THREE.Raycaster(
      new THREE.Vector3(6, 0, 5),
      new THREE.Vector3(0, 0, -1),
    );
    const intersects: THREE.Intersection[] = [];
    mesh.raycast(ray, intersects);

    expect(intersects.length).toBeGreaterThan(0);
    expect(intersects[0].instanceId).toBe(1);
  });

  it('returns no intersections when the ray misses every capsule', () => {
    const iA = new Float32Array([0, 0, 0, 5, 0, 0]);
    const iB = new Float32Array([2, 0, 0, 7, 0, 0]);
    const iRadius = new Float32Array([0.2, 0.2, 0.2, 0.2]);
    const mesh = makeMesh(iA, iB, iRadius, 2);

    // Ray well above the capsules, pointed up — never hits.
    const ray = new THREE.Raycaster(
      new THREE.Vector3(6, 0, 5),
      new THREE.Vector3(0, 0, +1),
    );
    const intersects: THREE.Intersection[] = [];
    mesh.raycast(ray, intersects);
    expect(intersects.length).toBe(0);
  });

  it('respects raycaster.near / .far bounds', () => {
    const iA = new Float32Array([0, 0, 0]);
    const iB = new Float32Array([2, 0, 0]);
    const iRadius = new Float32Array([0.4, 0.4]);
    const mesh = makeMesh(iA, iB, iRadius, 1);

    const ray = new THREE.Raycaster(
      new THREE.Vector3(1, 0, 5),
      new THREE.Vector3(0, 0, -1),
    );
    ray.near = 0;
    ray.far = 1; // hit is at z=5-0.4=4.6, so distance from origin is 4.6 > 1
    const intersects: THREE.Intersection[] = [];
    mesh.raycast(ray, intersects);
    expect(intersects.length).toBe(0);
  });

  it('rejects all rays via bounding sphere when count is 0', () => {
    const mesh = makeMesh(new Float32Array(), new Float32Array(), new Float32Array(), 0);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(0, 0, 5),
      new THREE.Vector3(0, 0, -1),
    );
    const intersects: THREE.Intersection[] = [];
    mesh.raycast(ray, intersects);
    expect(intersects.length).toBe(0);
  });

  it('reports intersections sorted by distance', () => {
    // Two overlapping capsules — picking ray hits both, closer one first.
    const iA = new Float32Array([0, 0, 0, 0, 0, -2]);
    const iB = new Float32Array([2, 0, 0, 2, 0, -2]);
    const iRadius = new Float32Array([0.4, 0.4, 0.4, 0.4]);
    const mesh = makeMesh(iA, iB, iRadius, 2);

    const ray = new THREE.Raycaster(
      new THREE.Vector3(1, 0, 5),
      new THREE.Vector3(0, 0, -1),
    );
    const intersects: THREE.Intersection[] = [];
    mesh.raycast(ray, intersects);

    expect(intersects.length).toBe(2);
    // Closer = capsule 0 at z=0.
    expect(intersects[0].instanceId).toBe(0);
    expect(intersects[1].instanceId).toBe(1);
    expect(intersects[0].distance).toBeLessThan(intersects[1].distance);
  });
});
