/* eslint-disable react-refresh/only-export-components */
/**
 * OCC-8.2 — OCC-gated edge picker + edge overlay.
 *
 * Edge polylines from BRepTessellation.edgePolylines render as LineSegments.
 * Picking raycasts against these lines (not triangle adjacency). Each LineSegments
 * object carries userData.edgeId. Hover/click resolves to exact edgeId.
 *
 * EdgeOverlay: renders all edges of all OCC bodies as thin lines.
 */
import { useRef, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getMeshTessellation, buildAllEdgeLineSegments, buildEdgeLineGeometry } from '../../../engine/occ/picking';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OccEdgePickResult {
  edgeId: number;
  bodyId: string;
  mesh: THREE.LineSegments;
  point: THREE.Vector3;
}

export interface UseOccEdgePickerOptions {
  enabled: boolean;
  onHover?: (result: OccEdgePickResult | null) => void;
  onClick?: (result: OccEdgePickResult) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

const _edgeWorldA = new THREE.Vector3();
const _edgeWorldB = new THREE.Vector3();
const _edgeProjA = new THREE.Vector3();
const _edgeProjB = new THREE.Vector3();

function segDistSqPx(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-9) {
    const dx = px - ax;
    const dy = py - ay;
    return dx * dx + dy * dy;
  }
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq));
  const cx = ax + vx * t;
  const cy = ay + vy * t;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

export function useOccEdgePicker(options: UseOccEdgePickerOptions): void {
  const { gl, camera, scene } = useThree();
  const optionsRef = useRef(options);
  const hoverRef = useRef<OccEdgePickResult | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!options.enabled) {
      if (hoverRef.current) {
        hoverRef.current = null;
        optionsRef.current.onHover?.(null);
      }
      return;
    }

    const pick = (clientX: number, clientY: number, debug = false): OccEdgePickResult | null => {
      const rect = gl.domElement.getBoundingClientRect();

      const lines: THREE.LineSegments[] = [];
      scene.traverse((obj) => {
        if (
          obj instanceof THREE.LineSegments &&
          (obj.userData['edgeId'] !== undefined || Array.isArray(obj.userData['edgeIdsBySegment']))
        ) {
          lines.push(obj);
        }
      });

      void debug;
      let best: OccEdgePickResult | null = null;
      let bestDistSq = Infinity;
      let bestDepth = Infinity;
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const halfW = rect.width * 0.5;
      const halfH = rect.height * 0.5;
      const thresholdSq = 14 * 14;
      // When two edges project to nearly the same screen location (e.g. the front and
      // back rim of a coaxial hole/notch), screen-distance alone arbitrarily picks one —
      // often the FAR one, which is not what the user clicked. Within this near-tie band
      // we break ties by depth so the edge NEAREST the camera wins (the visible one).
      const NEAR_TIE_PX_SQ = 8 * 8;

      for (const ls of lines) {
        const position = ls.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        if (!position || position.count < 2) continue;
        const edgeIdsBySegment = ls.userData['edgeIdsBySegment'] as number[] | undefined;
        ls.updateWorldMatrix(true, false);
        const segmentCount = Math.floor(position.count / 2);
        for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
          const aIndex = segmentIndex * 2;
          const bIndex = aIndex + 1;
          _edgeWorldA.fromBufferAttribute(position, aIndex).applyMatrix4(ls.matrixWorld);
          _edgeWorldB.fromBufferAttribute(position, bIndex).applyMatrix4(ls.matrixWorld);
          _edgeProjA.copy(_edgeWorldA).project(camera);
          _edgeProjB.copy(_edgeWorldB).project(camera);
          if (_edgeProjA.z > 1 || _edgeProjB.z > 1) continue;
          const ax = (_edgeProjA.x + 1) * halfW;
          const ay = (1 - _edgeProjA.y) * halfH;
          const bx = (_edgeProjB.x + 1) * halfW;
          const by = (1 - _edgeProjB.y) * halfH;
          const distSq = segDistSqPx(px, py, ax, ay, bx, by);
          if (distSq > thresholdSq) continue;
          const edgeId = edgeIdsBySegment?.[segmentIndex] ?? (ls.userData['edgeId'] as number | undefined);
          if (edgeId === undefined) continue;
          // Mean NDC depth of the segment (smaller = nearer the camera).
          const depth = (_edgeProjA.z + _edgeProjB.z) * 0.5;
          // Accept when: clearly closer in 2D, OR within the near-tie band AND nearer in depth.
          let take: boolean;
          if (best === null) take = true;
          else if (distSq < bestDistSq - NEAR_TIE_PX_SQ) take = true;
          else if (distSq <= bestDistSq + NEAR_TIE_PX_SQ) take = depth < bestDepth;
          else take = false;
          if (!take) continue;
          bestDistSq = distSq;
          bestDepth = depth;
          best = {
            edgeId,
            bodyId: (ls.userData['brepBodyId'] as string) ?? '',
            mesh: ls,
            point: _edgeWorldA.clone().lerp(_edgeWorldB, 0.5),
          };
        }
      }

      if (!best) return null;
      return {
        ...best,
      };
    };

    const onMove = (e: PointerEvent) => {
      const result = pick(e.clientX, e.clientY);
      const prev = hoverRef.current;
      if (result?.edgeId === prev?.edgeId && result?.bodyId === prev?.bodyId) return;
      hoverRef.current = result;
      optionsRef.current.onHover?.(result);
    };

    let suppressNextClick = false;

    const selectFromEvent = (e: PointerEvent | MouseEvent) => {
      const result = pick(e.clientX, e.clientY, true);
      if (!result) return false;
      e.preventDefault();
      e.stopPropagation();
      optionsRef.current.onClick?.(result);
      return true;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (selectFromEvent(e)) suppressNextClick = true;
    };

    const onClick = (e: MouseEvent) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      selectFromEvent(e);
    };

    const dom = gl.domElement;
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerdown', onPointerDown, { capture: true });
    dom.addEventListener('click', onClick, { capture: true });
    return () => {
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerdown', onPointerDown, { capture: true });
      dom.removeEventListener('click', onClick, { capture: true });
    };
  }, [options.enabled, gl, camera, scene]);
}

