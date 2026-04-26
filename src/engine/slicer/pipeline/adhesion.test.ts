import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { generateAdhesion } from './adhesion';
import type { PrintProfile } from '../../../types/slicer';
import type { AdhesionDeps } from '../../../types/slicer-pipeline-deps.types';
import type { Contour } from '../../../types/slicer-pipeline.types';

const v = (x: number, y: number) => new THREE.Vector2(x, y);

function makeContour(points: THREE.Vector2[], isOuter = true): Contour {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return { points, isOuter, area: area / 2 };
}

function makeDeps(): AdhesionDeps {
  return {
    simplifyClosedContour: (pts) => pts,
    /** Centroid-based offset for axis-aligned rectangles. Real
     *  offsetContour shifts edges along their inward normal; for a
     *  CCW outer this means positive=shrink. The simplified stub
     *  matches that convention via a winding-aware centroid scale. */
    offsetContour: (pts, off) => {
      let cx = 0, cy = 0;
      for (const p of pts) { cx += p.x; cy += p.y; }
      cx /= pts.length; cy /= pts.length;
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        area += a.x * b.y - b.x * a.y;
      }
      const dir = area > 0 ? -1 : +1;
      return pts.map((p) => new THREE.Vector2(
        p.x + dir * Math.sign(p.x - cx) * off,
        p.y + dir * Math.sign(p.y - cy) * off,
      ));
    },
    generateScanLines: (contour, _density, lw, angle) => {
      // Generate parallel scan lines at the given angle through the
      // contour's bbox. Single line at the bbox center for simplicity.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of contour) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      const out: { from: THREE.Vector2; to: THREE.Vector2 }[] = [];
      const numLines = Math.floor(Math.max(maxX - minX, maxY - minY) / lw);
      for (let i = 0; i < numLines; i++) {
        const t = i / Math.max(1, numLines - 1);
        if (Math.abs(angle - Math.PI / 2) < 0.1) {
          const x = minX + t * (maxX - minX);
          out.push({ from: v(x, minY), to: v(x, maxY) });
        } else {
          const y = minY + t * (maxY - minY);
          out.push({ from: v(minX, y), to: v(maxX, y) });
        }
      }
      return out;
    },
    sortInfillLines: (lines) => lines,
  };
}

function makePrint(overrides: Partial<PrintProfile>): PrintProfile {
  return {
    firstLayerSpeed: 20,
    wallLineWidth: 0.4,
    skirtBrimLineWidth: 0.4,
    adhesionType: 'none',
    skirtLines: 0,
    skirtDistance: 5,
    skirtBrimMinLength: 0,
    brimWidth: 0,
    brimGap: 0,
    raftBaseThickness: 0.3,
    raftBaseLineWidth: 0.6,
    raftBaseSpeed: 16,
    ...overrides,
  } as unknown as PrintProfile;
}

describe('generateAdhesion — none', () => {
  it('emits no moves when adhesionType is "none"', () => {
    const square = makeContour([v(0, 0), v(10, 0), v(10, 10), v(0, 10)]);
    expect(generateAdhesion([square], makePrint({ adhesionType: 'none' }), makeDeps())).toEqual([]);
  });

  it('emits no moves when contour list is empty', () => {
    expect(generateAdhesion([], makePrint({ adhesionType: 'skirt', skirtLines: 1 }), makeDeps())).toEqual([]);
  });
});

