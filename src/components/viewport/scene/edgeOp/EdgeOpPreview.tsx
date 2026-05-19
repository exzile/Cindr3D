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
 *
 * EDGE-PICK PROXY: hiding the live body (`visible = false`) also makes it
 * un-raycastable (THREE.Raycaster skips invisible objects), and the preview
 * mesh carries none of the picker's `userData` AND its chamfered/filleted
 * geometry no longer contains the original sharp edges — so once a preview is
 * shown the edge picker has nothing to hit and clicking an already-selected
 * edge to DESELECT it (or picking a new one) silently does nothing. To keep
 * picking alive we add an invisible-material, still-raycastable proxy that
 * wraps the ORIGINAL live geometry and mirrors the live mesh's uuid +
 * pickable/featureId userData, so picked edge IDs match the selection IDs.
 */

import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { parseEdgeIds, fitEdgeCircle } from '../../../../utils/geometry/edgeCutCore';
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
  // Invisible (material.visible=false) but raycastable stand-in for the hidden
  // live body, so the edge picker keeps working while a preview is shown.
  const pickProxyRef = useRef<THREE.Mesh | null>(null);
  // Cache the non-indexed clone of the live mesh geometry so we don't re-clone
  // on every debounced value change (only mesh identity changes require a new clone).
  const srcGeoCacheRef = useRef<{ meshUuid: string; geo: THREE.BufferGeometry } | null>(null);

  // Debounce liveValue: CSG is expensive — only recompute 150 ms after the
  // user stops dragging the gizmo or typing, not on every intermediate event.
  const [debouncedValue, setDebouncedValue] = useState(liveValue);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedValue(liveValue), 150);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [liveValue]);

  const removePickProxy = (sceneRef: THREE.Scene) => {
    if (pickProxyRef.current) {
      sceneRef.remove(pickProxyRef.current);
      (pickProxyRef.current.material as THREE.Material).dispose();
      pickProxyRef.current = null;
    }
  };

  // Unmount cleanup — never strand a hidden live mesh or the pick proxy.
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
      removePickProxy(sceneRef);
      srcGeoCacheRef.current?.geo.dispose();
      srcGeoCacheRef.current = null;
      invalidate();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]); // invalidate stable; scene stable for Canvas lifetime

  useEffect(() => {
    // Remove the stale preview geometry — but DON'T restore live-mesh visibility
    // yet. If we're just updating liveValue on the same mesh, we keep it hidden
    // throughout so there's no visible flash between updates during gizmo drag.
    if (previewMeshRef.current) {
      scene.remove(previewMeshRef.current);
      previewMeshRef.current.geometry.dispose();
      previewMeshRef.current = null;
    }

    const restoreLiveMesh = () => {
      if (hiddenMeshRef.current) {
        /* eslint-disable react-hooks/immutability */
        hiddenMeshRef.current.visible = true;
        /* eslint-enable react-hooks/immutability */
        hiddenMeshRef.current = null;
      }
      // No preview → the real (now visible) body is pickable again; drop proxy.
      removePickProxy(scene);
    };

    if (!enabled || edgeIds.length === 0 || !(debouncedValue > 0)) {
      restoreLiveMesh();
      invalidate();
      return;
    }

    const parsed = parseEdgeIds(edgeIds);
    if (!parsed) { restoreLiveMesh(); invalidate(); return; }

    const liveMesh = liveBodyMeshes.get(parsed.meshUuid);
    if (!liveMesh) { restoreLiveMesh(); invalidate(); return; }

    // A circular rim (hole / boss) is cut by ONE analytic loop cutter — a
    // single fast CSG regardless of segment count — so the preview must pass
    // the WHOLE loop: decimating it to a handful of points destroys the circle
    // fit and silently drops back to the per-segment path, which renders as a
    // broken spike. For genuinely non-circular many-edge selections (e.g. a
    // chamfer across lots of box edges, no loop cutter) keep the old cap so a
    // long run of sequential synchronous CSG subtracts can't freeze the tab.
    const MAX_PREVIEW_SEGMENTS = 6;
    const isCircularLoop = fitEdgeCircle(parsed.edges) !== null;
    const previewEdges =
      isCircularLoop || parsed.edges.length <= MAX_PREVIEW_SEGMENTS
        ? parsed.edges
        : Array.from({ length: MAX_PREVIEW_SEGMENTS }, (_, i) =>
            parsed.edges[Math.round((i * (parsed.edges.length - 1)) / (MAX_PREVIEW_SEGMENTS - 1))],
          );

    // Reuse the cached non-indexed clone when the mesh hasn't changed — avoids
    // a clone + toNonIndexed on every debounced value change.
    if (srcGeoCacheRef.current?.meshUuid !== parsed.meshUuid) {
      srcGeoCacheRef.current?.geo.dispose();
      const geo = liveMesh.geometry.index
        ? liveMesh.geometry.clone().toNonIndexed()
        : liveMesh.geometry.clone();
      srcGeoCacheRef.current = { meshUuid: parsed.meshUuid, geo };
    }
    let previewGeo: THREE.BufferGeometry | null = null;
    try {
      previewGeo = compute(srcGeoCacheRef.current.geo, previewEdges, debouncedValue);
    } catch (err) {
      console.error('[EdgeOpPreview] compute threw:', err);
    }

    if (!previewGeo) { restoreLiveMesh(); invalidate(); return; }

    // Reject genuinely empty output only. The previous guard used
    // `count < srcVertCount` assuming chamfer/fillet always add vertices, but
    // `retriangulateCoplanarRegions` (run inside weldAndCleanSolid after the CSG
    // subtract) merges coplanar fans and can legally reduce vertex count below
    // the source even for a perfectly valid result — causing false rejections
    // that left the preview blank while the body stayed visible.
    if (previewGeo.attributes.position.count === 0) {
      previewGeo.dispose();
      restoreLiveMesh();
      invalidate();
      return;
    }

    // If the target mesh changed (different mesh than last preview), restore old
    // and drop the stale proxy so it is rebuilt against the new geometry/uuid.
    if (hiddenMeshRef.current && hiddenMeshRef.current !== liveMesh) {
      /* eslint-disable react-hooks/immutability */
      hiddenMeshRef.current.visible = true;
      /* eslint-enable react-hooks/immutability */
      hiddenMeshRef.current = null;
      removePickProxy(scene);
    }

    // Hide the live mesh only if not already hidden (avoids redundant DOM write).
    if (!hiddenMeshRef.current) {
      /* eslint-disable react-hooks/immutability */
      liveMesh.visible = false;
      /* eslint-enable react-hooks/immutability */
      hiddenMeshRef.current = liveMesh;
    }

    // Edge-pick proxy: the hidden live mesh is no longer raycastable and the
    // preview geometry no longer contains the original sharp edges, so without
    // this the picker can't toggle (deselect) or add edges while a preview is
    // shown. The proxy shares the live mesh's geometry (original edges intact),
    // uuid (so `edgeId()` produces IDs that match the selection list), and
    // pickable/featureId userData (so `collectPickable()` + its filter accept
    // it). `material.visible = false` keeps it out of the render but
    // Raycaster still hits it (it checks Object3D.visible, which stays true).
    if (!pickProxyRef.current) {
      const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
      const proxy = new THREE.Mesh(liveMesh.geometry, proxyMat);
      proxy.uuid = liveMesh.uuid;
      proxy.userData.pickable = liveMesh.userData.pickable;
      proxy.userData.featureId = liveMesh.userData.featureId;
      proxy.renderOrder = -1;
      scene.add(proxy);
      pickProxyRef.current = proxy;
    }

    const previewMesh = new THREE.Mesh(previewGeo, liveMesh.material);
    previewMesh.castShadow = true;
    previewMesh.receiveShadow = true;
    scene.add(previewMesh);
    previewMeshRef.current = previewMesh;

    invalidate();
  }, [enabled, edgeIds, debouncedValue, compute, scene, invalidate]);

  return null;
}
