import { useRef, useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { buildPolylineGeometry } from "../pickerGeometry";
import { applyLinePulse } from "../pickPulse";
import { useOccEdgePicker, type OccEdgePickResult } from "../OccEdgePicker";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import {
  buildBatchedEdgeLineGeometry,
  buildMergedMeshCreaseGuideGeometry,
  buildMeshTopologyGuideGeometry,
  buildTessellationGuideGeometry,
  disposeGuideGeometryResult,
  mergedGuideGeometryResults,
  polylineIsCurved,
  resolveMeshOccTessellation,
} from "./edgeOpEdgeGeometry";
import {
  findClosestLiveOccEdge,
  findClosestOccEdge,
  getOccEdgePolyline,
  occEdgeId,
} from "./edgeOpEdgeSelection";
import { useCADStore } from "../../../../store/cadStore";
import { rehydrateMissingExtrudeOccBodies } from "../../../../store/cad/slices/extrudeRevolve/rehydrateExtrudeOccBody";

interface EdgeOpEdgeHighlightProps {
  enabled: boolean;
  edgeIds: string[];
  addEdge: (id: string) => void;
  removeEdge: (id: string) => void;
  selectedColor: number;
  allowCurvedEdges?: boolean;
}

const EDGE_GUIDE_RENDER_ORDER = 1398;
const EDGE_HOVER_RENDER_ORDER = 1402;
const EDGE_SELECTED_RENDER_ORDER = 1403;

export default function EdgeOpEdgeHighlight({
  enabled,
  edgeIds,
  addEdge,
  removeEdge,
  selectedColor,
  allowCurvedEdges = false,
}: EdgeOpEdgeHighlightProps) {
  const hoverMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0x2196f3,
        linewidth: 2,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  const selectedMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: selectedColor,
        linewidth: 3,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [selectedColor],
  );
  const allEdgesMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0xff6a00,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const pickEdgesMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0xff6a00,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => () => hoverMat.dispose(), [hoverMat]);
  useEffect(() => () => selectedMat.dispose(), [selectedMat]);
  useEffect(() => () => allEdgesMat.dispose(), [allEdgesMat]);
  useEffect(() => () => pickEdgesMat.dispose(), [pickEdgesMat]);

  const allEdgeLinesRef = useRef<THREE.LineSegments[]>([]);
  const hoverLineRef = useRef<THREE.Line | null>(null);
  const occHoverRef = useRef<OccEdgePickResult | null>(null);
  const renderedHoverIdRef = useRef<string | null>(null);
  const selectedLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  const selectedEdgesDataRef = useRef<Map<string, THREE.Vector3[]>>(new Map());
  const cursorOnRef = useRef(false);
  const { scene: _scene, gl, invalidate: invalidateCanvas } = useThree();
  const features = useCADStore((state) => state.features);
  const sketches = useCADStore((state) => state.sketches);

  // Ref exposed to the rehydration effect so it can force a guide-line rebuild
  // after OCC bodies are re-registered (needed after full page refresh).
  const triggerRebuildRef = useRef<(() => void) | null>(null);

  const edgeSourceSignature = useMemo(
    () =>
      features
        .filter((feature) => feature.visible && !feature.suppressed)
        .map((feature) => `${feature.id}:${feature.timestamp}:${feature.mesh instanceof THREE.Mesh ? feature.mesh.uuid : ''}`)
        .join("|"),
    [features],
  );

  // Compute a stable string key so that visibleBodyFeatureIds is only a new
  // Set reference when the actual IDs change — not on every features re-render.
  const visibleBodyFeatureIdsKey = useMemo(
    () =>
      features
        .filter((feature) => feature.visible && !feature.suppressed && feature.type !== "sketch")
        .map((feature) => feature.id)
        .sort()
        .join(","),
    [features],
  );
  const visibleBodyFeatureIds = useMemo(
    () => new Set(visibleBodyFeatureIdsKey ? visibleBodyFeatureIdsKey.split(",") : []),
    [visibleBodyFeatureIdsKey],
  );

  const edgeIdSet = useMemo(() => new Set(edgeIds), [edgeIds]);

  useEffect(() => {
    const sceneRef = _scene;
    const canvas = gl.domElement;
    const selectedLines = selectedLinesRef.current;
    const selectedEdges = selectedEdgesDataRef.current;
    return () => {
      if (hoverLineRef.current) {
        sceneRef.remove(hoverLineRef.current);
        hoverLineRef.current.geometry.dispose();
        hoverLineRef.current = null;
      }
      for (const line of allEdgeLinesRef.current) {
        sceneRef.remove(line);
        line.geometry.dispose();
      }
      allEdgeLinesRef.current = [];
      selectedLines.forEach((line) => {
        sceneRef.remove(line);
        line.geometry.dispose();
      });
      selectedLines.clear();
      selectedEdges.clear();
      if (cursorOnRef.current) {
        canvas.style.cursor = "";
        cursorOnRef.current = false;
      }
    };
  }, [_scene, gl]);

  const handleOccHover = useCallback((result: OccEdgePickResult | null) => {
    if (result && !result.bodyId) {
      // Guide line has no direct OCC body link. Still allow hover if there are
      // polyline data — the user can see the edge, so let them interact with it.
      // Resolution to an OCC body happens at click time; if that fails the click
      // handler silently no-ops (no body = can't fillet/chamfer, but hover
      // feedback + cursor change is still correct UX).
      const stored = result.mesh.userData['edgePolylines'] as Map<number, THREE.Vector3[]> | undefined;
      const pts = stored?.get(result.edgeId);
      if (!pts) {
        occHoverRef.current = null;
        invalidateCanvas();
        return;
      }
      // If curved edges are disallowed, reject curved polylines even without bodyId
      if (!allowCurvedEdges && polylineIsCurved(pts)) {
        occHoverRef.current = null;
        invalidateCanvas();
        return;
      }
    }
    if (result && !allowCurvedEdges) {
      // occDirect pick line or old pick line → use OCC tessellation polyline for curved check.
      // Merged guide line → use stored edgePolylines.
      const isOccDirectHover = result.mesh.userData['occDirect'] === true;
      const isTopologyHit = !isOccDirectHover && result.mesh.userData['edgePolylines'] !== undefined;
      if (isTopologyHit) {
        const stored = result.mesh.userData['edgePolylines'] as Map<number, THREE.Vector3[]> | undefined;
        const pts = stored?.get(result.edgeId);
        if (pts && polylineIsCurved(pts)) {
          occHoverRef.current = null;
          invalidateCanvas();
          return;
        }
      } else {
        const body = globalBRepBodyRegistry.get(result.bodyId);
        const occPolyline = body?._tessellation?.edgePolylines.get(result.edgeId);
        if (occPolyline && polylineIsCurved(occPolyline)) {
          occHoverRef.current = null;
          invalidateCanvas();
          return;
        }
      }
    }
    occHoverRef.current = result;
    invalidateCanvas();
  }, [allowCurvedEdges, invalidateCanvas]);

  const handleOccClick = useCallback((result: OccEdgePickResult) => {

    // Three hit types:
    // 1. occDirect pick line — invisible line with exact OCC edge IDs + body-local geometry
    // 2. Old-style pick line — no edgePolylines, OCC edge IDs, tessellation lookup
    // 3. Merged guide line — has edgePolylines, needs spatial remapping via findClosestOccEdge
    const isOccDirect = result.mesh.userData['occDirect'] === true;
    const isTopologyHit = !isOccDirect && result.mesh.userData['edgePolylines'] !== undefined;
    let polyline: THREE.Vector3[] | null = null;
    let displayPolyline: THREE.Vector3[] | null = null;
    let resolvedBodyId = result.bodyId;
    let resolvedEdgeId = result.edgeId;
    let sourceBody = globalBRepBodyRegistry.get(result.bodyId);
    let visualSourceFeatureId: string | undefined;

    if (isOccDirect || !isTopologyHit) {
      // OCC pick line hit: edge ID is already a correct OCC edge ID.
      // Look up the polyline from the body's tessellation and transform
      // to world space using the pick line's matrixWorld (= source mesh matrix).
      polyline = getOccEdgePolyline(result);
      displayPolyline = polyline;
    }

    if (!polyline) {
      // topology/merged guideLine hit (or OCC lookup failed): get stored world-space polyline.
      const stored = result.mesh.userData['edgePolylines'] as Map<number, THREE.Vector3[]> | undefined;
      polyline = stored?.get(result.edgeId) ?? null;
      displayPolyline = polyline;

      // For OCC bodies, resolve the topology index → nearest OCC tessellation edge ID
      // so that fillet/chamfer commit always receives a valid numeric OCC edge number.
      if (polyline) {
        const meshMatrix = (result.mesh.userData['meshMatrix'] as THREE.Matrix4 | undefined) ?? new THREE.Matrix4();
        const featureId = result.mesh.userData['sourceFeatureId'] as string | undefined;
        const occ = sourceBody?._tessellation
          ? findClosestOccEdge(sourceBody._tessellation, polyline, meshMatrix, allowCurvedEdges)
          : findClosestLiveOccEdge(polyline, allowCurvedEdges, resolvedBodyId, featureId, meshMatrix);
        if (occ) {
          polyline = occ.polylineWorld;
          resolvedEdgeId = occ.edgeId;
          if ('bodyId' in occ) {
            if (!resolvedBodyId && featureId) visualSourceFeatureId = featureId;
            resolvedBodyId = occ.bodyId;
            sourceBody = globalBRepBodyRegistry.get(resolvedBodyId);
          }
        }
      }
    }
    if (!polyline || !sourceBody || !resolvedBodyId) return;
    if (!allowCurvedEdges && polylineIsCurved(polyline)) return;
    const id = visualSourceFeatureId
      ? `occ:${resolvedBodyId}:${resolvedEdgeId}:feature:${visualSourceFeatureId}`
      : `occ:${resolvedBodyId}:${resolvedEdgeId}`;
    if (edgeIdSet.has(id)) {
      removeEdge(id);
      return;
    }
    selectedEdgesDataRef.current.set(id, displayPolyline ?? polyline);
    addEdge(id);
  }, [addEdge, removeEdge, edgeIdSet, allowCurvedEdges]);

  useOccEdgePicker({
    enabled,
    onHover: handleOccHover,
    onClick: handleOccClick,
  });

  useEffect(() => {
    let cancelled = false;
    let initialBuildHandle: number | null = null;
    let retryHandle: number | null = null;
    let attempts = 0;
    const maxAttempts = 24;
    for (const line of allEdgeLinesRef.current) {
      _scene.remove(line);
      line.geometry.dispose();
    }
    allEdgeLinesRef.current = [];
    if (!enabled) return undefined;

    const buildLines = () => {
      for (const line of allEdgeLinesRef.current) {
        _scene.remove(line);
        line.geometry.dispose();
      }
      const lines: THREE.LineSegments[] = [];
      _scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) && !(obj as THREE.Mesh).isMesh) return;
        const mesh = obj as THREE.Mesh;
        if (!mesh.visible) return;
        const featureId = mesh.userData.featureId as string | undefined;
        const bodyId = mesh.userData.brepBodyId as string | undefined;
        if (featureId && !visibleBodyFeatureIds.has(featureId)) return;
        if (!featureId && !bodyId) return;
        const resolved = resolveMeshOccTessellation(mesh);
        if (bodyId && !resolved) return;
        const batched = resolved
          ? buildBatchedEdgeLineGeometry(resolved.tess, allowCurvedEdges)
          : null;

        // Visible orange guide. When we have an OCC tessellation with edge
        // polylines, USE ONLY that — it carries OCC's authoritative boundary
        // edges (the actual CAD edges of each face). Mixing in the mesh-derived
        // topology/crease guides causes tessellation triangle edges on curved
        // surfaces to be drawn as creases (adjacent-triangle normal angle
        // exceeds the 20° crease threshold), producing iso-lines that wrap
        // the entire cylinder.
        //
        // The topology + crease guides remain as the fallback for legacy
        // meshes without an OCC body.
        const hasOccTess = !!resolved && (batched?.edgeIdsBySegment?.length ?? 0) > 0;
        const tessellationGuideResult = resolved
          ? buildTessellationGuideGeometry(resolved.tess, mesh.matrixWorld, allowCurvedEdges)
          : null;
        const topologyGuideResult = hasOccTess
          ? null
          : buildMeshTopologyGuideGeometry(mesh, allowCurvedEdges);
        const renderedGuideResult = hasOccTess
          ? null
          : buildMergedMeshCreaseGuideGeometry(mesh, allowCurvedEdges);
        const visibleGuideResult = hasOccTess
          ? tessellationGuideResult
          : allowCurvedEdges
            ? mergedGuideGeometryResults(topologyGuideResult, tessellationGuideResult, renderedGuideResult)
            : topologyGuideResult ?? renderedGuideResult ?? tessellationGuideResult;
        if (visibleGuideResult !== topologyGuideResult) disposeGuideGeometryResult(topologyGuideResult);
        if (visibleGuideResult !== tessellationGuideResult) disposeGuideGeometryResult(tessellationGuideResult);
        if (visibleGuideResult !== renderedGuideResult) disposeGuideGeometryResult(renderedGuideResult);
        if (!batched && !visibleGuideResult) return;
        if (visibleGuideResult) {
          const guideLine = new THREE.LineSegments(visibleGuideResult.geometry, allEdgesMat);
          guideLine.userData.edgeIdsBySegment = visibleGuideResult.edgeIdsBySegment;
          guideLine.userData.edgePolylines = visibleGuideResult.edgePolylines;
          guideLine.userData.brepBodyId = resolved?.bodyId ?? "";
          guideLine.userData.sourceFeatureId = featureId ?? "";
          guideLine.userData.meshMatrix = mesh.matrixWorld.clone();
          if (resolved?.bodyId) {
            guideLine.userData.brepBodyId = resolved.bodyId;
          }
          guideLine.frustumCulled = false;
          guideLine.matrixAutoUpdate = true;
          guideLine.renderOrder = EDGE_GUIDE_RENDER_ORDER;
          _scene.add(guideLine);
          lines.push(guideLine);
        }
        // Invisible OCC tessellation pick target — carries exact OCC edge IDs.
        // ALWAYS added alongside the visible guide so that the picker can match
        // against it directly. When hit, handleOccClick detects `occDirect` and
        // uses the OCC edge ID without spatial remapping — this avoids the
        // findClosestOccEdge mismatch that occurs when the merged visible guide
        // reassigns sequential IDs that don't match OCC topology.
        if (batched) {
          const pickLine = new THREE.LineSegments(batched.geometry, pickEdgesMat);
          pickLine.userData.edgeIdsBySegment = batched.edgeIdsBySegment;
          pickLine.userData.brepBodyId = resolved!.bodyId;
          pickLine.userData.occDirect = true;
          pickLine.frustumCulled = false;
          // Geometry is in body-local space; apply the mesh's world matrix so the
          // picker's screen-space distance check places segments correctly.
          pickLine.matrixAutoUpdate = false;
          pickLine.matrix.copy(mesh.matrixWorld);
          pickLine.matrixWorld.copy(mesh.matrixWorld);
          pickLine.renderOrder = EDGE_GUIDE_RENDER_ORDER;
          _scene.add(pickLine);
          lines.push(pickLine);
        }
      });
      allEdgeLinesRef.current = lines;
      invalidateCanvas();
      return lines.length;
    };

    const scheduleBuild = (delayMs: number) => {
      retryHandle = window.setTimeout(() => {
        retryHandle = null;
        if (cancelled) return;
        attempts += 1;
        const lineCount = buildLines();
        if (lineCount > 0 || attempts >= maxAttempts) return;
        scheduleBuild(125);
      }, delayMs);
    };

    initialBuildHandle = window.setTimeout(() => {
      initialBuildHandle = null;
      if (cancelled) return;
      const lineCount = buildLines();
      if (lineCount > 0) return;
      scheduleBuild(125);
    }, 250);

    // Expose buildLines so the rehydration effect can force a rebuild after OCC
    // bodies are re-registered (needed after full page refresh wipes the heap).
    triggerRebuildRef.current = buildLines;

    return () => {
      cancelled = true;
      triggerRebuildRef.current = null;
      if (initialBuildHandle !== null) window.clearTimeout(initialBuildHandle);
      if (retryHandle !== null) window.clearTimeout(retryHandle);
      for (const line of allEdgeLinesRef.current) {
        _scene.remove(line);
        line.geometry.dispose();
      }
      allEdgeLinesRef.current = [];
    };
  }, [enabled, _scene, allEdgesMat, pickEdgesMat, allowCurvedEdges, edgeSourceSignature, visibleBodyFeatureIds, invalidateCanvas]);

  // After page refresh the OCC WASM heap is wiped so the registry is empty even
  // though feature meshes are still in the scene.  Rebuild missing BRep bodies for
  // visible solid extrudes whenever edge-op mode is activated, then force a guide-
  // line rebuild so the orange lines carry a valid brepBodyId for click resolution.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    rehydrateMissingExtrudeOccBodies(features, sketches).then((rehydrated) => {
      if (cancelled || rehydrated === 0) return;
      // Bodies are now registered — rebuild guide lines so they get brepBodyId set.
      triggerRebuildRef.current?.();
      invalidateCanvas();
    });

    return () => { cancelled = true; };
  }, [enabled, features, sketches, invalidateCanvas]);

  useFrame(({ scene, invalidate }) => {
    if (!enabled) {
      /* eslint-disable-next-line react-hooks/immutability */
      allEdgesMat.opacity = 1;
      if (hoverLineRef.current) {
        scene.remove(hoverLineRef.current);
        hoverLineRef.current.geometry.dispose();
        hoverLineRef.current = null;
        renderedHoverIdRef.current = null;
      }
      if (selectedLinesRef.current.size > 0) {
        selectedLinesRef.current.forEach((line) => {
          scene.remove(line);
          line.geometry.dispose();
        });
        selectedLinesRef.current.clear();
        selectedEdgesDataRef.current.clear();
      }
      if (cursorOnRef.current) {
        /* eslint-disable-next-line react-hooks/immutability */
        gl.domElement.style.cursor = "";
        cursorOnRef.current = false;
      }
      return;
    }

    // Only drive continuous frames when something is actually animating (hover pulse
    // or selected-edge pulse). The static guide lines don't need per-frame redraws.
    if (occHoverRef.current || selectedLinesRef.current.size > 0) {
      invalidate();
    }

    const wantCursor = !!occHoverRef.current;
    if (wantCursor !== cursorOnRef.current) {
      gl.domElement.style.cursor = wantCursor ? "crosshair" : "";
      cursorOnRef.current = wantCursor;
    }

    const occHover = occHoverRef.current;
    if (occHover) {
      const id = occEdgeId(occHover);
      if (id !== renderedHoverIdRef.current || !hoverLineRef.current) {
        renderedHoverIdRef.current = id;
        // OCC body: get polyline from tessellation; topology guideLine: fall back to stored polyline.
        const hPts = getOccEdgePolyline(occHover)
          ?? (occHover.mesh.userData['edgePolylines'] as Map<number, THREE.Vector3[]> | undefined)?.get(occHover.edgeId)
          ?? null;
        if (hPts) {
          if (!hoverLineRef.current) {
            const line = new THREE.Line(buildPolylineGeometry(hPts), hoverMat);
            line.renderOrder = EDGE_HOVER_RENDER_ORDER;
            scene.add(line);
            hoverLineRef.current = line;
          } else {
            hoverLineRef.current.geometry.dispose();
            hoverLineRef.current.geometry = buildPolylineGeometry(hPts);
          }
        }
      }
    } else if (hoverLineRef.current) {
      scene.remove(hoverLineRef.current);
      hoverLineRef.current.geometry.dispose();
      hoverLineRef.current = null;
      renderedHoverIdRef.current = null;
    }

    selectedLinesRef.current.forEach((line, id) => {
      if (!edgeIdSet.has(id)) {
        scene.remove(line);
        line.geometry.dispose();
        selectedLinesRef.current.delete(id);
        selectedEdgesDataRef.current.delete(id);
      }
    });
    for (const id of edgeIds) {
      if (!selectedLinesRef.current.has(id)) {
        const edgeData = selectedEdgesDataRef.current.get(id);
        if (edgeData && edgeData.length >= 2) {
          const line = new THREE.Line(buildPolylineGeometry(edgeData), selectedMat);
          line.renderOrder = EDGE_SELECTED_RENDER_ORDER;
          scene.add(line);
          selectedLinesRef.current.set(id, line);
        }
      }
    }

    const now = performance.now();
    // Guide lines stay at static opacity — animating them every frame causes
    // an invalidate() → useFrame → invalidate() loop that locks the renderer
    // at 60fps even when nothing is changing.
    if (hoverLineRef.current) applyLinePulse(hoverLineRef.current, 1, now);
    selectedLinesRef.current.forEach((line) => {
      const material = line.material as THREE.Material;
      material.opacity = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(now * 0.006));
      material.transparent = true;
    });
  });

  return null;
}
