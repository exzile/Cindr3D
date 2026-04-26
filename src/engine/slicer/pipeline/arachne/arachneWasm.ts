import * as THREE from 'three';

import type { PrintProfile } from '../../../../types/slicer';
import type { ArachneBackend, VariableWidthPath } from './types';

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
      const fs = await import(`${nodePrefix}:fs/promises`);
      const url = await import(`${nodePrefix}:url`);
      const path = await import(`${nodePrefix}:path`);
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
    if (mod._arachneConfigValueCount() !== 22) {
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

/** Build the 22-field flat ArachneConfig buffer. Field order MUST match
 *  `wasm/src/arachne_config.h`. Settings missing from the profile fall
 *  back to the libArachne defaults Cura ships with `wall_line_width = 0.4`
 *  for a typical 0.4mm nozzle. */
function configValues(
  wallCount: number,
  lineWidth: number,
  outerWallInset: number,
  printProfile: PrintProfile,
): Float64Array {
  const outerWidth = printProfile.outerWallLineWidth ?? lineWidth;
  const innerWidth = printProfile.innerWallLineWidth ?? lineWidth;
  const minWallLW = printProfile.minWallLineWidth ?? lineWidth * 0.5;
  const minEvenLW = printProfile.minEvenWallLineWidth ?? minWallLW;
  // Cura calls this `min_odd_wall_line_width` (the min for the odd
  // gapfill bead). Profile aliases it as `minThinWallLineWidth`.
  const minOddLW = printProfile.minThinWallLineWidth ?? minWallLW;
  const minFeature = printProfile.minFeatureSize ?? minWallLW * 0.5;
  const transitionLength = printProfile.wallTransitionLength ?? lineWidth;
  const transitionAngle = printProfile.wallTransitionAngle ?? 10;
  const transitionFilterDist = printProfile.wallTransitionFilterDistance ?? lineWidth * 0.25;
  const transitionFilterMargin = printProfile.wallTransitionFilterMargin ?? lineWidth * 0.0625;
  const wallDistribution = printProfile.wallDistributionCount ?? 1;
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
    1,                             // 11 section_type (1 = walls)
    0.01,                          // 12 meshfix_maximum_deviation
    minWallLW,                     // 13 min_wall_line_width
    minEvenLW,                     // 14 min_even_wall_line_width
    minOddLW,                      // 15 min_odd_wall_line_width
    0.5,                           // 16 min_variable_line_ratio
    0.01,                          // 17 simplify_max_resolution
    0.01,                          // 18 simplify_max_deviation
    0.01,                          // 19 simplify_max_area_deviation
    enableThinWalls ? 1 : 0,       // 20 print_thin_walls
    0,                             // 21 fluid_motion_enabled
  ]);
}

function generatePathsWithModule(
  mod: ArachneModule,
  outerContour: THREE.Vector2[],
  holeContours: THREE.Vector2[][],
  wallCount: number,
  lineWidth: number,
  outerWallInset: number,
  printProfile: PrintProfile,
): VariableWidthPath[] {
  const { paths, pointCount } = flattenContours(outerContour, holeContours);
  if (paths.length === 0 || pointCount === 0) return [];

  const pointsPtr = mod._malloc(pointCount * 2 * 8);
  const countsPtr = mod._malloc(paths.length * 4);
  const config = configValues(wallCount, lineWidth, outerWallInset, printProfile);
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
    if (outputPathCount === 0 || outputPointCount === 0) return [];

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
      return result;
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
): Promise<VariableWidthPath[]> {
  return generatePathsWithModule(
    await loadArachneModule(),
    outerContour,
    holeContours,
    wallCount,
    lineWidth,
    outerWallInset,
    printProfile,
  );
}

export function generateArachnePathsWasmSync(
  outerContour: THREE.Vector2[],
  holeContours: THREE.Vector2[][],
  wallCount: number,
  lineWidth: number,
  outerWallInset: number,
  printProfile: PrintProfile,
): VariableWidthPath[] | null {
  const mod = getLoadedArachneModule();
  if (!mod) return null;
  return generatePathsWithModule(mod, outerContour, holeContours, wallCount, lineWidth, outerWallInset, printProfile);
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
  ) => {
    const paths = generateArachnePathsWasmSync(
      outerContour,
      holeContours,
      wallCount,
      lineWidth,
      outerWallInset,
      printProfile,
    );
    if (!paths) throw new Error('arachneWasm: module not loaded');
    return paths;
  },
};
