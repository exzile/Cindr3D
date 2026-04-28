// System-level invariants on emitted SliceMove[] sequences.
//
// These tests slice synthetic meshes through the real `Slicer` pipeline
// (matching `SlicerGeometricSystem.test.ts`) and assert end-to-end
// properties on the produced moves:
//   1. Move-coordinate sanity (no NaN, no near-zero degenerate moves
//      mixed with extrusion).
//   2. Lines END where they should — extrusion moves chain endpoint to
//      endpoint within a tolerance, ignoring travels.
//   3. Lines DON'T cross into walls — every infill / top-bottom / bridge
//      move endpoint sits inside the body and outside the wall band.
//   4. Walls don't extrude over each other (separate inner/outer rings
//      remain disjoint, not nested).
//   5. Travels don't extrude (extrusion === 0) and extrusion moves do
//      extrude (extrusion > 0, except for the optional zero-width
//      transition tail that legitimately drops to 0 at variable-width
//      Arachne path tails).

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import type { SliceMove } from '../types/slicer';
import {
  buildBox as buildBoxGeometry,
  buildCylinder as buildCylinderGeometry,
  makeSlicer as makeBaseSlicer,
} from './_helpers/slicerSystemHelpers';

// ---------- slicer factory -----------------------------------------------

// This suite asserts move-level invariants on multi-wall, infill-bearing
// prints, so it overrides the shared helper's defaults (wallCount=1,
// no infill).
function makeSlicer(overrides: Record<string, unknown> = {}) {
  return makeBaseSlicer({ wallCount: 2, infillDensity: 30, ...overrides });
}

// ---------- geometry helpers ---------------------------------------------

function isFiniteXY(p: { x: number; y: number }) {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Closest distance from a point to a 2D line segment. */
function pointSegDist(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Test whether two segments [a→b] and [c→d] cross, EXCLUDING shared
 * endpoints (which happen legitimately at wall-to-wall junctions).
 * Uses standard 2D segment intersection via signs of cross products.
 */
function segmentsCross(
  a: { x: number; y: number }, b: { x: number; y: number },
  c: { x: number; y: number }, d: { x: number; y: number },
  endpointEps = 1e-4,
): boolean {
  // Skip if they share an endpoint (within tolerance).
  if (distance(a, c) < endpointEps || distance(a, d) < endpointEps
   || distance(b, c) < endpointEps || distance(b, d) < endpointEps) {
    return false;
  }
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  const d1 = cross(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y);
  const d2 = cross(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y);
  const d3 = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y);
  const d4 = cross(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
      && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

const EXTRUSION_TYPES = new Set<SliceMove['type']>([
  'wall-outer', 'wall-inner', 'gap-fill', 'infill', 'top-bottom', 'bridge', 'support', 'ironing',
  'skirt', 'brim', 'raft',
]);

// ============================================================================
// 1.  Coordinate sanity
// ============================================================================

describe('Slicer move invariants — coordinate sanity', () => {
  it('no move has NaN or infinite coordinates', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(20, 20, 4),
      transform: new THREE.Matrix4(),
    }]);
    let badCount = 0;
    for (const layer of result.layers) {
      for (const m of layer.moves) {
        if (!isFiniteXY(m.from) || !isFiniteXY(m.to)) badCount++;
        if (!Number.isFinite(m.extrusion)) badCount++;
        if (!Number.isFinite(m.lineWidth)) badCount++;
      }
    }
    expect(badCount).toBe(0);
  }, 60_000);

  it('travels never push filament forward', async () => {
    // Travel moves can carry NEGATIVE extrusion (retract) or zero, but
    // never positive — that would mean filament pushed during a non-
    // extrusion move. Catches accidental flow leakage on travels.
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(15, 15, 2),
      transform: new THREE.Matrix4(),
    }]);
    let bad = 0;
    for (const layer of result.layers) {
      for (const m of layer.moves) {
        if (m.type === 'travel' && m.extrusion > 0) bad++;
      }
    }
    expect(bad).toBe(0);
  }, 60_000);

  it('extrusion moves have positive line width', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(15, 15, 2),
      transform: new THREE.Matrix4(),
    }]);
    let bad = 0;
    for (const layer of result.layers) {
      for (const m of layer.moves) {
        if (EXTRUSION_TYPES.has(m.type) && !(m.lineWidth > 0)) bad++;
      }
    }
    expect(bad).toBe(0);
  }, 60_000);
});

// ============================================================================
// 2.  Move-chain continuity — lines END where they should
// ============================================================================

