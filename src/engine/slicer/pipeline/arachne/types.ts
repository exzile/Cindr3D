import type * as THREE from 'three';
import type { PrintProfile } from '../../../../types/slicer';

/** Backend identifier. Profiles may legacy-store `'js'`; the resolver
 *  coerces it to the WASM backend (the JS staged backend was removed
 *  in 9.3D). */
export type ArachneBackendName = 'wasm' | 'js';

export type ArachneSectionType =
  | 'wall'
  | 'infill'
  | 'skin'
  | 'support'
  | 'adhesion'
  | 'ironing'
  | 'mesh'
  | 'dots'
  | 'concentric-infill';

export interface ArachneGenerationContext {
  sectionType?: ArachneSectionType;
  isTopOrBottomLayer?: boolean;
}

export interface ArachneBackend {
  readonly name: ArachneBackendName;
  generatePaths(
    outerContour: THREE.Vector2[],
    holeContours: THREE.Vector2[][],
    wallCount: number,
    lineWidth: number,
    outerWallInset: number,
    printProfile: PrintProfile,
    context?: ArachneGenerationContext,
  ): VariableWidthPath[];
  generatePathsWithInnerContours?(
    outerContour: THREE.Vector2[],
    holeContours: THREE.Vector2[][],
    wallCount: number,
    lineWidth: number,
    outerWallInset: number,
    printProfile: PrintProfile,
    context?: ArachneGenerationContext,
  ): ArachnePathResult;
}

export interface ArachnePathResult {
  paths: VariableWidthPath[];
  innerContours: THREE.Vector2[][];
}

/**
 * Output of the Arachne pipeline: a wall path with PER-VERTEX line width.
 * Adjacent vertices' widths are linearly interpolated along the segment.
 *
 * This is the "ExtrusionLine" from Cura's source (`include/utils/ExtrusionLine.h`).
 */
export interface VariableWidthPath {
  /** Polyline points along the wall centerline. */
  points: THREE.Vector2[];
  /** Per-vertex line width (mm). length === points.length.
   *  Width tapers linearly between consecutive vertices. */
  widths: number[];
  /** Wall depth: 0 = outermost wall of its contour (this is a `wall-outer`
   *  move type — for hole loops it's the wall closest to the hole's empty
   *  space); 1+ = inner walls. */
  depth: number;
  /** Whether the polyline closes back on itself (forms a complete loop). */
  isClosed: boolean;
  /** Hint about which feature this path belongs to:
   *    - 'outer'  = a wall around the model's outer contour
   *    - 'hole'   = a wall around one of the holes (a wall-outer of the hole at depth 0)
   *    - 'gapfill' = a thin gap-fill bead in a region too narrow for the
   *                  nominal wall count (Arachne's signature feature) */
  source: 'outer' | 'hole' | 'gapfill';
}
