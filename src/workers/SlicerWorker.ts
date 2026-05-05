/// <reference lib="webworker" />
// Runs the slicer off the main thread so the UI stays responsive.
// The main thread extracts geometry data as plain typed arrays, transfers
// them here, and this worker reconstructs the geometries, runs the Slicer,
// and posts back progress and the final result.

import * as THREE from 'three';
import { Slicer } from '../engine/slicer/Slicer';
import { loadClipper2Module } from '../engine/slicer/geometry/clipper2Wasm';
import { loadArachneModule } from '../engine/slicer/pipeline/arachne/arachneWasm';
import type { SliceProgress, SliceResult } from '../types/slicer';
import {
  buildSequentialPrintPlan,
  formatSequentialPrintWarnings,
  type SequentialPrintBounds,
  type SequentialPrintClearance,
  type SequentialPrintObject,
  type SequentialPrintWarning,
} from '../utils/sequentialPrint';
import { freshWorkerUrl } from './freshWorkerUrl';

// Warm up WASM modules as soon as this worker starts so by the time
// the first layer's perimeter/infill ops fire, both the Clipper2 sync
// fast path and the Arachne backend are ready. Fire-and-forget — each
// adapter's load is memoised, so the await inside the actual call
// chain becomes a no-op once warm-up resolves. Pre-warming saves
// ~30-50ms per module across the first few layers.
void loadClipper2Module().catch(() => { /* fallback path stays available */ });
void loadArachneModule().catch(() => { /* arachne dispatcher falls back to classic walls */ });

interface RawGeometry {
  positions: Float32Array;          // BufferAttribute position data
  index: Uint32Array | null;        // Optional index buffer
  transformElements: Float32Array;  // 16-element column-major Matrix4
  overrides?: Record<string, unknown>;
  objectName?: string;
  // Modifier-mesh role + settings. Default `'normal'` (= a regular
  // printable). Modifier meshes are partitioned out before grouping so
  // they don't form their own profile-override group; they ride
  // alongside the printables they modify.
  modifierMeshRole?: 'normal' | 'infill_mesh' | 'cutting_mesh' | 'support_mesh' | 'anti_overhang_mesh';
  modifierMeshSettings?: Record<string, unknown>;
}

interface SliceMessage {
  type: 'slice';
  requestId: number;
  payload: {
    geometryData: RawGeometry[];
    printerProfile: object;
    materialProfile: object;
    printProfile: object;
    disableGroupPool?: boolean;
  };
}

interface CancelMessage {
  type: 'cancel';
  requestId: number;
}

type WorkerMessage = SliceMessage | CancelMessage;

let activeSlicer: Slicer | null = null;
let cancelRequested = false;
let activeRequestId = 0;
let activeChildWorkers: Worker[] = [];
let activeChildRejectors: Array<(error: Error) => void> = [];

type ReconstructedGeometry = {
  raw: RawGeometry;
  geometry: THREE.BufferGeometry;
  transform: THREE.Matrix4;
  overrides?: Record<string, unknown>;
  objectName?: string;
  modifierMeshRole?: RawGeometry['modifierMeshRole'];
  modifierMeshSettings?: RawGeometry['modifierMeshSettings'];
};

type ChildWorkerMessage =
  | { type: 'progress'; requestId: number; progress: SliceProgress }
  | { type: 'complete'; requestId: number; result: SliceResult }
  | { type: 'cancelled'; requestId: number }
  | { type: 'error'; requestId: number; message: string };

type SliceResultWithTool = SliceResult & {
  extruderIndex?: number;
  primeTower?: PrimeTowerSettings;
  /** Plate-object names belonging to this slice group, used to emit M486 labels. */
  objectNames?: string[];
};

interface PrimeTowerSettings {
  enabled: boolean;
  x: number;
  y: number;
  size: number;
  minVolume: number;
  wipe: boolean;
}

