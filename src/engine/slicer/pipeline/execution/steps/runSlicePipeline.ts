import * as THREE from 'three';
import type { SliceResult } from '../../../../../types/slicer';
import { finalizeGCodeStats, appendEndGCode } from '../../../gcode/footer';
import { applyPostProcessingScripts } from '../../../gcode/postProcessing';
import { prepareSliceRun } from './prepareSliceRun';
import { emitLayerStartState, prepareLayerState } from './prepareLayerState';
import { emitGroupedAndContourWalls } from './emitGroupedAndContourWalls';
import { emitContourInfill } from './emitContourInfill';
import { finalizeLayer } from './finalizeLayer';
import { loadArachneModule, setArachneStatsLayer } from '../../arachne';
import type {
  SlicerExecutionPipeline,
  SliceGeometryRun,
  SliceLayerGeometryState,
  SliceLayerState,
  SliceRun,
} from './types';

interface SerializedVector3 {
  x: number;
  y: number;
  z: number;
}

interface SerializedTriangle {
  v0: SerializedVector3;
  v1: SerializedVector3;
  v2: SerializedVector3;
  normal: SerializedVector3;
  edgeKey01: string;
  edgeKey12: string;
  edgeKey20: string;
}

type SerializedGeometryRun = Omit<SliceGeometryRun, 'triangles' | 'modelBBox'> & {
  triangles: SerializedTriangle[];
  modelBBox: {
    min: SerializedVector3;
    max: SerializedVector3;
  };
};

type SerializedLayerGeometry = Omit<SliceLayerGeometryState, 'contours'> & {
  contours: Array<{
    area: number;
    isOuter: boolean;
    points: Array<[number, number]>;
  }>;
};

type LayerWorkerMessage =
  | { type: 'layer'; requestId: number; layerIndex: number; layer: SerializedLayerGeometry | null }
  | { type: 'complete'; requestId: number; layers: Array<{ layerIndex: number; layer: SerializedLayerGeometry | null }> }
  | { type: 'cancelled'; requestId: number }
  | { type: 'error'; requestId: number; message: string };

interface LayerPrepPool {
  workerCount: number;
  getLayer(layerIndex: number): Promise<SliceLayerGeometryState | null>;
  done: Promise<void>;
  stop(): void;
}

const MIN_LAYER_WORKER_POOL_LAYERS = 48;
const MAX_LAYER_PREP_WORKERS = 8;
const SMALL_MESH_LAYER_PREP_TRIANGLES = 20_000;
const MEDIUM_MESH_LAYER_PREP_TRIANGLES = 40_000;
const LARGE_MESH_LAYER_PREP_TRIANGLES = 80_000;
const HUGE_MESH_LAYER_PREP_TRIANGLES = 200_000;
const FAST_LAYER_YIELD_STRIDE = 8;
const HEAVY_LAYER_MS = 50;
const MAX_LAYER_PROGRESS_UPDATES = 40;

const TIMING_LABELS: Record<string, string> = {
  'prepare-run': 'Prepare geometry',
  'clipper-warmup': 'Clipper2 warmup',
  'arachne-warmup': 'Arachne warmup',
  'worker-layer-prep': 'Parallel layer prep',
  'prepare-layer': 'Slice contours',
  'emit-layer-start': 'Layer setup',
  walls: 'Walls / Arachne',
  infill: 'Infill / skin',
  finalize: 'Finalize layer',
  footer: 'Footer stats',
  postprocess: 'Post-processing',
};

function hardwareConcurrency(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  return Math.max(1, Math.floor(cores || 1));
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function createLayerWorker(): Worker {
  return new Worker(new URL('../../../../../workers/SlicerLayerWorker.ts', import.meta.url), { type: 'module' });
}

function serializeVector3(v: { x: number; y: number; z: number }): SerializedVector3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function triangleIntersectsLayerBatch(
  run: Pick<SliceRun, 'layerZs' | 'modelBBox'>,
  tri: SliceRun['triangles'][number],
  layerIndices: readonly number[],
): boolean {
  if (layerIndices.length === 0) return false;
  const modelMinZ = run.modelBBox.min.z;
  const minZ = Math.min(tri.v0.z, tri.v1.z, tri.v2.z) - modelMinZ;
  const maxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z) - modelMinZ;
  const eps = 1e-7;
  for (const layerIndex of layerIndices) {
    const layerZ = run.layerZs[layerIndex];
    if (layerZ >= minZ - eps && layerZ <= maxZ + eps) return true;
  }
  return false;
}

