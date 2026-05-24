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

const _mouse = new THREE.Vector2();

export function useOccEdgePicker(options: UseOccEdgePickerOptions): void {
  const { gl, camera, raycaster, scene } = useThree();
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

    const pick = (clientX: number, clientY: number): OccEdgePickResult | null => {
      const rect = gl.domElement.getBoundingClientRect();
      _mouse.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(_mouse, camera);
      raycaster.params.Line = { threshold: 0.5 };

      const lines: THREE.LineSegments[] = [];
      scene.traverse((obj) => {
        if (obj instanceof THREE.LineSegments && obj.userData['edgeId'] !== undefined) {
          lines.push(obj);
        }
      });

      const hits = raycaster.intersectObjects(lines, false);
      if (hits.length === 0) return null;
      const hit = hits[0];
      const ls = hit.object as THREE.LineSegments;
      return {
        edgeId: ls.userData['edgeId'] as number,
        bodyId: (ls.userData['brepBodyId'] as string) ?? '',
        mesh: ls,
        point: hit.point.clone(),
      };
    };

    const onMove = (e: PointerEvent) => {
      const result = pick(e.clientX, e.clientY);
      const prev = hoverRef.current;
      if (result?.edgeId === prev?.edgeId && result?.bodyId === prev?.bodyId) return;
      hoverRef.current = result;
      optionsRef.current.onHover?.(result);
    };

    const onClick = (e: MouseEvent) => {
      const result = pick(e.clientX, e.clientY);
      if (result) optionsRef.current.onClick?.(result);
    };

    const dom = gl.domElement;
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('click', onClick, { capture: true });
    return () => {
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('click', onClick, { capture: true });
    };
  }, [options.enabled, gl, camera, raycaster, scene]);
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