function primeTowerSettingsFromProfile(profile: Record<string, unknown>): PrimeTowerSettings | undefined {
  if (profile.primeTowerEnable !== true) return undefined;
  return {
    enabled: true,
    x: typeof profile.primeTowerPositionX === 'number' ? profile.primeTowerPositionX : 200,
    y: typeof profile.primeTowerPositionY === 'number' ? profile.primeTowerPositionY : 200,
    size: typeof profile.primeTowerSize === 'number' ? profile.primeTowerSize : 20,
    minVolume: typeof profile.primeTowerMinVolume === 'number' ? profile.primeTowerMinVolume : 6,
    wipe: profile.primeTowerWipeEnable !== false,
  };
}

function toolChangeLines(result: SliceResultWithTool, previousTool: number | undefined): string[] {
  const tool = result.extruderIndex;
  if (tool === undefined || tool < 0 || tool === previousTool) return [];
  if (previousTool === undefined && tool === 0) return [];
  return [`T${tool} ; Select tool for sliced group`];
}

function primeTowerLines(
  previousTool: number | undefined,
  nextTool: number | undefined,
  settings: PrimeTowerSettings | undefined,
): string[] {
  if (!settings?.enabled || previousTool === undefined || nextTool === undefined || previousTool === nextTool) return [];
  const size = Math.max(5, settings.size);
  const half = size / 2;
  const x0 = settings.x - half;
  const y0 = settings.y - half;
  const x1 = settings.x + half;
  const y1 = settings.y + half;
  const purge = Math.max(0, settings.minVolume);
  const edgePurge = purge / 4;
  const feed = 900;
  return [
    '; Prime tower purge',
    'M83 ; Relative extrusion for prime tower',
    `G0 X${x0.toFixed(3)} Y${y0.toFixed(3)} F9000`,
    `G1 X${x1.toFixed(3)} Y${y0.toFixed(3)} E${edgePurge.toFixed(5)} F${feed}`,
    `G1 X${x1.toFixed(3)} Y${y1.toFixed(3)} E${edgePurge.toFixed(5)} F${feed}`,
    `G1 X${x0.toFixed(3)} Y${y1.toFixed(3)} E${edgePurge.toFixed(5)} F${feed}`,
    `G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} E${edgePurge.toFixed(5)} F${feed}`,
    ...(settings.wipe ? [`G0 X${settings.x.toFixed(3)} Y${settings.y.toFixed(3)} F9000 ; Prime tower wipe`] : []),
    'M82 ; Restore absolute extrusion',
  ];
}

