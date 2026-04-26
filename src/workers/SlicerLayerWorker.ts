/// <reference lib="webworker" />

import * as THREE from 'three';
import { Slicer } from '../engine/slicer/Slicer';
import { prepareSliceRun } from '../engine/slicer/pipeline/execution/steps/prepareSliceRun';
import { prepareLayerGeometryState } from '../engine/slicer/pipeline/execution/steps/prepareLayerState';
import type { SliceLayerGeometryState } from '../engine/slicer/pipeline/execution/steps/types';
import type { Contour } from '../types/slicer-pipeline.types';
import type { MaterialProfile, PrinterProfile, PrintProfile } from '../types/slicer';

interface RawGeometry {
  positions: Float32Array;
  index: Uint32Array | null;
  transformElements: Float32Array;
}

interface LayerPrepMessage {
  type: 'prepare-layers';
  requestId: number;
  payload: {
    geometryData: RawGeometry[];
    printerProfile: PrinterProfile;
    materialProfile: MaterialProfile;
    printProfile: PrintProfile;
    layerIndices: number[];
  };
}

interface CancelMessage {
  type: 'cancel';
  requestId: number;
}

type WorkerMessage = LayerPrepMessage | CancelMessage;
type SerializedContour = Omit<Contour, 'points'> & { points: Array<[number, number]> };
type SerializedLayerGeometry = Omit<SliceLayerGeometryState, 'contours'> & {
  contours: SerializedContour[];
};

let activeRequestId = 0;
let cancelRequested = false;
let activeSlicer: Slicer | null = null;

function reconstructGeometries(geometryData: RawGeometry[]) {
  return geometryData.map(({ positions, index, transformElements }) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1));
    const transform = new THREE.Matrix4();
    transform.fromArray(transformElements);
    return { geometry, transform };
  });
}

function serializeLayerGeometry(layer: SliceLayerGeometryState | null): SerializedLayerGeometry | null {
  if (!layer) return null;
  return {
    ...layer,
    contours: layer.contours.map((contour) => ({
      area: contour.area,
      isOuter: contour.isOuter,
      points: contour.points.map((point: THREE.Vector2) => [point.x, point.y] as [number, number]),
    })),
  };
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;

  if (msg.type === 'cancel') {
    if (msg.requestId !== activeRequestId) return;
    cancelRequested = true;
    activeSlicer?.cancel();
    return;
  }

  activeRequestId = msg.requestId;
  cancelRequested = false;
  const { requestId } = msg;
  const { geometryData, printerProfile, materialProfile, printProfile, layerIndices } = msg.payload;
  const geometries = reconstructGeometries(geometryData);

  try {
    const slicer = new Slicer(printerProfile, materialProfile, printProfile);
    activeSlicer = slicer;
    const run = prepareSliceRun(slicer, geometries);
    const layers: Array<{ layerIndex: number; layer: ReturnType<typeof serializeLayerGeometry> }> = [];

    for (const layerIndex of layerIndices) {
      if (cancelRequested) throw new Error('Slicing cancelled');
      const layer = await prepareLayerGeometryState(slicer, run, layerIndex);
      layers.push({ layerIndex, layer: serializeLayerGeometry(layer) });
    }

    if (cancelRequested || activeRequestId !== requestId) {
      if (activeRequestId === requestId) self.postMessage({ type: 'cancelled', requestId });
      return;
    }
    self.postMessage({ type: 'complete', requestId, layers });
  } catch (err) {
    if (cancelRequested || activeRequestId !== requestId) {
      if (activeRequestId === requestId) self.postMessage({ type: 'cancelled', requestId });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: 'error', requestId, message });
  } finally {
    activeSlicer = null;
    for (const g of geometries) g.geometry.dispose();
  }
};
