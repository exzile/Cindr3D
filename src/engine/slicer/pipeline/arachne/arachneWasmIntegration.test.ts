import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { generateArachnePathsWasm, generatePerimetersArachne, loadArachneModule } from './index';
import type { PrintProfile } from '../../../../types/slicer';
import type { PerimeterDeps } from '../../../../types/slicer-pipeline-deps.types';
import type { InfillRegion } from '../../../../types/slicer-pipeline.types';
import { allFixtures } from './__tests__/fixtures';

function makeDeps(): PerimeterDeps {
  return {
    offsetContour: (contour, offset) => {
      if (contour.length < 3) return [];
      let cx = 0;
      let cy = 0;
      for (const p of contour) {
        cx += p.x;
        cy += p.y;
      }
      cx /= contour.length;
      cy /= contour.length;
      const offset_ = -offset;
      return contour.map((p) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) return new THREE.Vector2(p.x, p.y);
        const factor = (len + offset_) / len;
        return new THREE.Vector2(cx + dx * factor, cy + dy * factor);
      });
    },
    signedArea: (points) => {
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        area += a.x * b.y - b.x * a.y;
      }
      return area / 2;
    },
    multiPolygonToRegions: (mp) => {
      const out: InfillRegion[] = [];
      for (const poly of mp) {
        const contour = poly[0]?.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y)) ?? [];
        const holes = poly.slice(1).map((ring) => ring.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y)));
        if (contour.length >= 3) out.push({ contour, holes });
      }
      return out;
    },
  };
}

const wasmProfile = {
  wallCount: 3,
  wallLineWidth: 0.4,
  minWallLineWidth: 0.2,
  arachneBackend: 'wasm',
} as unknown as PrintProfile;

// 9.3A known gaps with the current temporary Clipper compatibility shim:
// acuteCorner currently produces no WASM paths, so the slicer falls back to
// classic fixed-width walls.
const knownNoWasmPathFixtures = new Set(['acuteCorner']);
const knownWasmAbortFixtures = new Set<string>();
const wasmPathFixtures = allFixtures.filter((fixture) => !knownNoWasmPathFixtures.has(fixture.name));
const perimeterFixtures = allFixtures.filter((fixture) => !knownWasmAbortFixtures.has(fixture.name));

describe('Arachne WASM backend integration', () => {
  beforeAll(async () => {
    await loadArachneModule();
  });

  it.each(wasmPathFixtures)('emits finite variable-width paths for "$name"', async (fixture) => {
    const paths = await generateArachnePathsWasm(
      fixture.outer,
      fixture.holes,
      wasmProfile.wallCount,
      wasmProfile.wallLineWidth,
      0,
      wasmProfile,
    );

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.points.length).toBe(path.widths.length);
      expect(path.points.length).toBeGreaterThanOrEqual(2);
      expect(path.depth).toBeGreaterThanOrEqual(0);
      for (const pt of path.points) {
        expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
      }
      for (const width of path.widths) {
        expect(Number.isFinite(width) && width > 0).toBe(true);
      }
    }
  });

  it.each(perimeterFixtures)('returns coherent GeneratedPerimeters for "$name"', (fixture) => {
    const result = generatePerimetersArachne(
      fixture.outer,
      fixture.holes,
      wasmProfile.wallCount,
      wasmProfile.wallLineWidth,
      0,
      wasmProfile,
      makeDeps(),
    );

    expect(result.walls.length).toBeGreaterThan(0);
    expect(result.walls.length).toBe(result.lineWidths.length);
    expect(result.walls.length).toBe(result.wallDepths.length);
    expect(result.outerCount).toBeGreaterThanOrEqual(0);
    expect(result.outerCount).toBeLessThanOrEqual(result.walls.length);
    for (let i = 0; i < result.walls.length; i++) {
      const widths = result.lineWidths[i];
      if (Array.isArray(widths)) {
        expect(widths).toHaveLength(result.walls[i].length);
        expect(widths.every((width) => Number.isFinite(width) && width > 0)).toBe(true);
      } else {
        expect(Number.isFinite(widths) && widths > 0).toBe(true);
      }
    }
  });
});