// ── EdgeOverlay component ─────────────────────────────────────────────────────

const EDGE_MAT = new THREE.LineBasicMaterial({ color: 0x222222, linewidth: 1 });
const EDGE_HOVER_MAT = new THREE.LineBasicMaterial({ color: 0x00aaff, linewidth: 2 });

export interface OccEdgeOverlayProps {
  mesh: THREE.Mesh;
  hoveredEdgeId?: number;
}

/**
 * Renders all edges from a mesh's BRepTessellation as LineSegments.
 * Pass the R3F Mesh ref's current value. Memoized per tessellation.
 */
export function OccEdgeOverlay({ mesh, hoveredEdgeId }: OccEdgeOverlayProps) {
  const tess = getMeshTessellation(mesh);
  const bodyId = (mesh.userData['brepBodyId'] as string) ?? '';

  const linePrimitives = useMemo(() => {
    if (!tess) return [];
    return buildAllEdgeLineSegments(tess).map((ls) => {
      ls.userData['brepBodyId'] = bodyId;
      return ls;
    });
  }, [tess, bodyId]);

  const hoveredGeo = useMemo(() => {
    if (hoveredEdgeId == null || !tess) return null;
    return buildEdgeLineGeometry(tess, hoveredEdgeId);
  }, [tess, hoveredEdgeId]);

  useEffect(() => {
    return () => {
      for (const ls of linePrimitives) {
        ls.geometry.dispose();
      }
      hoveredGeo?.dispose();
    };
  }, [linePrimitives, hoveredGeo]);

  return (
    <>
      {linePrimitives.map((ls, i) => (
        <primitive key={i} object={ls} attach={undefined} />
      ))}
      {hoveredGeo && (
        <lineSegments geometry={hoveredGeo}>
          <primitive object={EDGE_HOVER_MAT} attach="material" />
        </lineSegments>
      )}
    </>
  );
}

export { EDGE_MAT, EDGE_HOVER_MAT };
