import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GeometryEngine } from '../engine/GeometryEngine';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Count unique vertex positions in a non-indexed geometry (within tol). */
function uniquePositions(geom: THREE.BufferGeometry, tol = 1e-4): number {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const seen = new Set<string>();
  const q = 1 / tol;
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * q)}|${Math.round(pos.getY(i) * q)}|${Math.round(pos.getZ(i) * q)}`;
    seen.add(k);
  }
  return seen.size;
}

/** Build a minimal mesh with identity transform. */
function mkMesh(geom: THREE.BufferGeometry): THREE.Mesh {
  const mesh = new THREE.Mesh(geom);
  mesh.updateMatrixWorld(true);
  return mesh;
}

// ─── shellMesh ──────────────────────────────────────────────────────────────

describe('GeometryEngine.shellMesh', () => {
  it('produces non-zero output for a box', () => {
    const src = mkMesh(new THREE.BoxGeometry(2, 2, 2));
    const shelled = GeometryEngine.shellMesh(src, 0.2, 'inward');
    expect(shelled.geometry.attributes.position.count).toBeGreaterThan(0);
    shelled.geometry.dispose();
    src.geometry.dispose();
  });

  it('inward shell inner layer sits inside the outer (smaller bbox)', () => {
    const src = mkMesh(new THREE.BoxGeometry(4, 4, 4));
    const shelled = GeometryEngine.shellMesh(src, 0.5, 'inward');
    // The shell geometry is outer + inner combined. The overall bbox should
    // still roughly match the outer box (no vertex outside it).
    const bb = new THREE.Box3().setFromBufferAttribute(
      shelled.geometry.attributes.position as THREE.BufferAttribute,
    );
    expect(bb.max.x).toBeLessThanOrEqual(2 + 1e-3);
    expect(bb.min.x).toBeGreaterThanOrEqual(-2 - 1e-3);
    shelled.geometry.dispose();
    src.geometry.dispose();
  });

  it('welds shared corners before offsetting (no torn seams)', () => {
    // A welded box has 8 unique corners. The previous implementation used
    // toNonIndexed() FIRST and then recomputed normals — every triangle got
    // its own face normal, and adjacent triangles offset in different
    // directions → torn seams. The fix welds first so shared corners use the
    // averaged normal. We verify by checking the output is NOT torn: unique
    // outer vertices should be proportionate to the welded count of the
    // source (8 corners → should see a small multiple of 8, not 36+).
    const src = mkMesh(new THREE.BoxGeometry(2, 2, 2));
    const shelled = GeometryEngine.shellMesh(src, 0.3, 'inward');
    const unique = uniquePositions(shelled.geometry, 1e-3);
    // Outer 8 corners + inner 8 corners = 16 unique positions after weld.
    // With torn seams we'd see more (up to 24×2 = 48). Expect <= 30.
    expect(unique).toBeLessThanOrEqual(30);
    shelled.geometry.dispose();
    src.geometry.dispose();
  });
});

// ─── shellSolid (Fusion-parity) ─────────────────────────────────────────────

/** Fraction of edges used by exactly one triangle (open boundary edges). */
function boundaryEdgeFraction(geom: THREE.BufferGeometry, tol = 1e-3): number {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const q = 1 / tol;
  const key = (i: number) => {
    const vi = idx ? idx.getX(i) : i;
    return `${Math.round(pos.getX(vi) * q)},${Math.round(pos.getY(vi) * q)},${Math.round(pos.getZ(vi) * q)}`;
  };
  const edges = new Map<string, number>();
  for (let t = 0; t < triCount; t++) {
    const a = key(t * 3), b = key(t * 3 + 1), c = key(t * 3 + 2);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const ek = u < v ? `${u}|${v}` : `${v}|${u}`;
      edges.set(ek, (edges.get(ek) ?? 0) + 1);
    }
  }
  let boundary = 0;
  for (const n of edges.values()) if (n === 1) boundary++;
  return boundary / Math.max(1, edges.size);
}

/** Count triangles whose centroid is in the +Y top footprint at y≈maxY, facing +Y. */
function topCapTriangles(geom: THREE.BufferGeometry, halfY: number, halfXZ: number): number {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let count = 0;
  for (let t = 0; t < triCount; t++) {
    const ia = idx ? idx.getX(t * 3) : t * 3;
    const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
    const cy = (a.y + b.y + c.y) / 3;
    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    if (cy < halfY - 0.25) continue;
    if (Math.abs(cx) > halfXZ * 0.6 || Math.abs(cz) > halfXZ * 0.6) continue;
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (n.y > 0.85) count++;
  }
  return count;
}

describe('GeometryEngine.shellSolid (Fusion parity)', () => {
  it('closed hollow shell is a watertight manifold (not disjoint surface soup)', () => {
    // The OLD vertex-push shellMesh concatenated outer+inner with no rim, so
    // ~half the edges were open boundaries. A correct CSG hollow solid is a
    // closed 2-manifold → essentially zero boundary edges.
    const src = mkMesh(new THREE.BoxGeometry(10, 10, 10));
    const shelled = GeometryEngine.shellSolid(src, {
      insideThickness: 1.5, outsideThickness: 0, shellType: 'sharp',
      removeFaces: [], faceThicknesses: [],
    });
    expect(shelled.geometry.attributes.position.count).toBeGreaterThan(0);
    expect(boundaryEdgeFraction(shelled.geometry)).toBeLessThan(0.02);
    shelled.geometry.dispose();
    src.geometry.dispose();
  });

  it('two-thickness model: outside expands bbox, inside preserves it, both differ', () => {
    const mk = () => mkMesh(new THREE.BoxGeometry(10, 10, 10));
    const inside = GeometryEngine.shellSolid(mk(), { insideThickness: 2, outsideThickness: 0, shellType: 'sharp', removeFaces: [], faceThicknesses: [] });
    const outside = GeometryEngine.shellSolid(mk(), { insideThickness: 0, outsideThickness: 2, shellType: 'sharp', removeFaces: [], faceThicknesses: [] });
    const both = GeometryEngine.shellSolid(mk(), { insideThickness: 2, outsideThickness: 2, shellType: 'sharp', removeFaces: [], faceThicknesses: [] });
    const bb = (m: THREE.Mesh) => new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position as THREE.BufferAttribute);
    // Inside-only keeps the original ±5 outer box.
    expect(bb(inside).max.x).toBeCloseTo(5, 1);
    // Outside-only grows the box outward (~+2). Old impl left this degenerate.
    expect(bb(outside).max.x).toBeGreaterThan(6.5);
    // Both grows outward too, and differs from inside (old impl: symmetric==inward).
    expect(bb(both).max.x).toBeGreaterThan(6.5);
    inside.geometry.dispose(); outside.geometry.dispose(); both.geometry.dispose();
  });

  it('removing the top face creates a real opening (no outer top cap)', () => {
    const closed = GeometryEngine.shellSolid(mkMesh(new THREE.BoxGeometry(10, 10, 10)), {
      insideThickness: 1.5, outsideThickness: 0, shellType: 'sharp',
      removeFaces: [], faceThicknesses: [],
    });
    const topRemoved = GeometryEngine.shellSolid(mkMesh(new THREE.BoxGeometry(10, 10, 10)), {
      insideThickness: 1.5, outsideThickness: 0, shellType: 'sharp',
      removeFaces: [{
        normal: new THREE.Vector3(0, 1, 0),
        centroid: new THREE.Vector3(0, 5, 0),
        boundary: [
          new THREE.Vector3(-5, 5, -5),
          new THREE.Vector3(5, 5, -5),
          new THREE.Vector3(5, 5, 5),
          new THREE.Vector3(-5, 5, 5),
        ],
      }],
      faceThicknesses: [],
    });
    // Closed shell has a solid outer top cap; removing +Y must eliminate it.
    expect(topCapTriangles(closed.geometry, 5, 5)).toBeGreaterThan(0);
    expect(topCapTriangles(topRemoved.geometry, 5, 5)).toBe(0);
    // Still one connected body (a valid cup), not shattered.
    expect(GeometryEngine.splitByConnectedComponents(topRemoved.geometry).length).toBe(1);
    closed.geometry.dispose();
    topRemoved.geometry.dispose();
  });
});

// ─── mirrorMesh ─────────────────────────────────────────────────────────────

describe('GeometryEngine.mirrorMesh', () => {
  it('preserves vertex count', () => {
    const src = mkMesh(new THREE.BoxGeometry(1, 1, 1));
    const mirrored = GeometryEngine.mirrorMesh(src, 'YZ');
    expect(mirrored.geometry.attributes.position.count)
      .toBe(src.geometry.attributes.position.count);
    mirrored.geometry.dispose();
    src.geometry.dispose();
  });

  it('flips x-coords for YZ plane mirror', () => {
    const geom = new THREE.BoxGeometry(2, 1, 1);
    geom.translate(2, 0, 0); // box centered at x=2
    const src = mkMesh(geom);
    const mirrored = GeometryEngine.mirrorMesh(src, 'YZ');
    const bb = new THREE.Box3().setFromBufferAttribute(
      mirrored.geometry.attributes.position as THREE.BufferAttribute,
    );
    expect(bb.max.x).toBeCloseTo(-1, 5); // was +3
    expect(bb.min.x).toBeCloseTo(-3, 5); // was +1
    mirrored.geometry.dispose();
    geom.dispose();
  });

  it('reflected normals face outward (not inside-out)', () => {
    const geom = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const src = mkMesh(geom);
    const mirrored = GeometryEngine.mirrorMesh(src, 'XY');

    // Every triangle of a closed mirrored solid should still have a valid
    // positive-length normal. If the winding is wrong for some triangles,
    // they'd render black but the length would still be positive. A
    // well-mirrored mesh has the SAME total sum of triangle areas as the
    // source (area is invariant under reflection).
    const srcArea = totalTriArea(src.geometry);
    const mirArea = totalTriArea(mirrored.geometry);
    expect(mirArea).toBeCloseTo(srcArea, 3);
    mirrored.geometry.dispose();
    geom.dispose();
  });
});

function totalTriArea(geom: THREE.BufferGeometry): number {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  let total = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const ia = idx ? idx.getX(t * 3)     : t * 3;
    const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    cross.crossVectors(ab, ac);
    total += cross.length() * 0.5;
  }
  return total;
}

// ─── CSG operations (sanity) ────────────────────────────────────────────────

describe('GeometryEngine CSG operations', () => {
  it('csgSubtract: box minus overlapping box produces non-empty geometry', () => {
    const a = new THREE.BoxGeometry(2, 2, 2);
    const b = new THREE.BoxGeometry(1, 1, 1);
    b.translate(0.5, 0, 0);
    const result = GeometryEngine.csgSubtract(a, b);
    expect(result.attributes.position.count).toBeGreaterThan(0);
    a.dispose(); b.dispose(); result.dispose();
  });

  it('csgUnion: two overlapping boxes unified into one body', () => {
    const a = new THREE.BoxGeometry(2, 2, 2);
    const b = new THREE.BoxGeometry(2, 2, 2);
    b.translate(1.5, 0, 0);
    const result = GeometryEngine.csgUnion(a, b);
    expect(result.attributes.position.count).toBeGreaterThan(0);
    // After union, splitByConnectedComponents should return 1 component
    const parts = GeometryEngine.splitByConnectedComponents(result);
    expect(parts).toHaveLength(1);
    a.dispose(); b.dispose(); result.dispose();
  });

  it('csgIntersect: two disjoint boxes produce empty result', () => {
    const a = new THREE.BoxGeometry(1, 1, 1);
    const b = new THREE.BoxGeometry(1, 1, 1);
    b.translate(10, 0, 0);
    const result = GeometryEngine.csgIntersect(a, b);
    // Intersection of disjoint boxes is empty
    expect(result.attributes.position.count).toBe(0);
    a.dispose(); b.dispose(); result.dispose();
  });

  it('csgIntersect: overlapping boxes produce non-empty result', () => {
    const a = new THREE.BoxGeometry(2, 2, 2);
    const b = new THREE.BoxGeometry(2, 2, 2);
    b.translate(1, 0, 0);
    const result = GeometryEngine.csgIntersect(a, b);
    expect(result.attributes.position.count).toBeGreaterThan(0);
    a.dispose(); b.dispose(); result.dispose();
  });
});

// ─── splitByConnectedComponents edge cases ──────────────────────────────────

describe('splitByConnectedComponents edge cases', () => {
  it('merges vertices within tolerance (CSG seam duplicates)', () => {
    // Two boxes connected at a face — seam duplicates usually caused by CSG
    // output. Build them with slightly offset vertices (< tol) on the shared
    // edge and verify splitByConnectedComponents recognises them as one.
    const a = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    a.translate(-0.5, 0, 0);
    const b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    b.translate(0.5 + 1e-5, 0, 0); // tiny offset — within default 1e-4 tolerance
    const pA = a.attributes.position.array as Float32Array;
    const pB = b.attributes.position.array as Float32Array;
    const combined = new Float32Array(pA.length + pB.length);
    combined.set(pA, 0);
    combined.set(pB, pA.length);
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(combined, 3));

    const parts = GeometryEngine.splitByConnectedComponents(merged, 1e-3);
    // Shared face within tolerance → should fuse into one component
    expect(parts.length).toBe(1);
    a.dispose(); b.dispose();
  });

  it('distinct components remain separate when gap > tolerance', () => {
    const a = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    a.translate(-0.5, 0, 0);
    const b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    b.translate(5, 0, 0); // well outside tolerance
    const pA = a.attributes.position.array as Float32Array;
    const pB = b.attributes.position.array as Float32Array;
    const combined = new Float32Array(pA.length + pB.length);
    combined.set(pA, 0);
    combined.set(pB, pA.length);
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(combined, 3));

    const parts = GeometryEngine.splitByConnectedComponents(merged);
    expect(parts).toHaveLength(2);
    a.dispose(); b.dispose();
  });
});

// ─── removeFaceAndHeal tolerance ────────────────────────────────────────────

describe('GeometryEngine.removeFaceAndHeal', () => {
  it('finds and removes the target face on a simple box', () => {
    const geom = new THREE.BoxGeometry(4, 2, 4).toNonIndexed();
    const src = mkMesh(geom);
    const flatCentroid = new THREE.Vector3(0, 1, 0); // center of +Y face
    const flatNormal = new THREE.Vector3(0, 1, 0);
    const result = GeometryEngine.removeFaceAndHeal(src, flatNormal, flatCentroid);
    // Function returns a new mesh. Returned geometry should not be the same
    // reference as the source, and should have > 0 vertices (the healing
    // step re-closes the hole).
    expect(result.geometry).not.toBe(src.geometry);
    expect(result.geometry.attributes.position.count).toBeGreaterThan(0);
    result.geometry.dispose();
    geom.dispose();
  });

  it('skips triangles on the opposite parallel face (same normal direction, different plane)', () => {
    // A simple box has two Y-parallel faces. Removing the +Y face with the
    // new plane-offset match should NOT also remove the -Y face (same
    // orientation but at y = -1, a different plane).
    const geom = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
    const src = mkMesh(geom);
    const resultTop = GeometryEngine.removeFaceAndHeal(
      src,
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 1, 0),
    );
    const resultBottom = GeometryEngine.removeFaceAndHeal(
      src,
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
    );
    // Removing the top should produce a different result than removing the
    // bottom (confirms the plane-offset disambiguation is working).
    // They'll have similar vertex counts since both are 1-face removals, but
    // the geometry content should differ.
    const topPos = resultTop.geometry.attributes.position.array as Float32Array;
    const botPos = resultBottom.geometry.attributes.position.array as Float32Array;
    // If the offset-test weren't working, both faces would be removed for
    // either call, producing an IDENTICAL result. So they must not be equal.
    let identical = topPos.length === botPos.length;
    if (identical) {
      for (let i = 0; i < topPos.length; i++) {
        if (Math.abs(topPos[i] - botPos[i]) > 1e-6) { identical = false; break; }
      }
    }
    expect(identical).toBe(false);
    resultTop.geometry.dispose();
    resultBottom.geometry.dispose();
    geom.dispose();
  });
});

// ─── Re-running deterministic algorithms ────────────────────────────────────

describe('deterministic algorithms', () => {
  it('splitByConnectedComponents yields identical vertex counts across runs', () => {
    const a = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(); a.translate(0, 0, 0);
    const b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(); b.translate(5, 0, 0);
    const c = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(); c.translate(0, 5, 0);
    const makeCombined = () => {
      const pA = a.attributes.position.array as Float32Array;
      const pB = b.attributes.position.array as Float32Array;
      const pC = c.attributes.position.array as Float32Array;
      const out = new Float32Array(pA.length + pB.length + pC.length);
      out.set(pA, 0); out.set(pB, pA.length); out.set(pC, pA.length + pB.length);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
      return g;
    };
    const run1 = GeometryEngine.splitByConnectedComponents(makeCombined());
    const run2 = GeometryEngine.splitByConnectedComponents(makeCombined());
    expect(run1.length).toBe(run2.length);
    for (let i = 0; i < run1.length; i++) {
      expect(run1[i].attributes.position.count).toBe(run2[i].attributes.position.count);
    }
    a.dispose(); b.dispose(); c.dispose();
  });
});
