/**
 * shellSolid — Fusion 360-parity solid Shell.
 *
 * Produces a watertight hollow solid (single THREE.Mesh, world-space) from a
 * closed input body. Unlike the legacy vertex-push `shellMesh`, this:
 *   - hollows via CSG so the result is always a valid manifold solid,
 *   - supports independent inside/outside thickness (Fusion's two-thickness
 *     model — inward / outward / both),
 *   - removes selected faces, producing real openings with rim walls,
 *   - supports per-face wall-thickness overrides (Fusion "Individual Faces"),
 *   - supports sharp vs rounded inner corners (Fusion ShellTypes).
 *
 * Geometry approach: build an inner (eroded) and/or outer (dilated) offset
 * solid, then `outer − inner` via three-bvh-csg. For each removed face a
 * prism cutter spanning the full wall band is subtracted; CSG generates the
 * rim walls automatically and keeps the body watertight.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { csgSubtract } from '../solid/csg';
import { extractEdgeTopology } from '../solid/edgeTopology';
import { computePlaneAxesFromNormal } from '../../planeUtils';

export interface ShellFaceSpec {
  /** World, unit. */
  normal: THREE.Vector3;
  /** World. */
  centroid: THREE.Vector3;
  /** World polygon, ordered around the face. */
  boundary: THREE.Vector3[];
  /** Per-face wall-thickness override (Fusion "Individual Faces"). */
  thickness?: number;
}

export interface ShellOptions {
  /** Inward wall thickness (≥ 0). */
  insideThickness: number;
  /** Outward wall thickness (≥ 0). */
  outsideThickness: number;
  /** Faces to remove → openings. */
  removeFaces: ShellFaceSpec[];
  /** Faces whose surrounding wall uses a different thickness. */
  faceThicknesses?: ShellFaceSpec[];
  /** Sharp keeps crisp inner corners; rounded blends them (Fusion ShellTypes). */
  shellType: 'sharp' | 'rounded';
}

const EPS = 1e-4;

function worldGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  let g = mesh.geometry.clone();
  mesh.updateWorldMatrix(true, false);
  g.applyMatrix4(mesh.matrixWorld);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  return g;
}

/** Solve (Σ nₖnₖᵀ) d = b for d (3×3, regularised). Used for sharp corners. */
function solve3(A: number[], b: THREE.Vector3): THREE.Vector3 {
  // A is row-major 9-array; add small ridge so coincident planes stay stable.
  const a00 = A[0] + 1e-6, a01 = A[1], a02 = A[2];
  const a10 = A[3], a11 = A[4] + 1e-6, a12 = A[5];
  const a20 = A[6], a21 = A[7], a22 = A[8] + 1e-6;
  const det =
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20);
  if (Math.abs(det) < 1e-12) return new THREE.Vector3();
  const id = 1 / det;
  const x =
    (b.x * (a11 * a22 - a12 * a21) - a01 * (b.y * a22 - a12 * b.z) + a02 * (b.y * a21 - a11 * b.z)) * id;
  const y =
    (a00 * (b.y * a22 - a12 * b.z) - b.x * (a10 * a22 - a12 * a20) + a02 * (a10 * b.z - b.y * a20)) * id;
  const z =
    (a00 * (a11 * b.z - b.y * a21) - a01 * (a10 * b.z - b.y * a20) + b.x * (a10 * a21 - a11 * a20)) * id;
  return new THREE.Vector3(x, y, z);
}

/**
 * Offset a closed indexed geometry along its surface by `signedDist` (negative
 * = inward). `sharp` solves per-vertex incident-face-plane intersection so
 * planar corners stay crisp; otherwise the averaged vertex normal is used,
 * which naturally rounds convex corners. `faceOverride(vi)` may return a
 * per-vertex thickness magnitude (variable wall).
 */
function offsetSolid(
  base: THREE.BufferGeometry,
  signedDist: number,
  sharp: boolean,
  faceOverride: (vi: number) => number | null,
): THREE.BufferGeometry {
  const g = base.clone();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const idx = g.index!;
  const sign = Math.sign(signedDist) || -1;

  // Gather incident triangle face-normals per vertex (for sharp solve).
  const incident: Map<number, THREE.Vector3[]> = new Map();
  if (sharp) {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < idx.count; i += 3) {
      const i0 = idx.getX(i), i1 = idx.getX(i + 1), i2 = idx.getX(i + 2);
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      const fn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (fn.lengthSq() < 1e-12) continue;
      fn.normalize();
      for (const vi of [i0, i1, i2]) {
        let arr = incident.get(vi);
        if (!arr) { arr = []; incident.set(vi, arr); }
        if (!arr.some((n) => n.dot(fn) > 0.9999)) arr.push(fn);
      }
    }
  }

  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const ov = faceOverride(i);
    const mag = ov != null ? ov : Math.abs(signedDist);
    v.fromBufferAttribute(pos, i);
    if (sharp && incident.has(i)) {
      const planes = incident.get(i)!;
      // Each incident plane moves inward along its own normal by `mag`.
      const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      const rhs = new THREE.Vector3();
      for (const n of planes) {
        A[0] += n.x * n.x; A[1] += n.x * n.y; A[2] += n.x * n.z;
        A[3] += n.y * n.x; A[4] += n.y * n.y; A[5] += n.y * n.z;
        A[6] += n.z * n.x; A[7] += n.z * n.y; A[8] += n.z * n.z;
        const t = sign * mag;
        rhs.x += n.x * t; rhs.y += n.y * t; rhs.z += n.z * t;
      }
      const d = solve3(A, rhs);
      pos.setXYZ(i, v.x + d.x, v.y + d.y, v.z + d.z);
    } else {
      const n = new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).normalize();
      pos.setXYZ(i, v.x + n.x * sign * mag, v.y + n.y * sign * mag, v.z + n.z * sign * mag);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Build a closed prism that spans the full wall band along the face normal. */