function serializeGeometryRun(run: SliceRun, layerIndices?: readonly number[]): SerializedGeometryRun {
  const triangles = layerIndices && layerIndices.length > 0
    ? run.triangles.filter((tri) => triangleIntersectsLayerBatch(run, tri, layerIndices))
    : run.triangles;

  return {
    pp: run.pp,
    mat: run.mat,
    triangles: triangles.map((tri) => ({
      v0: serializeVector3(tri.v0),
      v1: serializeVector3(tri.v1),
      v2: serializeVector3(tri.v2),
      normal: serializeVector3(tri.normal),
      edgeKey01: tri.edgeKey01,
      edgeKey12: tri.edgeKey12,
      edgeKey20: tri.edgeKey20,
    })),
    modelBBox: {
      min: serializeVector3(run.modelBBox.min),
      max: serializeVector3(run.modelBBox.max),
    },
    offsetX: run.offsetX,
    offsetY: run.offsetY,
    offsetZ: run.offsetZ,
    layerZs: run.layerZs,
    totalLayers: run.totalLayers,
    solidBottom: run.solidBottom,
    solidTop: run.solidTop,
    bedCenterX: run.bedCenterX,
    bedCenterY: run.bedCenterY,
  };
}

function hydrateLayerGeometry(layer: SerializedLayerGeometry | null): SliceLayerGeometryState | null {
  if (!layer) return null;
  return {
    ...layer,
    contours: layer.contours.map((contour) => ({
      area: contour.area,
      isOuter: contour.isOuter,
      points: contour.points.map(([x, y]) => new THREE.Vector2(x, y)),
    })),
  };
}

export function chooseLayerPrepWorkerCount(
  run: Pick<SliceRun, 'totalLayers' | 'triangles' | 'pp'>,
  cores = hardwareConcurrency(),
): number {
  if (run.totalLayers < MIN_LAYER_WORKER_POOL_LAYERS) return 0;
  const availableCores = Math.max(1, Math.floor(cores || 1));
  if (availableCores < 2) return 0;

  const print = run.pp as SliceRun['pp'] & { parallelLayerPreparation?: boolean };
  if (print.parallelLayerPreparation === false) return 0;

  const workerBudget = Math.min(Math.max(1, availableCores - 1), run.totalLayers, MAX_LAYER_PREP_WORKERS);
  const triangleCount = run.triangles.length;
  if (triangleCount >= HUGE_MESH_LAYER_PREP_TRIANGLES) return 0;
  if (triangleCount >= LARGE_MESH_LAYER_PREP_TRIANGLES) return Math.min(4, workerBudget);
  if (triangleCount >= MEDIUM_MESH_LAYER_PREP_TRIANGLES) return Math.min(5, workerBudget);
  if (triangleCount >= SMALL_MESH_LAYER_PREP_TRIANGLES) return Math.min(6, workerBudget);
  return workerBudget;
}

function shouldUseLayerWorkerPool(run: SliceRun): boolean {
  return chooseLayerPrepWorkerCount(run) > 1;
}

export function shouldYieldBeforeLayer(layerIndex: number, previousLayerMs: number): boolean {
  if (layerIndex === 0) return true;
  if (previousLayerMs >= HEAVY_LAYER_MS) return true;
  return layerIndex % FAST_LAYER_YIELD_STRIDE === 0;
}

export function layerProgressReportStride(totalLayers: number): number {
  if (totalLayers <= 20) return 1;
  return Math.max(1, Math.ceil(totalLayers / MAX_LAYER_PROGRESS_UPDATES));
}

