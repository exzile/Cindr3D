import * as THREE from 'three';
import type { SlicerGCodeFlavor, StartEndMachineState } from '../../../../../types/slicer-gcode.types';
import { GCodeEmitter } from '../../../gcode/emitter';
import { appendHeaderPlaceholders, appendStartGCode } from '../../../gcode/startup';
import type { SlicerExecutionPipeline, SliceGeometryRun, SliceRun } from './types';

export type PreparedSliceGeometryRun = SliceGeometryRun & Pick<SliceRun, 'printer' | 'modelHeight'>;

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

export function prepareSliceRun(
  pipeline: unknown,
  geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
): SliceRun {
  const geometryRun = prepareSliceGeometryRun(pipeline, geometries);
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
): PreparedSliceGeometryRun {
  const slicer = pipeline as SlicerExecutionPipeline;
  const pp = slicer.printProfile;
  const mat = slicer.materialProfile;
  const printer = slicer.printerProfile;

  slicer.cancelled = false;
  slicer.reportProgress('preparing', 0, 0, 0, 'Extracting triangles...');

  const triangles = slicer.extractTriangles(geometries);
  if (triangles.length === 0) throw new Error('No triangles found in provided geometry.');

  const modelBBox = slicer.computeBBox(triangles);
  const modelHeight = modelBBox.max.z - modelBBox.min.z;
  const bedCenterX = printer.originCenter ? 0 : printer.buildVolume.x / 2;
  const bedCenterY = printer.originCenter ? 0 : printer.buildVolume.y / 2;
  const modelCenterX = (modelBBox.min.x + modelBBox.max.x) / 2;
  const modelCenterY = (modelBBox.min.y + modelBBox.max.y) / 2;
  const offsetX = bedCenterX - modelCenterX;
  const offsetY = bedCenterY - modelCenterY;
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