function buildFaceCutter(
  spec: ShellFaceSpec,
  outDist: number,
  inDist: number,
): THREE.BufferGeometry | null {
  const poly = spec.boundary;
  if (poly.length < 3) return null;
  const n = spec.normal.clone().normalize();
  const { t1, t2 } = computePlaneAxesFromNormal(n);
  const origin = poly[0];

  // Project boundary to the face plane for triangulation.
  const pts2: THREE.Vector2[] = poly.map((p) => {
    const d = p.clone().sub(origin);
    return new THREE.Vector2(d.dot(t1), d.dot(t2));
  });
  const tris = THREE.ShapeUtils.triangulateShape(pts2, []);
  if (tris.length === 0) return null;

  const top = poly.map((p) => p.clone().addScaledVector(n, outDist));
  const bot = poly.map((p) => p.clone().addScaledVector(n, -inDist));
  const verts: number[] = [];
  const push = (p: THREE.Vector3) => verts.push(p.x, p.y, p.z);

  // Caps (top faces +n, bottom faces -n → consistent outward winding).
  for (const [x, y, z] of tris) {
    push(top[x]); push(top[y]); push(top[z]);
    push(bot[x]); push(bot[z]); push(bot[y]);
  }
  // Sides.
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    push(top[i]); push(bot[i]); push(bot[j]);
    push(top[i]); push(bot[j]); push(top[j]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

/** Returns true when `p` lies on the face's plane within the face footprint. */
function vertOnFace(p: THREE.Vector3, spec: ShellFaceSpec, planeTol: number): boolean {
  const n = spec.normal;
  if (Math.abs(n.dot(p) - n.dot(spec.centroid)) > planeTol) return false;
  // Cheap footprint test: within bbox of the boundary polygon (+tol).
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  const { t1, t2 } = computePlaneAxesFromNormal(n);
  const o = spec.centroid;
  for (const b of spec.boundary) {
    const d = b.clone().sub(o);
    const a = d.dot(t1), c = d.dot(t2);
    minA = Math.min(minA, a); maxA = Math.max(maxA, a);
    minB = Math.min(minB, c); maxB = Math.max(maxB, c);
  }
  const dp = p.clone().sub(o);
  const pa = dp.dot(t1), pb = dp.dot(t2);
  return pa >= minA - planeTol && pa <= maxA + planeTol && pb >= minB - planeTol && pb <= maxB + planeTol;
}

export function shellSolid(mesh: THREE.Mesh, opts: ShellOptions): THREE.Mesh {
  const { insideThickness: tin, outsideThickness: tout, removeFaces, shellType } = opts;
  const sharp = shellType === 'sharp';
  const outer = worldGeometry(mesh);

  if (!outer.boundingSphere) outer.computeBoundingSphere();
  const radius = outer.boundingSphere?.radius ?? 1;
  const planeTol = Math.max(0.01, radius * 0.01);
  const overrides = opts.faceThicknesses ?? [];

  // Per-vertex thickness override: a vertex on an overridden face uses that
  // face's thickness for the inward offset (variable wall).
  const posOuter = outer.attributes.position as THREE.BufferAttribute;
  const vScratch = new THREE.Vector3();
  const overrideFor = (vi: number): number | null => {
    if (overrides.length === 0) return null;
    vScratch.fromBufferAttribute(posOuter, vi);
    for (const f of overrides) {
      if (f.thickness == null || f.thickness <= 0) continue;
      if (vertOnFace(vScratch, f, planeTol)) return f.thickness;
    }
    return null;
  };

  // ── Build the hollow wall band via CSG ──────────────────────────────────
  let hollow: THREE.BufferGeometry;
  if (tin > 0 && tout <= 0) {
    const inner = offsetSolid(outer, -tin, sharp, overrideFor);
    hollow = csgSubtract(outer, inner);
    inner.dispose();
  } else if (tout > 0 && tin <= 0) {
    const expanded = offsetSolid(outer, tout, sharp, () => null);
    hollow = csgSubtract(expanded, outer);
    expanded.dispose();
  } else if (tin > 0 && tout > 0) {
    const expanded = offsetSolid(outer, tout, sharp, () => null);
    const inner = offsetSolid(outer, -tin, sharp, overrideFor);
    hollow = csgSubtract(expanded, inner);
    expanded.dispose();
    inner.dispose();
  } else {
    // Nothing to do — return a copy of the input.
    const m = new THREE.Mesh(outer, mesh.material);
    m.userData = { ...mesh.userData };
    return m;
  }
  outer.dispose();

  // ── Punch openings for removed faces ────────────────────────────────────
  const span = tin + tout;
  for (const spec of removeFaces) {
    const cutter = buildFaceCutter(spec, tout + span + EPS, tin + span + EPS);
    if (!cutter) continue;
    try {
      const next = csgSubtract(hollow, cutter);
      hollow.dispose();
      hollow = next;
    } catch {
      // Degenerate face boundary — skip this opening rather than abort.
    }
    cutter.dispose();
  }

  hollow.deleteAttribute('uv');
  const cleaned = mergeVertices(hollow, 1e-4);
  hollow.dispose();
  cleaned.computeVertexNormals();
  try { cleaned.userData.topology = extractEdgeTopology(cleaned); } catch { /* non-fatal */ }
  const result = new THREE.Mesh(cleaned, mesh.material);
  result.userData = { ...mesh.userData, topology: cleaned.userData.topology };
  return result;
}
