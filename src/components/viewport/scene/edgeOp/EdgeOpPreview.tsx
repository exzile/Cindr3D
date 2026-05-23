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

import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  ensureSourceGeometry,
  geometryFromWorkerResult,
  restorePreviewScene,
  showPreviewGeometry,
  type PreviewSceneRefs,
} from "./previewScene";
import {
  resolvePreviewEdges,
  type EdgeOpPreviewToolType,
  type ParsedPreviewEdges,
} from "./previewEdges";
import { useDebouncedEdgeIds } from "./useDebouncedEdgeIds";

interface EdgeOpPreviewProps {
  /** activeDialog matches this tool's dialog. */
  enabled: boolean;
  /** Selected edge IDs. */
  edgeIds: string[];
  /** Current live size (radius / distance). */
  liveValue: number;
  /** Which tool to run in the worker — determines which compute fn is called. */
  toolType: EdgeOpPreviewToolType;
  /** Arc-resolution hint passed to the compute fn (default 4). */
  segments?: number;
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
  const srcGeoCacheRef = useRef<{
    meshUuid: string;
    geo: THREE.BufferGeometry;
  } | null>(null);
  const sceneRefs = useMemo<PreviewSceneRefs>(
    () => ({
      previewMeshRef,
      hiddenMeshRef,
      pickProxyRef,
      srcGeoCacheRef,
    }),
    [],
  );

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const latestRequestIdRef = useRef(0);

  // Ping-pong backpressure: at most one in-flight job. If the worker is busy
  // when a new value arrives, save it here and dispatch once the result lands.
  const inFlightRef = useRef(false);
  const pendingJobRef = useRef<{
    pac: ParsedPreviewEdges;
    value: number;
  } | null>(null);

  // Debounce edgeIds: when the user clicks several edges in quick succession
  // each click fires a recompute; debouncing coalesces those into one run so
  // intermediate states don't queue up and stall the thread.
  const debouncedEdgeIds = useDebouncedEdgeIds(edgeIds, 80);

  // Parse + cluster + cap once per debouncedEdgeIds. The dispatch effect runs on
  // every liveValue change too — without this memo the cluster work
  // re-ran on every slider tick, which is O(N) but adds up on circle-rim
  // selections (30-100+ segments) at preview refresh rate.
  const parsedAndClustered = useMemo((): ParsedPreviewEdges | null => {
    return resolvePreviewEdges(enabled, debouncedEdgeIds, toolType);
    // liveBodyMeshes is a module-level mutable Map; the meshUuid identity drives
    // re-runs through `debouncedEdgeIds`, and a remount swaps the uuid → memo
    // re-runs. enabled gate keeps preview disabled state cheap.
  }, [enabled, debouncedEdgeIds, toolType]);

  // Keep stable refs to scene-mutable state so the worker message handler
  // (created once on mount) always reads current values without being recreated.
  const sceneRef = useRef(scene);
  const invalidateRef = useRef(invalidate);
  const parsedAndClusteredRef = useRef(parsedAndClustered);

  useEffect(() => {
    sceneRef.current = scene;
    invalidateRef.current = invalidate;
    parsedAndClusteredRef.current = parsedAndClustered;
  }, [scene, invalidate, parsedAndClustered]);

  // Stable ref to the dispatch function so the worker result handler can
  // kick off the next pending job without causing the worker effect to re-run.
  const dispatchJobRef = useRef<
    (pac: ParsedPreviewEdges, value: number) => void
  >(() => {});
  useEffect(() => {
    dispatchJobRef.current = (pac: ParsedPreviewEdges, value: number) => {
      if (!workerRef.current) return;

      const { parsed, liveMesh, previewEdges } = pac;

      const srcGeo = ensureSourceGeometry(
        parsed.meshUuid,
        liveMesh,
        srcGeoCacheRef,
      );

      const id = ++requestIdRef.current;
      latestRequestIdRef.current = id;
      inFlightRef.current = true;

      // Slice (copy) the positions — we keep the cache in srcGeoCacheRef so we
      // must not transfer (detach) the original buffer.
      const posCopy = (
        srcGeo.attributes.position.array as Float32Array
      ).slice();

      const edgesData = previewEdges.map((e) => ({
        ax: e.a.x,
        ay: e.a.y,
        az: e.a.z,
        bx: e.b.x,
        by: e.b.y,
        bz: e.b.z,
      }));

      workerRef.current.postMessage(
        {
          type: "compute",
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
  }, [segments, toolType]);

  // Handler ref pattern: worker.onmessage delegates to this ref so we never
  // need to recreate the worker when callbacks change.
  const workerOnMessageRef = useRef<(e: MessageEvent) => void>(() => {});
  useEffect(() => {
    workerOnMessageRef.current = (e: MessageEvent) => {
      const { type, requestId, positions, normals } = e.data;
      if (type !== "result") return;
      // Discard stale results from superseded requests.
      if (requestId !== latestRequestIdRef.current) {
        inFlightRef.current = false;
        return;
      }

      inFlightRef.current = false;
      const sc = sceneRef.current;

      if (!positions) {
        restorePreviewScene(sc, sceneRefs);
        invalidateRef.current();
      } else {
        const pac = parsedAndClusteredRef.current;
        if (!pac) {
          restorePreviewScene(sc, sceneRefs);
          invalidateRef.current();
        } else {
          showPreviewGeometry(
            sc,
            sceneRefs,
            pac.liveMesh,
            geometryFromWorkerResult(positions, normals),
          );
          invalidateRef.current();
        }
      }

      // Dispatch the pending job (if any) now that the worker is free.
      const pending = pendingJobRef.current;
      pendingJobRef.current = null;
      if (pending) dispatchJobRef.current(pending.pac, pending.value);
    };
  }, [sceneRefs]);

  // Create the worker once on mount; terminate on unmount.
  // Also register an HMR listener so editing edgeOpWorker / csg / edgeCutCore
  // during development terminates the stale worker — the next render recreates it.
  useEffect(() => {
    const worker = new Worker(
      new URL("../../../../workers/edgeOpWorker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (e) => workerOnMessageRef.current(e);
    worker.onerror = (e) => console.error("[EdgeOpPreview] worker error:", e);
    workerRef.current = worker;

    const hmrCleanup = import.meta.hot
      ? (() => {
          const onUpdate = () => {
            worker.terminate();
            workerRef.current = null;
          };
          import.meta.hot!.on("vite:beforeUpdate", onUpdate);
          return () => import.meta.hot!.off("vite:beforeUpdate", onUpdate);
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
      restorePreviewScene(sceneSnapshot, sceneRefs, {
        disposeSourceCache: true,
      });
      invalidate();
    };
  }, [scene, sceneRefs, invalidate]); // scene stable for Canvas lifetime

  // Dispatch to worker on value / edge change (immediate — no liveValue debounce).
  useEffect(() => {
    if (!parsedAndClustered || !(liveValue > 0)) {
      pendingJobRef.current = null;
      restorePreviewScene(scene, sceneRefs);
      invalidate();
      return;
    }

    if (inFlightRef.current) {
      // Worker is busy — save this as the pending job to run when it finishes.
      pendingJobRef.current = { pac: parsedAndClustered, value: liveValue };
      return;
    }

    dispatchJobRef.current(parsedAndClustered, liveValue);
  }, [liveValue, parsedAndClustered, scene, sceneRefs, invalidate]);

  return null;
}
