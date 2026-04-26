import * as THREE from 'three';
import polygonClipping, { type MultiPolygon as PCMultiPolygon, type Ring as PCRing } from 'polygon-clipping';
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
      bridgeMultiPolygon = booleanMultiPolygonClipper2Sync(
        currentLayerMaterial,
        previousLayerMaterial,
        'difference',
      ) ?? polygonClipping.difference(currentLayerMaterial, previousLayerMaterial);
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

export function buildLayerTopology({
  contours,
  optimizeWallOrder,
  currentX,
  currentY,
  previousLayerMaterial,
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
  return {
    workContours,
    holesByOuterContour,
    currentLayerMaterial,
    hasBridgeRegions: bridgeRegions.hasBridgeRegions,
    isInBridgeRegion: bridgeRegions.isInBridgeRegion,
  };
}
