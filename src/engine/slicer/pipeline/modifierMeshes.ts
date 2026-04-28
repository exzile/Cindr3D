import * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon, Ring as PCRing } from 'polygon-clipping';

import { booleanMultiPolygonClipper2Sync } from '../geometry/clipper2Boolean';
import { signedArea } from '../geometry/contourUtils';
import type {
  Contour,
  LayerModifierRegions,
  ModifierMesh,
} from '../../../types/slicer-pipeline.types';
import type { ModifierMeshSettings } from '../../../types/slicer';
import type { SlicerExecutionPipeline } from './execution/steps/types';

/**
 * Slice a single modifier mesh at a given Z, returning a 2D MultiPolygon
 * of its cross-section. Reuses the slicer's `sliceTrianglesAtZ +
 * connectSegments + classifyContours` chain so the math matches the
 * printable-mesh path exactly.
 *
 * Returns `null` when the mesh has no triangles intersecting `sliceZ`.
 */
export function sliceModifierMeshAtZ(
  slicer: SlicerExecutionPipeline,
  mesh: ModifierMesh,
  sliceZ: number,
  offsetX: number,
  offsetY: number,
  offsetZ: number,
): PCMultiPolygon | null {
  if (mesh.triangles.length === 0) return null;
  const segments = slicer.sliceTrianglesAtZ(mesh.triangles, sliceZ, offsetX, offsetY, offsetZ);
  if (segments.length === 0) return null;

  const rawContours = slicer.connectSegments(segments);
  if (rawContours.length === 0) return null;

  const classified = slicer.classifyContours(rawContours);
  if (classified.length === 0) return null;

  return contoursToMultiPolygon(classified, slicer);
}

/**
 * Convert classified Contour[] (outers + holes, parented by point-in-poly)
 * into a polygon-clipping MultiPolygon. Each outer carries the holes that
 * fall inside it.
 */
export function contoursToMultiPolygon(
  contours: Contour[],
  slicer: SlicerExecutionPipeline,
): PCMultiPolygon {
  const outers = contours.filter((c) => c.isOuter && c.points.length >= 3);
  const holes = contours.filter((c) => !c.isOuter && c.points.length >= 3);

  return outers.map((outer) => {
    const polygon: PCMultiPolygon[number] = [slicer.contourToClosedPCRing(outer.points)];
    for (const hole of holes) {
      if (slicer.pointInContour(hole.points[0], outer.points)) {
        polygon.push(slicer.contourToClosedPCRing(hole.points));
      }
    }
    return polygon;
  });
}

/**
 * Convert layer contours (already classified) to a printable-MP. Same
 * shape as `contoursToMultiPolygon` but takes the slicer's hole/outer
 * classification as already-correct.
 */
export function layerContoursToMultiPolygon(
  contours: Contour[],
  slicer: SlicerExecutionPipeline,
): PCMultiPolygon {
  return contoursToMultiPolygon(contours, slicer);
}

interface InfillOverrideEntry {
  region: PCMultiPolygon;
  settings: ModifierMeshSettings;
  meshIndex: number;
  order: number;
}

/**
 * For every modifier mesh, slice its cross-section at this layer and
 * group the results by role. Cutting/forced-support/blocked-support are
 * unioned across same-role meshes; infill overrides are kept per-mesh
 * (sorted descending by `infillMeshOrder` so higher-priority meshes win
 * on overlap, matching Cura's behavior).
 *
 * Returns `undefined` when no modifier mesh contributes geometry — that
 * lets callers skip the (per-layer) composition pass entirely.
 */