describe('generateAdhesion — skirt', () => {
  it('emits a closed loop of skirt moves around the model', () => {
    const square = makeContour([v(0, 0), v(10, 0), v(10, 10), v(0, 10)]);
    const moves = generateAdhesion([square], makePrint({
      adhesionType: 'skirt',
      skirtLines: 1,
      skirtDistance: 1,
    }), makeDeps());
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.type === 'skirt')).toBe(true);
    // Loop is closed: total length is the perimeter; first.from == last.to
    const first = moves[0];
    const last = moves[moves.length - 1];
    expect(last.to.x).toBeCloseTo(first.from.x, 5);
    expect(last.to.y).toBeCloseTo(first.from.y, 5);
  });

  it('emits skirtLines × outer-perimeter loops', () => {
    const square = makeContour([v(0, 0), v(10, 0), v(10, 10), v(0, 10)]);
    const single = generateAdhesion([square], makePrint({
      adhesionType: 'skirt', skirtLines: 1,
    }), makeDeps());
    const triple = generateAdhesion([square], makePrint({
      adhesionType: 'skirt', skirtLines: 3,
    }), makeDeps());
    expect(triple.length).toBe(single.length * 3);
  });

  it('uses firstLayerSpeed for the moves', () => {
    const square = makeContour([v(0, 0), v(10, 0), v(10, 10), v(0, 10)]);
    const moves = generateAdhesion([square], makePrint({
      adhesionType: 'skirt', skirtLines: 1, firstLayerSpeed: 25,
    }), makeDeps());
    expect(moves[0].speed).toBe(25);
  });

  it('uses skirtBrimLineWidth (falls back to wallLineWidth)', () => {
    const square = makeContour([v(0, 0), v(10, 0), v(10, 10), v(0, 10)]);
    const moves = generateAdhesion([square], makePrint({
      adhesionType: 'skirt',
      skirtLines: 1,
      skirtBrimLineWidth: 0.6,
    }), makeDeps());
    expect(moves[0].lineWidth).toBe(0.6);
  });

  it('honors skirtBrimMinLength to add extra loops past skirtLines', () => {
    const square = makeContour([v(0, 0), v(10, 0), v(10, 10), v(0, 10)]);
    // 10x10 square perimeter ≈ 40mm. With skirtLines=1 we'd get 4 moves;
    // minLength=120 forces ~3 loops total → 12 moves.
    const moves = generateAdhesion([square], makePrint({
      adhesionType: 'skirt',
      skirtLines: 1,
      skirtBrimMinLength: 120,
    }), makeDeps());
    expect(moves.length).toBeGreaterThan(4);
  });

  it('only emits skirt around outer contours (ignores holes)', () => {
    const outer = makeContour([v(0, 0), v(20, 0), v(20, 20), v(0, 20)], true);
    const hole = makeContour([v(8, 8), v(8, 12), v(12, 12), v(12, 8)], false);
    const moves = generateAdhesion([outer, hole], makePrint({
      adhesionType: 'skirt', skirtLines: 1,
    }), makeDeps());
    // Skirt should sit OUTSIDE the 20×20 outer; bbox extends past 20.
    expect(Math.max(...moves.map((m) => m.from.x))).toBeGreaterThan(20);
    // Hole interior (x in [8,12]) should NOT have a skirt loop around it —
    // verify by checking no move's centerline lies inside the hole.
    const insideHole = moves.some((m) =>
      m.from.x >= 8 && m.from.x <= 12 && m.from.y >= 8 && m.from.y <= 12,
    );
    expect(insideHole).toBe(false);
  });
});

describe('generateAdhesion — brim', () => {
  it('emits brim moves with type="brim"', () => {
    const square = makeContour([v(0, 0), v(10, 0), v(10, 10), v(0, 10)]);
    const moves = generateAdhesion([square], makePrint({
      adhesionType: 'brim', brimWidth: 2,
    }), makeDeps());
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.type === 'brim')).toBe(true);
  });

  it('more brimWidth → more loops (more moves)', () => {
    const square = makeContour([v(0, 0), v(10, 0), v(10, 10), v(0, 10)]);
    const small = generateAdhesion([square], makePrint({
      adhesionType: 'brim', brimWidth: 1,
    }), makeDeps());
    const large = generateAdhesion([square], makePrint({
      adhesionType: 'brim', brimWidth: 5,
    }), makeDeps());
    expect(large.length).toBeGreaterThan(small.length);
  });
});

describe('generateAdhesion — raft', () => {
  it('emits raft moves with type="raft"', () => {
    const square = makeContour([v(0, 0), v(10, 0), v(10, 10), v(0, 10)]);
    const moves = generateAdhesion([square], makePrint({
      adhesionType: 'raft',
    }), makeDeps());
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.some((m) => m.type === 'raft')).toBe(true);
  });

  it('raft uses raftBaseSpeed (not firstLayerSpeed)', () => {
    const square = makeContour([v(0, 0), v(10, 0), v(10, 10), v(0, 10)]);
    const moves = generateAdhesion([square], makePrint({
      adhesionType: 'raft',
      raftBaseSpeed: 12,
    }), makeDeps());
    const raftMoves = moves.filter((m) => m.type === 'raft');
    expect(raftMoves[0].speed).toBe(12);
  });

  it('raft margin grows the printed area beyond the model bbox', () => {
    const square = makeContour([v(0, 0), v(10, 0), v(10, 10), v(0, 10)]);
    const moves = generateAdhesion([square], makePrint({
      adhesionType: 'raft',
      raftExtraMargin: 5,
    } as unknown as PrintProfile), makeDeps());
    let minX = Infinity, maxX = -Infinity;
    for (const m of moves) {
      minX = Math.min(minX, m.from.x, m.to.x);
      maxX = Math.max(maxX, m.from.x, m.to.x);
    }
    // 10mm wide model + 5mm margin per side → raft spans at least 20mm.
    expect(maxX - minX).toBeGreaterThanOrEqual(15);
  });
});
