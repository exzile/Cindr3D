/**
 * Heightmap visualization — public API shim.
 *
 * The implementation lives in `./scene/*` (one component per file). This
 * file is a thin re-export so existing import paths
 * (`./heightMap/visualization`) keep working without churn.
 */

/* eslint-disable react-refresh/only-export-components */

export { Scene3D } from './scene/Scene3D';
export { Heatmap2D } from './scene/Heatmap2D';
export { ColorScaleLegend, getBedQuality, StatsPanel } from './scene/legend';
export { CAMERA_POSITIONS, type CameraPreset } from './scene/cameraPresets';
export type { ConfiguredProbeGrid, BedBounds, HoverInfo } from './scene/types';