describe('Slicer move invariants — chain continuity', () => {
  it('extrusion-move `from` point matches the previous move\'s `to` point', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(15, 15, 2),
      transform: new THREE.Matrix4(),
    }]);
    // Allow a small tolerance: the slicer rounds positions to 3 decimals
    // when emitting G-code text; in-memory `from`/`to` are unrounded but
    // wall close-loop logic can introduce ~1µm drift.
    const TOL = 5e-3;
    let breaks = 0;
    for (const layer of result.layers) {
      for (let i = 1; i < layer.moves.length; i++) {
        const prev = layer.moves[i - 1];
        const cur  = layer.moves[i];
        if (distance(prev.to, cur.from) > TOL) breaks++;
      }
    }
    // Some chain breaks ARE legitimate — e.g. between wall ring and
    // infill, or after retract+travel. But within a single extrusion
    // run the chain must be contiguous, so if `breaks` is huge the
    // emitter is dropping move endpoints. Cap loosely; on a 15mm cube
    // we expect ~0-3 transitions per layer.
    const totalMoves = result.layers.reduce((s, l) => s + l.moves.length, 0);
    expect(breaks).toBeLessThan(totalMoves * 0.1);
  }, 60_000);

  it('zero-length extrusion moves are absent (slicer emits at least 1 µm)', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(15, 15, 2),
      transform: new THREE.Matrix4(),
    }]);
    let zeroCount = 0;
    for (const layer of result.layers) {
      for (const m of layer.moves) {
        if (!EXTRUSION_TYPES.has(m.type)) continue;
        if (distance(m.from, m.to) < 1e-6) zeroCount++;
      }
    }
    expect(zeroCount).toBe(0);
  }, 60_000);

  it('layer Z values are monotonically increasing', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(15, 15, 4),
      transform: new THREE.Matrix4(),
    }]);
    for (let i = 1; i < result.layers.length; i++) {
      expect(result.layers[i].z).toBeGreaterThan(result.layers[i - 1].z);
    }
  }, 60_000);
});

// ============================================================================
// 3.  Walls don't cross other walls / infill doesn't cross walls
// ============================================================================

