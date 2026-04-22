/// <reference lib="webworker" />
// Runs the slicer off the main thread so the UI stays responsive.
// The main thread extracts geometry data as plain typed arrays, transfers
// them here, and this worker reconstructs the geometries, runs the Slicer,
// and posts back progress and the final result.

import * as THREE from 'three';
import { Slicer } from '../engine/Slicer';
import type { SliceProgress, SliceResult } from '../types/slicer';

interface RawGeometry {
  positions: Float32Array;          // BufferAttribute position data
  index: Uint32Array | null;        // Optional index buffer
  transformElements: Float32Array;  // 16-element column-major Matrix4
  overrides?: Record<string, unknown>;
  objectName?: string;
}

interface SliceMessage {
  type: 'slice';
  requestId: number;
  payload: {
    geometryData: RawGeometry[];
    printerProfile: object;
    materialProfile: object;
    printProfile: object;
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

function mergeSliceResults(results: SliceResult[]): SliceResult {
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

  // Concatenate G-code with a banner between groups. We don't attempt
  // layer interleaving across groups — sequential prints execute one object
  // at a time, so concatenation matches physical behavior.
  const headers: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    headers.push(
      `; ============================================================`,
      `; Group ${i + 1} of ${results.length}`,
      `; ============================================================`,
    );
    merged.gcode += headers.join('\n') + '\n' + r.gcode + '\n';
    headers.length = 0;
    merged.printTime += r.printTime;
    merged.filamentUsed += r.filamentUsed;
    merged.filamentWeight += r.filamentWeight;
    merged.filamentCost += r.filamentCost;
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
  return merged;
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === 'cancel') {
    if (msg.requestId !== activeRequestId) return;
    cancelRequested = true;
    activeSlicer?.cancel();
    return;
  }

  if (msg.type === 'slice') {
    activeRequestId = msg.requestId;
    cancelRequested = false;
    const { requestId } = msg;
    const { geometryData, printerProfile, materialProfile, printProfile } = msg.payload;

    // Reconstruct THREE.js geometry objects from transferred typed arrays.
    // We reference the typed arrays directly instead of copying via Array.from
    // — the main thread transferred ownership so they're ours to use.
    const geometries = geometryData.map(({ positions, index, transformElements, overrides, objectName }) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1));
      const transform = new THREE.Matrix4();
      transform.fromArray(transformElements);
      return { geometry, transform, overrides, objectName };
    });

    // Partition geometries by their override signature. Each partition runs
    // its own slice pass so the profile overrides (infill, walls, supports,
    // etc.) genuinely apply to that subset of plate objects.
    const groups = new Map<string, typeof geometries>();
    for (const g of geometries) {
      const key = g.overrides ? JSON.stringify(g.overrides) : '__default__';
      const bucket = groups.get(key) ?? [];
      bucket.push(g);
      groups.set(key, bucket);
    }
    const groupList = [...groups.entries()];
    const multi = groupList.length > 1;

    // Token used to detect re-entry from a fresh slice starting while this
    // one is still completing — each message posted back checks it.
    const postProgressSafely = (progress: SliceProgress) => {
      if (cancelRequested || activeRequestId !== requestId) return;
      self.postMessage({ type: 'progress', requestId, progress });
    };

    try {
      const results: SliceResult[] = [];
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
        const result = await slicer.slice(geosForSlice);
        if (cancelRequested) throw new Error('Slicing cancelled');
        results.push(result);
      }

      if (cancelRequested) {
        if (activeRequestId === requestId) self.postMessage({ type: 'cancelled', requestId });
        for (const g of geometries) g.geometry.dispose();
        return;
      }
      const merged = mergeSliceResults(results);
      activeSlicer = null;
      if (activeRequestId === requestId) self.postMessage({ type: 'complete', requestId, result: merged });
      for (const g of geometries) g.geometry.dispose();
    } catch (err) {
      // Suppress errors from cancelled runs or from a stale worker state.
      if (cancelRequested || activeRequestId !== requestId) {
        if (cancelRequested && activeRequestId === requestId) self.postMessage({ type: 'cancelled', requestId });
        for (const g of geometries) g.geometry.dispose();
        return;
      }
      activeSlicer = null;
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'error', requestId, message });
      for (const g of geometries) g.geometry.dispose();
    }
  }
};