function mergeSliceResults(
  results: SliceResultWithTool[],
  sequentialWarnings: SequentialPrintWarning[] = [],
): SliceResult {
  if (results.length === 1) return results[0];
  const merged: SliceResult = {
    gcode: '',
    layerCount: 0,
    printTime: 0,
    filamentUsed: 0,
    filamentWeight: 0,
    filamentCost: 0,
    layers: [],
  };
  const timingBuckets = new Map<string, { label: string; ms: number; count: number }>();
  let timingTotalMs = 0;
  let timingWorkerCount = 0;
  let timingTriangleCount = 0;

  // Concatenate G-code with a banner between groups. We don't attempt
  // layer interleaving across groups — sequential prints execute one object
  // at a time, so concatenation matches physical behavior.
  const warningBlock = formatSequentialPrintWarnings(sequentialWarnings);
  if (warningBlock) merged.gcode += `${warningBlock}\n`;
  const headers: string[] = [];
  let previousTool: number | undefined;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    headers.push(
      `; ============================================================`,
      `; Group ${i + 1} of ${results.length}`,
      `; ============================================================`,
    );
    const toolLines = toolChangeLines(r, previousTool);
    const towerLines = primeTowerLines(previousTool, r.extruderIndex, r.primeTower);
    merged.gcode += headers.join('\n')
      + '\n'
      + (toolLines.length ? `${toolLines.join('\n')}\n` : '')
      + (towerLines.length ? `${towerLines.join('\n')}\n` : '')
      + r.gcode
      + '\n';
    headers.length = 0;
    if (r.extruderIndex !== undefined) previousTool = r.extruderIndex;
    merged.printTime += r.printTime;
    merged.filamentUsed += r.filamentUsed;
    merged.filamentWeight += r.filamentWeight;
    merged.filamentCost += r.filamentCost;
    if (r.slicingPerformance) {
      timingTotalMs += r.slicingPerformance.totalMs;
      timingWorkerCount += r.slicingPerformance.workerCount;
      timingTriangleCount += r.slicingPerformance.triangleCount;
      for (const bucket of r.slicingPerformance.buckets) {
        const current = timingBuckets.get(bucket.key);
        if (current) {
          current.ms += bucket.ms;
          current.count += bucket.count;
        } else {
          timingBuckets.set(bucket.key, {
            label: bucket.label,
            ms: bucket.ms,
            count: bucket.count,
          });
        }
      }
    }
  }

  // Preview: merge layer arrays by Z so the layer slider still works
  // sanely. Two groups at the same Z are surfaced as a single visual layer.
  type Bucket = { z: number; moves: SliceResult['layers'][number]['moves']; layerTime: number };
  const buckets = new Map<string, Bucket>();
  for (const r of results) {
    for (const layer of r.layers) {
      const key = layer.z.toFixed(3);
      const b = buckets.get(key);
      if (b) {
        b.moves.push(...layer.moves);
        b.layerTime += layer.layerTime;
      } else {
        buckets.set(key, { z: layer.z, moves: [...layer.moves], layerTime: layer.layerTime });
      }
    }
  }
  const sorted = [...buckets.values()].sort((a, b) => a.z - b.z);
  merged.layers = sorted.map((b, i) => ({
    z: b.z, layerIndex: i, moves: b.moves, layerTime: b.layerTime,
  }));
  merged.layerCount = merged.layers.length;
  if (timingBuckets.size > 0) {
    merged.slicingPerformance = {
      totalMs: timingTotalMs,
      layerPrepMode: 'merged',
      workerCount: timingWorkerCount,
      triangleCount: timingTriangleCount,
      layerCount: merged.layerCount,
      buckets: [...timingBuckets.entries()]
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => b.ms - a.ms),
    };
  }
  return merged;
}

/**
 * Strip characters that would break an M486 A"<name>" line: double quotes
 * (which terminate the field), CR/LF (which split the M486 onto its own
 * line), and collapse whitespace runs. Empty input returns empty so the
 * caller can fall back to a generic label.
 */
