import type * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon, Ring as PCRing } from 'polygon-clipping';
import type { GCodeEmitter } from '../../../gcode/emitter';
import type {
  Contour,
  GeneratedPerimeters,
  Segment,
  Triangle,
} from '../../../../../types/slicer-pipeline.types';
import type {
  MaterialProfile,
  PrinterProfile,
  PrintProfile,
  SliceLayer,
  SliceMove,
} from '../../../../../types/slicer';
import type { SlicerGCodeFlavor } from '../../../../../types/slicer-gcode.types';
import type { LayerTopology } from '../../../../../types/slicer-pipeline-layer-topology.types';
import type { LayerControlFlags } from '../../../../../types/slicer-pipeline-layer-controls.types';
import type { ArachneGenerationContext } from '../../arachne/types';

export interface SlicerModelBBox {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface SlicerExecutionPipeline {
  cancelled: boolean;
  printProfile: PrintProfile;
  materialProfile: MaterialProfile;
  printerProfile: PrinterProfile;
  reportProgress(stage: string, progress: number, layer: number, totalLayers: number, message: string): void;
  yieldToUI(): Promise<void>;
  extractTriangles(geometries: Array<{ geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }>): Triangle[];
  computeBBox(triangles: Triangle[]): SlicerModelBBox;
  computeAdaptiveLayerZs(
    triangles: Triangle[],
    modelHeight: number,
    firstLayerHeight: number,
    layerHeight: number,
    maxVariation: number,
    variationStep: number,
    zScale: number,
  ): number[];
  sliceTrianglesAtZ(
    triangles: Triangle[],
    sliceZ: number,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
  ): Segment[];
  connectSegments(segments: Segment[]): THREE.Vector2[][];
  classifyContours(contours: THREE.Vector2[][]): Contour[];
  closeContourGaps(contours: Contour[], radius: number): Contour[];
  offsetContour(contour: THREE.Vector2[], offset: number): THREE.Vector2[];
  generateAdhesion(
    contours: Contour[],
    print: PrintProfile,
    layerHeight: number,
    offsetX: number,
    offsetY: number,
  ): SliceMove[];
  pointInContour(point: THREE.Vector2, contour: THREE.Vector2[]): boolean;
  pointInRing(x: number, y: number, ring: PCRing): boolean;
  findSeamPosition(
    loop: THREE.Vector2[],
    print: PrintProfile,
    layerIndex: number,
    currentX: number,
    currentY: number,
    options: {
      previousSeam: THREE.Vector2 | null;
      continuityTolerance: number;
      userSpecifiedRadius: number;
      isSupported?: (point: THREE.Vector2) => boolean;
    },
  ): number;
  reorderFromIndex(loop: THREE.Vector2[], index: number): THREE.Vector2[];
  simplifyClosedContour(loop: THREE.Vector2[], tolerance: number): THREE.Vector2[];
  filterPerimetersByMinOdd(perimeters: GeneratedPerimeters, minOddWallLineWidth: number): GeneratedPerimeters;
  generatePerimeters(
    contour: THREE.Vector2[],
    holes: THREE.Vector2[][],
    wallCount: number,
    wallLineWidth: number,
    outerWallInset: number,
    context?: ArachneGenerationContext,
  ): GeneratedPerimeters;
  generateSupportForLayer(
    triangles: Triangle[],
    sliceZ: number,
    layerZ: number,
    layerIndex: number,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    modelHeight: number,
    contours: Contour[],
  ): { moves: SliceMove[]; flowOverride?: number };
  generateLinearInfill(
    contour: THREE.Vector2[],
    density: number,
    spacing: number,
    layerIndex: number,
    pattern: string,
    holes?: THREE.Vector2[][],
  ): Array<{ from: THREE.Vector2; to: THREE.Vector2 }>;
  generateScanLines(
    contour: THREE.Vector2[],
    density: number,
    spacing: number,
    angle: number,
    phase: number,
    holes?: THREE.Vector2[][],
  ): Array<{ from: THREE.Vector2; to: THREE.Vector2 }>;
  contourBBox(contour: THREE.Vector2[]): { minX: number; minY: number; maxX: number; maxY: number };
  contourToClosedPCRing(contour: THREE.Vector2[]): PCRing;
  multiPolygonToRegions(mp: PCMultiPolygon): Array<{ contour: THREE.Vector2[]; holes: THREE.Vector2[][] }>;
  sortInfillLines(lines: Array<{ from: THREE.Vector2; to: THREE.Vector2 }>): Array<{ from: THREE.Vector2; to: THREE.Vector2 }>;
  sortInfillLinesNN(
    lines: Array<{ from: THREE.Vector2; to: THREE.Vector2 }>,
    currentX: number,
    currentY: number,
  ): Array<{ from: THREE.Vector2; to: THREE.Vector2 }>;
  segmentInsideMaterial(
    from: THREE.Vector2,
    to: THREE.Vector2,
    outer: THREE.Vector2[],
    holes: THREE.Vector2[][],
  ): boolean;
  offsetContourFast?(contour: THREE.Vector2[], offset: number): THREE.Vector2[];
}

export interface SliceRun {
  pp: PrintProfile;
  mat: MaterialProfile;
  printer: PrinterProfile;
  flavor: SlicerGCodeFlavor;
  triangles: Triangle[];
  modelBBox: SlicerModelBBox;
  modelHeight: number;
  bedCenterX: number;
  bedCenterY: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  layerZs: number[];
  totalLayers: number;
  solidBottom: number;
  solidTop: number;
  gcode: string[];
  emitter: GCodeEmitter;
  relativeE: boolean;
  layerControlFlags: LayerControlFlags;
  prevLayerMaterial: PCMultiPolygon;
  previousSeamPoints: THREE.Vector2[];
  currentSeamPoints: THREE.Vector2[];
  seamMemoryLayer?: number;
  bridgeFanActive: boolean;
  consecutiveBridgeLayers: number;
  layerHadBridge: boolean;
  sliceLayers: SliceLayer[];
  totalTime: number;
}

export type SliceGeometryRun = Pick<
  SliceRun,
  | 'pp'
  | 'mat'
  | 'triangles'
  | 'modelBBox'
  | 'offsetX'
  | 'offsetY'
  | 'offsetZ'
  | 'layerZs'
  | 'totalLayers'
  | 'solidBottom'
  | 'solidTop'
  | 'bedCenterX'
  | 'bedCenterY'
> & {
  layerHadBridge?: boolean;
};

export interface SliceLayerGeometryState {
  li: number;
  layerZ: number;
  sliceZ: number;
  isFirstLayer: boolean;
  layerH: number;
  isSolidBottom: boolean;
  isSolidTop: boolean;
  isSolid: boolean;
  /**
   * True only for the topmost `topSurfaceSkinLayers` solid layers (subset
   * of `isSolidTop`). When false on a solid-top layer, the layer should
   * use regular topBottom settings rather than the ultra-quality top-
   * surface overrides (`topSurfaceSkinLineWidth`, `topSurfaceSkinPattern`,
   * `topSurfaceSkinExpansion`, `topSurfaceSkinFlow`).
   */
  isTopSurfaceLayer: boolean;
  /** Same as `isTopSurfaceLayer`, but for the bottommost N layers. */
  isBottomSurfaceLayer: boolean;
  outerWallSpeed: number;
  innerWallSpeed: number;
  infillSpeed: number;
  topBottomSpeed: number;
  contours: Contour[];
  printZ: number;
  precomputedContourWalls?: PrecomputedContourWall[];
}

export interface SliceLayerState extends SliceLayerGeometryState, LayerTopology {
  moves: SliceMove[];
  layerTime: number;
}

export interface ContourWallData {
  contour: Contour;
  exWalls: GeneratedPerimeters;
  wallSets: THREE.Vector2[][];
  wallLineWidths: Array<number | number[]>;
  wallClosed?: boolean[];
  outerWallCount: number;
  infillHoles: THREE.Vector2[][];
}

export interface PrecomputedContourWall {
  contourIndex: number;
  perimeters: GeneratedPerimeters;
}
