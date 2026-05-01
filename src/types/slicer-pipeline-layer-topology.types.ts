import type * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon, Ring as PCRing } from 'polygon-clipping';
import type { Contour } from './slicer-pipeline.types';

export interface LayerTopologyOptions {
  contours: Contour[];
  optimizeWallOrder: boolean;
  currentX: number;
  currentY: number;
  previousLayerMaterial: PCMultiPolygon;
  /** Material polygon of the layer ABOVE this one (li+1). When provided,
   *  `topSkinRegion = currentLayerMaterial − nextLayerMaterial` flags
   *  per-feature top-solid regions (e.g. tops of bosses inside a model)
   *  for solid skin emission. Empty/undefined for the topmost layer or
   *  when the cache isn't populated. */
  nextLayerMaterial?: PCMultiPolygon;
  /** Minimum polygon thickness (≈ `2·area / perimeter`, mm) for a
   *  `topSkinRegion` polygon to survive. Tessellation noise on curved
   *  walls produces long thin slivers in `current − next`; below this
   *  threshold we treat them as noise and drop them. Typical: 1.5 ×
   *  the layer's nominal infill line width. */
  topSkinSliverThickness?: number;
  isFirstLayer: boolean;
  pointInContour: (point: THREE.Vector2, contour: THREE.Vector2[]) => boolean;
  pointInRing: (x: number, y: number, ring: PCRing) => boolean;
}

export interface LayerTopology {
  workContours: Contour[];
  holesByOuterContour: Map<Contour, THREE.Vector2[][]>;
  currentLayerMaterial: PCMultiPolygon;
  /** Per-feature top-skin region: parts of `currentLayerMaterial` that
   *  do NOT have material above (`current − next`). Empty when the layer
   *  above is unknown or completely covers this layer. Used by
   *  `emitContourInfill.ts` to promote sub-regions of the infill to
   *  solid skin even when the layer isn't structurally `isSolidTop`. */
  topSkinRegion: PCMultiPolygon;
  hasBridgeRegions: boolean;
  isInBridgeRegion: (x: number, y: number) => boolean;
}
