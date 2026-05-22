/**
 * EdgeOpPreview — generic live 3D preview for an edge-modification tool while
 * its dialog is open (fillet / chamfer).
 *
 * On every change of the selected edges or the live size it:
 *  1. Looks up the live rendered mesh from liveBodyMeshes (keyed by the mesh
 *     UUID embedded in the edge ID — populated by BodyMesh on mount).
 *  2. Clones + non-indexes that geometry, serialises it and the picked edges,
 *     and posts a 'compute' message to edgeOpWorker (off-main-thread CSG).
 *  3. On the worker result, imperatively adds a preview mesh and hides the
 *     original so there is no z-fighting overlap.
 *  4. On cleanup restores the original mesh and disposes the preview geometry.
 *
 * The same compute functions are used here (in the worker) and in the commit
 * (applyEdgeCut), so the preview matches the committed result exactly. Shared
 * by FilletPreview / ChamferPreview.
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
 *
 * WORKER PING-PONG: CSG runs off the main thread so the canvas stays
 * responsive during live drag. Dispatches are immediate (no debounce on
 * liveValue): if the worker is busy when a new value arrives, it is saved to
 * pendingJobRef and dispatched the instant the worker replies — so the preview
 * always catches up to the final dragged value with at most one queued job.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  parseEdgeIds,
  fitEdgeCircle,
  fitEdgeCircleOrArc,
  clusterEdgesByEndpointConnectivity,
  computePositionEps,
} from '../../../../utils/geometry/edgeCutCore';
import { liveBodyMeshes } from '../../../../store/meshRegistry';
import type { PickedEdge } from '../../../../utils/geometry/edgeCutCore';

interface EdgeOpPreviewProps {
  /** activeDialog matches this tool's dialog. */
  enabled: boolean;
  /** Selected edge IDs. */
  edgeIds: string[];
  /** Current live size (radius / distance). */
  liveValue: number;
  /** Which tool to run in the worker — determines which compute fn is called. */
  toolType: 'fillet' | 'chamfer';
  /** Arc-resolution hint passed to the compute fn (default 4). */
  segments?: number;
}

interface ParsedAndClustered {
  parsed: ReturnType<typeof parseEdgeIds> & {};
  liveMesh: THREE.Mesh;
  previewEdges: PickedEdge[];
}