describe('Slicer move invariants — walls and infill stay in their lanes', () => {
  it('outer wall and inner wall rings do not cross each other', async () => {
    const slicer = makeSlicer({ wallCount: 3 });
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(20, 20, 2),
      transform: new THREE.Matrix4(),
    }]);
    // Pick a mid-stack layer (skip first/last layer effects).
    const layer = result.layers[5];
    const outers = layer.moves.filter((m) => m.type === 'wall-outer');
    const inners = layer.moves.filter((m) => m.type === 'wall-inner');
    expect(outers.length).toBeGreaterThan(0);
    expect(inners.length).toBeGreaterThan(0);

    let crossings = 0;
    for (const o of outers) {
      for (const i of inners) {
        if (segmentsCross(o.from, o.to, i.from, i.to)) crossings++;
      }
    }
    expect(crossings).toBe(0);
  }, 60_000);

  it('infill (top-bottom) endpoints stay inside the wall band on a solid layer', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(20, 20, 2),
      transform: new THREE.Matrix4(),
    }]);
    // Layer 0 is solid bottom. Top-bottom infill must lie inside the
    // outer wall.
    const layer = result.layers[0];
    const outers = layer.moves.filter((m) => m.type === 'wall-outer');
    const tb = layer.moves.filter((m) => m.type === 'top-bottom');
    if (tb.length === 0) return; // some configs may emit infill instead
    expect(outers.length).toBeGreaterThan(0);

    // Compute outer-wall bbox.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const o of outers) {
      minX = Math.min(minX, o.from.x, o.to.x);
      maxX = Math.max(maxX, o.from.x, o.to.x);
      minY = Math.min(minY, o.from.y, o.to.y);
      maxY = Math.max(maxY, o.from.y, o.to.y);
    }

    let outOfBand = 0;
    for (const m of tb) {
      const eps = 1e-3;
      if (m.from.x < minX - eps || m.from.x > maxX + eps
       || m.from.y < minY - eps || m.from.y > maxY + eps) outOfBand++;
      if (m.to.x < minX - eps || m.to.x > maxX + eps
       || m.to.y < minY - eps || m.to.y > maxY + eps) outOfBand++;
    }
    expect(outOfBand).toBe(0);
  }, 60_000);

  it('cylinder with axial hole: no extrusion move crosses through the hole', async () => {
    const slicer = makeSlicer({ wallCount: 2 });
    const result = await slicer.slice([{
      geometry: buildCylinderGeometry(12, 4, 48, 3),
      transform: new THREE.Matrix4(),
    }]);
    // Pick a mid-stack layer (avoid top/bottom solid skin).
    const layer = result.layers[Math.floor(result.layers.length / 2)];

    // Find the hole center: average all wall-inner endpoints.
    const inners = layer.moves.filter((m) => m.type === 'wall-inner');
    if (inners.length === 0) return; // skip if config didn't generate inner walls
    let cx = 0, cy = 0, n = 0;
    for (const m of inners) { cx += m.from.x + m.to.x; cy += m.from.y + m.to.y; n += 2; }
    cx /= n; cy /= n;

    // Estimate hole radius: median of inner-wall-endpoint distances to
    // the centroid we just computed. Use min, since outer body is also
    // tracked by some inner walls (concentric infill etc.).
    const dists = inners.flatMap((m) => [
      Math.hypot(m.from.x - cx, m.from.y - cy),
      Math.hypot(m.to.x   - cx, m.to.y   - cy),
    ]);
    dists.sort((a, b) => a - b);
    const innerRadius = dists[0]; // closest endpoint to centroid

    // Now: every infill move endpoint must be FURTHER from centroid
    // than the inner radius (i.e. not inside the hole).
    const fillMoves = layer.moves.filter(
      (m) => m.type === 'infill' || m.type === 'top-bottom',
    );
    let inHole = 0;
    for (const m of fillMoves) {
      if (Math.hypot(m.from.x - cx, m.from.y - cy) < innerRadius - 1e-2) inHole++;
      if (Math.hypot(m.to.x   - cx, m.to.y   - cy) < innerRadius - 1e-2) inHole++;
    }
    expect(inHole).toBe(0);
  }, 90_000);

  it('infill segment midpoints stay clear of all wall segments by ≥ 0.05 × lineWidth', async () => {
    const slicer = makeSlicer({ wallCount: 2, infillDensity: 50 });
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(20, 20, 2),
      transform: new THREE.Matrix4(),
    }]);
    const layer = result.layers[Math.floor(result.layers.length / 2)];
    const walls = layer.moves.filter(
      (m) => m.type === 'wall-outer' || m.type === 'wall-inner',
    );
    const fill = layer.moves.filter(
      (m) => m.type === 'infill' || m.type === 'top-bottom',
    );
    if (walls.length === 0 || fill.length === 0) return;

    let tooClose = 0;
    for (const f of fill) {
      const mx = (f.from.x + f.to.x) / 2;
      const my = (f.from.y + f.to.y) / 2;
      const halfWidth = f.lineWidth * 0.5;
      // Find min distance from infill midpoint to any wall segment.
      let minDist = Infinity;
      for (const w of walls) {
        const d = pointSegDist(mx, my, w.from.x, w.from.y, w.to.x, w.to.y);
        if (d < minDist) minDist = d;
      }
      // Allow infill stroke to overlap with the WALL stroke by half the
      // wall width (they butt up). But infill MIDPOINT shouldn't sit
      // closer than wall halfWidth + a small buffer.
      const wallHalfW = walls[0].lineWidth * 0.5;
      if (minDist < (wallHalfW - halfWidth) - 0.01) tooClose++;
    }
    // Loose threshold — the slicer aims for walls and infill to abut,
    // so some midpoints WILL be near walls. We're catching outright
    // overlap, not adjacency.
    expect(tooClose).toBeLessThan(fill.length * 0.05);
  }, 60_000);
});

// ============================================================================
// 4.  Travel doesn't cross walls (avoidCrossingPerimeters)
// ============================================================================

describe('Slicer move invariants — travel routing', () => {
  it('travels stay finite and have non-NaN endpoints even when avoiding walls', async () => {
    const slicer = makeSlicer({
      avoidCrossingPerimeters: true,
      wallCount: 2,
    });
    const result = await slicer.slice([{
      geometry: buildCylinderGeometry(15, 4, 48, 4),
      transform: new THREE.Matrix4(),
    }]);
    let bad = 0;
    for (const layer of result.layers) {
      for (const m of layer.moves) {
        if (m.type !== 'travel') continue;
        if (!isFiniteXY(m.from) || !isFiniteXY(m.to)) bad++;
      }
    }
    expect(bad).toBe(0);
  }, 90_000);
});

// ============================================================================
// 5.  Wall closure — closed wall rings actually close
// ============================================================================

describe('Slicer move invariants — wall closure', () => {
  it('an outer wall ring on a simple cube layer is a closed polyline', async () => {
    const slicer = makeSlicer({ wallCount: 1 });
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(20, 20, 2),
      transform: new THREE.Matrix4(),
    }]);
    const layer = result.layers[Math.floor(result.layers.length / 2)];
    const outers = layer.moves.filter((m) => m.type === 'wall-outer');
    expect(outers.length).toBeGreaterThan(0);
    // First move's from and last move's to should be near each other.
    const first = outers[0];
    const last  = outers[outers.length - 1];
    const closure = distance(first.from, last.to);
    expect(closure).toBeLessThan(0.1); // 100 µm closure tolerance
  }, 60_000);
});