export function buildModifierRegionsForLayer(
  slicer: SlicerExecutionPipeline,
  modifierMeshes: ModifierMesh[] | undefined,
  sliceZ: number,
  offsetX: number,
  offsetY: number,
  offsetZ: number,
): LayerModifierRegions | undefined {
  if (!modifierMeshes || modifierMeshes.length === 0) return undefined;

  let cuttingMP: PCMultiPolygon = [];
  let forcedSupportMP: PCMultiPolygon = [];
  let blockedSupportMP: PCMultiPolygon = [];
  const infillOverrideEntries: InfillOverrideEntry[] = [];
  let touched = false;

  for (const mesh of modifierMeshes) {
    const mp = sliceModifierMeshAtZ(slicer, mesh, sliceZ, offsetX, offsetY, offsetZ);
    if (!mp || mp.length === 0) continue;
    touched = true;

    switch (mesh.role) {
      case 'cutting_mesh':
        cuttingMP = unionMP(cuttingMP, mp);
        break;
      case 'support_mesh':
        if (mesh.settings?.supportEnabled === false) break;
        forcedSupportMP = unionMP(forcedSupportMP, mp);
        break;
      case 'anti_overhang_mesh':
        blockedSupportMP = unionMP(blockedSupportMP, mp);
        break;
      case 'infill_mesh':
        infillOverrideEntries.push({
          region: mp,
          settings: mesh.settings ?? {},
          meshIndex: mesh.meshIndex,
          order: mesh.settings?.infillMeshOrder ?? 0,
        });
        break;
      case 'normal':
        break;
    }
  }

  if (!touched) return undefined;

  // Higher infillMeshOrder wins on overlap. Stable-sort so equal orders
  // resolve by declaration order (the meshIndex tiebreaker).
  infillOverrideEntries.sort((a, b) => (b.order - a.order) || (a.meshIndex - b.meshIndex));

  const regions: LayerModifierRegions = {};
  if (cuttingMP.length > 0) regions.cuttingMP = cuttingMP;
  if (forcedSupportMP.length > 0) regions.forcedSupportMP = forcedSupportMP;
  if (blockedSupportMP.length > 0) regions.blockedSupportMP = blockedSupportMP;
  if (infillOverrideEntries.length > 0) {
    regions.infillOverrides = infillOverrideEntries.map((entry) => ({
      region: entry.region,
      settings: entry.settings,
      meshIndex: entry.meshIndex,
    }));
  }
  return regions;
}

function unionMP(a: PCMultiPolygon, b: PCMultiPolygon): PCMultiPolygon {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const result = booleanMultiPolygonClipper2Sync(a, b, 'union');
  return result ?? a;
}

/**
 * Subtract `clip` from `subject` using Clipper2. Returns the subject
 * unchanged when `clip` is empty or the boolean op fails.
 */
export function subtractMP(subject: PCMultiPolygon, clip: PCMultiPolygon): PCMultiPolygon {
  if (clip.length === 0 || subject.length === 0) return subject;
  const result = booleanMultiPolygonClipper2Sync(subject, clip, 'difference');
  return result ?? subject;
}

function pcRingToVec2(ring: PCRing): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  // Closed ring: drop the duplicate-of-first endpoint to match the
  // Contour convention (open polyline with implicit closing edge).
  for (let i = 0; i < ring.length - 1; i++) pts.push(new THREE.Vector2(ring[i][0], ring[i][1]));
  return pts;
}

/**
 * Convert a polygon-clipping MultiPolygon into a flat `Contour[]` list,
 * matching the shape `prepareLayerGeometryState` produces from
 * `classifyContours`. Each polygon's first ring becomes an outer
 * contour, subsequent rings become hole contours.
 */
export function multiPolygonToContours(mp: PCMultiPolygon): Contour[] {
  const contours: Contour[] = [];
  for (const poly of mp) {
    if (poly.length === 0) continue;
    const outerPts = pcRingToVec2(poly[0]);
    if (outerPts.length >= 3) {
      contours.push({ points: outerPts, area: signedArea(outerPts), isOuter: true });
    }
    for (let i = 1; i < poly.length; i++) {
      const holePts = pcRingToVec2(poly[i]);
      if (holePts.length >= 3) {
        contours.push({ points: holePts, area: signedArea(holePts), isOuter: false });
      }
    }
  }
  return contours;
}

/**
 * Subtract a cutting_mesh region from the printable layer contours.
 * Builds the printable MultiPolygon from the layer's outers (with their
 * inside holes parented), runs Clipper2 difference, and returns a new
 * `Contour[]` list with the cut applied. Returns the input unchanged
 * when the cut fails or produces no material.
 */
export function applyCuttingMeshSubtraction(
  contours: Contour[],
  cuttingMP: PCMultiPolygon,
  slicer: SlicerExecutionPipeline,
): Contour[] {
  if (cuttingMP.length === 0 || contours.length === 0) return contours;
  const printableMP = layerContoursToMultiPolygon(contours, slicer);
  if (printableMP.length === 0) return contours;
  const result = booleanMultiPolygonClipper2Sync(printableMP, cuttingMP, 'difference');
  if (!result) return contours;
  return multiPolygonToContours(result);
}
