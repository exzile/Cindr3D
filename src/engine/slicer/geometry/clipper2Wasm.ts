import * as THREE from 'three';

type JoinType = 'miter' | 'square' | 'round';

export type Clipper2OffsetOptions = {
  joinType?: JoinType;
  miterLimit?: number;
  arcTolerance?: number;
  precision?: number;
};

export interface Clipper2Module {
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _clipperAnswer(): number;
  _offsetPaths(
    pointsPtr: number,
    pathCountsPtr: number,
    pathCount: number,
    delta: number,
    joinType: number,
    miterLimit: number,
    arcTolerance: number,
    precision: number,
  ): number;
  _getOffsetCounts(outPtr: number): void;
  _emitOffsetPathCounts(outPtr: number, capacityInts: number): number;
  _emitOffsetPoints(outPtr: number, capacityDoubles: number): number;
  _resetOffsetPaths(): void;
  // op: 0=union, 1=intersection, 2=difference, 3=xor
  // fillRule: 0=evenodd, 1=nonzero, 2=positive, 3=negative
  _booleanPaths(
    subjPointsPtr: number, subjCountsPtr: number, subjCount: number,
    clipPointsPtr: number, clipCountsPtr: number, clipCount: number,
    op: number, fillRule: number, precision: number,
  ): number;
}

type BooleanOp = 'union' | 'intersection' | 'difference' | 'xor';
type FillRule = 'evenodd' | 'nonzero' | 'positive' | 'negative';
type BooleanOptions = { fillRule?: FillRule; precision?: number };

function booleanOpToInt(op: BooleanOp): number {
  if (op === 'intersection') return 1;
  if (op === 'difference') return 2;
  if (op === 'xor') return 3;
  return 0;
}

function fillRuleToInt(fr: FillRule): number {
  if (fr === 'nonzero') return 1;
  if (fr === 'positive') return 2;
  if (fr === 'negative') return 3;
  return 0;
}

let modulePromise: Promise<Clipper2Module> | null = null;
let loadedModule: Clipper2Module | null = null;

function joinTypeToInt(joinType: JoinType): number {
  if (joinType === 'square') return 1;
  if (joinType === 'round') return 2;
  return 0;
}

export async function loadClipper2Module(): Promise<Clipper2Module> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const factory = (await import('../../../../wasm/dist/clipper2.js')).default;
    const factoryOpts: { wasmBinary?: ArrayBuffer; locateFile?(path: string): string } = {};
    const maybeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
    if (maybeProcess?.versions?.node) {
      const nodePrefix = 'node';
      const fs = await import(/* @vite-ignore */ `${nodePrefix}:fs/promises`);
      const url = await import(/* @vite-ignore */ `${nodePrefix}:url`);
      const path = await import(/* @vite-ignore */ `${nodePrefix}:path`);
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const wasmPath = path.resolve(here, '../../../../wasm/dist/clipper2.wasm');
      const buf = await fs.readFile(wasmPath);
      factoryOpts.wasmBinary = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer;
    }

    const mod: Clipper2Module = await factory(factoryOpts);
    if (typeof mod._clipperAnswer !== 'function' || mod._clipperAnswer() !== 1) {
      throw new Error('clipper2Wasm: module loaded but _clipperAnswer() check failed');
    }
    loadedModule = mod;
    return mod;
  })();
  return modulePromise;
}

export function getLoadedClipper2Module(): Clipper2Module | null {
  return loadedModule;
}

