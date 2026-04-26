import * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon, Ring as PCRing } from 'polygon-clipping';

import { booleanPathsClipper2Sync } from './clipper2Wasm';

type BooleanOp = 'union' | 'intersection' | 'difference' | 'xor';

function ringToPath(ring: PCRing): THREE.Vector2[] {
  const end = ring.length >= 2
    && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1
    : ring.length;
  const path: THREE.Vector2[] = [];
  for (let i = 0; i < end; i++) path.push(new THREE.Vector2(ring[i][0], ring[i][1]));
  return path;
}

function pathToRing(path: THREE.Vector2[]): PCRing {
  const ring: PCRing = path.map((point) => [point.x, point.y] as [number, number]);
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  }
  return ring;
}

function signedArea(path: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    area += path[j].x * path[i].y - path[i].x * path[j].y;
  }
  return area / 2;
}

function pointInPath(point: THREE.Vector2, path: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const pi = path[i];
    const pj = path[j];
    if (
      pi.y > point.y !== pj.y > point.y
      && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function multiPolygonToPaths(mp: PCMultiPolygon): THREE.Vector2[][] {
  const paths: THREE.Vector2[][] = [];
  for (const polygon of mp) {
    for (const ring of polygon) {
      const path = ringToPath(ring);
      if (path.length >= 3) paths.push(path);
    }
  }
  return paths;
}

function pathsToMultiPolygon(paths: THREE.Vector2[][]): PCMultiPolygon {
  const rings = paths
    .filter((path) => path.length >= 3)
    .map((path) => ({ path, area: signedArea(path) }))
    .sort((a, b) => Math.abs(b.area) - Math.abs(a.area));

  const polygons: Array<{ outer: THREE.Vector2[]; holes: THREE.Vector2[][] }> = [];
  const pendingHoles: THREE.Vector2[][] = [];

  for (const ring of rings) {
    const isHole = ring.area < 0;
    if (!isHole) {
      polygons.push({ outer: ring.path, holes: [] });
      continue;
    }

    const parent = polygons.find((polygon) => pointInPath(ring.path[0], polygon.outer));
    if (parent) parent.holes.push(ring.path);
    else pendingHoles.push(ring.path);
  }

  for (const hole of pendingHoles) {
    const parent = polygons.find((polygon) => pointInPath(hole[0], polygon.outer));
    if (parent) parent.holes.push(hole);
  }

  if (polygons.length === 0 && rings.length > 0) {
    return rings.map((ring) => [pathToRing(ring.path)]);
  }

  return polygons.map((polygon) => [
    pathToRing(polygon.outer),
    ...polygon.holes.map(pathToRing),
  ]);
}

export function booleanMultiPolygonClipper2Sync(
  subjects: PCMultiPolygon,
  clips: PCMultiPolygon,
  op: BooleanOp,
): PCMultiPolygon | null {
  const paths = booleanPathsClipper2Sync(
    multiPolygonToPaths(subjects),
    multiPolygonToPaths(clips),
    op,
  );
  return paths ? pathsToMultiPolygon(paths) : null;
}
