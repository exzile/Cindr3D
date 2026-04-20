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
    const geometries = geometryData.map(({ positions, index, transformElements }) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1));
      const transform = new THREE.Matrix4();
      transform.fromArray(Array.from(transformElements));
      return { geometry, transform };
    });

    const slicer = new Slicer(
      printerProfile as never,
      materialProfile as never,
      printProfile as never,
    );
    activeSlicer = slicer;

    slicer.setProgressCallback((progress: SliceProgress) => {
      self.postMessage({ type: 'progress', progress });
    });

    try {
      const result = await slicer.slice(geometries);
      activeSlicer = null;
      self.postMessage({ type: 'complete', result });
    } catch (err) {
      activeSlicer = null;
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'error', message });
    }
  }
};
