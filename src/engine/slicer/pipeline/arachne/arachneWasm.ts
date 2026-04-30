import * as THREE from 'three';

import type { PrintProfile } from '../../../../types/slicer';
import type { ArachneBackend, ArachneGenerationContext, ArachnePathResult, ArachneSectionType, VariableWidthPath } from './types';

interface ArachneModule {
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _arachneAnswer(): number;
  _arachneConfigValueCount(): number;
  _generateArachnePaths(
    pointsPtr: number,
    pathCountsPtr: number,
    pathCount: number,
    configValuesPtr: number,
    configValueCount: number,
  ): number;
  _getArachneCounts(outPtr: number): void;
  _emitArachnePathCounts(outPtr: number, capacityInts: number): number;
  _emitArachnePathMeta(outPtr: number, capacityInts: number): number;
  _emitArachnePoints(outPtr: number, capacityDoubles: number): number;
  _getArachneInnerContourCounts(outPtr: number): void;
  _emitArachneInnerContourPathCounts(outPtr: number, capacityInts: number): number;
  _emitArachneInnerContourPoints(outPtr: number, capacityDoubles: number): number;
  _resetArachnePaths(): void;
}

let modulePromise: Promise<ArachneModule> | null = null;
let loadedModule: ArachneModule | null = null;

export async function loadArachneModule(): Promise<ArachneModule> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const factory = (await import('../../../../../wasm/dist/arachne.js')).default;
    const factoryOpts: { wasmBinary?: ArrayBuffer; locateFile?(path: string): string } = {};
    const maybeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
    if (maybeProcess?.versions?.node) {
      const nodePrefix = 'node';
      const fs = await import(/* @vite-ignore */ `${nodePrefix}:fs/promises`);
      const url = await import(/* @vite-ignore */ `${nodePrefix}:url`);
      const path = await import(/* @vite-ignore */ `${nodePrefix}:path`);
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const wasmPath = path.resolve(here, '../../../../../wasm/dist/arachne.wasm');
      const buf = await fs.readFile(wasmPath);
      factoryOpts.wasmBinary = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer;
    }

    const mod: ArachneModule = await factory(factoryOpts);
    if (typeof mod._arachneAnswer !== 'function' || mod._arachneAnswer() !== 1) {
      throw new Error('arachneWasm: module loaded but _arachneAnswer() check failed');
    }
    if (mod._arachneConfigValueCount() !== 25) {
      throw new Error('arachneWasm: module config ABI mismatch');
    }
    loadedModule = mod;
    return mod;
  })();
  return modulePromise;
}

export function getLoadedArachneModule(): ArachneModule | null {
  return loadedModule;
}

function flattenContours(
  outerContour: THREE.Vector2[],
  holeContours: THREE.Vector2[][],
): { paths: THREE.Vector2[][]; pointCount: number } {
  const paths = [outerContour, ...holeContours].filter((path) => path.length >= 3);
  return {
    paths,
    pointCount: paths.reduce((sum, path) => sum + path.length, 0),
  };
}

const SECTION_TYPE_ID: Record<ArachneSectionType, number> = {
  wall: 1,
  infill: 2,
  skin: 3,
  support: 4,
  adhesion: 5,
  ironing: 6,
  mesh: 7,
  dots: 8,
  'concentric-infill': 9,
};

/** Build the 25-field flat ArachneConfig buffer. Field order MUST match
 *  `wasm/src/arachne_config.h`. Settings missing from the profile fall
 *  back to the libArachne defaults Cura ships with `wall_line_width = 0.4`
 *  for a typical 0.4mm nozzle. */
