import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { emitGroupedAndContourWalls } from './emitGroupedAndContourWalls';
import type { ContourWallData, SliceLayerState, SliceRun } from './types';
import type { GeneratedPerimeters } from '../../../../../types/slicer-pipeline.types';

function square(size: number): THREE.Vector2[] {
  return [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(size, 0),
    new THREE.Vector2(size, size),
    new THREE.Vector2(0, size),
  ];
}

describe('emitGroupedAndContourWalls', () => {
  it('reuses grouped perimeter generation for inner wall emission', () => {
    const loop = square(10);
    const contour = { points: loop, area: 100, isOuter: true };
    const generated: GeneratedPerimeters = {
      walls: [loop],
      lineWidths: [0.45],
      wallClosed: [true],
      wallDepths: [0],
      wallSources: ['outer'],
      outerCount: 1,
      innermostHoles: [],
      infillRegions: [],
    };
    let generateCalls = 0;
    const pipeline = {
      findSeamPosition: () => 0,
      reorderFromIndex: (points: THREE.Vector2[], index: number) => [
        ...points.slice(index),
        ...points.slice(0, index),
      ],
      simplifyClosedContour: (points: THREE.Vector2[]) => points,
      filterPerimetersByMinOdd: (perimeters: GeneratedPerimeters) => perimeters,
      generatePerimeters: () => {
        generateCalls += 1;
        return generated;
      },
    };
    const run = {
      pp: {
        groupOuterWalls: true,
        wallCount: 1,
        wallLineWidth: 0.45,
        outerWallFirst: true,
      },
      emitter: {
        currentX: 0,
        currentY: 0,
        currentLayerFlow: 1,
        setAccel: () => undefined,
        setJerk: () => undefined,
        travelTo: () => undefined,
        extrudeTo: () => ({ time: 0 }),
        calculateExtrusion: () => 0,
      },
      gcode: [],
      previousSeamPoints: [],
      currentSeamPoints: [],
    } as unknown as SliceRun;
    const layer = {
      li: 0,
      layerZ: 0.2,
      layerH: 0.2,
      isFirstLayer: true,
      isSolidTop: false,
      isSolidBottom: false,
      outerWallSpeed: 20,
      innerWallSpeed: 30,
      workContours: [contour],
      holesByOuterContour: new Map(),
      moves: [],
      layerTime: 0,
      hasBridgeRegions: false,
    } as unknown as SliceLayerState;

    const result = emitGroupedAndContourWalls(pipeline, run, layer);

    expect(generateCalls).toBe(1);
    expect(result).toHaveLength(1);
    expect((result[0] as ContourWallData).wallSets).toBe(generated.walls);
  });

  it('uses precomputed contour walls from layer workers', () => {
    const loop = square(10);
    const contour = { points: loop, area: 100, isOuter: true };
    const generated: GeneratedPerimeters = {
      walls: [loop],
      lineWidths: [0.45],
      wallClosed: [true],
      wallDepths: [0],
      wallSources: ['outer'],
      outerCount: 1,
      innermostHoles: [],
      infillRegions: [],
    };
    const pipeline = {
      findSeamPosition: () => 0,
      reorderFromIndex: (points: THREE.Vector2[], index: number) => [
        ...points.slice(index),
        ...points.slice(0, index),
      ],
      simplifyClosedContour: (points: THREE.Vector2[]) => points,
      filterPerimetersByMinOdd: (perimeters: GeneratedPerimeters) => perimeters,
      generatePerimeters: () => {
        throw new Error('generatePerimeters should not run when precomputed walls are available');
      },
    };
    const run = {
      pp: {
        groupOuterWalls: false,
        wallCount: 1,
        wallLineWidth: 0.45,
        outerWallFirst: true,
      },
      emitter: {
        currentX: 0,
        currentY: 0,
        currentLayerFlow: 1,
        setAccel: () => undefined,
        setJerk: () => undefined,
        travelTo: () => undefined,
        extrudeTo: () => ({ time: 0 }),
        calculateExtrusion: () => 0,
      },
      gcode: [],
      previousSeamPoints: [],
      currentSeamPoints: [],
    } as unknown as SliceRun;
    const layer = {
      li: 0,
      layerZ: 0.2,
      layerH: 0.2,
      isFirstLayer: true,
      isSolidTop: false,
      isSolidBottom: false,
      outerWallSpeed: 20,
      innerWallSpeed: 30,
      contours: [contour],
      workContours: [contour],
      holesByOuterContour: new Map(),
      moves: [],
      layerTime: 0,
      hasBridgeRegions: false,
      precomputedContourWalls: [{ contourIndex: 0, perimeters: generated }],
    } as unknown as SliceLayerState;

    const result = emitGroupedAndContourWalls(pipeline, run, layer);

    expect(result).toHaveLength(1);
    expect(result[0].exWalls).toBe(generated);
  });

  it('orders inner walls with Orca-style depth constraints and nearest available path', () => {
    const outer = square(40);
    const farDeep = square(4).map((point) => point.add(new THREE.Vector2(30, 30)));
    const nearDeep = square(4).map((point) => point.add(new THREE.Vector2(2, 2)));
    const shallow = square(10).map((point) => point.add(new THREE.Vector2(15, 15)));
    const contour = { points: outer, area: 1600, isOuter: true };
    const generated: GeneratedPerimeters = {
      walls: [outer, farDeep, nearDeep, shallow],
      lineWidths: [0.45, 0.45, 0.45, 0.45],
      wallClosed: [true, true, true, true],
      wallDepths: [0, 2, 2, 1],
      wallSources: ['outer', 'outer', 'outer', 'outer'],
      outerCount: 1,
      innermostHoles: [],
      infillRegions: [],
    };
    const pipeline = {
      findSeamPosition: () => 0,
      reorderFromIndex: (points: THREE.Vector2[], index: number) => [
        ...points.slice(index),
        ...points.slice(0, index),
      ],
      simplifyClosedContour: (points: THREE.Vector2[]) => points,
      filterPerimetersByMinOdd: (perimeters: GeneratedPerimeters) => perimeters,
      generatePerimeters: () => generated,
    };
    const run = {
      pp: {
        groupOuterWalls: false,
        wallCount: 4,
        wallLineWidth: 0.45,
        outerWallFirst: false,
      },
      emitter: {
        currentX: 0,
        currentY: 0,
        currentLayerFlow: 1,
        setAccel: () => undefined,
        setJerk: () => undefined,
        travelTo(x: number, y: number) {
          this.currentX = x;
          this.currentY = y;
        },
        extrudeTo(x: number, y: number) {
          this.currentX = x;
          this.currentY = y;
          return { time: 0 };
        },
        calculateExtrusion: () => 0,
      },
      gcode: [],
      previousSeamPoints: [],
      currentSeamPoints: [],
    } as unknown as SliceRun;
    const layer = {
      li: 0,
      layerZ: 0.2,
      layerH: 0.2,
      isFirstLayer: true,
      isSolidTop: false,
      isSolidBottom: false,
      outerWallSpeed: 20,
      innerWallSpeed: 30,
      workContours: [contour],
      holesByOuterContour: new Map(),
      moves: [],
      layerTime: 0,
      hasBridgeRegions: false,
    } as unknown as SliceLayerState;

    emitGroupedAndContourWalls(pipeline, run, layer);

    expect(run.gcode.filter((line) => line.startsWith('; Inner wall'))).toEqual([
      '; Inner wall 2',
      '; Inner wall 1',
      '; Inner wall 3',
    ]);
  });

  it('emits Arachne odd paths as Orca-style inner walls instead of separate gap fill', () => {
    const outer = square(20);
    const inner = square(12).map((point) => point.add(new THREE.Vector2(4, 4)));
    const odd = [
      new THREE.Vector2(7, 7),
      new THREE.Vector2(9, 8),
      new THREE.Vector2(11, 7),
    ];
    const contour = { points: outer, area: 400, isOuter: true };
    const generated: GeneratedPerimeters = {
      walls: [outer, inner, odd],
      lineWidths: [0.45, 0.45, [0.22, 0.28, 0.22]],
      wallClosed: [true, true, false],
      wallDepths: [0, 1, 1],
      wallSources: ['outer', 'outer', 'gapfill'],
      outerCount: 1,
      innermostHoles: [],
      infillRegions: [],
    };
    const pipeline = {
      findSeamPosition: () => 0,
      reorderFromIndex: (points: THREE.Vector2[], index: number) => [
        ...points.slice(index),
        ...points.slice(0, index),
      ],
      simplifyClosedContour: (points: THREE.Vector2[]) => points,
      filterPerimetersByMinOdd: (perimeters: GeneratedPerimeters) => perimeters,
      generatePerimeters: () => generated,
    };
    const run = {
      pp: {
        groupOuterWalls: false,
        wallCount: 3,
        wallLineWidth: 0.45,
        outerWallFirst: true,
      },
      emitter: {
        currentX: 0,
        currentY: 0,
        currentLayerFlow: 1,
        setAccel: () => undefined,
        setJerk: () => undefined,
        travelTo(x: number, y: number) {
          this.currentX = x;
          this.currentY = y;
        },
        extrudeTo(x: number, y: number) {
          this.currentX = x;
          this.currentY = y;
          return { time: 0 };
        },
        calculateExtrusion: () => 0,
      },
      gcode: [],
      previousSeamPoints: [],
      currentSeamPoints: [],
    } as unknown as SliceRun;
    const layer = {
      li: 0,
      layerZ: 0.2,
      layerH: 0.2,
      isFirstLayer: true,
      isSolidTop: false,
      isSolidBottom: false,
      outerWallSpeed: 20,
      innerWallSpeed: 30,
      workContours: [contour],
      holesByOuterContour: new Map(),
      moves: [],
      layerTime: 0,
      hasBridgeRegions: false,
    } as unknown as SliceLayerState;

    emitGroupedAndContourWalls(pipeline, run, layer);

    expect(run.gcode.some((line) => line.startsWith('; Gap fill'))).toBe(false);
    expect(run.gcode.filter((line) => line.startsWith('; Inner wall'))).toContain('; Inner wall 2');
    expect(layer.moves.map((move) => move.type)).not.toContain('gap-fill');
    expect(layer.moves.some((move) => move.type === 'wall-inner')).toBe(true);
  });

  it('uses nominal widths for closed regular walls and preserves odd transition beads', () => {
    const outer = square(20);
    const inner = square(12).map((point) => point.add(new THREE.Vector2(4, 4)));
    const odd = [
      new THREE.Vector2(7, 7),
      new THREE.Vector2(9, 8),
      new THREE.Vector2(11, 7),
    ];
    const contour = { points: outer, area: 400, isOuter: true };
    const generated: GeneratedPerimeters = {
      walls: [outer, inner, odd],
      lineWidths: [
        [0.34, 0.58, 0.52, 0.37],
        [0.39, 0.64, 0.61, 0.4],
        [0.22, 0.3, 0.24],
      ],
      wallClosed: [true, true, false],
      wallDepths: [0, 1, 1],
      wallSources: ['outer', 'outer', 'gapfill'],
      outerCount: 1,
      innermostHoles: [],
      infillRegions: [],
    };
    const pipeline = {
      findSeamPosition: () => 0,
      reorderFromIndex: (points: THREE.Vector2[], index: number) => [
        ...points.slice(index),
        ...points.slice(0, index),
      ],
      simplifyClosedContour: (points: THREE.Vector2[]) => points,
      filterPerimetersByMinOdd: (perimeters: GeneratedPerimeters) => perimeters,
      generatePerimeters: () => generated,
    };
    const run = {
      pp: {
        groupOuterWalls: false,
        wallCount: 3,
        wallLineWidth: 0.4,
        outerWallLineWidth: 0.4,
        innerWallLineWidth: 0.45,
        outerWallFirst: true,
      },
      emitter: {
        currentX: 0,
        currentY: 0,
        currentLayerFlow: 1,
        setAccel: () => undefined,
        setJerk: () => undefined,
        travelTo(x: number, y: number) {
          this.currentX = x;
          this.currentY = y;
        },
        extrudeTo(x: number, y: number) {
          this.currentX = x;
          this.currentY = y;
          return { time: 0 };
        },
        calculateExtrusion: (_dist: number, lineWidth: number) => lineWidth,
      },
      gcode: [],
      previousSeamPoints: [],
      currentSeamPoints: [],
    } as unknown as SliceRun;
    const layer = {
      li: 58,
      layerZ: 11.8,
      layerH: 0.2,
      isFirstLayer: false,
      isSolidTop: false,
      isSolidBottom: false,
      outerWallSpeed: 20,
      innerWallSpeed: 30,
      workContours: [contour],
      holesByOuterContour: new Map(),
      moves: [],
      layerTime: 0,
      hasBridgeRegions: false,
    } as unknown as SliceLayerState;

    emitGroupedAndContourWalls(pipeline, run, layer);

    const outerWallWidths = layer.moves
      .filter((move) => move.type === 'wall-outer')
      .map((move) => move.lineWidth);
    const innerWidths = layer.moves
      .filter((move) => move.type === 'wall-inner')
      .map((move) => move.lineWidth);

    expect(new Set(outerWallWidths)).toEqual(new Set([0.4]));
    expect(innerWidths.some((width) => Math.abs(width - 0.515) < 1e-9)).toBe(false);
    expect(innerWidths).toContain(0.26);
    expect(innerWidths).toContain(0.27);
  });

  it('orders separate contours by nearest reachable wall start', () => {
    const farOuter = square(10).map((point) => point.add(new THREE.Vector2(100, 100)));
    const farInner = square(5).map((point) => point.add(new THREE.Vector2(102, 102)));
    const nearOuter = square(10).map((point) => point.add(new THREE.Vector2(5, 5)));
    const nearInner = square(5).map((point) => point.add(new THREE.Vector2(7, 7)));
    const farContour = { points: farOuter, area: 100, isOuter: true };
    const nearContour = { points: nearOuter, area: 100, isOuter: true };
    const generated = new Map<object, GeneratedPerimeters>([
      [farContour, {
        walls: [farOuter, farInner],
        lineWidths: [0.45, 0.45],
        wallClosed: [true, true],
        wallDepths: [0, 1],
        wallSources: ['outer', 'outer'],
        outerCount: 1,
        innermostHoles: [],
        infillRegions: [],
      }],
      [nearContour, {
        walls: [nearOuter, nearInner],
        lineWidths: [0.45, 0.45],
        wallClosed: [true, true],
        wallDepths: [0, 1],
        wallSources: ['outer', 'outer'],
        outerCount: 1,
        innermostHoles: [],
        infillRegions: [],
      }],
    ]);
    const travelStarts: Array<{ x: number; y: number }> = [];
    const pipeline = {
      findSeamPosition: () => 0,
      reorderFromIndex: (points: THREE.Vector2[], index: number) => [
        ...points.slice(index),
        ...points.slice(0, index),
      ],
      simplifyClosedContour: (points: THREE.Vector2[]) => points,
      filterPerimetersByMinOdd: (perimeters: GeneratedPerimeters) => perimeters,
      generatePerimeters: (points: THREE.Vector2[]) => {
        if (points === farContour.points) return generated.get(farContour)!;
        if (points === nearContour.points) return generated.get(nearContour)!;
        throw new Error('unexpected contour');
      },
    };
    const run = {
      pp: {
        groupOuterWalls: false,
        wallCount: 2,
        wallLineWidth: 0.45,
        outerWallFirst: false,
      },
      emitter: {
        currentX: 0,
        currentY: 0,
        currentLayerFlow: 1,
        setAccel: () => undefined,
        setJerk: () => undefined,
        travelTo(x: number, y: number) {
          travelStarts.push({ x, y });
          this.currentX = x;
          this.currentY = y;
        },
        extrudeTo(x: number, y: number) {
          this.currentX = x;
          this.currentY = y;
          return { time: 0 };
        },
        calculateExtrusion: () => 0,
      },
      gcode: [],
      previousSeamPoints: [],
      currentSeamPoints: [],
    } as unknown as SliceRun;
    const layer = {
      li: 0,
      layerZ: 0.2,
      layerH: 0.2,
      isFirstLayer: true,
      isSolidTop: false,
      isSolidBottom: false,
      outerWallSpeed: 20,
      innerWallSpeed: 30,
      workContours: [farContour, nearContour],
      holesByOuterContour: new Map(),
      moves: [],
      layerTime: 0,
      hasBridgeRegions: false,
    } as unknown as SliceLayerState;

    emitGroupedAndContourWalls(pipeline, run, layer);

    expect(travelStarts[0]).toEqual({ x: 7, y: 7 });
  });
});