export default function EdgeOpPreview({
  enabled,
  edgeIds,
  liveValue,
  toolType,
  segments = 4,
}: EdgeOpPreviewProps) {
  const { scene, invalidate } = useThree();

  const previewMeshRef = useRef<THREE.Mesh | null>(null);
  const hiddenMeshRef = useRef<THREE.Mesh | null>(null);
  // Invisible (material.visible=false) but raycastable stand-in for the hidden
  // live body, so the edge picker keeps working while a preview is shown.
  const pickProxyRef = useRef<THREE.Mesh | null>(null);
  // Cache the non-indexed clone of the live mesh geometry so we don't re-clone
  // on every value change (only mesh identity changes require a new clone).
  const srcGeoCacheRef = useRef<{ meshUuid: string; geo: THREE.BufferGeometry } | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const latestRequestIdRef = useRef(0);

  // Ping-pong backpressure: at most one in-flight job. If the worker is busy
  // when a new value arrives, save it here and dispatch once the result lands.
  const inFlightRef = useRef(false);
  const pendingJobRef = useRef<{ pac: ParsedAndClustered; value: number } | null>(null);

  // Debounce edgeIds: when the user clicks several edges in quick succession
  // each click fires a recompute; debouncing coalesces those into one run so
  // intermediate states don't queue up and stall the thread.
  const [debouncedEdgeIds, setDebouncedEdgeIds] = useState(edgeIds);
  const edgeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (edgeDebounceRef.current) clearTimeout(edgeDebounceRef.current);
    edgeDebounceRef.current = setTimeout(() => setDebouncedEdgeIds(edgeIds), 80);
    return () => { if (edgeDebounceRef.current) clearTimeout(edgeDebounceRef.current); };
  }, [edgeIds]);

  // Parse + cluster + cap once per debouncedEdgeIds. The dispatch effect runs on
  // every liveValue change too — without this memo the cluster work
  // re-ran on every slider tick, which is O(N) but adds up on circle-rim
  // selections (30-100+ segments) at preview refresh rate.
  const parsedAndClustered = useMemo((): ParsedAndClustered | null => {
    if (!enabled || debouncedEdgeIds.length === 0) return null;
    const parsed = parseEdgeIds(debouncedEdgeIds);
    if (!parsed) return null;
    const liveMesh = liveBodyMeshes.get(parsed.meshUuid);
    if (!liveMesh) return null;

    const MAX_NON_CIRCLE_SEGS = 6;
    const clusterEps = computePositionEps(liveMesh.geometry);
    const edgeClusters = clusterEdgesByEndpointConnectivity(parsed.edges, clusterEps);
    const previewEdges: PickedEdge[] = [];
    for (const cluster of edgeClusters) {
      const circleFit = toolType === 'fillet' ? fitEdgeCircleOrArc(cluster) : fitEdgeCircle(cluster);
      if (cluster.length <= MAX_NON_CIRCLE_SEGS || circleFit !== null) {
        previewEdges.push(...cluster);
      } else {
        for (let i = 0; i < MAX_NON_CIRCLE_SEGS; i++) {
          previewEdges.push(cluster[Math.round((i * (cluster.length - 1)) / (MAX_NON_CIRCLE_SEGS - 1))]);
        }
      }
    }
    return { parsed, liveMesh, previewEdges };
  // liveBodyMeshes is a module-level mutable Map; the meshUuid identity drives
  // re-runs through `debouncedEdgeIds`, and a remount swaps the uuid → memo
  // re-runs. enabled gate keeps preview disabled state cheap.
  }, [enabled, debouncedEdgeIds]);

  // Keep stable refs to scene-mutable state so the worker message handler
  // (created once on mount) always reads current values without being recreated.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  const parsedAndClusteredRef = useRef(parsedAndClustered);
  parsedAndClusteredRef.current = parsedAndClustered;

  // Stable ref to the dispatch function so the worker result handler can
  // kick off the next pending job without causing the worker effect to re-run.
  const dispatchJobRef = useRef<(pac: ParsedAndClustered, value: number) => void>(() => {});
  dispatchJobRef.current = (pac: ParsedAndClustered, value: number) => {
    if (!workerRef.current) return;

    const { parsed, liveMesh, previewEdges } = pac;

    if (srcGeoCacheRef.current?.meshUuid !== parsed.meshUuid) {
      srcGeoCacheRef.current?.geo.dispose();
      const geo = liveMesh.geometry.index
        ? liveMesh.geometry.clone().toNonIndexed()
        : liveMesh.geometry.clone();
      srcGeoCacheRef.current = { meshUuid: parsed.meshUuid, geo };
    }

    const id = ++requestIdRef.current;
    latestRequestIdRef.current = id;
    inFlightRef.current = true;

    // Slice (copy) the positions — we keep the cache in srcGeoCacheRef so we
    // must not transfer (detach) the original buffer.
    const posCopy = (
      srcGeoCacheRef.current.geo.attributes.position.array as Float32Array
    ).slice();

    const edgesData = previewEdges.map((e) => ({
      ax: e.a.x, ay: e.a.y, az: e.a.z,
      bx: e.b.x, by: e.b.y, bz: e.b.z,
    }));

    workerRef.current.postMessage(
      {
        type: 'compute',
        requestId: id,
        srcGeoPositions: posCopy.buffer,
        edges: edgesData,
        toolType,
        value,
        segments,
        fast: true,
      },
      [posCopy.buffer],
    );
  };

  // Handler ref pattern: worker.onmessage delegates to this ref so we never
  // need to recreate the worker when callbacks change.
  const workerOnMessageRef = useRef((_e: MessageEvent) => {});
  workerOnMessageRef.current = (e: MessageEvent) => {
    const { type, requestId, positions, normals } = e.data;
    if (type !== 'result') return;
    // Discard stale results from superseded requests.
    if (requestId !== latestRequestIdRef.current) {
      inFlightRef.current = false;
      return;
    }

    inFlightRef.current = false;
    const sc = sceneRef.current;

    const restoreLiveMesh = () => {
      if (hiddenMeshRef.current) {
        hiddenMeshRef.current.visible = true;
        hiddenMeshRef.current = null;
      }
      if (pickProxyRef.current) {
        sc.remove(pickProxyRef.current);
        (pickProxyRef.current.material as THREE.Material).dispose();
        pickProxyRef.current = null;
      }
      if (previewMeshRef.current) {
        sc.remove(previewMeshRef.current);
        previewMeshRef.current.geometry.dispose();
        previewMeshRef.current = null;
      }
    };

    if (!positions) {
      restoreLiveMesh();
      invalidateRef.current();
    } else {
      const pac = parsedAndClusteredRef.current;
      if (!pac) {
        restoreLiveMesh();
        invalidateRef.current();
      } else {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(positions), 3),
        );
        if (normals) {
          // Use the creased normals computed inside the worker (toCreasedNormals)
          // for smooth shading on the fillet arc.
          geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
        } else {
          geo.computeVertexNormals();
        }

        const { liveMesh } = pac;
        const oldPreviewGeo = previewMeshRef.current?.geometry ?? null;

        // If the target mesh changed, restore old and drop the stale proxy.
        if (hiddenMeshRef.current && hiddenMeshRef.current !== liveMesh) {
          hiddenMeshRef.current.visible = true;
          hiddenMeshRef.current = null;
          if (pickProxyRef.current) {
            sc.remove(pickProxyRef.current);
            (pickProxyRef.current.material as THREE.Material).dispose();
            pickProxyRef.current = null;
          }
        }

        if (!hiddenMeshRef.current) {
          liveMesh.visible = false;
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
          sc.add(proxy);
          pickProxyRef.current = proxy;
        }

        if (previewMeshRef.current && previewMeshRef.current.material === liveMesh.material) {
          previewMeshRef.current.geometry = geo;
        } else {
          if (previewMeshRef.current) sc.remove(previewMeshRef.current);
          const previewMesh = new THREE.Mesh(geo, liveMesh.material);
          previewMesh.castShadow = true;
          previewMesh.receiveShadow = true;
          sc.add(previewMesh);
          previewMeshRef.current = previewMesh;
        }

        // Dispose the previous geometry AFTER the new one is in place so there's
        // never a window where the mesh is temporarily geometry-less.
        if (oldPreviewGeo && oldPreviewGeo !== geo) oldPreviewGeo.dispose();

        invalidateRef.current();
      }
    }

    // Dispatch the pending job (if any) now that the worker is free.
    const pending = pendingJobRef.current;
    pendingJobRef.current = null;
    if (pending) dispatchJobRef.current(pending.pac, pending.value);
  };

  // Create the worker once on mount; terminate on unmount.
  // Also register an HMR listener so editing edgeOpWorker / csg / edgeCutCore
  // during development terminates the stale worker — the next render recreates it.
  useEffect(() => {
    const worker = new Worker(
      new URL('../../../../workers/edgeOpWorker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (e) => workerOnMessageRef.current(e);
    worker.onerror = (e) => console.error('[EdgeOpPreview] worker error:', e);
    workerRef.current = worker;

    const hmrCleanup = import.meta.hot
      ? (() => {
          const onUpdate = () => { worker.terminate(); workerRef.current = null; };
          import.meta.hot!.on('vite:beforeUpdate', onUpdate);
          return () => import.meta.hot!.off('vite:beforeUpdate', onUpdate);
        })()
      : undefined;

    return () => {
      hmrCleanup?.();
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Unmount cleanup — never strand a hidden live mesh or the pick proxy.
  useEffect(() => {
    const sceneSnapshot = scene;
    return () => {
      if (hiddenMeshRef.current) {
        hiddenMeshRef.current.visible = true;
        hiddenMeshRef.current = null;
      }
      if (previewMeshRef.current) {
        sceneSnapshot.remove(previewMeshRef.current);
        previewMeshRef.current.geometry.dispose();
        previewMeshRef.current = null;
      }
      if (pickProxyRef.current) {
        sceneSnapshot.remove(pickProxyRef.current);
        (pickProxyRef.current.material as THREE.Material).dispose();
        pickProxyRef.current = null;
      }
      srcGeoCacheRef.current?.geo.dispose();
      srcGeoCacheRef.current = null;
      invalidate();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]); // invalidate stable; scene stable for Canvas lifetime

  // Dispatch to worker on value / edge change (immediate — no liveValue debounce).
  useEffect(() => {
    const sc = scene;

    const restoreLiveMeshSync = () => {
      pendingJobRef.current = null;
      if (hiddenMeshRef.current) {
        hiddenMeshRef.current.visible = true;
        hiddenMeshRef.current = null;
      }
      if (pickProxyRef.current) {
        sc.remove(pickProxyRef.current);
        (pickProxyRef.current.material as THREE.Material).dispose();
        pickProxyRef.current = null;
      }
      if (previewMeshRef.current) {
        sc.remove(previewMeshRef.current);
        previewMeshRef.current.geometry.dispose();
        previewMeshRef.current = null;
      }
    };

    if (!parsedAndClustered || !(liveValue > 0)) {
      restoreLiveMeshSync();
      invalidate();
      return;
    }

    if (inFlightRef.current) {
      // Worker is busy — save this as the pending job to run when it finishes.
      pendingJobRef.current = { pac: parsedAndClustered, value: liveValue };
      return;
    }

    dispatchJobRef.current(parsedAndClustered, liveValue);
  }, [liveValue, parsedAndClustered, scene, invalidate]);

  return null;
}