export function configValues(
  wallCount: number,
  lineWidth: number,
  outerWallInset: number,
  printProfile: PrintProfile,
  context: ArachneGenerationContext = {},
): Float64Array {
  const outerWidth = context.isFirstLayer ? lineWidth : (printProfile.outerWallLineWidth ?? lineWidth);
  const innerWidth = context.isFirstLayer ? lineWidth : (printProfile.innerWallLineWidth ?? lineWidth);
  // OrcaSlicer's `make_paths_params` (libslic3r/Arachne/WallToolPaths.cpp)
  // computes each libArachne threshold as `% × nozzle_diameter`.
  // We mirror that exactly when `context.nozzleDiameter` is plumbed
  // through, so behavior matches Orca on profiles where line width
  // and nozzle diameter differ (e.g. 0.45mm line on a 0.6mm nozzle).
  // Falls back to lineWidth when nozzle is unknown — equivalent to the
  // common case where line width and nozzle match.
  const nozzleRef = context.nozzleDiameter && context.nozzleDiameter > 0
    ? context.nozzleDiameter
    : lineWidth;
  const minWallLW = printProfile.minWallLineWidth ?? nozzleRef * 0.85;        // Orca: 85% of nozzle
  const minEvenLW = printProfile.minEvenWallLineWidth ?? minWallLW;
  // Cura calls this `min_odd_wall_line_width` (the min for the odd
  // gapfill bead). Profile aliases it as `minThinWallLineWidth`.
  const minOddLW = printProfile.minThinWallLineWidth ?? minWallLW;
  const minFeature = printProfile.minFeatureSize ?? nozzleRef * 0.25;          // Orca: 25% of nozzle
  const transitionLength = printProfile.wallTransitionLength ?? nozzleRef;     // Orca: 100% of nozzle
  const transitionAngle = printProfile.wallTransitionAngle ?? 10;
  // OrcaSlicer hardcodes `transition_filter_dist = 100mm` in their
  // libArachne fork (`Arachne/WallToolPaths.cpp:541`). It tells
  // SkeletalTrapezoidation how far apart two width-transitions need
  // to be before they're considered distinct — at 100mm any thin
  // ring's transitions get merged into one, eliminating the
  // medial-axis spurs that surface as inward triangular bumps on the
  // outer wall preview. Our previous default (`lineWidth × 0.25` ≈
  // 0.11mm) was ~900× tighter, which is why spurs survived even
  // after matching every other Orca config value.
  const transitionFilterDist = printProfile.wallTransitionFilterDistance ?? 100;
  // `wall_transition_filter_deviation` — Orca's default is 25% of
  // nozzle. Larger margin = wider hysteresis band around the wall-
  // count transition threshold = libArachne stays on the same wall
  // count across small width changes instead of emitting a medial-axis
  // transition spur. The spurs are exactly what was producing the
  // inward triangular bumps on the outer wall preview.
  const transitionFilterMargin = printProfile.wallTransitionFilterMargin ?? nozzleRef * 0.25;
  const wallDistribution = printProfile.wallDistributionCount ?? 1;
  const sectionType = SECTION_TYPE_ID[context.sectionType ?? 'wall'];
  const minWallLengthFactor = printProfile.minWallLengthFactor ?? 0.5;
  const fluidMotionEnabled = printProfile.fluidMotionEnable === true;
  const preciseOuterWall = printProfile.preciseOuterWall === true;
  // `printThinWalls` is the Cura-named field. Older profiles use
  // `thinWallDetection` as the same boolean. Either truthy enables.
  const enableThinWalls = (printProfile.printThinWalls ?? printProfile.thinWallDetection) !== false;

  return new Float64Array([
    wallCount,                     // 0  inset_count
    outerWidth,                    // 1  bead_width_0 (outer)
    innerWidth,                    // 2  bead_width_x (inner)
    outerWallInset,                // 3  wall_0_inset
    transitionLength,              // 4  wall_transition_length
    transitionAngle,               // 5  wall_transition_angle_deg
    transitionFilterDist,          // 6  wall_transition_filter_distance
    transitionFilterMargin,        // 7  wall_transition_filter_deviation
    minFeature,                    // 8  min_feature_size
    minWallLW,                     // 9  min_bead_width
    wallDistribution,              // 10 wall_distribution_count
    sectionType,                   // 11 section_type
    0.01,                          // 12 meshfix_maximum_deviation
    minWallLW,                     // 13 min_wall_line_width
    minEvenLW,                     // 14 min_even_wall_line_width
    minOddLW,                      // 15 min_odd_wall_line_width
    0.5,                           // 16 min_variable_line_ratio
    // Match OrcaSlicer's wall-simplifier defaults so libArachne's
    // medial-axis paths get collapsed at the same scale theirs do. Our
    // previous 0.01 values were 50× tighter than Orca's 0.5/0.025,
    // which preserved branch-tip side-trips inside individual
    // ExtrusionLines. Diagnostic confirmed Orca's gcode for the same
    // STL has internal teleports max ~1.6mm vs ours at ~6.7mm — the
    // simplifier is the only difference.
    printProfile.wallMaximumResolution ?? 0.5,  // 17 simplify_max_resolution
    printProfile.wallMaximumDeviation ?? 0.025, // 18 simplify_max_deviation
    0.01,                          // 19 simplify_max_area_deviation
    enableThinWalls ? 1 : 0,       // 20 print_thin_walls
    fluidMotionEnabled ? 1 : 0,    // 21 fluid_motion_enabled
    minWallLengthFactor,           // 22 min_wall_length_factor
    context.isTopOrBottomLayer ? 1 : 0, // 23 is_top_or_bottom_layer
    preciseOuterWall ? 1 : 0,      // 24 precise_outer_wall
  ]);
}

