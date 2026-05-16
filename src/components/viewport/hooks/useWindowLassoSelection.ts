import { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { ViewportCtxState } from '../../../types/viewport-context-menu.types';

const _selBox3 = new THREE.Box3();
const _selVec3 = new THREE.Vector3();
const SKETCH_ENTITY_SAMPLE_COUNT = 48;
const PAINT_RADIUS = 15;

function pointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersect =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y + 1e-12) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ── Module-level helpers (reused by both handlePointerMove and handlePointerUp) ─

function projectToScreen(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
  rect: { width: number; height: number },
): { x: number; y: number } | null {
  _selVec3.copy(worldPos).project(camera);
  if (_selVec3.z > 1 || _selVec3.z < -1) return null;
  return {
    x: (_selVec3.x * 0.5 + 0.5) * rect.width,
    y: (1 - (_selVec3.y * 0.5 + 0.5)) * rect.height,
  };
}

type ActiveSketch = NonNullable<ReturnType<typeof useCADStore.getState>['activeSketch']>;
type AnyFeature = ReturnType<typeof useCADStore.getState>['features'][number];

function sampleSketchEntity(
  sketch: ActiveSketch,
  entity: ActiveSketch['entities'][number],
  camera: THREE.Camera,
  rect: { width: number; height: number },
): Array<{ x: number; y: number }> {
  const projected: Array<{ x: number; y: number }> = [];

  const pushWorldPoint = (pt: THREE.Vector3) => {
    const sp = projectToScreen(pt, camera, rect);
    if (sp) projected.push(sp);
  };
  const pushSketchPoint = (pt: { x: number; y: number; z: number }) => {
    pushWorldPoint(new THREE.Vector3(pt.x, pt.y, pt.z));
  };
  const pushSegmentSamples = (start: THREE.Vector3, end: THREE.Vector3, samples = 12) => {
    for (let i = 0; i <= samples; i += 1) {
      pushWorldPoint(start.clone().lerp(end, i / samples));
    }
  };

  if (entity.points.length === 0) return projected;

  if (entity.type === 'rectangle' && entity.points.length >= 2) {
    const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
    const p1 = new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z);
    const p2 = new THREE.Vector3(entity.points[1].x, entity.points[1].y, entity.points[1].z);
    const delta = p2.clone().sub(p1);
    const dt1 = t1.clone().multiplyScalar(delta.dot(t1));
    const dt2 = t2.clone().multiplyScalar(delta.dot(t2));
    const corners = [p1, p1.clone().add(dt1), p1.clone().add(dt1).add(dt2), p1.clone().add(dt2)];
    for (let i = 0; i < corners.length; i += 1) {
      pushSegmentSamples(corners[i], corners[(i + 1) % corners.length]);
    }
    return projected;
  }

  if (entity.type === 'circle' || entity.type === 'arc' || entity.type === 'ellipse' || entity.type === 'elliptical-arc') {
    const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
    const center = new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z);
    const start = entity.type === 'circle' || entity.type === 'ellipse' ? 0 : entity.startAngle ?? 0;
    const end = entity.type === 'circle' || entity.type === 'ellipse' ? Math.PI * 2 : entity.endAngle ?? Math.PI;
    const major = entity.type === 'ellipse' || entity.type === 'elliptical-arc' ? entity.majorRadius ?? 1 : entity.radius ?? 1;
    const minor = entity.type === 'ellipse' || entity.type === 'elliptical-arc' ? entity.minorRadius ?? 0.5 : entity.radius ?? 1;
    const rotation = entity.rotation ?? 0;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    for (let i = 0; i <= SKETCH_ENTITY_SAMPLE_COUNT; i += 1) {
      const angle = start + (i / SKETCH_ENTITY_SAMPLE_COUNT) * (end - start);
      const u = major * Math.cos(angle) * cosR - minor * Math.sin(angle) * sinR;
      const v = major * Math.cos(angle) * sinR + minor * Math.sin(angle) * cosR;
      pushWorldPoint(center.clone().addScaledVector(t1, u).addScaledVector(t2, v));
    }
    return projected;
  }

  if (entity.points.length >= 2) {
    for (let i = 1; i < entity.points.length; i += 1) {
      pushSegmentSamples(
        new THREE.Vector3(entity.points[i - 1].x, entity.points[i - 1].y, entity.points[i - 1].z),
        new THREE.Vector3(entity.points[i].x, entity.points[i].y, entity.points[i].z),
      );
    }
  } else {
    entity.points.forEach(pushSketchPoint);
  }
  return projected;
}

