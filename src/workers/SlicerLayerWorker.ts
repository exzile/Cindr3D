/// <reference lib="webworker" />

import * as THREE from 'three';
import { Slicer } from '../engine/slicer/Slicer';
import { prepareSliceGeometryRun } from '../engine/slicer/pipeline/execution/steps/prepareSliceRun';
import { prepareLayerGeometryState } from '../engine/slicer/pipeline/execution/steps/prepareLayerState';
import type { SliceGeometryRun, SliceLayerGeometryState } from '../engine/slicer/pipeline/execution/steps/types';
import type { Contour, Triangle } from '../types/slicer-pipeline.types';
import type { MaterialProfile, PrinterProfile, PrintProfile } from '../types/slicer';

interface RawGeometry {
  positions: Float32Array;
  index: Uint32Array | null;
  transformElements: Float32Array;
}

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

interface LayerPrepMessage {
  type: 'prepare-layers';
  requestId: number;
  payload: {
    geometryData?: RawGeometry[];
    geometryRun?: SerializedGeometryRun;
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

function hydrateVector3(v: SerializedVector3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function hydrateGeometryRun(run: SerializedGeometryRun): SliceGeometryRun {
  return {
    ...run,
    triangles: run.triangles.map((tri): Triangle => ({
      v0: hydrateVector3(tri.v0),
      v1: hydrateVector3(tri.v1),
      v2: hydrateVector3(tri.v2),
      normal: hydrateVector3(tri.normal),
      edgeKey01: tri.edgeKey01,
      edgeKey12: tri.edgeKey12,
      edgeKey20: tri.edgeKey20,
    })),
    modelBBox: {
      min: hydrateVector3(run.modelBBox.min),
      max: hydrateVector3(run.modelBBox.max),
    },
  };
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
  const { geometryData, geometryRun, printerProfile, materialProfile, printProfile, layerIndices } = msg.payload;
  const geometries = geometryData ? reconstructGeometries(geometryData) : [];

  try {
    const slicer = new Slicer(printerProfile, materialProfile, printProfile);
    activeSlicer = slicer;
    const run = geometryRun
      ? hydrateGeometryRun(geometryRun)
      : prepareSliceGeometryRun(slicer, geometries);
    (run as SliceGeometryRun & { activeLayerIndices?: number[] }).activeLayerIndices = layerIndices;
    const layers: Array<{ layerIndex: number; layer: ReturnType<typeof serializeLayerGeometry> }> = [];

    for (const layerIndex of layerIndices) {
      if (cancelRequested) throw new Error('Slicing cancelled');
      const layer = await prepareLayerGeometryState(slicer, run, layerIndex, {
        reportProgress: false,
        yieldToUI: false,
      });
      const serializedLayer = serializeLayerGeometry(layer);
      layers.push({ layerIndex, layer: serializedLayer });
      self.postMessage({
        type: 'layer',
        requestId,
        layerIndex,
        layer: serializedLayer,
      });
    }

    if (cancelRequested || activeRequestId !== requestId) {
      if (activeRequestId === requestId) self.postMessage({ type: 'cancelled', requestId });
      return;
    }
    self.postMessage({ type: 'complete', requestId, layers: [] });
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