function sanitizeM486Label(name: string): string {
  return name.replace(/["\r\n]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Wrap each group's G-code with M486 object-label markers so firmware that
 * supports object cancellation (Klipper, Marlin 2.0.9+, RRF 3.5+) can
 * cancel individual objects mid-print.
 *
 * Slice groups are now per-object (see grouping in self.onmessage), so
 * each result corresponds to a single plate object. Format emitted:
 *   M486 T<objectCount>
 *   M486 S0 A"<object 0 name>"
 *   ... object 0 gcode ...
 *   M486 S-1
 *   M486 S1 A"<object 1 name>"
 *   ... object 1 gcode ...
 *   M486 S-1
 *
 * Only emitted when at least one group carries a non-empty objectName —
 * un-named plates pass through unchanged so we don't generate spurious
 * M486 lines.
 */
function injectM486Labels(results: SliceResultWithTool[]): SliceResultWithTool[] {
  const hasNames = results.some((r) => r.objectNames && r.objectNames.length > 0);
  if (!hasNames) return results;

  const labeled = results.map((r, i) => {
    const rawLabel = r.objectNames && r.objectNames.length > 0
      ? r.objectNames.join(' / ')
      : `Object ${i}`;
    const label = sanitizeM486Label(rawLabel) || `Object ${i}`;
    return {
      ...r,
      gcode: `M486 S${i} A"${label}"\n${r.gcode}\nM486 S-1`,
    };
  });

  // M486 T<n> must appear before any S<id> marker — prepend it to the
  // first group so it lands at the very start of the merged output.
  labeled[0] = { ...labeled[0], gcode: `M486 T${results.length}\n${labeled[0].gcode}` };

  return labeled;
}

function getHardwareConcurrency(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  return Math.max(1, Math.floor(cores || 1));
}

function getTransferList(geometryData: RawGeometry[]): Transferable[] {
  const transferables: Transferable[] = [];
  for (const raw of geometryData) {
    transferables.push(raw.positions.buffer);
    transferables.push(raw.transformElements.buffer);
    if (raw.index) transferables.push(raw.index.buffer);
  }
  return transferables;
}

function createSliceWorker(): Worker {
  return new Worker(
    freshWorkerUrl(new URL('./SlicerWorker.ts', import.meta.url)),
    { type: 'module' },
  );
}

function disposeGeometries(geometries: ReconstructedGeometry[]): void {
  for (const g of geometries) g.geometry.dispose();
}

function getGeometryBounds(geometry: THREE.BufferGeometry, transform: THREE.Matrix4): SequentialPrintBounds | null {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingBox) return null;
  const box = geometry.boundingBox.clone().applyMatrix4(transform);
  return {
    minX: box.min.x,
    maxX: box.max.x,
    minY: box.min.y,
    maxY: box.max.y,
    minZ: box.min.z,
    maxZ: box.max.z,
  };
}

function buildSequentialPrintObject(
  groupKey: string,
  geos: ReconstructedGeometry[],
  index: number,
): SequentialPrintObject | null {
  const boxes = geos
    .map((geo) => getGeometryBounds(geo.geometry, geo.transform))
    .filter((bounds): bounds is SequentialPrintBounds => bounds !== null);
  if (boxes.length === 0) return null;
  const label = geos.map((geo) => geo.objectName ?? '').filter(Boolean).join(' / ') || `Object ${index + 1}`;
  return {
    id: groupKey,
    label,
    bounds: {
      minX: Math.min(...boxes.map((box) => box.minX)),
      maxX: Math.max(...boxes.map((box) => box.maxX)),
      minY: Math.min(...boxes.map((box) => box.minY)),
      maxY: Math.max(...boxes.map((box) => box.maxY)),
      minZ: Math.min(...boxes.map((box) => box.minZ)),
      maxZ: Math.max(...boxes.map((box) => box.maxZ)),
    },
  };
}

function getSequentialClearance(printerProfile: object): SequentialPrintClearance {
  const profile = printerProfile as Record<string, unknown>;
  return {
    gantryHeight: typeof profile.gantryHeight === 'number' ? profile.gantryHeight : undefined,
    printheadMinX: typeof profile.printheadMinX === 'number' ? profile.printheadMinX : undefined,
    printheadMaxX: typeof profile.printheadMaxX === 'number' ? profile.printheadMaxX : undefined,
    printheadMinY: typeof profile.printheadMinY === 'number' ? profile.printheadMinY : undefined,
    printheadMaxY: typeof profile.printheadMaxY === 'number' ? profile.printheadMaxY : undefined,
  };
}

function planSequentialGroupOrder(
  groupList: Array<[string, ReconstructedGeometry[]]>,
  printerProfile: object,
): { groups: Array<[string, ReconstructedGeometry[]]>; warnings: SequentialPrintWarning[] } {
  const sequentialObjects = groupList
    .map(([key, geos], index) => buildSequentialPrintObject(key, geos, index))
    .filter((object): object is SequentialPrintObject => object !== null);
  if (sequentialObjects.length !== groupList.length) {
    return { groups: groupList, warnings: [] };
  }

  const plan = buildSequentialPrintPlan(sequentialObjects, getSequentialClearance(printerProfile));
  const groupsByKey = new Map(groupList);
  const orderedGroups = plan.orderedIds
    .map((id) => groupsByKey.get(id))
    .filter((geos): geos is ReconstructedGeometry[] => geos !== undefined)
    .map((geos, index): [string, ReconstructedGeometry[]] => [plan.orderedIds[index], geos]);

  return {
    groups: orderedGroups.length === groupList.length ? orderedGroups : groupList,
    warnings: plan.warnings,
  };
}

async function runSliceGroupInChildWorker(
  requestId: number,
  groupIndex: number,
  groupCount: number,
  geometryData: RawGeometry[],
  printerProfile: object,
  materialProfile: object,
  printProfile: object,
  postProgressSafely: (progress: SliceProgress) => void,
): Promise<SliceResultWithTool> {
  const worker = createSliceWorker();
  const transferableGeometryData = geometryData.map((raw) => ({
    ...raw,
    positions: raw.positions.slice(),
    index: raw.index ? raw.index.slice() : null,
    transformElements: raw.transformElements.slice(),
  }));

  return new Promise<SliceResultWithTool>((resolve, reject) => {
    let settled = false;
    const rejectOnCancel = () => reject(new Error('Slicing cancelled'));
    activeChildWorkers.push(worker);
    activeChildRejectors.push(rejectOnCancel);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      activeChildWorkers = activeChildWorkers.filter((w) => w !== worker);
      activeChildRejectors = activeChildRejectors.filter((r) => r !== rejectOnCancel);
      fn();
    };

    worker.onmessage = (event: MessageEvent<ChildWorkerMessage>) => {
      const msg = event.data;
      if (msg.requestId !== requestId) return;
      if (msg.type === 'progress') {
        const span = 100 / groupCount;
        const base = groupIndex * span;
        postProgressSafely({
          ...msg.progress,
          percent: Math.round(base + (msg.progress.percent * span) / 100),
          message: `Group ${groupIndex + 1}/${groupCount} · ${msg.progress.message}`,
        });
      } else if (msg.type === 'complete') {
        finish(() => resolve(msg.result));
      } else if (msg.type === 'cancelled') {
        finish(() => reject(new Error('Slicing cancelled')));
      } else if (msg.type === 'error') {
        finish(() => reject(new Error(msg.message)));
      }
    };

    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || 'Slice worker failed')));
    };

    worker.postMessage({
      type: 'slice',
      requestId,
      payload: {
        geometryData: transferableGeometryData,
        printerProfile,
        materialProfile,
        printProfile,
        disableGroupPool: true,
      },
    } satisfies SliceMessage, getTransferList(transferableGeometryData));
  });
}

