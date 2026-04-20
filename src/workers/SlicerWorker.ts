/// <reference lib="webworker" />
// Runs the slicer off the main thread so the UI stays responsive.
// The main thread extracts geometry data as plain typed arrays, transfers
// them here, and this worker reconstructs the geometries, runs the Slicer,
// and posts back progress and the final result.

import * as THREE from 'three';
import { Slicer } from '../engine/Slicer';
import type { SliceProgress } from '../types/slicer';

interface RawGeometry {
  positions: Float32Array;          // BufferAttribute position data
  index: Uint32Array | null;        // Optional index buffer
  transformElements: Float32Array;  // 16-element column-major Matrix4
}

interface SliceMessage {
  type: 'slice';
  payload: {
    geometryData: RawGeometry[];
    printerProfile: object;
    materialProfile: object;
    printProfile: object;
  };
}

interface CancelMessage {
  type: 'cancel';
}

type WorkerMessage = SliceMessage | CancelMessage;

let activeSlicer: Slicer | null = null;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === 'cancel') {
    activeSlicer?.cancel();
    return;
  }

  if (msg.type === 'slice') {
    const { geometryData, printerProfile, materialProfile, printProfile } = msg.payload;

    // Reconstruct THREE.js geometry objects from transferred typed arrays.
    // We reference the typed arrays directly instead of copying via Array.from
    // — the main thread transferred ownership so they're ours to use.
    const geometries = geometryData.map(({ positions, index, transformElements }) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1));
      const transform = new THREE.Matrix4();
      transform.fromArray(transformElements);
      return { geometry, transform };
    });

    const slicer = new Slicer(
      printerProfile as never,
      materialProfile as never,
      printProfile as never,
    );
    activeSlicer = slicer;

    slicer.setProgressCallback((progress: SliceProgress) => {
      // Only forward progress for the slicer that's still current — prevents
      // a cancelled run from trickling stale progress into the UI after a
      // new slice has started.
      if (activeSlicer === slicer) {
        self.postMessage({ type: 'progress', progress });
      }
    });

    try {
      const result = await slicer.slice(geometries);
      // Cancellation race: if cancel arrived between completion and now, or
      // a fresh slice replaced us, suppress the completion message so the
      // store doesn't accept stale results.
      if (activeSlicer !== slicer) {
        // Dispose geometries we constructed to avoid a GPU/memory leak.
        for (const g of geometries) g.geometry.dispose();
        return;
      }
      activeSlicer = null;
      self.postMessage({ type: 'complete', result });
      // Slicer has consumed the geometries already, but dispose any buffers
      // that happen to still be bound.
      for (const g of geometries) g.geometry.dispose();
    } catch (err) {
      // If a newer slice already took over, swallow the error — it belongs
      // to the cancelled run.
      if (activeSlicer !== slicer) {
        for (const g of geometries) g.geometry.dispose();
        return;
      }
      activeSlicer = null;
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'error', message });
      for (const g of geometries) g.geometry.dispose();
    }
  }
};
