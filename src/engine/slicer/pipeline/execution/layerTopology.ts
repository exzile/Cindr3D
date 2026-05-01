import * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon, Ring as PCRing } from 'polygon-clipping';
import type {
  LayerTopology,
  LayerTopologyOptions,
} from '../../../../types/slicer-pipeline-layer-topology.types';

import { booleanMultiPolygonClipper2Sync } from '../../geometry/clipper2Boolean';
import type { Contour } from '../../../../types/slicer-pipeline.types';

function optimizeContourOrder(
  contours: Contour[],
  currentX: number,
  currentY: number,
): Contour[] {
  const outers = contours.filter((c) => c.isOuter);
  const holes = contours.filter((c) => !c.isOuter);
  const centroids = outers.map((c) => ({
    cx: c.points.reduce((sum, point) => sum + point.x, 0) / c.points.length,
    cy: c.points.reduce((sum, point) => sum + point.y, 0) / c.points.length,
  }));
  const visited = new Uint8Array(outers.length);
  const ordered: Contour[] = [];
  let refX = currentX;
  let refY = currentY;
  for (let i = 0; i < outers.length; i++) {
    let best = -1;
    let bestDistance = Infinity;
    for (let j = 0; j < outers.length; j++) {
      if (visited[j]) continue;
      const distance = Math.hypot(centroids[j].cx - refX, centroids[j].cy - refY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = j;
      }
    }
    visited[best] = 1;
    ordered.push(outers[best]);
    refX = centroids[best].cx;
    refY = centroids[best].cy;
  }
  return [...ordered, ...holes];
}

function buildHoleMap(
  workContours: Contour[],
  allContours: Contour[],
  pointInContour: (point: THREE.Vector2, contour: THREE.Vector2[]) => boolean,
): Map<Contour, THREE.Vector2[][]> {
  const holesByOuterContour = new Map<Contour, THREE.Vector2[][]>();
  for (const contour of workContours) {
    if (!contour.isOuter) continue;
    const holes: THREE.Vector2[][] = [];
    for (const holeContour of allContours) {
      if (holeContour.isOuter || holeContour.points.length < 3) continue;
      if (pointInContour(holeContour.points[0], contour.points)) {
        holes.push(holeContour.points);
      }
    }
    holesByOuterContour.set(contour, holes);
  }
  return holesByOuterContour;
}

export function buildLayerMaterialFromContours(
  contours: Contour[],
  pointInContour: (point: THREE.Vector2, contour: THREE.Vector2[]) => boolean,
): PCMultiPolygon {
  // Lightweight wrapper used by the `layerMaterialCache` pre-pass in
  // `runSlicePipeline.ts`: build the layer's material polygon from a
  // raw contour list (no walls/infill/topology needed). Mirrors what
  // `buildLayerTopology` does internally, but skipping the contour
  // reordering and bridge-region work.
  const holesByOuterContour = buildHoleMap(contours, contours, pointInContour);
  return buildLayerMaterial(contours, holesByOuterContour);
}

function buildLayerMaterial(
  workContours: Contour[],
  holesByOuterContour: Map<Contour, THREE.Vector2[][]>,
): PCMultiPolygon {
  const currentLayerMaterial: PCMultiPolygon = [];
  for (const contour of workContours) {
    if (!contour.isOuter || contour.points.length < 3) continue;
    const polygon: THREE.Vector2[][] = [contour.points];
    const contourHoles = holesByOuterContour.get(contour) ?? [];
    for (const hole of contourHoles) polygon.push(hole);
    const pcPolygon = polygon.map((ring): PCRing => {
      const closedRing: PCRing = ring.map((point) => [point.x, point.y] as [number, number]);
      if (closedRing.length > 0) {
        const first = closedRing[0];
        const last = closedRing[closedRing.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          closedRing.push([first[0], first[1]]);
        }
      }
      return closedRing;
    });
    currentLayerMaterial.push(pcPolygon);
  }
  return currentLayerMaterial;
}

function buildBridgeRegionChecker(
  currentLayerMaterial: PCMultiPolygon,
  previousLayerMaterial: PCMultiPolygon,
  isFirstLayer: boolean,
  pointInRing: (x: number, y: number, ring: PCRing) => boolean,
): { hasBridgeRegions: boolean; isInBridgeRegion: (x: number, y: number) => boolean } {
  let bridgeMultiPolygon: PCMultiPolygon = [];
  if (!isFirstLayer && currentLayerMaterial.length > 0 && previousLayerMaterial.length > 0) {
    try {
      // ARACHNE-9.4A.4: worker awaits Clipper2 load — null here means a
      // contract violation, not a transient miss. Catch handles it as
      // empty bridge region (degenerate layer).
      const result = booleanMultiPolygonClipper2Sync(
        currentLayerMaterial, previousLayerMaterial, 'difference',
      );
      if (result === null) throw new Error('layerTopology: Clipper2 WASM not loaded');
      bridgeMultiPolygon = result;
    } catch {
      bridgeMultiPolygon = [];
    }
  }

  const bridgeBoxes: Array<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    polygon: PCMultiPolygon[number];
  }> = [];

  for (const polygon of bridgeMultiPolygon) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const ring of polygon) {
      for (const point of ring) {
        if (point[0] < minX) minX = point[0];
        if (point[0] > maxX) maxX = point[0];
        if (point[1] < minY) minY = point[1];
        if (point[1] > maxY) maxY = point[1];
      }
    }
    bridgeBoxes.push({ minX, maxX, minY, maxY, polygon });
  }

  return {
    hasBridgeRegions: bridgeBoxes.length > 0,
    isInBridgeRegion: (x: number, y: number): boolean => {
      for (const box of bridgeBoxes) {
        if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) continue;
        const outerRing = box.polygon[0];
        if (!pointInRing(x, y, outerRing)) continue;
        let insideHole = false;
        for (let i = 1; i < box.polygon.length; i++) {
          if (pointInRing(x, y, box.polygon[i])) {
            insideHole = true;
            break;
          }
        }
        if (!insideHole) return true;
      }
      return false;
    },
  };
}

