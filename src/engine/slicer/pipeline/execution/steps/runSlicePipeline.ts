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
  SliceLayerGeometryState,
  SliceLayerState,
  SliceRun,
} from './types';

interface RawWorkerGeometry {
  positions: Float32Array;
  index: Uint32Array | null;
  transformElements: Float32Array;
}

type SerializedLayerGeometry = Omit<SliceLayerGeometryState, 'contours'> & {
  contours: Array<{
    area: number;
    isOuter: boolean;
    points: Array<[number, number]>;
  }>;
};

type LayerWorkerMessage =
  | { type: 'complete'; requestId: number; layers: Array<{ layerIndex: number; layer: SerializedLayerGeometry | null }> }
  | { type: 'cancelled'; requestId: number }
  | { type: 'error'; requestId: number; message: string };

const MIN_LAYER_WORKER_POOL_LAYERS = 48;
const MAX_LAYER_PREP_WORKERS = 6;
const SMALL_MESH_LAYER_PREP_TRIANGLES = 20_000;
const MEDIUM_MESH_LAYER_PREP_TRIANGLES = 40_000;
const LARGE_MESH_LAYER_PREP_TRIANGLES = 80_000;

function hardwareConcurrency(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  return Math.max(1, Math.floor(cores || 1));
}

function createLayerWorker(): Worker {
  return new Worker(new URL('../../../../../workers/SlicerLayerWorker.ts', import.meta.url), { type: 'module' });
}

function cloneWorkerGeometryData(geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[]): RawWorkerGeometry[] {
  return geometries.map(({ geometry, transform }) => {
    const posAttr = geometry.getAttribute('position');
    const positions = posAttr.array instanceof Float32Array
      ? posAttr.array.slice()
      : new Float32Array(posAttr.array as ArrayLike<number>);
    const indexAttr = geometry.getIndex();
    const index = indexAttr
      ? new Uint32Array(indexAttr.array as ArrayLike<number>)
      : null;
    return {
      positions,
      index,
      transformElements: new Float32Array(transform.elements),
    };
  });
}

function transferList(data: RawWorkerGeometry[]): Transferable[] {
  const list: Transferable[] = [];
  for (const raw of data) {
    list.push(raw.positions.buffer);
    list.push(raw.transformElements.buffer);
    if (raw.index) list.push(raw.index.buffer);
  }
  return list;
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

  const triangleCount = run.triangles.length;
  if (triangleCount >= LARGE_MESH_LAYER_PREP_TRIANGLES) return 0;
  if (triangleCount >= MEDIUM_MESH_LAYER_PREP_TRIANGLES) return Math.min(2, availableCores, run.totalLayers);
  if (triangleCount >= SMALL_MESH_LAYER_PREP_TRIANGLES) return Math.min(3, availableCores, run.totalLayers);
  return Math.min(availableCores, run.totalLayers, MAX_LAYER_PREP_WORKERS);
}

function shouldUseLayerWorkerPool(run: SliceRun): boolean {
  return chooseLayerPrepWorkerCount(run) > 1;
}