function emitInnerContoursWithModule(mod: ArachneModule): THREE.Vector2[][] {
  const countsPtr = mod._malloc(2 * 4);
  if (!countsPtr) throw new Error('arachneWasm: malloc failed for inner contour counts');
  let contourCount = 0;
  let pointCount = 0;
  try {
    mod._getArachneInnerContourCounts(countsPtr);
    const counts = new Int32Array(mod.HEAP32.buffer, countsPtr, 2);
    contourCount = counts[0];
    pointCount = counts[1];
  } finally {
    mod._free(countsPtr);
  }
  if (contourCount === 0 || pointCount === 0) return [];

  const pathCountsPtr = mod._malloc(contourCount * 4);
  const pointsPtr = mod._malloc(pointCount * 2 * 8);
  if (!pathCountsPtr || !pointsPtr) {
    if (pathCountsPtr) mod._free(pathCountsPtr);
    if (pointsPtr) mod._free(pointsPtr);
    throw new Error('arachneWasm: malloc failed for inner contour output');
  }

  try {
    if (mod._emitArachneInnerContourPathCounts(pathCountsPtr, contourCount) < 0) {
      throw new Error('arachneWasm: _emitArachneInnerContourPathCounts capacity mismatch');
    }
    if (mod._emitArachneInnerContourPoints(pointsPtr, pointCount * 2) < 0) {
      throw new Error('arachneWasm: _emitArachneInnerContourPoints capacity mismatch');
    }

    const pathCounts = new Int32Array(mod.HEAP32.buffer, pathCountsPtr, contourCount);
    const points = new Float64Array(mod.HEAPF64.buffer, pointsPtr, pointCount * 2);
    const contours: THREE.Vector2[][] = [];
    let pointOffset = 0;
    for (let contourIndex = 0; contourIndex < contourCount; contourIndex++) {
      const count = pathCounts[contourIndex];
      const contour: THREE.Vector2[] = [];
      for (let i = 0; i < count; i++) {
        contour.push(new THREE.Vector2(points[pointOffset++], points[pointOffset++]));
      }
      if (contour.length >= 3) contours.push(contour);
    }
    return contours;
  } finally {
    mod._free(pathCountsPtr);
    mod._free(pointsPtr);
  }
}