function ringSignedArea(ring: PCRing): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[i + 1];
    s += ax * by - bx * ay;
  }
  return s * 0.5;
}

function ringPerimeter(ring: PCRing): number {
  let p = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[i + 1];
    p += Math.hypot(bx - ax, by - ay);
  }
  return p;
}

/**
 * Drop polygons from `mp` whose `2·|area| / perimeter` (≈ minimum
 * thickness) is below `minThickness`. Tessellation noise on curved
 * walls produces long thin slivers in the `current − next` difference;
 * this filter removes those without affecting genuine feature-tops
 * (which always have non-trivial thickness in both axes).
 */
function filterSliversFromMultiPolygon(
  mp: PCMultiPolygon,
  minThickness: number,
): PCMultiPolygon {
  if (minThickness <= 0) return mp;
  const out: PCMultiPolygon = [];
  for (const poly of mp) {
    if (poly.length === 0) continue;
    const outerRing = poly[0];
    if (outerRing.length < 4) continue;
    let area = Math.abs(ringSignedArea(outerRing));
    let perim = ringPerimeter(outerRing);
    for (let i = 1; i < poly.length; i++) {
      area -= Math.abs(ringSignedArea(poly[i]));
      perim += ringPerimeter(poly[i]);
    }
    if (perim < 1e-9 || area < 1e-9) continue;
    const thickness = (2 * area) / perim;
    if (thickness >= minThickness) out.push(poly);
  }
  return out;
}

function buildTopSkinRegion(
  currentLayerMaterial: PCMultiPolygon,
  nextLayerMaterial: PCMultiPolygon | undefined,
  sliverThickness: number,
): PCMultiPolygon {
  // Per-feature top-skin: regions where THIS layer has material but the
  // layer above does NOT. These get promoted to solid skin even when the
  // layer isn't part of the global `solidTop` band — equivalent to
  // OrcaSlicer's `top_surfaces = current_material − next_material` in
  // `PrintObject::discover_vertical_shells`.
  //
  // Tessellation noise on curved walls (cones, spheres, cylinders)
  // produces long thin slivers along the wall in the `current − next`
  // difference, even when the geometry has no genuine feature-top at
  // that point. We filter those out by polygon thickness — anything
  // below `sliverThickness` (typically ~1.5 × lineWidth) is treated as
  // noise and dropped.
  if (!nextLayerMaterial || nextLayerMaterial.length === 0) return [];
  if (currentLayerMaterial.length === 0) return [];
  let raw: PCMultiPolygon;
  try {
    const result = booleanMultiPolygonClipper2Sync(
      currentLayerMaterial, nextLayerMaterial, 'difference',
    );
    if (result === null) throw new Error('layerTopology: Clipper2 WASM not loaded');
    raw = result;
  } catch {
    return [];
  }
  return filterSliversFromMultiPolygon(raw, sliverThickness);
}

export function buildLayerTopology({
  contours,
  optimizeWallOrder,
  currentX,
  currentY,
  previousLayerMaterial,
  nextLayerMaterial,
  topSkinSliverThickness,
  isFirstLayer,
  pointInContour,
  pointInRing,
}: LayerTopologyOptions): LayerTopology {
  const workContours = optimizeWallOrder
    ? optimizeContourOrder(contours, currentX, currentY)
    : contours;
  const holesByOuterContour = buildHoleMap(workContours, contours, pointInContour);
  const currentLayerMaterial = buildLayerMaterial(workContours, holesByOuterContour);
  const bridgeRegions = buildBridgeRegionChecker(
    currentLayerMaterial,
    previousLayerMaterial,
    isFirstLayer,
    pointInRing,
  );
  const topSkinRegion = buildTopSkinRegion(
    currentLayerMaterial,
    nextLayerMaterial,
    topSkinSliverThickness ?? 0,
  );
  return {
    workContours,
    holesByOuterContour,
    currentLayerMaterial,
    topSkinRegion,
    hasBridgeRegions: bridgeRegions.hasBridgeRegions,
    isInBridgeRegion: bridgeRegions.isInBridgeRegion,
  };
}