function offsetPathsWithModule(
  mod: Clipper2Module,
  paths: THREE.Vector2[][],
  delta: number,
  options: Clipper2OffsetOptions = {},
): THREE.Vector2[][] {
  const validPaths = paths.filter((path) => path.length >= 3);
  if (validPaths.length === 0) return [];

  const totalPoints = validPaths.reduce((sum, path) => sum + path.length, 0);
  const pointsPtr = mod._malloc(totalPoints * 2 * 8);
  const countsPtr = mod._malloc(validPaths.length * 4);
  if (!pointsPtr || !countsPtr) {
    if (pointsPtr) mod._free(pointsPtr);
    if (countsPtr) mod._free(countsPtr);
    throw new Error('clipper2Wasm: malloc failed for input buffers');
  }

  try {
    const points = new Float64Array(mod.HEAPF64.buffer, pointsPtr, totalPoints * 2);
    const counts = new Int32Array(mod.HEAP32.buffer, countsPtr, validPaths.length);
    let pointOffset = 0;
    validPaths.forEach((path, pathIndex) => {
      counts[pathIndex] = path.length;
      for (const point of path) {
        points[pointOffset++] = point.x;
        points[pointOffset++] = point.y;
      }
    });

    const status = mod._offsetPaths(
      pointsPtr,
      countsPtr,
      validPaths.length,
      delta,
      joinTypeToInt(options.joinType ?? 'miter'),
      options.miterLimit ?? 2,
      options.arcTolerance ?? 0,
      options.precision ?? 3,
    );
    if (status !== 0) throw new Error(`clipper2Wasm: _offsetPaths returned ${status}`);

    const outCountsPtr = mod._malloc(2 * 4);
    if (!outCountsPtr) throw new Error('clipper2Wasm: malloc failed for output counts');
    let outputPathCount = 0;
    let outputPointCount = 0;
    try {
      mod._getOffsetCounts(outCountsPtr);
      const outCounts = new Int32Array(mod.HEAP32.buffer, outCountsPtr, 2);
      outputPathCount = outCounts[0];
      outputPointCount = outCounts[1];
    } finally {
      mod._free(outCountsPtr);
    }
    if (outputPathCount === 0 || outputPointCount === 0) return [];

    const outputCountsPtr = mod._malloc(outputPathCount * 4);
    const outputPointsPtr = mod._malloc(outputPointCount * 2 * 8);
    if (!outputCountsPtr || !outputPointsPtr) {
      if (outputCountsPtr) mod._free(outputCountsPtr);
      if (outputPointsPtr) mod._free(outputPointsPtr);
      throw new Error('clipper2Wasm: malloc failed for output buffers');
    }

    try {
      if (mod._emitOffsetPathCounts(outputCountsPtr, outputPathCount) < 0) {
        throw new Error('clipper2Wasm: _emitOffsetPathCounts capacity mismatch');
      }
      if (mod._emitOffsetPoints(outputPointsPtr, outputPointCount * 2) < 0) {
        throw new Error('clipper2Wasm: _emitOffsetPoints capacity mismatch');
      }

      const outputCounts = new Int32Array(mod.HEAP32.buffer, outputCountsPtr, outputPathCount);
      const outputPoints = new Float64Array(mod.HEAPF64.buffer, outputPointsPtr, outputPointCount * 2);
      const result: THREE.Vector2[][] = [];
      let offset = 0;
      for (let pathIndex = 0; pathIndex < outputPathCount; pathIndex++) {
        const count = outputCounts[pathIndex];
        const path: THREE.Vector2[] = [];
        for (let i = 0; i < count; i++) {
          path.push(new THREE.Vector2(outputPoints[offset++], outputPoints[offset++]));
        }
        if (path.length >= 3) result.push(path);
      }
      return result;
    } finally {
      mod._free(outputCountsPtr);
      mod._free(outputPointsPtr);
    }
  } finally {
    mod._free(pointsPtr);
    mod._free(countsPtr);
    mod._resetOffsetPaths();
  }
}

export async function offsetPathsClipper2(
  paths: THREE.Vector2[][],
  delta: number,
  options: Clipper2OffsetOptions = {},
): Promise<THREE.Vector2[][]> {
  return offsetPathsWithModule(await loadClipper2Module(), paths, delta, options);
}

export function offsetPathsClipper2Sync(
  paths: THREE.Vector2[][],
  delta: number,
  options: Clipper2OffsetOptions = {},
): THREE.Vector2[][] | null {
  const mod = getLoadedClipper2Module();
  if (!mod) return null;
  return offsetPathsWithModule(mod, paths, delta, options);
}