function projectedFeatureCentroid(
  feature: AnyFeature,
  camera: THREE.Camera,
  rect: { width: number; height: number },
): { x: number; y: number } | null {
  if (!feature.mesh || !feature.visible) return null;
  _selBox3.setFromObject(feature.mesh);
  if (_selBox3.isEmpty()) return null;
  _selBox3.getCenter(_selVec3);
  return projectToScreen(_selVec3, camera, rect);
}

// ─────────────────────────────────────────────────────────────────────────────

export function useWindowLassoSelection() {
  const activeTool = useCADStore((s) => s.activeTool);
  const selectionMode = useCADStore((s) => s.selectionMode);
  const setWindowSelectStart = useCADStore((s) => s.setWindowSelectStart);
  const setWindowSelectEnd = useCADStore((s) => s.setWindowSelectEnd);
  const clearWindowSelect = useCADStore((s) => s.clearWindowSelect);
  const setSelectedEntityIds = useCADStore((s) => s.setSelectedEntityIds);
  const setLassoSelecting = useCADStore((s) => s.setLassoSelecting);
  const setLassoPoints = useCADStore((s) => s.setLassoPoints);
  const clearLasso = useCADStore((s) => s.clearLasso);

  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const isLassoRef = useRef(false);
  const isPaintRef = useRef(false);
  const lassoAccumRef = useRef<{ x: number; y: number }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const rightDownRef = useRef<{ x: number; y: number } | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const [viewportCtxMenu, setViewportCtxMenu] = useState<ViewportCtxState | null>(null);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 2) {
      rightDownRef.current = { x: event.clientX, y: event.clientY };
    }
    if (activeTool !== 'select') return;
    if (event.button !== 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    dragStartRef.current = point;
    isDraggingRef.current = false;
    isPaintRef.current = selectionMode === 'paint';
    // lasso mode: selectionMode='lasso' OR shift held in normal/window modes
    isLassoRef.current = !isPaintRef.current && (selectionMode === 'lasso' || event.shiftKey);
    lassoAccumRef.current = [point];
  }, [activeTool, selectionMode]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const dx = point.x - dragStartRef.current.x;
    const dy = point.y - dragStartRef.current.y;

    if (!isDraggingRef.current) {
      if (Math.sqrt(dx * dx + dy * dy) < 5) return;
      isDraggingRef.current = true;
      if (isPaintRef.current) {
        // Paint mode starts immediately — no overlay needed
      } else if (isLassoRef.current) {
        setLassoSelecting(true);
        setLassoPoints([dragStartRef.current, point]);
        lassoAccumRef.current = [dragStartRef.current, point];
      } else {
        setWindowSelectStart(dragStartRef.current);
      }
    } else if (isPaintRef.current) {
      // ── Paint selection: incrementally hit-test and add entities/features ──
      const camera = cameraRef.current;
      if (!camera) return;
      const { activeSketch, features, selectedEntityIds } = useCADStore.getState();
      const newIds: string[] = [];
      const nearCursor = (p: { x: number; y: number }) =>
        Math.hypot(p.x - point.x, p.y - point.y) < PAINT_RADIUS;

      if (activeSketch) {
        for (const entity of activeSketch.entities) {
          if (selectedEntityIds.includes(entity.id)) continue;
          const samples = sampleSketchEntity(activeSketch, entity, camera, rect);
          if (samples.some(nearCursor)) newIds.push(entity.id);
        }
      } else {
        for (const feature of features) {
          if (selectedEntityIds.includes(feature.id)) continue;
          const sp = projectedFeatureCentroid(feature, camera, rect);
          if (sp && nearCursor(sp)) newIds.push(feature.id);
        }
      }

      if (newIds.length > 0) {
        setSelectedEntityIds(Array.from(new Set([...selectedEntityIds, ...newIds])));
      }
    } else if (isLassoRef.current) {
      lassoAccumRef.current = [...lassoAccumRef.current, point];
      setLassoPoints(lassoAccumRef.current);
    } else {
      setWindowSelectEnd(point);
    }
  }, [setWindowSelectStart, setWindowSelectEnd, setLassoSelecting, setLassoPoints, setSelectedEntityIds]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    if (isDraggingRef.current) {
      const camera = cameraRef.current;

      if (isPaintRef.current) {
        // Paint: selection was applied incrementally — nothing to do on release
      } else {
        const mergeIds = (matchedIds: string[], additive: boolean) => {
          const { selectedEntityIds } = useCADStore.getState();
          if (!additive) return matchedIds;
          return Array.from(new Set([...selectedEntityIds, ...matchedIds]));
        };

        const { activeSketch, features, windowSelectStart } = useCADStore.getState();
        const additive = event.ctrlKey || event.metaKey;

        if (isLassoRef.current) {
          const polygon = lassoAccumRef.current;
          if (polygon.length >= 3 && activeSketch && camera) {
            const matchedIds = activeSketch.entities
              .filter((entity) => sampleSketchEntity(activeSketch, entity, camera, rect).some((sp) => pointInPolygon(sp, polygon)))
              .map((entity) => entity.id);
            setSelectedEntityIds(mergeIds(matchedIds, additive));
          } else if (polygon.length >= 3 && camera) {
            const matched = features.filter((feature) => {
              const sp = projectedFeatureCentroid(feature, camera, rect);
              return sp !== null && pointInPolygon(sp, polygon);
            });
            setSelectedEntityIds(mergeIds(matched.map((f) => f.id), additive));
          }
          clearLasso();
        } else {
          if (windowSelectStart && camera) {
            const minX = Math.min(windowSelectStart.x, point.x);
            const maxX = Math.max(windowSelectStart.x, point.x);
            const minY = Math.min(windowSelectStart.y, point.y);
            const maxY = Math.max(windowSelectStart.y, point.y);
            if (activeSketch) {
              const matchedIds = activeSketch.entities
                .filter((entity) => sampleSketchEntity(activeSketch, entity, camera, rect).some((sp) => (
                  sp.x >= minX && sp.x <= maxX && sp.y >= minY && sp.y <= maxY
                )))
                .map((entity) => entity.id);
              setSelectedEntityIds(mergeIds(matchedIds, additive));
            } else {
              const matched = features.filter((feature) => {
                const sp = projectedFeatureCentroid(feature, camera, rect);
                return sp !== null && sp.x >= minX && sp.x <= maxX && sp.y >= minY && sp.y <= maxY;
              });
              setSelectedEntityIds(mergeIds(matched.map((f) => f.id), additive));
            }
          }
          clearWindowSelect();
        }
      }
    }

    dragStartRef.current = null;
    isDraggingRef.current = false;
    isPaintRef.current = false;
    lassoAccumRef.current = [];
  }, [setSelectedEntityIds, clearWindowSelect, clearLasso]);

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const down = rightDownRef.current;
    rightDownRef.current = null;
    if (down) {
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (moved > 5) return;
    }
    setViewportCtxMenu({ x: event.clientX, y: event.clientY });
  }, []);

  return {
    cameraRef,
    containerRef,
    handleContextMenu,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    setViewportCtxMenu,
    viewportCtxMenu,
  };
}