function startLayerPrepWorkerPool(
  pipeline: unknown,
  run: SliceRun,
): LayerPrepPool {
  const slicer = pipeline as SlicerExecutionPipeline;
  const workerCount = chooseLayerPrepWorkerCount(run);
  const layerBatches = Array.from({ length: workerCount }, () => [] as number[]);
  for (let li = 0; li < run.totalLayers; li++) layerBatches[li % workerCount].push(li);

  const requestId = Math.floor(Math.random() * 1_000_000_000);
  const workers: Worker[] = [];
  const layerResolvers = new Array<(layer: SliceLayerGeometryState | null) => void>(run.totalLayers);
  const layerRejectors = new Array<(error: Error) => void>(run.totalLayers);
  const layerPromises = Array.from({ length: run.totalLayers }, (_, layerIndex) => new Promise<SliceLayerGeometryState | null>((resolve, reject) => {
    layerResolvers[layerIndex] = resolve;
    layerRejectors[layerIndex] = reject;
  }));
  let stopped = false;
  let cancelTimer: ReturnType<typeof setInterval> | null = null;

  const rejectAll = (error: Error) => {
    for (const reject of layerRejectors) reject(error);
  };

  const stop = () => {
    stopped = true;
    if (cancelTimer) {
      clearInterval(cancelTimer);
      cancelTimer = null;
    }
    for (const worker of workers) worker.terminate();
  };

  const runWorker = (layerIndices: number[]): Promise<void> => new Promise((resolve, reject) => {
    const worker = createLayerWorker();
    workers.push(worker);
    const geometryRun = serializeGeometryRun(run, layerIndices);

    worker.onmessage = (event: MessageEvent<LayerWorkerMessage>) => {
      const msg = event.data;
      if (msg.requestId !== requestId) return;
      if (msg.type === 'layer') {
        layerResolvers[msg.layerIndex]?.(hydrateLayerGeometry(msg.layer));
      } else if (msg.type === 'complete') {
        for (const item of msg.layers) {
          layerResolvers[item.layerIndex]?.(hydrateLayerGeometry(item.layer));
        }
        worker.terminate();
        resolve();
      } else if (msg.type === 'cancelled') {
        worker.terminate();
        const error = new Error('Slicing cancelled');
        reject(error);
        rejectAll(error);
      } else if (msg.type === 'error') {
        worker.terminate();
        const error = new Error(msg.message);
        reject(error);
        rejectAll(error);
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      const error = new Error(event.message || 'Layer worker failed');
      reject(error);
      rejectAll(error);
    };

    worker.postMessage({
      type: 'prepare-layers',
      requestId,
      payload: {
        geometryRun,
        printerProfile: run.printer,
        materialProfile: run.mat,
        printProfile: run.pp,
        layerIndices,
      },
    });
  });

  cancelTimer = setInterval(() => {
    if (!slicer.cancelled) return;
    for (const worker of workers) {
      worker.postMessage({ type: 'cancel', requestId });
      worker.terminate();
    }
    rejectAll(new Error('Slicing cancelled'));
  }, 50);

  slicer.reportProgress('slicing', 0, 0, run.totalLayers, `Preparing ${run.totalLayers} layers on ${workerCount} workers...`);
  const done = Promise.all(layerBatches.filter((batch) => batch.length > 0).map(runWorker))
    .then(() => undefined)
    .finally(() => {
      if (!stopped) stop();
    });

  return {
    workerCount,
    getLayer: (layerIndex: number) => layerPromises[layerIndex],
    done,
    stop,
  };
}

export async function runSlicePipeline(
  pipeline: unknown,
  geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
): Promise<SliceResult> {
  const totalStartMs = nowMs();
  const timings = new Map<string, { ms: number; count: number }>();
  const addTiming = (key: string, ms: number) => {
    const current = timings.get(key);
    if (current) {
      current.ms += ms;
      current.count += 1;
    } else {
      timings.set(key, { ms, count: 1 });
    }
  };

  const slicer = pipeline as SlicerExecutionPipeline & {
    prepareClipper2Offsets?: () => Promise<void>;
  };
  if (slicer.printProfile?.nonPlanarSlicingEnabled) {
    throw new Error('Non-planar slicing is not supported by the current planar G-code pipeline.');
  }
  let timingStartMs = nowMs();
  const run = prepareSliceRun(pipeline, geometries);
  addTiming('prepare-run', nowMs() - timingStartMs);

  timingStartMs = nowMs();
  await slicer.prepareClipper2Offsets?.();
  addTiming('clipper-warmup', nowMs() - timingStartMs);

  if (run.pp.arachneBackend === 'wasm') {
    timingStartMs = nowMs();
    try {
      await loadArachneModule();
    } catch (err) {
      console.warn('Arachne WASM backend unavailable; falling back to JS/classic Arachne paths.', err);
    } finally {
      addTiming('arachne-warmup', nowMs() - timingStartMs);
    }
  }
  let layerPrepPool: LayerPrepPool | null = null;
  let layerPrepWorkerCount = 0;
  let layerPrepPoolStartMs = 0;

  if (shouldUseLayerWorkerPool(run)) {
    layerPrepWorkerCount = chooseLayerPrepWorkerCount(run);
    layerPrepPoolStartMs = nowMs();
    layerPrepPool = startLayerPrepWorkerPool(pipeline, run);
    void layerPrepPool.done.catch(() => {});
  }

  const progressStride = layerProgressReportStride(run.totalLayers);
  let previousLayerMs = Infinity;

  for (let li = 0; li < run.totalLayers; li++) {
    // Per-layer cancellation responsiveness:
    //
    // The wall and infill emit steps below are synchronous and can each
    // take hundreds of milliseconds (libArachne WASM, scanline gen, etc.).
    // While JS executes one of those long sync calls, the worker's
    // `onmessage` handler is BLOCKED, so a `cancel` message sent by the
    // UI sits in the message queue and `slicer.cancelled` stays `false`
    // until the layer finishes. With dozens of layers each taking
    // 100-500 ms, that adds up to multi-second cancel latency — which
    // reads as "cancel doesn't work" to the user.
    //
    // We yield to the macrotask queue (setTimeout 0) at the TOP of every
    // layer iteration so any pending `cancel` message is delivered
    // before we start the next layer's heavy synchronous work. Yields
    // cost ~1 ms per layer; in exchange, cancel reliably takes effect
    // within one layer of the user's click.
    if (shouldYieldBeforeLayer(li, previousLayerMs)) await slicer.yieldToUI();
    if (slicer.cancelled) throw new Error('Slicing cancelled by user.');
    const layerStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (li === 0 || li === run.totalLayers - 1 || li % progressStride === 0) {
      slicer.reportProgress('slicing', (li / run.totalLayers) * 80, li, run.totalLayers, `Emitting layer ${li + 1}/${run.totalLayers}...`);
    }
    setArachneStatsLayer(li);
    let layer: SliceLayerState | null;
    if (layerPrepPool) {
      timingStartMs = nowMs();
      let geometryState: SliceLayerGeometryState | null;
      try {
        geometryState = await layerPrepPool.getLayer(li);
      } catch (err) {
        addTiming('worker-layer-prep', nowMs() - layerPrepPoolStartMs);
        layerPrepPool.stop();
        layerPrepPool = null;
        layerPrepWorkerCount = 0;
        if (slicer.cancelled) throw err;
        console.warn('Falling back to sequential layer preparation after streaming worker-pool failure', err);
        timingStartMs = nowMs();
        layer = await prepareLayerState(pipeline, run, li, {
          reportProgress: false,
          yieldToUI: false,
        });
        addTiming('prepare-layer', nowMs() - timingStartMs);
        if (!layer) continue;
        // Continue with this sequentially prepared layer.
        if (slicer.cancelled) throw new Error('Slicing cancelled by user.');
        timingStartMs = nowMs();
        const contourData = emitGroupedAndContourWalls(pipeline, run, layer);
        addTiming('walls', nowMs() - timingStartMs);
        if (slicer.cancelled) throw new Error('Slicing cancelled by user.');
        timingStartMs = nowMs();
        emitContourInfill(pipeline, run, layer, contourData);
        addTiming('infill', nowMs() - timingStartMs);
        if (slicer.cancelled) throw new Error('Slicing cancelled by user.');
        timingStartMs = nowMs();
        finalizeLayer(pipeline, run, layer);
        addTiming('finalize', nowMs() - timingStartMs);
        previousLayerMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - layerStartMs;
        continue;
      }
      if (!geometryState) continue;
      layer = emitLayerStartState(pipeline, run, geometryState);
      addTiming('emit-layer-start', nowMs() - timingStartMs);
    } else {
      timingStartMs = nowMs();
      layer = await prepareLayerState(pipeline, run, li, {
        reportProgress: false,
        yieldToUI: false,
      });
      addTiming('prepare-layer', nowMs() - timingStartMs);
    }
    if (!layer) continue;
    // Yield + recheck before each major synchronous emit step so the
    // cancel message can land mid-layer too (a single very thick layer
    // with hundreds of walls could otherwise still tie up the worker
    // for a second or more).
    if (slicer.cancelled) throw new Error('Slicing cancelled by user.');
    timingStartMs = nowMs();
    const contourData = emitGroupedAndContourWalls(pipeline, run, layer);
    addTiming('walls', nowMs() - timingStartMs);
    if (slicer.cancelled) throw new Error('Slicing cancelled by user.');
    timingStartMs = nowMs();
    emitContourInfill(pipeline, run, layer, contourData);
    addTiming('infill', nowMs() - timingStartMs);
    if (slicer.cancelled) throw new Error('Slicing cancelled by user.');
    timingStartMs = nowMs();
    finalizeLayer(pipeline, run, layer);
    addTiming('finalize', nowMs() - timingStartMs);
    previousLayerMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - layerStartMs;
  }

  if (layerPrepPool) {
    await layerPrepPool.done.catch((err) => {
      if (slicer.cancelled) throw err;
      console.warn('Layer worker pool completed with an error after slice emission finished', err);
    });
    addTiming('worker-layer-prep', nowMs() - layerPrepPoolStartMs);
  }

  slicer.reportProgress('generating', 95, run.totalLayers, run.totalLayers, 'Writing end G-code...');
  timingStartMs = nowMs();
  appendEndGCode(run.gcode, run.printer, run.mat);
  const stats = finalizeGCodeStats(
    run.gcode,
    run.totalTime,
    run.emitter.totalExtruded,
    run.printer,
    run.mat,
  );
  addTiming('footer', nowMs() - timingStartMs);
  slicer.reportProgress('complete', 100, run.totalLayers, run.totalLayers, 'Slicing complete.');

  timingStartMs = nowMs();
  const gcode = applyPostProcessingScripts(run.gcode.join('\n'), run.pp);
  addTiming('postprocess', nowMs() - timingStartMs);

  return {
    gcode,
    layerCount: run.totalLayers,
    printTime: stats.estimatedTime,
    filamentUsed: run.emitter.totalExtruded,
    filamentWeight: stats.filamentWeight,
    filamentCost: stats.filamentCost,
    layers: run.sliceLayers,
    slicingPerformance: {
      totalMs: nowMs() - totalStartMs,
      layerPrepMode: layerPrepWorkerCount > 0 ? 'parallel' : 'sequential',
      workerCount: layerPrepWorkerCount,
      triangleCount: run.triangles.length,
      layerCount: run.totalLayers,
      buckets: [...timings.entries()]
        .map(([key, value]) => ({
          key,
          label: TIMING_LABELS[key] ?? key,
          ms: value.ms,
          count: value.count,
        }))
        .filter((bucket) => bucket.ms >= 0.05)
        .sort((a, b) => b.ms - a.ms),
    },
  };
}