function booleanPathsWithModule(
  mod: Clipper2Module,
  subjects: THREE.Vector2[][],
  clips: THREE.Vector2[][],
  op: BooleanOp,
  options: BooleanOptions = {},
): THREE.Vector2[][] {
  const subj = subjects.filter((p) => p.length >= 2);
  const clip = clips.filter((p) => p.length >= 2);
  if (subj.length === 0 && clip.length === 0) return [];

  const subjTotal = subj.reduce((s, p) => s + p.length, 0);
  const clipTotal = clip.reduce((s, p) => s + p.length, 0);

  // Allocate input buffers separately so each malloc is 16-aligned.
  const subjPointsPtr = subjTotal > 0 ? mod._malloc(subjTotal * 2 * 8) : 0;
  const subjCountsPtr = subj.length > 0 ? mod._malloc(subj.length * 4) : 0;
  const clipPointsPtr = clipTotal > 0 ? mod._malloc(clipTotal * 2 * 8) : 0;
  const clipCountsPtr = clip.length > 0 ? mod._malloc(clip.length * 4) : 0;

  const writePaths = (
    paths: THREE.Vector2[][], pointsPtr: number, countsPtr: number,
  ) => {
    if (paths.length === 0) return;
    const total = paths.reduce((s, p) => s + p.length, 0);
    const pts = new Float64Array(mod.HEAPF64.buffer, pointsPtr, total * 2);
    const cnt = new Int32Array(mod.HEAP32.buffer, countsPtr, paths.length);
    let off = 0;
    paths.forEach((path, i) => {
      cnt[i] = path.length;
      for (const p of path) { pts[off++] = p.x; pts[off++] = p.y; }
    });
  };

  try {
    writePaths(subj, subjPointsPtr, subjCountsPtr);
    writePaths(clip, clipPointsPtr, clipCountsPtr);

    const status = mod._booleanPaths(
      subjPointsPtr, subjCountsPtr, subj.length,
      clipPointsPtr, clipCountsPtr, clip.length,
      booleanOpToInt(op),
      fillRuleToInt(options.fillRule ?? 'evenodd'),
      options.precision ?? 3,
    );
    if (status !== 0) throw new Error(`clipper2Wasm: _booleanPaths returned ${status}`);

    const outCountsPtr = mod._malloc(2 * 4);
    let outPathCount = 0, outPointCount = 0;
    try {
      mod._getOffsetCounts(outCountsPtr);
      const c = new Int32Array(mod.HEAP32.buffer, outCountsPtr, 2);
      outPathCount = c[0]; outPointCount = c[1];
    } finally {
      mod._free(outCountsPtr);
    }
    if (outPathCount === 0 || outPointCount === 0) return [];

    const pathCountsPtr = mod._malloc(outPathCount * 4);
    const pointsPtr = mod._malloc(outPointCount * 2 * 8);
    try {
      if (mod._emitOffsetPathCounts(pathCountsPtr, outPathCount) < 0) {
        throw new Error('clipper2Wasm: _emitOffsetPathCounts capacity mismatch');
      }
      if (mod._emitOffsetPoints(pointsPtr, outPointCount * 2) < 0) {
        throw new Error('clipper2Wasm: _emitOffsetPoints capacity mismatch');
      }
      const counts = new Int32Array(mod.HEAP32.buffer, pathCountsPtr, outPathCount);
      const points = new Float64Array(mod.HEAPF64.buffer, pointsPtr, outPointCount * 2);
      const result: THREE.Vector2[][] = [];
      let off = 0;
      for (let pi = 0; pi < outPathCount; pi++) {
        const n = counts[pi];
        const path: THREE.Vector2[] = [];
        for (let i = 0; i < n; i++) {
          const x = points[off++]; const y = points[off++];
          path.push(new THREE.Vector2(x, y));
        }
        if (path.length >= 3) result.push(path);
      }
      return result;
    } finally {
      mod._free(pathCountsPtr);
      mod._free(pointsPtr);
    }
  } finally {
    if (subjPointsPtr) mod._free(subjPointsPtr);
    if (subjCountsPtr) mod._free(subjCountsPtr);
    if (clipPointsPtr) mod._free(clipPointsPtr);
    if (clipCountsPtr) mod._free(clipCountsPtr);
    mod._resetOffsetPaths();
  }
}

/**
 * Polygon boolean op via Clipper2 WASM. Same emit pipeline as offset
 * (both produce a PathsD result through `g_result_paths` C++-side).
 *
 * Default `evenodd` fill rule matches the `polygon-clipping` JS dep we
 * intend to retire — see TaskLists ARACHNE-9.4A.4.
 */
export async function booleanPathsClipper2(
  subjects: THREE.Vector2[][],
  clips: THREE.Vector2[][],
  op: BooleanOp,
  options: BooleanOptions = {},
): Promise<THREE.Vector2[][]> {
  return booleanPathsWithModule(await loadClipper2Module(), subjects, clips, op, options);
}

export function booleanPathsClipper2Sync(
  subjects: THREE.Vector2[][],
  clips: THREE.Vector2[][],
  op: BooleanOp,
  options: BooleanOptions = {},
): THREE.Vector2[][] | null {
  const mod = getLoadedClipper2Module();
  if (!mod) return null;
  return booleanPathsWithModule(mod, subjects, clips, op, options);
}