async function prepareLayersInWorkerPool(
  pipeline: unknown,
  run: SliceRun,
  geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
): Promise<Array<SliceLayerGeometryState | null>> {
  const slicer = pipeline as SlicerExecutionPipeline;
  const workerCount = chooseLayerPrepWorkerCount(run);
  const layerBatches = Array.from({ length: workerCount }, () => [] as number[]);
  for (let li = 0; li < run.totalLayers; li++) layerBatches[li % workerCount].push(li);

  const requestId = Math.floor(Math.random() * 1_000_000_000);
  const workers: Worker[] = [];
  const rejectors: Array<(error: Error) => void> = [];
  const results = new Array<SliceLayerGeometryState | null>(run.totalLayers).fill(null);

  const runWorker = (layerIndices: number[]): Promise<void> => new Promise((resolve, reject) => {
    const worker = createLayerWorker();
    const rejectOnce = (error: Error) => reject(error);
    workers.push(worker);
    rejectors.push(rejectOnce);

    worker.onmessage = (event: MessageEvent<LayerWorkerMessage>) => {
      const msg = event.data;
      if (msg.requestId !== requestId) return;
      if (msg.type === 'complete') {
        for (const item of msg.layers) {
          results[item.layerIndex] = hydrateLayerGeometry(item.layer);
        }
        worker.terminate();
        resolve();
      } else if (msg.type === 'cancelled') {
        worker.terminate();
        reject(new Error('Slicing cancelled'));
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Layer worker failed'));
    };

    const geometryData = cloneWorkerGeometryData(geometries);
    worker.postMessage({
      type: 'prepare-layers',
      requestId,
      payload: {
        geometryData,
        printerProfile: run.printer,
        materialProfile: run.mat,
        printProfile: run.pp,
        layerIndices,
      },
    }, transferList(geometryData));
  });

  const cancelTimer = setInterval(() => {
    if (!slicer.cancelled) return;
    for (const worker of workers) {
      worker.postMessage({ type: 'cancel', requestId });
      worker.terminate();
    }
    for (const reject of rejectors) reject(new Error('Slicing cancelled'));
  }, 50);

  try {
    slicer.reportProgress('slicing', 0, 0, run.totalLayers, `Preparing ${run.totalLayers} layers on ${workerCount} workers...`);
    await Promise.all(layerBatches.filter((batch) => batch.length > 0).map(runWorker));
    return results;
  } finally {
    clearInterval(cancelTimer);
    for (const worker of workers) worker.terminate();
  }
}

export async function runSlicePipeline(
  pipeline: unknown,
  geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
): Promise<SliceResult> {
  const slicer = pipeline as SlicerExecutionPipeline & {
    prepareClipper2Offsets?: () => Promise<void>;
  };
  if (slicer.printProfile?.nonPlanarSlicingEnabled) {
    throw new Error('Non-planar slicing is not supported by the current planar G-code pipeline.');
  }
  const run = prepareSliceRun(pipeline, geometries);
  await slicer.prepareClipper2Offsets?.();
  if (run.pp.arachneBackend === 'wasm') {
    try {
      await loadArachneModule();
    } catch (err) {
      console.warn('Arachne WASM backend unavailable; falling back to JS/classic Arachne paths.', err);
    }
  }
  let preparedLayers: Array<SliceLayerGeometryState | null> | null = null;

  if (shouldUseLayerWorkerPool(run)) {
    try {
      preparedLayers = await prepareLayersInWorkerPool(pipeline, run, geometries);
    } catch (err) {
      if (slicer.cancelled) throw err;
      console.warn('Falling back to sequential layer preparation after worker-pool failure', err);
      preparedLayers = null;
    }
  }

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
    await slicer.yieldToUI();
    if (slicer.cancelled) throw new Error('Slicing cancelled by user.');
    slicer.reportProgress('slicing', (li / run.totalLayers) * 80, li, run.totalLayers, `Emitting layer ${li + 1}/${run.totalLayers}...`);
    setArachneStatsLayer(li);
    let layer: SliceLayerState | null;
    if (preparedLayers) {
      const geometryState = preparedLayers[li];
      if (!geometryState) continue;
      layer = emitLayerStartState(pipeline, run, geometryState);
    } else {
      layer = await prepareLayerState(pipeline, run, li);
    }
    if (!layer) continue;
    // Yield + recheck before each major synchronous emit step so the
    // cancel message can land mid-layer too (a single very thick layer
    // with hundreds of walls could otherwise still tie up the worker
    // for a second or more).
    if (slicer.cancelled) throw new Error('Slicing cancelled by user.');
    const contourData = emitGroupedAndContourWalls(pipeline, run, layer);
    if (slicer.cancelled) throw new Error('Slicing cancelled by user.');
    emitContourInfill(pipeline, run, layer, contourData);
    if (slicer.cancelled) throw new Error('Slicing cancelled by user.');
    finalizeLayer(pipeline, run, layer);
  }

  slicer.reportProgress('generating', 95, run.totalLayers, run.totalLayers, 'Writing end G-code...');
  appendEndGCode(run.gcode, run.printer, run.mat);
  const stats = finalizeGCodeStats(
    run.gcode,
    run.totalTime,
    run.emitter.totalExtruded,
    run.printer,
    run.mat,
  );
  slicer.reportProgress('complete', 100, run.totalLayers, run.totalLayers, 'Slicing complete.');

  const gcode = applyPostProcessingScripts(run.gcode.join('\n'), run.pp);

  return {
    gcode,
    layerCount: run.totalLayers,
    printTime: stats.estimatedTime,
    filamentUsed: run.emitter.totalExtruded,
    filamentWeight: stats.filamentWeight,
    filamentCost: stats.filamentCost,
    layers: run.sliceLayers,
  };
}
