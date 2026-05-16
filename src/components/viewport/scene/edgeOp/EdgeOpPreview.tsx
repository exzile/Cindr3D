/**
 * EdgeOpPreview — generic live 3D preview for an edge-modification tool while
 * its dialog is open (fillet / chamfer).
 *
 * On every change of the selected edges or the live size it:
 *  1. Looks up the live rendered mesh from liveBodyMeshes (keyed by the mesh
 *     UUID embedded in the edge ID — populated by BodyMesh on mount).
 *  2. Clones + non-indexes that geometry, runs the tool's `compute`.
 *  3. Imperatively adds a preview mesh and hides the original so there is no
 *     z-fighting overlap.
 *  4. On cleanup restores the original mesh and disposes the preview geometry.
 *
 * The same `compute` function is used here and in the commit (applyEdgeCut),
 * so the preview matches the committed result exactly. Shared by
 * FilletPreview / ChamferPreview.
 */

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { parseEdgeIds } from '../../../../utils/geometry/edgeCutCore';
import { liveBodyMeshes } from '../../../../store/meshRegistry';
import type { PickedEdge } from '../../../../utils/geometry/edgeCutCore';

interface EdgeOpPreviewProps {
  /** activeDialog matches this tool's dialog. */
  enabled: boolean;
  /** Selected edge IDs. */
  edgeIds: string[];
  /** Current live size (radius / distance). */
  liveValue: number;
  /** Build the previewed geometry — same fn the commit uses. */
  compute: (srcGeo: THREE.BufferGeometry, edges: PickedEdge[], value: number) => THREE.BufferGeometry | null;
}

export default function EdgeOpPreview({ enabled, edgeIds, liveValue, compute }: EdgeOpPreviewProps) {
  const { scene, invalidate } = useThree();

  const previewMeshRef = useRef<THREE.Mesh | null>(null);
  const hiddenMeshRef = useRef<THREE.Mesh | null>(null);

  // Unmount cleanup — never strand a hidden live mesh.
  useEffect(() => {
    const sceneRef = scene;
    return () => {
      if (hiddenMeshRef.current) {
        /* eslint-disable react-hooks/immutability */
        hiddenMeshRef.current.visible = true;
        /* eslint-enable react-hooks/immutability */
        hiddenMeshRef.current = null;
      }
      if (previewMeshRef.current) {
        sceneRef.remove(previewMeshRef.current);
        previewMeshRef.current.geometry.dispose();
        previewMeshRef.current = null;
      }
      invalidate();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]); // invalidate stable; scene stable for Canvas lifetime

  useEffect(() => {
    // Always clean up the previous preview first.
    if (previewMeshRef.current) {
      scene.remove(previewMeshRef.current);
      previewMeshRef.current.geometry.dispose();
      previewMeshRef.current = null;
    }
    if (hiddenMeshRef.current) {
      /* eslint-disable react-hooks/immutability */
      hiddenMeshRef.current.visible = true;
      /* eslint-enable react-hooks/immutability */
      hiddenMeshRef.current = null;
    }

    if (!enabled || edgeIds.length === 0 || !(liveValue > 0)) {
      invalidate();
      return;
    }

    const parsed = parseEdgeIds(edgeIds);
    if (!parsed) { invalidate(); return; }

    const liveMesh = liveBodyMeshes.get(parsed.meshUuid);
    if (!liveMesh) { invalidate(); return; }

    const srcGeo = liveMesh.geometry.clone().toNonIndexed();
    const previewGeo = compute(srcGeo, parsed.edges, liveValue);
    srcGeo.dispose();

    if (!previewGeo) { invalidate(); return; } // degenerate / size too large

    const previewMesh = new THREE.Mesh(previewGeo, liveMesh.material);
    previewMesh.castShadow = true;
    previewMesh.receiveShadow = true;

    /* eslint-disable react-hooks/immutability */
    liveMesh.visible = false;
    /* eslint-enable react-hooks/immutability */
    hiddenMeshRef.current = liveMesh;

    scene.add(previewMesh);
    previewMeshRef.current = previewMesh;

    invalidate();
  }, [enabled, edgeIds, liveValue, compute, scene, invalidate]);

  return null;
}
