import * as THREE from 'three';

// Unit-capsule template used by every extrusion instance. The vertex shader
// picks a per-vertex anchor side (0 = p0 end, 1 = p1 end), reads the matching
// world-space endpoint and radius from the per-instance attributes, then
// places the vertex by combining the encoded local-frame position with the
// world-space orthonormal basis it derives from `p1 - p0`. One BufferGeometry
// here, one InstancedMesh per layer at the call site — no CPU mesh stitching.
//
// Topology: cylinder body between the two endpoints + a hemisphere cap on
// each end. Hemispheres always overlap the next segment in a continuous
// extrusion path, so joints and turns blend cleanly via the depth buffer
// without miter math, chain detection, or path-break heuristics.

const RADIAL = 12;     // segments around the tube axis
const HEMI_RINGS = 3;  // rings inside each hemisphere (pole -> equator)

export interface CapsuleTemplate {
  geometry: THREE.BufferGeometry;
  trianglesPerInstance: number;
}

function buildTemplate(): CapsuleTemplate {
  // Per vertex attributes:
  //   aSide: 0 if anchored to p0, 1 if anchored to p1.
  //   aLocal: vec3 in a local frame where x = axial (toward p1) and y/z are
  //           the perpendicular plane. Magnitude is in radius units, so the
  //           shader scales by mix(r0, r1, aSide) and rotates by the world
  //           basis to land in scene space.
  const aSide: number[] = [];
  const aLocal: number[] = [];
  const indices: number[] = [];

  let vCount = 0;
  const pushVertex = (side: 0 | 1, lx: number, ly: number, lz: number): number => {
    aSide.push(side);
    aLocal.push(lx, ly, lz);
    return vCount++;
  };

  // Hemisphere at p0: theta = 0 at the pole (most negative axial), pi/2 at
  // the equator (cylinder join). axial = -cos(theta), radial scale = sin.
  // Stored per-ring so we can index quad strips between consecutive rings.
  const startCapRings: number[][] = [];
  for (let r = 0; r <= HEMI_RINGS; r++) {
    const theta = (r / HEMI_RINGS) * Math.PI * 0.5;
    const axial = -Math.cos(theta);
    const radial = Math.sin(theta);
    const ring: number[] = [];
    for (let s = 0; s < RADIAL; s++) {
      const phi = (s / RADIAL) * Math.PI * 2;
      ring.push(pushVertex(0, axial, Math.cos(phi) * radial, Math.sin(phi) * radial));
    }
    startCapRings.push(ring);
  }

  // Hemisphere at p1: mirror axial sign, anchor side = 1.
  const endCapRings: number[][] = [];
  for (let r = 0; r <= HEMI_RINGS; r++) {
    const theta = (r / HEMI_RINGS) * Math.PI * 0.5;
    const axial = Math.cos(theta);
    const radial = Math.sin(theta);
    const ring: number[] = [];
    for (let s = 0; s < RADIAL; s++) {
      const phi = (s / RADIAL) * Math.PI * 2;
      ring.push(pushVertex(1, axial, Math.cos(phi) * radial, Math.sin(phi) * radial));
    }
    endCapRings.push(ring);
  }

  const startEquator = startCapRings[HEMI_RINGS];
  const endEquator = endCapRings[HEMI_RINGS];

  // Stitch quads between adjacent rings with consistent winding. Cylinder
  // body uses the two equators; hemispheres use their own ring sequences.
  const stitchRings = (a: number[], b: number[]) => {
    for (let s = 0; s < RADIAL; s++) {
      const sNext = (s + 1) % RADIAL;
      const a0 = a[s], a1 = a[sNext];
      const b0 = b[s], b1 = b[sNext];
      indices.push(a0, b0, b1);
      indices.push(a0, b1, a1);
    }
  };

  for (let r = 0; r < HEMI_RINGS; r++) stitchRings(startCapRings[r], startCapRings[r + 1]);
  stitchRings(startEquator, endEquator);
  for (let r = HEMI_RINGS; r > 0; r--) stitchRings(endCapRings[r], endCapRings[r - 1]);

  const geometry = new THREE.BufferGeometry();
  // `position` exists only because Three.js requires it for materials that
  // don't override it. The shader ignores it and rebuilds positions from
  // (aSide, aLocal, instance attributes) each frame.
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(aLocal), 3));
  geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(new Float32Array(aSide), 1));
  geometry.setAttribute('aLocal', new THREE.Float32BufferAttribute(new Float32Array(aLocal), 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return {
    geometry,
    trianglesPerInstance: indices.length / 3,
  };
}

let cached: CapsuleTemplate | null = null;

export function getCapsuleTemplate(): CapsuleTemplate {
  if (!cached) cached = buildTemplate();
  return cached;
}

export const CAPSULE_RADIAL = RADIAL;
export const CAPSULE_HEMI_RINGS = HEMI_RINGS;
