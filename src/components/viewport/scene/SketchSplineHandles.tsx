/**
 * S10 — SketchSplineHandles
 *
 * Renders draggable sphere handles at each control point of every spline
 * entity in the active sketch. Only visible when activeTool === 'select'.
 * Drag interaction updates control-point positions via updateSplineControlPoint.
 *
 * Key implementation rules (from memory):
 *  - Drag state lives in useRef (not useState) to avoid stale closures.
 *  - No new THREE.* allocations inside event handlers — use module-level scratch vars.
 *  - Plane-aware coordinate conversion via GeometryEngine.getSketchAxes.
 */

import React, { useRef, useMemo, useEffect } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { tagShared } from '../../../engine/GeometryEngine';

// ── Module-level scratch variables — never allocate inside handlers ──────────
const _scratchVec   = new THREE.Vector3();
const _scratchMouse = new THREE.Vector2();

// ── Shared handle geometry — one BufferGeometry reused by all spheres ────────
// AUDIT-19: tagShared marks this geometry so disposal logic skips it.
const HANDLE_GEO = tagShared(new THREE.SphereGeometry(0.3, 10, 10));

// ── Materials keyed by visual state ─────────────────────────────────────────
const MAT_NORMAL   = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
const MAT_HOVERED  = new THREE.MeshBasicMaterial({ color: 0xffdd00, depthTest: false });
const MAT_DRAGGING = new THREE.MeshBasicMaterial({ color: 0x4488ff, depthTest: false });

/** Select the correct material for a given handle index. */
function pickMat(
  pointIdx: number,
  editingId: string | null,
  hoveredIdx: number | null,
  draggingIdx: number | null,
): THREE.Material {
  if (editingId === null) return MAT_NORMAL;
  if (draggingIdx === pointIdx) return MAT_DRAGGING;
  if (hoveredIdx === pointIdx) return MAT_HOVERED;
  return MAT_NORMAL;
}

interface DragState {
  active: boolean;
  entityId: string;
  pointIndex: number;
  sketchPlane: THREE.Plane;
}

export default function SketchSplineHandles() {
  const { camera, gl, raycaster } = useThree();

  const activeTool      = useCADStore((s) => s.activeTool);
  const activeSketch    = useCADStore((s) => s.activeSketch);
  const editingSplineId = useCADStore((s) => s.editingSplineEntityId);
  const hoveredIdx      = useCADStore((s) => s.hoveredSplinePointIndex);
  const draggingIdx     = useCADStore((s) => s.draggingSplinePointIndex);

  const setEditingId = useCADStore((s) => s.setEditingSplineEntityId);
  const setHovered   = useCADStore((s) => s.setHoveredSplinePointIndex);
  const setDragging  = useCADStore((s) => s.setDraggingSplinePointIndex);

  // Drag state kept in a ref to avoid stale-closure bugs.
  // Reading from the store inside window listeners would always see stale closures —
  // use refs for all drag-related state that must be live inside the window listeners.
  const dragRef = useRef<DragState>({
    active: false,
    entityId: '',
    pointIndex: -1,
    sketchPlane: new THREE.Plane(),
  });

  // Collect all spline entities from the active sketch
  const splineEntities = useMemo(() => {
    if (!activeSketch) return [];
    return activeSketch.entities.filter((e) => e.type === 'spline');
  }, [activeSketch]);

  // Build the sketch plane once per active sketch (used for ray-plane intersection)
  const sketchPlane = useMemo((): THREE.Plane => {
    if (!activeSketch) return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    switch (activeSketch.plane) {
      case 'XY': return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      case 'XZ': return new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      case 'YZ': return new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
      case 'custom': {
        const n = activeSketch.planeNormal.clone().normalize();
        return new THREE.Plane(n, -n.dot(activeSketch.planeOrigin));
      }
      default: return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    }
  }, [activeSketch]);

  // Utility: convert a PointerEvent into a world-space plane intersection point.
  // Reuses module-level _scratchMouse and _scratchVec — zero allocations.
  const getPlaneHit = (event: PointerEvent, plane: THREE.Plane): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    _scratchMouse.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(_scratchMouse, camera);
    const hit = raycaster.ray.intersectPlane(plane, _scratchVec);
    return hit ? _scratchVec : null;
  };

  // ── Global drag listeners — same pattern as ExtrudeGizmo ─────────────────
  // Attach once; read drag state from dragRef to avoid stale closures.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current.active) return;
      const hit = getPlaneHit(e, dragRef.current.sketchPlane);
      if (hit) {
        // Read current state directly from store (not captured closure)
        useCADStore.getState().updateSplineControlPoint(
          dragRef.current.entityId,
          dragRef.current.pointIndex,
          hit.x,
          hit.y,
          hit.z,
        );
      }
    };

    const onUp = () => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      useCADStore.getState().setDraggingSplinePointIndex(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera, raycaster]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only render when in select mode and there are spline entities
  if (activeTool !== 'select' || splineEntities.length === 0 || !activeSketch) return null;

  // ── Build sphere meshes for each control point ───────────────────────────
  const handles: React.ReactElement[] = [];

  for (const entity of splineEntities) {
    for (let pi = 0; pi < entity.points.length; pi++) {
      const pt  = entity.points[pi];
      const eid = entity.id;
      // Capture loop index for closures
      const pidx = pi;

      const material = pickMat(pidx, editingSplineId, hoveredIdx, draggingIdx);

      const onPointerEnter = () => {
        setEditingId(eid);
        setHovered(pidx);
      };

      const onPointerLeave = () => {
        // Don't clear hover while actively dragging this point
        if (!dragRef.current.active) {
          setHovered(null);
        }
      };

      const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        dragRef.current = {
          active:      true,
          entityId:    eid,
          pointIndex:  pidx,
          sketchPlane: sketchPlane,
        };
        setEditingId(eid);
        setDragging(pidx);
      };

      handles.push(
        <mesh
          key={`${eid}-${pidx}`}
          geometry={HANDLE_GEO}
          material={material}
          position={[pt.x, pt.y, pt.z]}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          onPointerDown={onPointerDown}
          renderOrder={100}
        />,
      );
    }
  }

  return <>{handles}</>;
}
