import * as THREE from 'three';
import type { SlicerGCodeFlavor, StartEndMachineState } from '../../../../../types/slicer-gcode.types';
import { GCodeEmitter } from '../../../gcode/emitter';
import { appendHeaderPlaceholders, appendStartGCode } from '../../../gcode/startup';
import { removeAllHoles as repairRemoveAllHoles } from '../../../geometry/coreGeometry';
import type { ModifierMeshRole, ModifierMeshSettings } from '../../../../../types/slicer';
import type { ModifierMesh } from '../../../../../types/slicer-pipeline.types';
import type { SlicerExecutionPipeline, SliceGeometryRun, SliceRun } from './types';

export interface ModifierMeshInput {
  geometry: THREE.BufferGeometry;
  transform: THREE.Matrix4;
  role: ModifierMeshRole;
  settings?: ModifierMeshSettings;
}

export type PreparedSliceGeometryRun = SliceGeometryRun & Pick<SliceRun, 'printer' | 'modelHeight'>;

interface CachedMeshGeometry {
  triangles: SliceGeometryRun['triangles'];
  modelBBox: SliceRun['modelBBox'];
  modelHeight: number;
}

const MAX_MESH_GEOMETRY_CACHE_ENTRIES = 8;
const meshGeometryCache = new Map<string, CachedMeshGeometry>();

function appendToolSelection(gcode: string[], printer: SliceRun['printer'], pp: SliceRun['pp']): void {
  const extruderIndex = Math.max(0, Math.floor(pp.extruderIndex ?? 0));
  if (extruderIndex <= 0) return;

  const toolChange = pp.toolChangeGCode?.trim();
  gcode.push('; ----- Tool selection -----');
  if (toolChange) gcode.push(toolChange.replace(/\{tool\}/g, String(extruderIndex)));
  else gcode.push(`T${extruderIndex} ; Select tool`);
  if (printer.applyExtruderOffsets) {
    const x = printer.extruderOffsetX ?? 0;
    const y = printer.extruderOffsetY ?? 0;
    if (x !== 0 || y !== 0) gcode.push(`G10 P${extruderIndex} X${x.toFixed(3)} Y${y.toFixed(3)} ; Tool offset`);
  }
}

function attributeVersion(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null | undefined): number {
  if (!attr) return -1;
  const version = (attr as THREE.BufferAttribute & { version?: number }).version;
  return typeof version === 'number' ? version : 0;
}

function transformKey(transform: THREE.Matrix4): string {
  return transform.elements.map((value) => Number.isFinite(value) ? value.toPrecision(12) : String(value)).join(',');
}

function geometryCacheKey(
  geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
): string {
  return geometries.map(({ geometry, transform }) => {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    return [
      geometry.uuid,
      geometry.id,
      position?.count ?? 0,
      attributeVersion(position),
      index?.count ?? 0,
      attributeVersion(index),
      transformKey(transform),
    ].join(':');
  }).join('|');
}

function rememberMeshGeometry(cacheKey: string, value: CachedMeshGeometry): CachedMeshGeometry {
  if (meshGeometryCache.size >= MAX_MESH_GEOMETRY_CACHE_ENTRIES) {
    const oldestKey = meshGeometryCache.keys().next().value;
    if (oldestKey) meshGeometryCache.delete(oldestKey);
  }
  meshGeometryCache.set(cacheKey, value);
  return value;
}

function prepareMeshGeometry(
  slicer: SlicerExecutionPipeline,
  geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
  pp: SliceRun['pp'],
): CachedMeshGeometry {
  // Cache pristine extracted triangles (without per-profile repairs) so the
  // same geometry can serve multiple profiles. Per-profile repair passes
  // run AFTER the cache lookup on a copy.
  const cacheKey = geometryCacheKey(geometries);
  let cached = meshGeometryCache.get(cacheKey);
  if (!cached) {
    const triangles = slicer.extractTriangles(geometries);
    if (triangles.length === 0) throw new Error('No triangles found in provided geometry.');
    const modelBBox = slicer.computeBBox(triangles);
    const modelHeight = modelBBox.max.z - modelBBox.min.z;
    cached = rememberMeshGeometry(cacheKey, { triangles, modelBBox, modelHeight });
  }

  // Apply mesh-repair passes per profile setting. Each pass returns a new
  // triangle list so the cached pristine list stays untouched.
  if (pp.removeAllHoles) {
    const repaired = repairRemoveAllHoles(cached.triangles);
    if (repaired.added > 0) {
      const modelBBox = slicer.computeBBox(repaired.triangles);
      const modelHeight = modelBBox.max.z - modelBBox.min.z;
      return { triangles: repaired.triangles, modelBBox, modelHeight };
    }
  }
  return cached;
}

