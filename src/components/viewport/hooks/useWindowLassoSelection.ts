import { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import type { ViewportCtxState } from '../../../types/viewport-context-menu.types';

const _selBox3 = new THREE.Box3();
const _selVec3 = new THREE.Vector3();

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

export function useWindowLassoSelection() {
  const activeTool = useCADStore((s) => s.activeTool);
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
    isLassoRef.current = event.shiftKey;
    lassoAccumRef.current = [point];
  }, [activeTool]);

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
      if (isLassoRef.current) {
        setLassoSelecting(true);
        setLassoPoints([dragStartRef.current, point]);
        lassoAccumRef.current = [dragStartRef.current, point];
      } else {
        setWindowSelectStart(dragStartRef.current);
      }
    } else if (isLassoRef.current) {
      lassoAccumRef.current = [...lassoAccumRef.current, point];
      setLassoPoints(lassoAccumRef.current);
    } else {
      setWindowSelectEnd(point);
    }
  }, [setWindowSelectStart, setWindowSelectEnd, setLassoSelecting, setLassoPoints]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    if (isDraggingRef.current) {
      const camera = cameraRef.current;
      const projectToScreen = (worldPos: THREE.Vector3): { x: number; y: number } | null => {
        if (!camera) return null;
        _selVec3.copy(worldPos).project(camera);
        if (_selVec3.z > 1 || _selVec3.z < -1) return null;
        return {
          x: (_selVec3.x * 0.5 + 0.5) * rect.width,
          y: (1 - (_selVec3.y * 0.5 + 0.5)) * rect.height,
        };
      };

      type AnyFeature = ReturnType<typeof useCADStore.getState>['features'][number];
      const projectedFeatureCentroid = (feature: AnyFeature): { x: number; y: number } | null => {
        if (!feature.mesh || !feature.visible) return null;
        _selBox3.setFromObject(feature.mesh);
        if (_selBox3.isEmpty()) return null;
        _selBox3.getCenter(_selVec3);
        return projectToScreen(_selVec3);
      };

      const { features, windowSelectStart } = useCADStore.getState();

      if (isLassoRef.current) {
        const polygon = lassoAccumRef.current;
        const matched = polygon.length >= 3
          ? features.filter((feature) => {
              const screenPoint = projectedFeatureCentroid(feature);
              return screenPoint !== null && pointInPolygon(screenPoint, polygon);
            })
          : [];
        setSelectedEntityIds(matched.map((feature) => feature.id));
        clearLasso();
      } else {
        if (windowSelectStart) {
          const minX = Math.min(windowSelectStart.x, point.x);
          const maxX = Math.max(windowSelectStart.x, point.x);
          const minY = Math.min(windowSelectStart.y, point.y);
          const maxY = Math.max(windowSelectStart.y, point.y);
          const matched = features.filter((feature) => {
            const screenPoint = projectedFeatureCentroid(feature);
            return screenPoint !== null && screenPoint.x >= minX && screenPoint.x <= maxX && screenPoint.y >= minY && screenPoint.y <= maxY;
          });
          setSelectedEntityIds(matched.map((feature) => feature.id));
        }
        clearWindowSelect();
      }
    }

    dragStartRef.current = null;
    isDraggingRef.current = false;
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
