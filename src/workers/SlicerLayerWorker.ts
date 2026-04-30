/// <reference lib="webworker" />

import * as THREE from 'three';
import { Slicer } from '../engine/slicer/Slicer';
import { prepareSliceGeometryRun } from '../engine/slicer/pipeline/execution/steps/prepareSliceRun';
import { prepareLayerGeometryState } from '../engine/slicer/pipeline/execution/steps/prepareLayerState';
import { loadArachneModule } from '../engine/slicer/pipeline/arachne';
import type { SliceGeometryRun, SliceLayerGeometryState } from '../engine/slicer/pipeline/execution/steps/types';
import { lineWidthForLayer } from '../engine/slicer/pipeline/execution/steps/lineWidths';
import type { Contour, ModifierMesh, Triangle } from '../types/slicer-pipeline.types';
import type { GeneratedPerimeters } from '../types/slicer-pipeline.types';
import type { MaterialProfile, PrinterProfile, PrintProfile, ModifierMeshSettings } from '../types/slicer';

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

interface SerializedModifierMesh {
  role: ModifierMesh['role'];
  meshIndex: number;
  triangles: SerializedTriangle[];
  settings?: ModifierMeshSettings;
}

type SerializedGeometryRun = Omit<SliceGeometryRun, 'triangles' | 'modelBBox' | 'modifierMeshes'> & {
  triangles: SerializedTriangle[];
  modifierMeshes: SerializedModifierMesh[];
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
type SerializedLayerGeometry = Omit<SliceLayerGeometryState, 'contours' | 'precomputedContourWalls'> & {
  contours: SerializedContour[];
  precomputedContourWalls?: Array<{
    contourIndex: number;
    perimeters: SerializedGeneratedPerimeters;
  }>;
};
type SerializedGeneratedPerimeters = Omit<GeneratedPerimeters, 'walls' | 'innermostHoles' | 'infillRegions'> & {
  walls: Array<Array<[number, number]>>;
  innermostHoles: Array<Array<[number, number]>>;
  infillRegions: Array<{
    contour: Array<[number, number]>;
    holes: Array<Array<[number, number]>>;
  }>;
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

function hydrateTriangle(tri: SerializedTriangle): Triangle {
  return {
    v0: hydrateVector3(tri.v0),
    v1: hydrateVector3(tri.v1),
    v2: hydrateVector3(tri.v2),
    normal: hydrateVector3(tri.normal),
    edgeKey01: tri.edgeKey01,
    edgeKey12: tri.edgeKey12,
    edgeKey20: tri.edgeKey20,
  };
}

function hydrateGeometryRun(run: SerializedGeometryRun): SliceGeometryRun {
  return {
    ...run,
    triangles: run.triangles.map(hydrateTriangle),
    modifierMeshes: (run.modifierMeshes ?? []).map((mesh): ModifierMesh => ({
      role: mesh.role,
      meshIndex: mesh.meshIndex,
      settings: mesh.settings,
      triangles: mesh.triangles.map(hydrateTriangle),
    })),
    modelBBox: {
      min: hydrateVector3(run.modelBBox.min),
      max: hydrateVector3(run.modelBBox.max),
    },
  };
}

function serializeLayerGeometry(layer: SliceLayerGeometryState | null): SerializedLayerGeometry | null {
  if (!layer) return null;
  const serializePoints = (points: THREE.Vector2[]) => points.map((point) => [point.x, point.y] as [number, number]);
  return {
    ...layer,
    contours: layer.contours.map((contour) => ({
      area: contour.area,
      isOuter: contour.isOuter,
      points: serializePoints(contour.points),
    })),
    precomputedContourWalls: layer.precomputedContourWalls?.map((item) => ({
      contourIndex: item.contourIndex,
      perimeters: {
        ...item.perimeters,
        walls: item.perimeters.walls.map(serializePoints),
        innermostHoles: item.perimeters.innermostHoles.map(serializePoints),
        infillRegions: item.perimeters.infillRegions.map((region) => ({
          contour: serializePoints(region.contour),
          holes: region.holes.map(serializePoints),
        })),
      },
    })),
  };
}

function containedHolesForContour(slicer: Slicer, contours: Contour[], contour: Contour): THREE.Vector2[][] {
  const holes: THREE.Vector2[][] = [];
  for (const holeContour of contours) {
    if (holeContour.isOuter || holeContour.points.length < 3) continue;
    if (slicer.pointInContour(holeContour.points[0], contour.points)) holes.push(holeContour.points);
  }
  return holes;
}

function precomputeContourWalls(slicer: Slicer, layer: SliceLayerGeometryState): void {
  const pp = slicer.printProfile;
  if (pp.wallGenerator !== 'arachne') return;
  const arachneContext = {
    sectionType: 'wall' as const,
    isTopOrBottomLayer: layer.isSolidTop || layer.isSolidBottom,
    isFirstLayer: layer.isFirstLayer,
    nozzleDiameter: (slicer as unknown as { printerProfile: { nozzleDiameter: number } }).printerProfile.nozzleDiameter,
  };
  const precomputed = [];
  for (let contourIndex = 0; contourIndex < layer.contours.length; contourIndex++) {
    const contour = layer.contours[contourIndex];
    if (!contour.isOuter) continue;
    const containedHoles = containedHolesForContour(slicer, layer.contours, contour);
    const wallLineWidth = lineWidthForLayer(pp.wallLineWidth, pp, layer.isFirstLayer);
    const perimeters = slicer.filterPerimetersByMinOdd(
      slicer.generatePerimeters(contour.points, containedHoles, pp.wallCount, wallLineWidth, pp.outerWallInset ?? 0, arachneContext),
      pp.minOddWallLineWidth ?? 0,
    );
    precomputed.push({ contourIndex, perimeters });
  }
  if (precomputed.length > 0) layer.precomputedContourWalls = precomputed;
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
    let canPrecomputeArachne = printProfile.arachneBackend === 'wasm';
    if (canPrecomputeArachne) {
      try {
        await loadArachneModule();
      } catch (err) {
        canPrecomputeArachne = false;
        console.warn('Arachne WASM backend unavailable in layer worker; skipping parallel wall precompute.', err);
      }
    }
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
      if (layer) {
        if (canPrecomputeArachne) precomputeContourWalls(slicer, layer);
      }
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