async function runSliceGroupsInWorkerPool(
  requestId: number,
  groupList: Array<[string, ReconstructedGeometry[]]>,
  modifiers: ReconstructedGeometry[],
  printerProfile: object,
  materialProfile: object,
  printProfile: object,
  postProgressSafely: (progress: SliceProgress) => void,
): Promise<SliceResultWithTool[]> {
  const results = new Array<SliceResultWithTool>(groupList.length);
  let nextIndex = 0;
  const workerCount = Math.min(groupList.length, getHardwareConcurrency());

  async function runNext(): Promise<void> {
    const index = nextIndex++;
    if (index >= groupList.length) return;
    if (cancelRequested) throw new Error('Slicing cancelled');

    const [, geos] = groupList[index];
    const effectivePrintProfile = { ...printProfile } as Record<string, unknown>;
    const overrides = geos[0].overrides;
    if (overrides) Object.assign(effectivePrintProfile, overrides);

    // Modifier meshes ride alongside every printable group — each
    // child worker reconstitutes them from the RawGeometry stream
    // and partitions on `modifierMeshRole` again. Order matters
    // (printables first so a child slice without modifiers still
    // works), but the partitioning is role-based rather than
    // position-based so the order is informational.
    const groupRaws = [...geos.map((g) => g.raw), ...modifiers.map((m) => m.raw)];

    results[index] = await runSliceGroupInChildWorker(
      requestId,
      index,
      groupList.length,
      groupRaws,
      printerProfile,
      materialProfile,
      effectivePrintProfile,
      postProgressSafely,
    );
    const extruderIndex = effectivePrintProfile.extruderIndex;
    if (typeof extruderIndex === 'number') results[index].extruderIndex = extruderIndex;
    results[index].primeTower = primeTowerSettingsFromProfile(effectivePrintProfile);
    const poolNames = geos.map((g) => g.objectName ?? '').filter(Boolean);
    if (poolNames.length) results[index].objectNames = poolNames;

    await runNext();
  }

  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  return results;
}

