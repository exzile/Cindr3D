import { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import { isGizmoDragging } from '../scene/gizmoDragGuard';
import type { ViewportCtxState } from '../../../types/viewport-context-menu.types';

const _selBox3 = new THREE.Box3();
const _selVec3 = new THREE.Vector3();
// Scratch vectors reused across sampleSketchEntity calls — avoids per-sample allocs
const _samplePt = new THREE.Vector3();
const _sampleA  = new THREE.Vector3();
const _sampleB  = new THREE.Vector3();
const _sampleC  = new THREE.Vector3(); // rectangle corner c1
const _sampleD  = new THREE.Vector3(); // rectangle corner c2/c3
const SKETCH_ENTITY_SAMPLE_COUNT = 48;
const PAINT_RADIUS = 15;
// Module-level flag for the active gesture — safe as singleton because there is only one Viewport.
let _isWindowGesture = false;

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
    pushWorldPoint(_samplePt.set(pt.x, pt.y, pt.z));
  };
  // Uses _samplePt as scratch — safe because pushWorldPoint only reads it.
  const pushSegmentSamples = (start: THREE.Vector3, end: THREE.Vector3, samples = 12) => {
    for (let i = 0; i <= samples; i += 1) {
      pushWorldPoint(_samplePt.lerpVectors(start, end, i / samples));
    }
  };

  if (entity.points.length === 0) return projected;

  if (entity.type === 'rectangle' && entity.points.length >= 2) {
    const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
    const p0 = entity.points[0]; const p1e = entity.points[1];
    _sampleA.set(p0.x, p0.y, p0.z);
    _sampleB.set(p1e.x, p1e.y, p1e.z);
    const dx = _sampleB.x - _sampleA.x; const dy = _sampleB.y - _sampleA.y; const dz = _sampleB.z - _sampleA.z;
    const dt1x = t1.x * (dx * t1.x + dy * t1.y + dz * t1.z);
    const dt1y = t1.y * (dx * t1.x + dy * t1.y + dz * t1.z);
    const dt1z = t1.z * (dx * t1.x + dy * t1.y + dz * t1.z);
    const dt2x = t2.x * (dx * t2.x + dy * t2.y + dz * t2.z);
    const dt2y = t2.y * (dx * t2.x + dy * t2.y + dz * t2.z);
    const dt2z = t2.z * (dx * t2.x + dy * t2.y + dz * t2.z);
    // Reuse module-level scratch vectors — _sampleB is safe to overwrite here
    // because dx/dy/dz were already extracted from it above.
    const c0 = _sampleA;
    const c1 = _sampleB.set(_sampleA.x + dt1x, _sampleA.y + dt1y, _sampleA.z + dt1z);
    const c2 = _sampleC.set(_sampleA.x + dt1x + dt2x, _sampleA.y + dt1y + dt2y, _sampleA.z + dt1z + dt2z);
    const c3 = _sampleD.set(_sampleA.x + dt2x, _sampleA.y + dt2y, _sampleA.z + dt2z);
    pushSegmentSamples(c0, c1); pushSegmentSamples(c1, c2);
    pushSegmentSamples(c2, c3); pushSegmentSamples(c3, c0);
    return projected;
  }

  if (entity.type === 'circle' || entity.type === 'arc' || entity.type === 'ellipse' || entity.type === 'elliptical-arc') {
    const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
    const ep0 = entity.points[0];
    _sampleA.set(ep0.x, ep0.y, ep0.z); // center — never mutated below
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
      pushWorldPoint(_samplePt.copy(_sampleA).addScaledVector(t1, u).addScaledVector(t2, v));
    }
    return projected;
  }

  if (entity.points.length >= 2) {
    for (let i = 1; i < entity.points.length; i += 1) {
      const prev = entity.points[i - 1]; const curr = entity.points[i];
      pushSegmentSamples(
        _sampleA.set(prev.x, prev.y, prev.z),
        _sampleB.set(curr.x, curr.y, curr.z),
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
    // An on-canvas gizmo arrow is being dragged — don't begin a marquee.
    if (isGizmoDragging()) return;
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
    // lasso mode: selectionMode='lasso' OR shift held in any mode
    isLassoRef.current = !isPaintRef.current && (selectionMode === 'lasso' || event.shiftKey);
    // window box-marquee is OPT-IN: only when the user explicitly picked the
    // 'window' selection mode. In 'normal' mode a bare drag must NOT draw a
    // selection box (it's just a click-through / camera move).
    _isWindowGesture = !isPaintRef.current && !isLassoRef.current && selectionMode === 'window';
    lassoAccumRef.current = [point];
  }, [activeTool, selectionMode]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Defense-in-depth: if a gizmo drag started (regardless of R3F-vs-React
    // event ordering on the initiating pointerdown), never draw a marquee.
    if (isGizmoDragging()) return;
    if (!dragStartRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const dx = point.x - dragStartRef.current.x;
    const dy = point.y - dragStartRef.current.y;

    if (!isDraggingRef.current) {
      if (Math.sqrt(dx * dx + dy * dy) < 5) return;
      // Normal mode (no paint/lasso/window): a drag is NOT a marquee. Abort
      // the gesture so no selection box is drawn and pointer-up is a no-op.
      if (!isPaintRef.current && !isLassoRef.current && !_isWindowGesture) {
        dragStartRef.current = null;
        return;
      }
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
    if (isGizmoDragging()) { dragStartRef.current = null; isDraggingRef.current = false; return; }
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
    _isWindowGesture = false;
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
