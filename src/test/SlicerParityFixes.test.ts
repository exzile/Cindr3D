import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Slicer } from '../engine/slicer/Slicer';
import {
  DEFAULT_MATERIAL_PROFILES,
  DEFAULT_PRINTER_PROFILES,
  DEFAULT_PRINT_PROFILES,
} from '../types/slicer';
import {
  findSolidSkinContourAnchorPath,
  findSolidSkinContourConnectorPath,
  shouldConnectInfillLinesForEmission,
  solidSkinConnectorLinkLimit,
  sortSolidSkinLinesForEmission,
  sparseInfillConnectorLinkLimit,
} from '../engine/slicer/pipeline/execution/steps/emitContourInfill';

describe('Slicer parity fixes', () => {
  it('orders split solid-skin scanlines row-by-row around holes', () => {
    const lines = [
      { from: new THREE.Vector2(0, 0), to: new THREE.Vector2(4, 0) },
      { from: new THREE.Vector2(6, 0), to: new THREE.Vector2(10, 0) },
      { from: new THREE.Vector2(0, 0.45), to: new THREE.Vector2(4, 0.45) },
      { from: new THREE.Vector2(6, 0.45), to: new THREE.Vector2(10, 0.45) },
    ];

    const sorted = sortSolidSkinLinesForEmission(lines, 0.45);

    expect(sorted[0].from.x).toBe(0);
    expect(sorted[0].to.x).toBe(4);
    expect(sorted[1].from.x).toBe(6);
    expect(sorted[1].to.x).toBe(10);
    expect(sorted[2].from.x).toBe(10);
    expect(sorted[2].to.x).toBe(6);
    expect(sorted[3].from.x).toBe(4);
    expect(sorted[3].to.x).toBe(0);
  });

  it('keeps solid-skin boundary ownership when rows are reversed for emission', () => {
    const boundary = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(10, 0),
      new THREE.Vector2(10, 10),
      new THREE.Vector2(0, 10),
    ];
    const hole = [
      new THREE.Vector2(4, 4),
      new THREE.Vector2(6, 4),
      new THREE.Vector2(6, 6),
      new THREE.Vector2(4, 6),
    ];
    const lines = [
      { from: new THREE.Vector2(0, 0), to: new THREE.Vector2(10, 0), boundaryContour: boundary, boundaryHoles: [hole] },
      { from: new THREE.Vector2(0, 0.5), to: new THREE.Vector2(10, 0.5), boundaryContour: boundary, boundaryHoles: [hole] },
    ];

    const sorted = sortSolidSkinLinesForEmission(lines, 0.5);

    expect(sorted[1].from.x).toBe(10);
    expect(sorted[1].to.x).toBe(0);
    expect(sorted[1].boundaryContour).toBe(boundary);
    expect(sorted[1].boundaryHoles).toEqual([hole]);
  });

  it('keeps solid-skin connector hops enabled across multiple clipped regions', () => {
    expect(shouldConnectInfillLinesForEmission(true, true, false, 3)).toBe(true);
    expect(shouldConnectInfillLinesForEmission(true, undefined, true, 3)).toBe(true);
    expect(shouldConnectInfillLinesForEmission(false, true, true, 3)).toBe(false);
    expect(shouldConnectInfillLinesForEmission(false, true, true, 1)).toBe(true);
  });

  it('keeps direct solid-skin connector links limited until contour-walk linking is implemented', () => {
    expect(solidSkinConnectorLinkLimit(0.5)).toBeCloseTo(1.05, 5);
    expect(sparseInfillConnectorLinkLimit(0.5)).toBeCloseTo(0.75, 5);
  });

  it('routes solid-skin end transitions along a nearby contour instead of a hole-crossing chord', () => {
    const outer = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(20, 0),
      new THREE.Vector2(20, 20),
      new THREE.Vector2(0, 20),
    ];
    const hole = [
      new THREE.Vector2(8, 8),
      new THREE.Vector2(12, 8),
      new THREE.Vector2(12, 12),
      new THREE.Vector2(8, 12),
    ];

    const path = findSolidSkinContourConnectorPath(
      new THREE.Vector2(8.1, 9),
      new THREE.Vector2(8.1, 11),
      outer,
      [hole],
      0.5,
    );

    expect(path).not.toBeNull();
    expect(path!.every((p) => Math.abs(p.x - 8) < 0.11)).toBe(true);
    const pathLen = path!.slice(1).reduce((sum, p, i) => sum + p.distanceTo(path![i]), 0);
    expect(pathLen).toBeLessThan(2.3);
  });

  it('allows Orca-style solid-skin contour walks around small curved features', () => {
    const outer = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(20, 0),
      new THREE.Vector2(20, 20),
      new THREE.Vector2(0, 20),
    ];
    const hole = Array.from({ length: 32 }, (_, i) => {
      const a = (i / 32) * Math.PI * 2;
      return new THREE.Vector2(10 + Math.cos(a), 10 + Math.sin(a));
    });

    const path = findSolidSkinContourConnectorPath(
      new THREE.Vector2(9.05, 10),
      new THREE.Vector2(10, 10.95),
      outer,
      [hole],
      0.5,
    );

    expect(path).not.toBeNull();
    const pathLen = path!.slice(1).reduce((sum, p, i) => sum + p.distanceTo(path![i]), 0);
    expect(pathLen).toBeGreaterThan(1.2);
    expect(pathLen).toBeLessThan(2.2);
  });

  it('adds Orca-style limited anchors for solid-skin ends on hole boundaries', () => {
    const outer = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(20, 0),
      new THREE.Vector2(20, 20),
      new THREE.Vector2(0, 20),
    ];
    const hole = Array.from({ length: 32 }, (_, i) => {
      const a = (i / 32) * Math.PI * 2;
      return new THREE.Vector2(10 + Math.cos(a) * 3, 10 + Math.sin(a) * 3);
    });

    const path = findSolidSkinContourAnchorPath(
      new THREE.Vector2(7.05, 10),
      new THREE.Vector2(-1, 0),
      outer,
      [hole],
      0.5,
    );

    expect(path).not.toBeNull();
    const pathLen = path!.slice(1).reduce((sum, p, i) => sum + p.distanceTo(path![i]), 0);
    expect(pathLen).toBeGreaterThan(0.5);
    expect(pathLen).toBeLessThan(0.57);
    expect(path!.slice(1).every((p) => Math.abs(p.distanceTo(new THREE.Vector2(10, 10)) - 3) < 0.04)).toBe(true);
  });

  it('does not invent long solid-skin contour links across unrelated hole sides', () => {
    const outer = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(30, 0),
      new THREE.Vector2(30, 30),
      new THREE.Vector2(0, 30),
    ];
    const hole = Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      return new THREE.Vector2(15 + Math.cos(a) * 5, 15 + Math.sin(a) * 5);
    });

    const path = findSolidSkinContourConnectorPath(
      new THREE.Vector2(10, 15),
      new THREE.Vector2(20, 15),
      outer,
      [hole],
      0.5,
    );

    expect(path).toBeNull();
  });

  it('retracts on long travel even when extrusion window is not yet met', () => {
    const printer = DEFAULT_PRINTER_PROFILES[0];
    const material = DEFAULT_MATERIAL_PROFILES[0];
    const print = {
      ...DEFAULT_PRINT_PROFILES[0],
      minimumExtrusionDistanceWindow: 10,
      maxCombDistanceNoRetract: 6,
      retractionMinTravel: 1.5,
      wallLineWidth: 0.4,
      // Default profile flips `avoidPrintedParts: true`, which makes
      // `forceRetract` always true and bypasses the short-travel
      // exemption we're testing here. Disable for this scenario.
      avoidPrintedParts: false,
      avoidSupports: false,
    };
    const slicer = new Slicer(printer, material, print) as unknown as {
      shouldRetractOnTravel: (dist: number, extrudedSinceRetract: number, pp: typeof print) => boolean;
    };

    expect(slicer.shouldRetractOnTravel(20, 0.5, print)).toBe(true);
    expect(slicer.shouldRetractOnTravel(1.0, 0.5, print)).toBe(false);
  });

  it('generates contour-following skirt loops instead of bbox rectangles', () => {
    const printer = DEFAULT_PRINTER_PROFILES[0];
    const material = DEFAULT_MATERIAL_PROFILES[0];
    const print = {
      ...DEFAULT_PRINT_PROFILES[0],
      adhesionType: 'skirt' as const,
      skirtLines: 1,
      skirtDistance: 1,
      skirtBrimLineWidth: 0.4,
      wallLineWidth: 0.4,
    };
    const slicer = new Slicer(printer, material, print) as unknown as {
      generateAdhesion: (
        contours: Array<{ points: THREE.Vector2[]; area: number; isOuter: boolean }>,
        pp: typeof print,
        layerH: number,
        offsetX: number,
        offsetY: number,
      ) => Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>;
    };

    const triangle = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(10, 0),
      new THREE.Vector2(2, 8),
    ];
    const moves = slicer.generateAdhesion([
      { points: triangle, area: 40, isOuter: true },
    ], print, 0.2, 0, 0);

    expect(moves).toHaveLength(3);
    const uniquePoints = new Set(
      moves.flatMap((move) => [
        `${move.from.x.toFixed(3)},${move.from.y.toFixed(3)}`,
        `${move.to.x.toFixed(3)},${move.to.y.toFixed(3)}`,
      ]),
    );
    expect(uniquePoints.size).toBe(3);
  });

  it('simplifies dense curved loops without collapsing them', () => {
    const printer = DEFAULT_PRINTER_PROFILES[0];
    const material = DEFAULT_MATERIAL_PROFILES[0];
    const print = DEFAULT_PRINT_PROFILES[0];
    const slicer = new Slicer(printer, material, print) as unknown as {
      simplifyClosedContour: (points: THREE.Vector2[], tolerance: number) => THREE.Vector2[];
    };

    const denseCircle = Array.from({ length: 180 }, (_, i) => {
      const a = (i / 180) * Math.PI * 2;
      return new THREE.Vector2(Math.cos(a) * 10, Math.sin(a) * 10);
    });
    const simplified = slicer.simplifyClosedContour(denseCircle, 0.03);

    // 180-point circle at chord-error 0.03mm on r=10mm: theoretical
    // optimum is ~40 segments; allow up to half (90) so the simplifier
    // can stay slightly conservative without failing.
    expect(simplified.length).toBeLessThanOrEqual(denseCircle.length / 2);
    expect(simplified.length).toBeGreaterThan(8);
  });

  it('rejects infill connector segments that cross a hole', () => {
    const printer = DEFAULT_PRINTER_PROFILES[0];
    const material = DEFAULT_MATERIAL_PROFILES[0];
    const print = DEFAULT_PRINT_PROFILES[0];
    const slicer = new Slicer(printer, material, print) as unknown as {
      segmentInsideMaterial: (
        from: THREE.Vector2,
        to: THREE.Vector2,
        contour: THREE.Vector2[],
        holes: THREE.Vector2[][],
      ) => boolean;
    };

    const outer = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(20, 0),
      new THREE.Vector2(20, 20),
      new THREE.Vector2(0, 20),
    ];
    const hole = [
      new THREE.Vector2(8, 8),
      new THREE.Vector2(12, 8),
      new THREE.Vector2(12, 12),
      new THREE.Vector2(8, 12),
    ];

    expect(
      slicer.segmentInsideMaterial(
        new THREE.Vector2(6, 10),
        new THREE.Vector2(14, 10),
        outer,
        [hole],
      ),
    ).toBe(false);

    expect(
      slicer.segmentInsideMaterial(
        new THREE.Vector2(2, 4),
        new THREE.Vector2(6, 4),
        outer,
        [hole],
      ),
    ).toBe(true);
  });

  it('scanline infill splits around holes instead of spanning across them', () => {
    const printer = DEFAULT_PRINTER_PROFILES[0];
    const material = DEFAULT_MATERIAL_PROFILES[0];
    const print = DEFAULT_PRINT_PROFILES[0];
    const slicer = new Slicer(printer, material, print) as unknown as {
      generateScanLines: (
        contour: THREE.Vector2[],
        density: number,
        lineWidth: number,
        angle: number,
        phaseOffset: number,
        holes: THREE.Vector2[][],
      ) => Array<{ from: THREE.Vector2; to: THREE.Vector2 }>;
    };

    const outer = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(20, 0),
      new THREE.Vector2(20, 20),
      new THREE.Vector2(0, 20),
    ];
    const hole = [
      new THREE.Vector2(8, 8),
      new THREE.Vector2(12, 8),
      new THREE.Vector2(12, 12),
      new THREE.Vector2(8, 12),
    ];

    const lines = slicer.generateScanLines(outer, 20, 4, 0, 0, [hole]);
    const crossing = lines.some((line) => {
      const mid = new THREE.Vector2((line.from.x + line.to.x) / 2, (line.from.y + line.to.y) / 2);
      return mid.x > 8 && mid.x < 12 && mid.y > 8 && mid.y < 12;
    });

    expect(crossing).toBe(false);
  });

  it('closing radius does not collapse large functional holes', () => {
    const printer = DEFAULT_PRINTER_PROFILES[0];
    const material = DEFAULT_MATERIAL_PROFILES[0];
    const print = {
      ...DEFAULT_PRINT_PROFILES[0],
      slicingClosingRadius: 0.049,
    };
    const slicer = new Slicer(printer, material, print) as unknown as {
      closeContourGaps: (
        contours: Array<{ points: THREE.Vector2[]; area: number; isOuter: boolean }>,
        r: number,
      ) => Array<{ points: THREE.Vector2[]; area: number; isOuter: boolean }>;
      signedArea: (points: THREE.Vector2[]) => number;
    };

    const outer = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(40, 0),
      new THREE.Vector2(40, 40),
      new THREE.Vector2(0, 40),
    ];
    const hole = [
      new THREE.Vector2(10, 10),
      new THREE.Vector2(30, 10),
      new THREE.Vector2(30, 30),
      new THREE.Vector2(10, 30),
    ].reverse();

    const closed = slicer.closeContourGaps([
      { points: outer, area: slicer.signedArea(outer), isOuter: true },
      { points: hole, area: slicer.signedArea(hole), isOuter: false },
    ], print.slicingClosingRadius);

    expect(closed.some((contour) => !contour.isOuter)).toBe(true);
  });
});