async function runSliceGroupsSequentially(
  groupList: Array<[string, ReconstructedGeometry[]]>,
  modifiers: ReconstructedGeometry[],
  printerProfile: object,
  materialProfile: object,
  printProfile: object,
  postProgressSafely: (progress: SliceProgress) => void,
): Promise<SliceResultWithTool[]> {
  const results: SliceResultWithTool[] = [];
  const multi = groupList.length > 1;

  for (let idx = 0; idx < groupList.length; idx++) {
    if (cancelRequested) throw new Error('Slicing cancelled');
    const [, geos] = groupList[idx];
    // Build the per-group effective print profile by layering overrides
    // onto the base. Per-object numeric and boolean settings are copied
    // straight onto the profile for this pass.
    const effectivePrintProfile = { ...printProfile } as Record<string, unknown>;
    const overrides = geos[0].overrides;
    if (overrides) Object.assign(effectivePrintProfile, overrides);

    const slicer = new Slicer(
      printerProfile as never,
      materialProfile as never,
      effectivePrintProfile as never,
    );
    activeSlicer = slicer;
    slicer.setProgressCallback((progress: SliceProgress) => {
      if (!multi) {
        postProgressSafely(progress);
        return;
      }
      // In multi-group mode, scale each group's progress into its slice
      // of the overall percent so the UI bar doesn't jump back.
      const span = 100 / groupList.length;
      const base = idx * span;
      postProgressSafely({
        ...progress,
        percent: Math.round(base + (progress.percent * span) / 100),
        message: groupList.length > 1
          ? `Group ${idx + 1}/${groupList.length} · ${progress.message}`
          : progress.message,
      });
    });

    const geosForSlice = geos.map(({ geometry, transform }) => ({ geometry, transform }));
    const modifierMeshesForSlice = modifiers.map((m) => ({
      geometry: m.geometry,
      transform: m.transform,
      role: m.modifierMeshRole as Exclude<RawGeometry['modifierMeshRole'], undefined>,
      settings: m.modifierMeshSettings as never,
    }));
    const result = await slicer.slice(geosForSlice, modifierMeshesForSlice) as SliceResultWithTool;
    const extruderIndex = effectivePrintProfile.extruderIndex;
    if (typeof extruderIndex === 'number') result.extruderIndex = extruderIndex;
    result.primeTower = primeTowerSettingsFromProfile(effectivePrintProfile);
    const seqNames = geos.map((g) => g.objectName ?? '').filter(Boolean);
    if (seqNames.length) result.objectNames = seqNames;
    if (cancelRequested) throw new Error('Slicing cancelled');
    results.push(result);
  }

  return results;
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === 'cancel') {
    if (msg.requestId !== activeRequestId) return;
    cancelRequested = true;
    activeSlicer?.cancel();
    for (const worker of activeChildWorkers) worker.terminate();
    for (const reject of activeChildRejectors) reject(new Error('Slicing cancelled'));
    activeChildWorkers = [];
    activeChildRejectors = [];
    return;
  }

  if (msg.type === 'slice') {
    activeRequestId = msg.requestId;
    cancelRequested = false;
    const { requestId } = msg;
    const { geometryData, printerProfile, materialProfile, printProfile, disableGroupPool } = msg.payload;

    // ARACHNE-9.4A.4: ensure Clipper2 WASM is fully instantiated before any
    // boolean op fires inside the slicer pipeline. The fire-and-forget
    // warm-up at module-init usually resolves first, but on a fresh worker
    // boot the slice request can race the loader. Awaiting here guarantees
    // every `booleanPathsClipper2Sync` / `booleanMultiPolygonClipper2Sync`
    // call below returns a real result rather than null — so the slicer
    // paths no longer need a polygon-clipping fallback chain.
    try {
      await loadClipper2Module();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const message: { type: 'error'; requestId: number; error: string } = {
        type: 'error', requestId, error: `Clipper2 WASM failed to load: ${error.message}`,
      };
      self.postMessage(message);
      return;
    }
    try { await loadArachneModule(); } catch { /* arachne is optional — backend dispatcher falls back */ }

    // Reconstruct THREE.js geometry objects from transferred typed arrays.
    // We reference the typed arrays directly instead of copying via Array.from
    // — the main thread transferred ownership so they're ours to use.
    const geometries: ReconstructedGeometry[] = geometryData.map((raw) => {
      const { positions, index, transformElements, overrides, objectName, modifierMeshRole, modifierMeshSettings } = raw;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1));
      const transform = new THREE.Matrix4();
      transform.fromArray(transformElements);
      return { raw, geometry, transform, overrides, objectName, modifierMeshRole, modifierMeshSettings };
    });

    // Split modifier meshes from printable meshes. Modifier meshes never
    // form their own group (they aren't printed); they ride alongside
    // every printable group so each group's slice pass sees the full
    // modifier set. This is how Cura/Orca handle support/cutting/infill
    // meshes whose volume crosses multiple printable objects.
    const printables: ReconstructedGeometry[] = [];
    const modifiers: ReconstructedGeometry[] = [];
    for (const g of geometries) {
      if (g.modifierMeshRole && g.modifierMeshRole !== 'normal') modifiers.push(g);
      else printables.push(g);
    }

    // Partition printable geometries into one slice group per plate object.
    // The override signature still scopes the per-pass print profile, so
    // objects with different overrides still get distinct profile passes —
    // we just no longer merge multiple objects that share an override
    // signature. That dedup was a performance optimisation, but it
    // collapsed every object with default settings into a single M486
    // cancellable unit, so cancelling P0 cancelled the whole plate.
    const groups = new Map<string, ReconstructedGeometry[]>();
    for (let i = 0; i < printables.length; i++) {
      const g = printables[i];
      const overrideKey = g.overrides ? JSON.stringify(g.overrides) : '__default__';
      groups.set(`${overrideKey}__${i}`, [g]);
    }
    if (groups.size === 0) {
      // No printables — nothing to slice. (A plate with only modifier
      // meshes is a user error; surface a clear message.)
      self.postMessage({
        type: 'error',
        requestId,
        message: 'No printable meshes on the plate — modifier meshes (cutting / infill / support / anti-overhang) need at least one normal mesh to modify.',
      });
      disposeGeometries(geometries);
      return;
    }
    const baseGroupList = [...groups.entries()];
    const wantsSequentialPrint = (printProfile as Record<string, unknown>).printSequence === 'one_at_a_time';
    const sequentialPlan = wantsSequentialPrint
      ? planSequentialGroupOrder(baseGroupList, printerProfile)
      : { groups: baseGroupList, warnings: [] };
    const groupList = sequentialPlan.groups;
    const multi = groupList.length > 1;
    const useGroupPool = !disableGroupPool && multi && getHardwareConcurrency() > 1;

    // Token used to detect re-entry from a fresh slice starting while this
    // one is still completing — each message posted back checks it.
    const postProgressSafely = (progress: SliceProgress) => {
      if (cancelRequested || activeRequestId !== requestId) return;
      self.postMessage({ type: 'progress', requestId, progress });
    };

    try {
      let results: SliceResult[];
      if (useGroupPool) {
        try {
          results = await runSliceGroupsInWorkerPool(
            requestId,
            groupList,
            modifiers,
            printerProfile,
            materialProfile,
            printProfile,
            postProgressSafely,
          );
        } catch (err) {
          if (cancelRequested) throw err;
          console.warn('Falling back to sequential slicing after worker-pool failure', err);
          results = await runSliceGroupsSequentially(
            groupList,
            modifiers,
            printerProfile,
            materialProfile,
            printProfile,
            postProgressSafely,
          );
        }
      } else {
      const resultsSequential: SliceResultWithTool[] = [];
      for (let idx = 0; idx < groupList.length; idx++) {
        if (cancelRequested) throw new Error('Slicing cancelled');
        const [, geos] = groupList[idx];
        // Build the per-group effective print profile by layering overrides
        // onto the base. Per-object numeric and boolean settings are copied
        // straight onto the profile for this pass.
        const effectivePrintProfile = { ...printProfile } as Record<string, unknown>;
        const overrides = geos[0].overrides;
        if (overrides) Object.assign(effectivePrintProfile, overrides);

        const slicer = new Slicer(
          printerProfile as never,
          materialProfile as never,
          effectivePrintProfile as never,
        );
        activeSlicer = slicer;
        slicer.setProgressCallback((progress: SliceProgress) => {
          if (!multi) {
            postProgressSafely(progress);
            return;
          }
          // In multi-group mode, scale each group's progress into its slice
          // of the overall percent so the UI bar doesn't jump back.
          const span = 100 / groupList.length;
          const base = idx * span;
          postProgressSafely({
            ...progress,
            percent: Math.round(base + (progress.percent * span) / 100),
            message: groupList.length > 1
              ? `Group ${idx + 1}/${groupList.length} · ${progress.message}`
              : progress.message,
          });
        });

        const geosForSlice = geos.map(({ geometry, transform }) => ({ geometry, transform }));
        const modifierMeshesForSlice = modifiers.map((m) => ({
          geometry: m.geometry,
          transform: m.transform,
          role: m.modifierMeshRole as Exclude<RawGeometry['modifierMeshRole'], undefined>,
          settings: m.modifierMeshSettings as never,
        }));
        const result = await slicer.slice(geosForSlice, modifierMeshesForSlice) as SliceResultWithTool;
        const extruderIndex = effectivePrintProfile.extruderIndex;
        if (typeof extruderIndex === 'number') result.extruderIndex = extruderIndex;
        result.primeTower = primeTowerSettingsFromProfile(effectivePrintProfile);
        const inlineNames = geos.map((g) => g.objectName ?? '').filter(Boolean);
        if (inlineNames.length) result.objectNames = inlineNames;
        if (cancelRequested) throw new Error('Slicing cancelled');
        resultsSequential.push(result);
      }
      results = resultsSequential;
      }

      if (cancelRequested) {
        if (activeRequestId === requestId) self.postMessage({ type: 'cancelled', requestId });
        disposeGeometries(geometries);
        return;
      }
      const merged = mergeSliceResults(injectM486Labels(results), sequentialPlan.warnings);
      activeSlicer = null;
      if (activeRequestId === requestId) self.postMessage({ type: 'complete', requestId, result: merged });
      disposeGeometries(geometries);
    } catch (err) {
      // Suppress errors from cancelled runs or from a stale worker state.
      if (cancelRequested || activeRequestId !== requestId) {
        if (cancelRequested && activeRequestId === requestId) self.postMessage({ type: 'cancelled', requestId });
        disposeGeometries(geometries);
        return;
      }
      activeSlicer = null;
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'error', requestId, message });
      disposeGeometries(geometries);
    }
  }
};
