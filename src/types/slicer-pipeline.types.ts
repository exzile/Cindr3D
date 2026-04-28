import type * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon } from 'polygon-clipping';
import type { ModifierMeshRole, ModifierMeshSettings } from './slicer/profiles/results';

/**
 * A modifier mesh is a per-object volume that adjusts how OTHER meshes
 * are sliced, rather than being printed itself. Cura/Orca call these
 * "Infill Mesh", "Cutting Mesh", "Support Mesh", and "Anti-Overhang
 * Mesh". The slicer keeps modifier meshes separate from printable
 * meshes; per-layer composition is what makes them affect the print.
 */
export interface ModifierMesh {
  role: ModifierMeshRole;
  triangles: Triangle[];
  settings?: ModifierMeshSettings;
  /** Index of this modifier in the SliceRun.modifierMeshes array. */
  meshIndex: number;
}

/**
 * Per-layer 2D regions contributed by modifier meshes. Computed in
 * `prepareLayerGeometryState` after the printable contours are built;
 * consumed downstream by walls/infill/support emission.
 */
export interface LayerModifierRegions {
  /** Multi-polygon to subtract from printable contours (cutting_mesh). */
  cuttingMP?: PCMultiPolygon;
  /** Forced support volume (support_mesh) — union over all support meshes. */
  forcedSupportMP?: PCMultiPolygon;
  /** Anti-overhang region (anti_overhang_mesh) — subtracted from support. */
  blockedSupportMP?: PCMultiPolygon;
  /** Per infill_mesh region with its overrides. Higher infillMeshOrder wins. */
  infillOverrides?: Array<{ region: PCMultiPolygon; settings: ModifierMeshSettings; meshIndex: number }>;
}

export interface Triangle {
  v0: THREE.Vector3;
  v1: THREE.Vector3;
  v2: THREE.Vector3;
  normal: THREE.Vector3;
  edgeKey01: string;
  edgeKey12: string;
  edgeKey20: string;
}

export interface Segment {
  a: THREE.Vector2;
  b: THREE.Vector2;
  edgeKeyA: string;
  edgeKeyB: string;
}

export interface Contour {
  points: THREE.Vector2[];
  area: number;
  isOuter: boolean;
}

export interface BBox2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface InfillRegion {
  contour: THREE.Vector2[];
  holes: THREE.Vector2[][];
}

export type WallLineWidth = number | number[];

export interface GeneratedPerimeters {
  walls: THREE.Vector2[][];
  lineWidths: WallLineWidth[];
  /** Parallel to `walls`. False for medial-axis branch/gap-fill paths that
   *  terminate inside a thin feature instead of forming a closed loop. */
  wallClosed?: boolean[];
  /** Parallel to `walls`. The wall offset depth: 0 = outermost wall of its
   *  contour (this is a `wall-outer` move type), 1+ = inner walls. The
   *  outermost wall of the OUTER contour AND the outermost wall of every
   *  hole are both depth-0 (each is the first wall encountered when crossing
   *  from air into model material). The wall-emission step uses this to
   *  correctly tag hole walls so they render in the outer colour next to
   *  the empty hole instead of the inner colour. */
  wallDepths: number[];
  /** Parallel to `walls`. Where each wall came from in the Arachne path
   *  classification: `'outer'` = wall around the outer contour,
   *  `'hole'` = wall around a hole, `'gapfill'` = medial-axis bead in a
   *  region too narrow for a full wall. Emit step routes `'gapfill'`
   *  entries through the `gap-fill` move type so previews and downstream
   *  bridge/retract logic can treat them differently from real walls.
   *  Optional — the classic generator omits it (everything is a wall). */
  wallSources?: Array<'outer' | 'hole' | 'gapfill'>;
  outerCount: number;
  innermostHoles: THREE.Vector2[][];
  infillRegions: InfillRegion[];
}
