/* eslint-disable react-refresh/only-export-components */
/**
 * OCC-8.1 - OCC face picker.
 *
 * Raycasts against BodyMesh objects and resolves hits to exact BRep faceIds
 * via BRepTessellation.faceIds, bypassing
 * coplanar-grouping heuristics.
 *
 * Active only when mesh has userData.brepTessellation (set by BodyMesh).
 */
import { useEffect, useRef, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  attachTessellationToMesh,
  getMeshTessellation,
  faceIdAtTriangle,
  buildFaceHighlightGeometry,
} from '../../../engine/occ/picking';
import { getOccSync } from '../../../engine/occ/loader';
import { tessellateWithInstance } from '../../../engine/occ/tessellate';
import { globalBRepBodyRegistry } from '../../../engine/occ/globalRegistry';

export interface OccFacePickResult {
  mesh: THREE.Mesh;
  faceId: number;
  bodyId: string;
  triangleIndex: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface UseOccFacePickerOptions {
  enabled: boolean;
  onHover?: (result: OccFacePickResult | null) => void;
  onClick?: (result: OccFacePickResult) => void;
  filter?: (mesh: THREE.Mesh) => boolean;
}

const _mouse = new THREE.Vector2();
const _normal = new THREE.Vector3();

export function useOccFacePicker(options: UseOccFacePickerOptions): void {
  const { gl, camera, raycaster, scene } = useThree();
  const optionsRef = useRef(options);
  const hoverRef = useRef<OccFacePickResult | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const pick = useCallback((clientX: number, clientY: number): OccFacePickResult | null => {
    const rect = gl.domElement.getBoundingClientRect();
    _mouse.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(_mouse, camera);

    const meshes: THREE.Mesh[] = [];
    const occ = getOccSync();
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      let tess = getMeshTessellation(obj);
      if (!tess && occ) {
        const featureId = obj.userData.featureId as string | undefined;
        const body = featureId ? globalBRepBodyRegistry.getByFeature(featureId)[0] : undefined;
        if (body) {
          tess = tessellateWithInstance(occ.oc, body);
          attachTessellationToMesh(obj, tess, body.id);
        }
      }
      if (tess !== null && (!optionsRef.current.filter || optionsRef.current.filter(obj))) {
        meshes.push(obj);
      }
    });

    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;

    const hit = hits[0];
    const mesh = hit.object as THREE.Mesh;
    const tess = getMeshTessellation(mesh);
    if (!tess || hit.faceIndex == null) return null;

    const faceId = faceIdAtTriangle(tess, hit.faceIndex);
    const bodyId = (mesh.userData['brepBodyId'] as string) ?? '';

    // Compute face normal from tessellation
    const base = hit.faceIndex * 9;
    _normal.set(tess.normals[base], tess.normals[base + 1], tess.normals[base + 2]);
    _normal.transformDirection(mesh.matrixWorld);

    return {
      mesh,
      faceId,
      bodyId,
      triangleIndex: hit.faceIndex,
      point: hit.point.clone(),
      normal: _normal.clone(),
    };
  }, [gl, camera, raycaster, scene]);

  useEffect(() => {
    if (!options.enabled) {
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        optionsRef.current.onHover?.(null);
      }
      return;
    }

    const onMove = (e: PointerEvent) => {
      const result = pick(e.clientX, e.clientY);
      const prev = hoverRef.current;
      const changed = result?.faceId !== prev?.faceId || result?.bodyId !== prev?.bodyId;
      if (!changed) return;
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
  }, [options.enabled, pick, gl.domElement]);
}

// ── Highlight overlay ─────────────────────────────────────────────────────────

const HOVER_MAT = new THREE.MeshBasicMaterial({
  color: 0x2196f3,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
  depthTest: false,
});

const SELECTED_MAT = new THREE.MeshBasicMaterial({
  color: 0xff6600,
  transparent: true,
  opacity: 0.5,
  side: THREE.DoubleSide,
  depthTest: false,
});

export { buildFaceHighlightGeometry, HOVER_MAT, SELECTED_MAT };
