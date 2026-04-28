import type { PrintProfile } from './print';

export interface PlateObject {
  id: string;
  name: string;
  featureId?: string; // reference to CAD feature (optional — may be a file import)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geometry?: any; // THREE.BufferGeometry — avoid importing Three.js in types
  // Transform on build plate (3D)
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number }; // degrees
  scale: { x: number; y: number; z: number };
  // Mirror
  mirrorX?: boolean;
  mirrorY?: boolean;
  mirrorZ?: boolean;
  // Per-object colour override
  color?: string;
  // Flags
  locked?: boolean; // prevent accidental moves/transforms
  // Computed
  boundingBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  selected?: boolean;
  // Per-object settings override (null keys inherit global print profile)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  perObjectSettings?: Record<string, any>;
  // Modifier mesh role — when set this object modifies slicing of other meshes
  // rather than being printed itself. Storage-only until engine support lands.
  modifierMeshRole?: ModifierMeshRole;
  modifierMeshSettings?: ModifierMeshSettings;
}

// -----------------------------------------------------------------------------
// Modifier Meshes (per-object mesh roles — storage scaffold)
// -----------------------------------------------------------------------------

export type ModifierMeshRole =
  | 'normal'          // regular printable object
  | 'infill_mesh'     // forces infill settings inside volume
  | 'cutting_mesh'    // subtracts geometry from overlapping objects
  | 'support_mesh'    // forces support generation inside volume
  | 'anti_overhang_mesh'; // prevents support generation inside volume

export interface ModifierMeshSettings {
  // Infill mesh overrides (active when role === 'infill_mesh')
  infillDensity?: number;
  infillPattern?: PrintProfile['infillPattern'];
  // Wall and skin overrides — apply inside an infill_mesh region.
  wallCount?: number;
  topLayers?: number;
  bottomLayers?: number;
  // Print-priority order for overlapping infill_mesh volumes.
  // Cura's `infillMeshOrder`: higher value wins on overlap. Defaults to 0
  // (matches Cura) so unset modifier meshes overlap deterministically by
  // declaration order.
  infillMeshOrder?: number;
  // Support mesh overrides (active when role === 'support_mesh')
  supportEnabled?: boolean;
  // Cutting mesh: no additional settings — volume defines subtraction region
  // Anti-overhang: no additional settings — volume defines blocked region
}

// -----------------------------------------------------------------------------
// Slicing Progress
// -----------------------------------------------------------------------------

export interface SliceProgress {
  stage: 'idle' | 'preparing' | 'slicing' | 'generating' | 'complete' | 'error';
  percent: number;
  currentLayer: number;
  totalLayers: number;
  message: string;
}

// -----------------------------------------------------------------------------
// Slice Result
// -----------------------------------------------------------------------------

export interface SliceResult {
  gcode: string;
  // Stats
  layerCount: number;
  printTime: number; // seconds
  filamentUsed: number; // mm
  filamentWeight: number; // grams
  filamentCost: number; // $
  // Per-layer data for preview
  layers: SliceLayer[];
  // Wall-clock slicer timings, used to find real bottlenecks without
  // changing geometry accuracy.
  slicingPerformance?: SlicePerformanceProfile;
}

export interface SlicePerformanceProfile {
  totalMs: number;
  layerPrepMode: 'sequential' | 'parallel' | 'merged';
  workerCount: number;
  triangleCount: number;
  layerCount: number;
  buckets: SliceTimingBucket[];
}

export interface SliceTimingBucket {
  key: string;
  label: string;
  ms: number;
  count: number;
}

// -----------------------------------------------------------------------------
// Single Layer Data for G-code Preview
// -----------------------------------------------------------------------------

export interface SliceLayer {
  z: number;
  layerIndex: number;
  moves: SliceMove[];
  layerTime: number; // seconds
}

// -----------------------------------------------------------------------------
// Individual Move in a Layer
// -----------------------------------------------------------------------------

export interface SliceMove {
  type: 'travel' | 'wall-outer' | 'wall-inner' | 'gap-fill' | 'infill' | 'top-bottom' | 'support' | 'skirt' | 'brim' | 'raft' | 'bridge' | 'ironing';
  from: { x: number; y: number };
  to: { x: number; y: number };
  speed: number; // mm/s
  extrusion: number; // mm of filament
  lineWidth: number;
  layerHeight?: number; // override extrusion layer height (raft sub-layers use per-section heights)
}