function generatePathsWithModule(
  mod: ArachneModule,
  outerContour: THREE.Vector2[],
  holeContours: THREE.Vector2[][],
  wallCount: number,
  lineWidth: number,
  outerWallInset: number,
  printProfile: PrintProfile,
  context: ArachneGenerationContext = {},
): ArachnePathResult {
  const { paths, pointCount } = flattenContours(outerContour, holeContours);
  if (paths.length === 0 || pointCount === 0) return { paths: [], innerContours: [] };

  const pointsPtr = mod._malloc(pointCount * 2 * 8);
  const countsPtr = mod._malloc(paths.length * 4);
  const config = configValues(wallCount, lineWidth, outerWallInset, printProfile, context);
  if (config.length !== mod._arachneConfigValueCount()) {
    throw new Error(`arachneWasm: configValues length ${config.length} != module ABI ${mod._arachneConfigValueCount()}`);
  }
  const configPtr = mod._malloc(config.byteLength);
  if (!pointsPtr || !countsPtr || !configPtr) {
    if (pointsPtr) mod._free(pointsPtr);
    if (countsPtr) mod._free(countsPtr);
    if (configPtr) mod._free(configPtr);
    throw new Error('arachneWasm: malloc failed for input buffers');
  }

  try {
    const points = new Float64Array(mod.HEAPF64.buffer, pointsPtr, pointCount * 2);
    const counts = new Int32Array(mod.HEAP32.buffer, countsPtr, paths.length);
    let offset = 0;
    paths.forEach((path, pathIndex) => {
      counts[pathIndex] = path.length;
      for (const point of path) {
        points[offset++] = point.x;
        points[offset++] = point.y;
      }
    });
    new Float64Array(mod.HEAPF64.buffer, configPtr, config.length).set(config);

    const status = mod._generateArachnePaths(
      pointsPtr,
      countsPtr,
      paths.length,
      configPtr,
      config.length,
    );
    if (status !== 0) throw new Error(`arachneWasm: _generateArachnePaths returned ${status}`);

    const outCountsPtr = mod._malloc(2 * 4);
    if (!outCountsPtr) throw new Error('arachneWasm: malloc failed for output counts');
    let outputPathCount = 0;
    let outputPointCount = 0;
    try {
      mod._getArachneCounts(outCountsPtr);
      const outCounts = new Int32Array(mod.HEAP32.buffer, outCountsPtr, 2);
      outputPathCount = outCounts[0];
      outputPointCount = outCounts[1];
    } finally {
      mod._free(outCountsPtr);
    }
    if (outputPathCount === 0 || outputPointCount === 0) {
      return { paths: [], innerContours: emitInnerContoursWithModule(mod) };
    }

    const outputCountsPtr = mod._malloc(outputPathCount * 4);
    const outputMetaPtr = mod._malloc(outputPathCount * 3 * 4);
    const outputPointsPtr = mod._malloc(outputPointCount * 3 * 8);
    if (!outputCountsPtr || !outputMetaPtr || !outputPointsPtr) {
      if (outputCountsPtr) mod._free(outputCountsPtr);
      if (outputMetaPtr) mod._free(outputMetaPtr);
      if (outputPointsPtr) mod._free(outputPointsPtr);
      throw new Error('arachneWasm: malloc failed for output buffers');
    }

    try {
      if (mod._emitArachnePathCounts(outputCountsPtr, outputPathCount) < 0) {
        throw new Error('arachneWasm: _emitArachnePathCounts capacity mismatch');
      }
      if (mod._emitArachnePathMeta(outputMetaPtr, outputPathCount * 3) < 0) {
        throw new Error('arachneWasm: _emitArachnePathMeta capacity mismatch');
      }
      if (mod._emitArachnePoints(outputPointsPtr, outputPointCount * 3) < 0) {
        throw new Error('arachneWasm: _emitArachnePoints capacity mismatch');
      }

      const outputCounts = new Int32Array(mod.HEAP32.buffer, outputCountsPtr, outputPathCount);
      const outputMeta = new Int32Array(mod.HEAP32.buffer, outputMetaPtr, outputPathCount * 3);
      const outputPoints = new Float64Array(mod.HEAPF64.buffer, outputPointsPtr, outputPointCount * 3);
      const result: VariableWidthPath[] = [];
      let pointOffset = 0;

      for (let pathIndex = 0; pathIndex < outputPathCount; pathIndex++) {
        const count = outputCounts[pathIndex];
        const pointsOut: THREE.Vector2[] = [];
        const widths: number[] = [];
        for (let i = 0; i < count; i++) {
          const x = outputPoints[pointOffset++];
          const y = outputPoints[pointOffset++];
          const width = outputPoints[pointOffset++];
          pointsOut.push(new THREE.Vector2(x, y));
          widths.push(width);
        }
        if (pointsOut.length >= 2 && widths.every((width) => Number.isFinite(width) && width > 0)) {
          const isOdd = outputMeta[pathIndex * 3 + 1] === 1;
          result.push({
            points: pointsOut,
            widths,
            depth: outputMeta[pathIndex * 3],
            isClosed: outputMeta[pathIndex * 3 + 2] === 1,
            source: isOdd ? 'gapfill' : 'outer',
          });
        }
      }
      return { paths: result, innerContours: emitInnerContoursWithModule(mod) };
    } finally {
      mod._free(outputCountsPtr);
      mod._free(outputMetaPtr);
      mod._free(outputPointsPtr);
    }
  } finally {
    mod._free(pointsPtr);
    mod._free(countsPtr);
    mod._free(configPtr);
    mod._resetArachnePaths();
  }
}

