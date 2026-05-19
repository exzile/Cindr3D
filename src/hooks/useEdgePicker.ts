/**
 * useEdgePicker — reusable edge-picking hook for R3F components.
 *
 * Raycasts against pickable meshes to get a face hit, then finds the nearest
 * MODEL edge (from the explicit `geometry.userData.topology`, not the
 * non-manifold render soup) and gates it by screen proximity + occlusion.
 *
 * This file is the composer/shim: the focused pieces live in `edgePicker/`
 * (2026-05 refactor, per the shim+subdir convention) —
 *   • segmentMath     — pure closest-point / screen-distance math
 *   • topologyCache    — per-geometry world-space edge cache (hot-path)
 *   • nearestEdge      — nearest model-edge pick
 *   • edgeVisibility   — proximity + occlusion gate
 * Same patterns as useFacePicker: module-level scratch, optionsRef for
 * stale-closure safety, hoverRef for no-op guards.
 */

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { isGizmoDragging } from '../components/viewport/scene/gizmoDragGuard';
import type { UseEdgePickerOptions } from '../types/edge-picker.types';
import type { EdgePickResult } from '../types/edge-picker.types';
import { pickNearestEdge } from './edgePicker/nearestEdge';
import { edgeIsPickable } from './edgePicker/edgeVisibility';
export type { EdgePickResult, UseEdgePickerOptions } from '../types/edge-picker.types';

// Module-level scratch — no per-event allocation.
const _mouse = new THREE.Vector2();

export function useEdgePicker(options: UseEdgePickerOptions): void {
  const { gl, camera, raycaster, scene } = useThree();

  const optionsRef = useRef(options);
  // eslint-disable-next-line react-hooks/refs
  optionsRef.current = options;

  const hoverRef = useRef<EdgePickResult | null>(null);

  useEffect(() => {
    if (!optionsRef.current.enabled) {
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        optionsRef.current.onHover?.(null);
      }
      return;
    }

    const collectPickable = (): THREE.Mesh[] => {
      const out: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (!m.isMesh || !obj.userData?.pickable) return;
        if (optionsRef.current.filter && !optionsRef.current.filter(m)) return;
        out.push(m);
      });
      return out;
    };

    const updateMouse = (event: { clientX: number; clientY: number }, r: DOMRect) => {
      _mouse.set(
        ((event.clientX - r.left) / r.width) * 2 - 1,
        -((event.clientY - r.top) / r.height) * 2 + 1,
      );
    };

    const handlePointerMove = (event: PointerEvent) => {
      // One layout read per move (getBoundingClientRect forces reflow); shared
      // by the NDC mapping and the screen-space proximity gate.
      const r = gl.domElement.getBoundingClientRect();
      updateMouse(event, r);
      raycaster.setFromCamera(_mouse, camera);
      const pickables = collectPickable();
      const hits = raycaster.intersectObjects(pickables, false);

      if (hits.length > 0 && hits[0].faceIndex !== undefined && hits[0].point) {
        const hit = hits[0];
        const result = pickNearestEdge(
          hit.object as THREE.Mesh,
          hit.faceIndex!,
          hit.point,
        );
        if (result) {
          if (edgeIsPickable(
            result, hit.point, camera, pickables,
            event.clientX - r.left, event.clientY - r.top, r.width, r.height,
          )) {
            hoverRef.current = result;
            optionsRef.current.onHover?.(result);
            return;
          }
        }
      }

      if (hoverRef.current !== null) {
        hoverRef.current = null;
        optionsRef.current.onHover?.(null);
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      // The trailing synthetic click after a gizmo-arrow drag must not pick an
      // edge. EdgeOpGizmo clears this flag on a deferred (post-click) task.
      if (isGizmoDragging()) return;
      const r = gl.domElement.getBoundingClientRect();
      updateMouse(event, r);
      raycaster.setFromCamera(_mouse, camera);
      const pickables = collectPickable();
      const hits = raycaster.intersectObjects(pickables, false);
      if (hits.length === 0) return;
      const hit = hits[0];
      if (hit.faceIndex === undefined || !hit.point) return;
      const result = pickNearestEdge(
        hit.object as THREE.Mesh,
        hit.faceIndex!,
        hit.point,
      );
      if (result) {
        if (!edgeIsPickable(
          result, hit.point, camera, pickables,
          event.clientX - r.left, event.clientY - r.top, r.width, r.height,
        )) return;
        optionsRef.current.onClick?.(result);
      }
    };

    const canvas = gl.domElement;
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('click', handleClick, true);

    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('click', handleClick, true);
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        optionsRef.current.onHover?.(null);
      }
    };

  }, [gl, camera, raycaster, scene, options.enabled]);
}