export function prepareSliceRun(
  pipeline: unknown,
  geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
  modifierMeshes: ModifierMeshInput[] = [],
): SliceRun {
  const geometryRun = prepareSliceGeometryRun(pipeline, geometries, modifierMeshes);
  const { pp, mat, printer } = geometryRun;
  const flavor: SlicerGCodeFlavor = printer.gcodeFlavorType ?? 'marlin';

  const gcode: string[] = [];
  const relativeE = pp.relativeExtrusion ?? false;
  const emitter = new GCodeEmitter({
    gcode,
    printer,
    material: mat,
    print: pp,
    flavor,
    relativeExtrusion: relativeE,
  });

  if (!printer.startGCodeMustBeFirst) {
    appendHeaderPlaceholders(gcode, printer, mat, pp);
    appendToolSelection(gcode, printer, pp);
  }
  appendStartGCode({
    gcode,
    printer,
    material: mat,
    print: pp,
    relativeExtrusion: relativeE,
    flavor,
    startEndState: emitter.startEndState as StartEndMachineState,
  });
  if (printer.startGCodeMustBeFirst) {
    appendHeaderPlaceholders(gcode, printer, mat, pp);
    appendToolSelection(gcode, printer, pp);
  }

  return {
    ...geometryRun,
    flavor,
    gcode,
    emitter,
    relativeE,
    layerControlFlags: {
      regularFanHeightFired: false,
      buildVolumeFanHeightFired: false,
    },
    prevLayerMaterial: [],
    layerMaterialCache: [],
    previousSeamPoints: [] as THREE.Vector2[],
    currentSeamPoints: [] as THREE.Vector2[],
    seamMemoryLayer: undefined as number | undefined,
    bridgeFanActive: false,
    /** Consecutive layers (incl. current) that have emitted bridge moves.
     *  Reset to 0 by finalizeLayer when no bridge moves were seen.
     *  Drives `bridgeFanSpeed2` / `bridgeFanSpeed3` when
     *  `bridgeEnableMoreLayers` is enabled. */
    consecutiveBridgeLayers: 0,
    /** True if the current layer has emitted at least one bridge move.
     *  Reset to false at layer start; checked in finalizeLayer. */
    layerHadBridge: false,
    sliceLayers: [],
    totalTime: 0,
  };
}

export function prepareSliceGeometryRun(
  pipeline: unknown,
  geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
  modifierMeshes: ModifierMeshInput[] = [],
): PreparedSliceGeometryRun {
  const slicer = pipeline as SlicerExecutionPipeline;
  const pp = slicer.printProfile;
  const mat = slicer.materialProfile;
  const printer = slicer.printerProfile;

  slicer.cancelled = false;
  slicer.reportProgress('preparing', 0, 0, 0, 'Extracting triangles...');

  const { triangles, modelBBox, modelHeight } = prepareMeshGeometry(slicer, geometries, pp);
  // Modifier meshes — each gets its triangles extracted independently so
  // per-layer slicing can produce a separate cross-section per role.
  // We do NOT run mesh-repair on modifiers (their boundary geometry is
  // user-painted; repair could erase the very volume the user chose to
  // mark as a cutting/infill/support volume).
  const preparedModifiers: ModifierMesh[] = [];
  for (let i = 0; i < modifierMeshes.length; i++) {
    const mod = modifierMeshes[i];
    if (mod.role === 'normal') continue;
    const modTris = slicer.extractTriangles([{ geometry: mod.geometry, transform: mod.transform }]);
    if (modTris.length === 0) continue;
    preparedModifiers.push({
      role: mod.role,
      triangles: modTris,
      settings: mod.settings,
      meshIndex: preparedModifiers.length,
    });
  }
  // Bed center is still computed for downstream consumers (skirt/brim
  // placement, default seam-X/Y position, etc.) but we no longer use it
  // to translate the model. The user's positioning in Prepare mode is
  // already baked into the `transform` matrix on each geometry, so the
  // triangles arrive here at their world-space X/Y. Auto-centering at
  // slice time was overriding that placement and causing the Preview
  // to show every model snapped to the build-plate centre — a real
  // bug for multi-object plates and any user who'd intentionally
  // moved their model. Set offsetX/Y to 0 so X/Y is preserved as-is.
  // Z still gets lifted so the bottom touches z=0; users almost never
  // intentionally float a model, and the previous behaviour was also
  // to lift, so keeping it avoids print-in-air regressions.
  const bedCenterX = printer.originCenter ? 0 : printer.buildVolume.x / 2;
  const bedCenterY = printer.originCenter ? 0 : printer.buildVolume.y / 2;
  const offsetX = 0;
  const offsetY = 0;
  const offsetZ = -modelBBox.min.z;
  const zScale = 1 + (mat.shrinkageCompensationZ ?? 0) / 100;

  let layerZs: number[];
  if (pp.adaptiveLayersEnabled) {
    layerZs = slicer.computeAdaptiveLayerZs(
      triangles,
      modelHeight,
      pp.firstLayerHeight,
      pp.layerHeight,
      pp.adaptiveLayersMaxVariation,
      pp.adaptiveLayersVariationStep,
      zScale,
      pp.adaptiveLayersTopographySize ?? 0,
    );
  } else {
    layerZs = [];
    let z = pp.firstLayerHeight;
    while (z <= modelHeight + 0.0001) {
      layerZs.push(z * zScale);
      z += pp.layerHeight;
    }
  }

  const totalLayers = layerZs.length;
  if (totalLayers === 0) throw new Error('Model too thin to slice at the given layer height.');

  const solidBottom = pp.bottomThickness && pp.bottomThickness > 0
    ? Math.max(1, Math.ceil(pp.bottomThickness / pp.layerHeight))
    : pp.bottomLayers;
  const solidTop = pp.topThickness && pp.topThickness > 0
    ? Math.max(1, Math.ceil(pp.topThickness / pp.layerHeight))
    : pp.topLayers;

  return {
    pp,
    mat,
    printer,
    triangles,
    modifierMeshes: preparedModifiers,
    modelBBox,
    modelHeight,
    bedCenterX,
    bedCenterY,
    offsetX,
    offsetY,
    offsetZ,
    layerZs,
    totalLayers,
    solidBottom,
    solidTop,
  };
}
