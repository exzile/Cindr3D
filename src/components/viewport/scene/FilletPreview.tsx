/**
 * FilletPreview — live 3D fillet preview while the Fillet dialog is open.
 *
 * Watches filletEdgeIds + filletLiveRadius. On every change it:
 *  1. Looks up the live rendered mesh from liveBodyMeshes (keyed by mesh UUID
 *     embedded in the edge ID — populated by BodyMesh on mount).
 *  2. Clones + non-indexes that geometry, runs computeFilletGeometry.
 *  3. Adds a preview THREE.Mesh to the scene imperatively and hides the
 *     original live mesh so there is no z-fighting overlap.
 *  4. On cleanup (dialog close, edge deselect, unmount) restores the original
 *     mesh visibility and disposes the preview geometry.
 *
 * The same computeFilletGeometry function is used here and in commitFillet,
 * so the preview matches the committed result exactly.
 */

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { liveBodyMeshes } from '../../../store/meshRegistry';
import { parseFilletEdgeIds, computeFilletGeometry } from '../../../utils/geometry/filletGeometry';

export default function FilletPreview() {
  const activeDialog  = useCADStore((s) => s.activeDialog);
  const filletEdgeIds = useCADStore((s) => s.filletEdgeIds);
  const filletLiveRadius = useCADStore((s) => s.filletLiveRadius);

  const { scene, invalidate } = useThree();

  const enabled = activeDialog === 'fillet';

  // Three.js objects managed imperatively (no JSX / React reconciler).
  const previewMeshRef = useRef<THREE.Mesh | null>(null);
  const hiddenMeshRef  = useRef<THREE.Mesh | null>(null);

  // ── Unmount cleanup ────────────────────────────────────────────────────────
  // Runs when the component tree teardown removes FilletPreview (e.g. the
  // Canvas unmounts). Ensures we never strand a hidden live mesh.
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
  }, [scene]); // invalidate is stable; scene is stable for Canvas lifetime

  // ── Preview update ─────────────────────────────────────────────────────────
  // Re-runs whenever the user changes the radius (gizmo drag or input) or
  // adds/removes a selected edge. Each run disposes the previous preview and
  // creates a fresh one.
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

    // Bail early when nothing to preview.
    if (!enabled || filletEdgeIds.length === 0 || !(filletLiveRadius > 0)) {
      invalidate();
      return;
    }

    // Parse the selected edge IDs → group with most edges.
    const parsed = parseFilletEdgeIds(filletEdgeIds);
    if (!parsed) { invalidate(); return; }

    // Look up the live rendered mesh (extrude features registered by BodyMesh).
    const liveMesh = liveBodyMeshes.get(parsed.meshUuid);
    if (!liveMesh) { invalidate(); return; }

    // Clone + non-index so computeFilletGeometry gets a mutable flat array.
    const srcGeo = liveMesh.geometry.clone().toNonIndexed();
    const previewGeo = computeFilletGeometry(srcGeo, parsed.edges, filletLiveRadius, 4);
    srcGeo.dispose();

    if (!previewGeo) { invalidate(); return; } // degenerate edges / radius too large

    // Build preview mesh using the same material as the live mesh.
    const previewMesh = new THREE.Mesh(previewGeo, liveMesh.material);
    previewMesh.castShadow    = true;
    previewMesh.receiveShadow = true;

    // Hide original, show preview.
    /* eslint-disable react-hooks/immutability */
    liveMesh.visible = false;
    /* eslint-enable react-hooks/immutability */
    hiddenMeshRef.current = liveMesh;

    scene.add(previewMesh);
    previewMeshRef.current = previewMesh;

    invalidate();
  }, [enabled, filletEdgeIds, filletLiveRadius, scene, invalidate]);

  return null;
}