export async function generateArachnePathsWasm(
  outerContour: THREE.Vector2[],
  holeContours: THREE.Vector2[][],
  wallCount: number,
  lineWidth: number,
  outerWallInset: number,
  printProfile: PrintProfile,
  context?: ArachneGenerationContext,
): Promise<VariableWidthPath[]> {
  return generatePathsWithModule(
    await loadArachneModule(),
    outerContour,
    holeContours,
    wallCount,
    lineWidth,
    outerWallInset,
    printProfile,
    context,
  ).paths;
}

export function generateArachnePathsWasmSync(
  outerContour: THREE.Vector2[],
  holeContours: THREE.Vector2[][],
  wallCount: number,
  lineWidth: number,
  outerWallInset: number,
  printProfile: PrintProfile,
  context?: ArachneGenerationContext,
): VariableWidthPath[] | null {
  const mod = getLoadedArachneModule();
  if (!mod) return null;
  return generatePathsWithModule(mod, outerContour, holeContours, wallCount, lineWidth, outerWallInset, printProfile, context).paths;
}

export function generateArachnePathsWithInnerContoursWasmSync(
  outerContour: THREE.Vector2[],
  holeContours: THREE.Vector2[][],
  wallCount: number,
  lineWidth: number,
  outerWallInset: number,
  printProfile: PrintProfile,
  context?: ArachneGenerationContext,
): ArachnePathResult | null {
  const mod = getLoadedArachneModule();
  if (!mod) return null;
  return generatePathsWithModule(mod, outerContour, holeContours, wallCount, lineWidth, outerWallInset, printProfile, context);
}

export const arachneWasmBackend: ArachneBackend = {
  name: 'wasm',
  generatePaths: (
    outerContour: THREE.Vector2[],
    holeContours: THREE.Vector2[][],
    wallCount: number,
    lineWidth: number,
    outerWallInset: number,
    printProfile: PrintProfile,
    context?: ArachneGenerationContext,
  ) => {
    const paths = generateArachnePathsWasmSync(
      outerContour,
      holeContours,
      wallCount,
      lineWidth,
      outerWallInset,
      printProfile,
      context,
    );
    if (!paths) throw new Error('arachneWasm: module not loaded');
    return paths;
  },
  generatePathsWithInnerContours: (
    outerContour: THREE.Vector2[],
    holeContours: THREE.Vector2[][],
    wallCount: number,
    lineWidth: number,
    outerWallInset: number,
    printProfile: PrintProfile,
    context?: ArachneGenerationContext,
  ) => {
    const result = generateArachnePathsWithInnerContoursWasmSync(
      outerContour,
      holeContours,
      wallCount,
      lineWidth,
      outerWallInset,
      printProfile,
      context,
    );
    if (!result) throw new Error('arachneWasm: module not loaded');
    return result;
  },
};
