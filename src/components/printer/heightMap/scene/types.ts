/** Shared types for the heightmap 3D/2D scene components. */

import type { DuetHeightMap as HeightMapData } from '../../../../types/duet';

export type { HeightMapData };

export type HoverInfo = {
  bedX: number;
  bedY: number;
  value: number;
  screenX: number;
  screenY: number;
  isProbePoint?: boolean;
  /** 1-based probe column. */
  gridX?: number;
  /** 1-based probe row. */
  gridY?: number;
};

export interface ConfiguredProbeGrid {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  numPoints: number;
}

/** Physical bed extents from the printer's axis limits (M208). */
export interface BedBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}
