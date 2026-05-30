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
  expandChainEdges,
  getSelectableEdgesForBody,
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
import { ensureOccBodyForFeature } from "../../../../store/cad/slices/extrudeRevolve/extrudeCommitOccTarget";
// getOccSync is imported for the cold-start slow-retry logic in the build-loop
// effect (see below). collectTangentChainEdges is NOT used here — the hover/click
// chain expansion uses pure-geometry polylineTangentChain instead (no OCC WASM
// dependency, works with topology guides that lack OCC edge IDs).
// Eager OCC preload is handled by App.tsx (shows OccLoadingModal with progress).
import { getOccSync } from "../../../../engine/occ/loader";

interface EdgeOpEdgeHighlightProps {
  enabled: boolean;
  edgeIds: string[];
  addEdge: (id: string) => void;
  removeEdge: (id: string) => void;
  selectedColor: number;
  /**
   * Edge selection IDs that the live OCC validity probe flagged as unsolvable at
   * the current fillet/chamfer value (Fusion-style). These flash bright red
   * instead of the normal selected colour to warn the user before they click OK.
   */
  invalidEdgeIds?: string[];
  allowCurvedEdges?: boolean;
}

/**
 * Detect tangent-continuous edges from guide-line polylines — pure geometry, no OCC.
 * Two edges share a vertex when an endpoint of one is within `eps` of an endpoint of
 * the other. They are tangent when the dot product of their tangent directions at the
 * shared vertex exceeds `cosTol`.
 *
 * Returns a Set containing the seed edge ID and all transitively tangent-connected IDs.
 */
type EdgeChainPolyline = { x: number; y: number; z: number }[] | Float32Array;

function polylineTangentChain(
  edgePolylines: Map<number, EdgeChainPolyline>,
  seedEdgeId: number,
  eps = 1e-4,
  cosTol = 0.995,
): Set<number> {
  const result = new Set<number>();
  if (!edgePolylines.has(seedEdgeId)) return result;
  result.add(seedEdgeId);

  // Plain-object 3D helpers (no THREE.Vector3 dependency — tessellation
  // polylines may store plain {x,y,z} objects without .clone/.sub/.dot).
  type P3 = { x: number; y: number; z: number };
  const sub = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const len = (v: P3) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const norm = (v: P3): P3 => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
  const dot = (a: P3, b: P3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const dist2 = (a: P3, b: P3) => { const d = sub(a, b); return dot(d, d); };
  const pointCount = (pts: EdgeChainPolyline) => Array.isArray(pts) ? pts.length : pts.length / 3;
  const pointAt = (pts: EdgeChainPolyline, index: number): P3 => {
    if (Array.isArray(pts)) return pts[index];
    const offset = index * 3;
    return { x: pts[offset], y: pts[offset + 1], z: pts[offset + 2] };
  };

  // Pre-compute endpoints & tangent directions for every edge.
  interface EdgeEndpoints { start: P3; end: P3; dirStart: P3; dirEnd: P3; }
  const edgeData = new Map<number, EdgeEndpoints>();
  for (const [id, pts] of edgePolylines) {
    const count = pointCount(pts);
    if (count < 2) continue;
    const a = pointAt(pts, 0);
    const b = pointAt(pts, count - 1);
    const dStart = norm(sub(pointAt(pts, 1), a));
    const dEnd = norm(sub(b, pointAt(pts, count - 2)));
    edgeData.set(id, { start: a, end: b, dirStart: dStart, dirEnd: dEnd });
  }

  // Spatial index: bucket endpoints by rounded position key.
  const bucketSize = eps * 10;
  const bucketKey = (v: P3) =>
    `${Math.round(v.x / bucketSize)},${Math.round(v.y / bucketSize)},${Math.round(v.z / bucketSize)}`;
  const endpointBuckets = new Map<string, Array<{ id: number; isStart: boolean }>>();
  for (const [id, data] of edgeData) {
    for (const isStart of [true, false]) {
      const pt = isStart ? data.start : data.end;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const nKey = `${Math.round(pt.x / bucketSize) + dx},${Math.round(pt.y / bucketSize) + dy},${Math.round(pt.z / bucketSize) + dz}`;
            let bucket = endpointBuckets.get(nKey);
            if (!bucket) { bucket = []; endpointBuckets.set(nKey, bucket); }
            bucket.push({ id, isStart });
          }
        }
      }
    }
  }

  // BFS from seed.
  const queue = [seedEdgeId];
  const eps2 = eps * eps;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curData = edgeData.get(cur);
    if (!curData) continue;
    for (const isStartOfCur of [true, false] as const) {
      const curPt = isStartOfCur ? curData.start : curData.end;
      const curDir = isStartOfCur ? curData.dirStart : curData.dirEnd;
      const key = bucketKey(curPt);
      const candidates = endpointBuckets.get(key);
      if (!candidates) continue;
      for (const cand of candidates) {
        if (cand.id === cur || result.has(cand.id)) continue;
        const candData = edgeData.get(cand.id);
        if (!candData) continue;
        const candPt = cand.isStart ? candData.start : candData.end;
        if (dist2(curPt, candPt) > eps2) continue;
        const candDir = cand.isStart ? candData.dirStart : candData.dirEnd;
        if (Math.abs(dot(curDir, candDir)) > cosTol) {
          result.add(cand.id);
          queue.push(cand.id);
        }
      }
    }
  }
  return result;
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
  invalidEdgeIds,
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
  // Bright red material for edges the live OCC validity probe rejected at the
  // current value (Fusion-style "not possible" warning).
  const invalidMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0xff2222,
        linewidth: 3,
        transparent: true,
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
  useEffect(() => () => invalidMat.dispose(), [invalidMat]);

  // Mirror the invalid-edge set into a ref so the useFrame loop reads the latest
  // without rebinding (the set changes as the probe result updates). The sync
  // effect lives after the useThree() call below (it needs invalidate()).
  const invalidIdSetRef = useRef<Set<string>>(new Set());

  const allEdgeLinesRef = useRef<THREE.LineSegments[]>([]);
  const hoverLineRef = useRef<THREE.Line | null>(null);
  const occHoverRef = useRef<OccEdgePickResult | null>(null);
  const renderedHoverIdRef = useRef<string | null>(null);
  const selectedLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  const selectedEdgesDataRef = useRef<Map<string, THREE.Vector3[]>>(new Map());
  /** Edge IDs whose display polyline was expanded to a tangent chain (segment-pair format for LineSegments). */
  const selectedChainIdsRef = useRef<Set<string>>(new Set());
  const cursorOnRef = useRef(false);
  const { scene: _scene, gl, invalidate: invalidateCanvas } = useThree();
  const features = useCADStore((state) => state.features);
  const sketches = useCADStore((state) => state.sketches);

  // Sync the invalid-edge set ref + kick a frame so the red flash appears/clears
  // even when the camera is idle (frameloop="demand").
  const invalidKey = (invalidEdgeIds ?? []).join("|");
  useEffect(() => {
    invalidIdSetRef.current = new Set(invalidEdgeIds ?? []);
    invalidateCanvas();
    // Keyed on invalidKey (joined string) so the effect only re-runs when the SET
    // of invalid ids actually changes, not on every new array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalidKey, invalidateCanvas]);

  // Ref exposed to the rehydration effect so it can force a guide-line rebuild
  // after OCC bodies are re-registered (needed after full page refresh).
  const triggerRebuildRef = useRef<(() => void) | null>(null);

  const edgeSourceMeta = useMemo(() => {
    const signatureParts: string[] = [];
    const visibleBodyIds: string[] = [];

    for (const feature of features) {
      if (!feature.visible || feature.suppressed) continue;

      signatureParts.push(
        `${feature.id}:${feature.timestamp}:${feature.mesh instanceof THREE.Mesh ? feature.mesh.uuid : ''}`,
      );
      if (feature.type !== "sketch") visibleBodyIds.push(feature.id);
    }

    visibleBodyIds.sort();
    return {
      edgeSourceSignature: signatureParts.join("|"),
      visibleBodyFeatureIdsKey: visibleBodyIds.join(","),
    };
  }, [features]);

  // Keep the Set stable unless the actual visible body IDs change.
  const { edgeSourceSignature, visibleBodyFeatureIdsKey } = edgeSourceMeta;
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
    const selectedChainIds = selectedChainIdsRef.current;
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
      selectedChainIds.clear();
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

    // Expand to full tangent chain for visual display so that clicking one polygon
    // segment of a curved edge selects the entire arc visually.
    // Uses the guide line's edgePolylines (pure geometry, no OCC WASM needed).
    let finalDisplay = displayPolyline ?? polyline;
    // Resolve edgePolylines (+ authoritative chainId map) — may come from the hit
    // mesh directly, or from the sibling visible guide line when the hit landed on
    // an occDirect pick line (which carries no edgePolylines/chainIdByEdgeId).
    let guidePolylines = result.mesh.userData['edgePolylines'] as Map<number, THREE.Vector3[]> | undefined;
    let chainMap = result.mesh.userData['chainIdByEdgeId'] as Map<number, number> | undefined;
    if (!guidePolylines) {
      for (const line of allEdgeLinesRef.current) {
        if (line.userData['occDirect']) continue;
        const lineBodyId = line.userData['brepBodyId'] as string | undefined;
        if (lineBodyId === resolvedBodyId && line.userData['edgePolylines']) {
          guidePolylines = line.userData['edgePolylines'] as Map<number, THREE.Vector3[]>;
          chainMap = line.userData['chainIdByEdgeId'] as Map<number, number> | undefined;
          break;
        }
      }
    }

    const buildChainDisplay = (chainSet: Set<number>): THREE.Vector3[] | null => {
      if (!guidePolylines || chainSet.size <= 1) return null;
      const chainPts: THREE.Vector3[] = [];
      for (const eid of chainSet) {
        const pts = guidePolylines.get(eid);
        if (!pts || pts.length < 2) continue;
        // Segment pairs for LineSegments.
        for (let i = 0; i + 1 < pts.length; i++) chainPts.push(pts[i], pts[i + 1]);
      }
      return chainPts.length >= 2 ? chainPts : null;
    };

    let isChainExpanded = false;
    if (chainMap && guidePolylines) {
      // Authoritative chainId expansion. With analytical arcs each arc is ONE OCC edge,
      // so the clicked edgeId is already canonical: no Math.min normalization needed.
      const chainSet = expandChainEdges(chainMap, guidePolylines, result.edgeId);
      const chainPts = buildChainDisplay(chainSet);
      if (chainPts) {
        isChainExpanded = true;
        finalDisplay = chainPts;
      }
    } else if (guidePolylines && guidePolylines.size > 1) {
      // Non-OCC mesh fallback: geometric tangent BFS +
      // Math.min canonical normalization to stabilise repeat clicks on polygon arcs.
      const chainSet = polylineTangentChain(guidePolylines, result.edgeId);
      if (chainSet.size <= 1 && resolvedEdgeId !== result.edgeId) {
        const altChain = polylineTangentChain(guidePolylines, resolvedEdgeId);
        if (altChain.size > chainSet.size) {
          for (const eid of altChain) chainSet.add(eid);
        }
      }

      if (chainSet.size > 1) {
        const tessPolylines = sourceBody._tessellation?.edgePolylines;
        if (tessPolylines && tessPolylines.size > 0) {
          const occChain = polylineTangentChain(tessPolylines, resolvedEdgeId);
          if (occChain.size > 1) {
            resolvedEdgeId = Math.min(...occChain);
          }
        }
        const chainPts = buildChainDisplay(chainSet);
        if (chainPts) {
          isChainExpanded = true;
          finalDisplay = chainPts;
        }
      }
    }

    // Compute the selection ID AFTER chain normalization so that clicking any
    // segment of the same tangent chain produces the same canonical ID.
    const id = visualSourceFeatureId
      ? `occ:${resolvedBodyId}:${resolvedEdgeId}:feature:${visualSourceFeatureId}`
      : `occ:${resolvedBodyId}:${resolvedEdgeId}`;

    if (edgeIdSet.has(id)) {
      removeEdge(id);
      selectedChainIdsRef.current.delete(id);
      return;
    }
    if (isChainExpanded) {
      selectedChainIdsRef.current.add(id);
    }
    selectedEdgesDataRef.current.set(id, finalDisplay);
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
    // Fast phase: 24 × 125 ms = 3 s (bodies already live from current session).
    // Slow phase: 2 s intervals while OCC WASM is still loading after a page
    // refresh. Stopped once OCC is ready (the rehydration effect's
    // triggerRebuildRef callback is the primary mechanism; this is a safety net).
    const maxFastAttempts = 24;
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
        // OCC-12.B1 — authoritative selectable-edge metadata for this OCC body
        // (filletable filter + chainId). null when the flag is off / OCC body gone.
        const meta = resolved ? getSelectableEdgesForBody(resolved.bodyId) : null;
        const batched = resolved
          ? buildBatchedEdgeLineGeometry(resolved.tess, allowCurvedEdges, meta)
          : null;

        // Visible orange guide. When we have an OCC tessellation with edge
        // polylines, USE ONLY that — it carries OCC's authoritative boundary
        // edges (the actual CAD edges of each face). Mixing in the mesh-derived
        // topology/crease guides causes tessellation triangle edges on curved
        // surfaces to be drawn as creases (adjacent-triangle normal angle
        // exceeds the 20° crease threshold), producing iso-lines that wrap
        // the entire cylinder.
        //
        // IMPORTANT: hasOccTess is based purely on whether we have an OCC body,
        // NOT on whether batched has straight edges. With analytical circle edges
        // (MakeEdge_8), circle edge polylines are curved and filtered from batched
        // when allowCurvedEdges=false — but that must not cause fallback to the
        // THREE.js crease guide, which draws all triangle mesh edges on the
        // curved surface.
        //
        // The topology + crease guides remain as the fallback for legacy
        // meshes WITHOUT a featureId (standalone THREE.js geometry). Feature
        // meshes (featureId set) are CAD bodies — they must ONLY show OCC-
        // authoritative edges. If OCC isn't available for a feature mesh, show
        // nothing rather than falling back to THREE.js crease geometry, which
        // draws all triangle edges on curved surfaces as horizontal iso-lines.
        const hasOccTess = !!resolved;
        const allowCreaseFallback = !featureId;
        const tessellationGuideResult = resolved
          ? buildTessellationGuideGeometry(resolved.tess, mesh.matrixWorld, allowCurvedEdges, meta)
          : null;
        const topologyGuideResult = (hasOccTess || !allowCreaseFallback)
          ? null
          : buildMeshTopologyGuideGeometry(mesh, allowCurvedEdges);
        const renderedGuideResult = (hasOccTess || !allowCreaseFallback)
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
          guideLine.userData.chainIdByEdgeId = visibleGuideResult.chainIdByEdgeId;
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
        if (lineCount > 0) return;
        if (attempts < maxFastAttempts) {
          // Still in the fast-retry window — keep checking at 125 ms.
          scheduleBuild(125);
        } else if (!getOccSync()) {
          // OCC WASM is still loading after a cold-start page refresh.
          // Slow-poll at 2 s so orange lines appear as soon as the STEP
          // restore completes, even if the fast window already elapsed.
          scheduleBuild(2000);
        } else {
          // else: OCC is loaded but lines are still empty (non-OCC body or
          // unrecoverable STEP data). The rehydration-effect triggerRebuildRef
          // callback is the primary async mechanism and may still succeed.
        }
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

    // Replay ALL visible solid features (not just the latest) so that every
    // extrude body is rebuilt with analytical arc edges when possible.
    // ensureOccBodyForFeature tries replay first (which uses the latest
    // analytical builders), falling back to STEP restore only when replay fails.
    const candidates = features.filter(
      (feature) =>
        feature.visible &&
        !feature.suppressed &&
        feature.type !== "sketch" &&
        feature.mesh instanceof THREE.Mesh,
    );
    Promise.all(
      candidates.map((feature) =>
        ensureOccBodyForFeature(feature, features, sketches).then((ok) => {
          return ok;
        }),
      ),
    ).then((results) => {
      if (cancelled) return;
      if (!results.some(Boolean)) return;
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

        // Remove any existing hover line so we can create the correct type
        // (Line vs LineSegments may change depending on tangent-chain expansion).
        if (hoverLineRef.current) {
          scene.remove(hoverLineRef.current);
          hoverLineRef.current.geometry.dispose();
          hoverLineRef.current = null;
        }

        // Expand to the full tangent chain so that hovering over any single polygon
        // segment of a curved edge (e.g. the arc of a half-circle extrude) highlights
        // the entire edge instead of one tiny tessellation segment.
        //
        // Uses the guide line's own edgePolylines (pure geometry, no OCC WASM needed).
        // This works for both tessellation guides (OCC edge IDs) and topology guides
        // (sequential IDs) — it only relies on endpoint proximity + tangent direction.
        let builtChain = false;
        let guidePolylines = occHover.mesh.userData['edgePolylines'] as Map<number, THREE.Vector3[]> | undefined;
        let chainMap = occHover.mesh.userData['chainIdByEdgeId'] as Map<number, number> | undefined;
        // The invisible occDirect pick line doesn't carry edgePolylines — find
        // the sibling visible guide line for the same body.
        if (!guidePolylines && occHover.mesh.userData['occDirect'] && occHover.bodyId) {
          for (const line of allEdgeLinesRef.current) {
            if (line.userData['occDirect']) continue;
            if (line.userData['brepBodyId'] === occHover.bodyId && line.userData['edgePolylines']) {
              guidePolylines = line.userData['edgePolylines'] as Map<number, THREE.Vector3[]>;
              chainMap = line.userData['chainIdByEdgeId'] as Map<number, number> | undefined;
              break;
            }
          }
        }
        if (guidePolylines && guidePolylines.size > 1) {
          // Authoritative chainId grouping for OCC bodies (chainMap present),
          // polylineTangentChain geometric BFS for non-OCC mesh bodies.
          const chainSet = chainMap
            ? expandChainEdges(chainMap, guidePolylines, occHover.edgeId)
            : polylineTangentChain(guidePolylines, occHover.edgeId);
          if (chainSet.size > 1) {
            // Build world-space segment pairs from all chain edges' polylines.
            const positions: number[] = [];
            for (const eid of chainSet) {
              const pts = guidePolylines.get(eid);
              if (!pts || pts.length < 2) continue;
              for (let i = 0; i + 1 < pts.length; i++) {
                positions.push(
                  pts[i].x, pts[i].y, pts[i].z,
                  pts[i + 1].x, pts[i + 1].y, pts[i + 1].z,
                );
              }
            }
            if (positions.length >= 6) {
              // Runs once per hover-id change, not per frame.
              const geom = new THREE.BufferGeometry();
              geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
              const line = new THREE.LineSegments(geom, hoverMat);
              line.renderOrder = EDGE_HOVER_RENDER_ORDER;
              line.frustumCulled = false;
              scene.add(line);
              hoverLineRef.current = line;
              builtChain = true;
            }
          }
        }

        if (!builtChain) {
          // Fallback: single-edge world-space polyline (straight edges, or when OCC
          // is not available, or when the edge has no tangent neighbours).
          const hPts = getOccEdgePolyline(occHover)
            ?? (occHover.mesh.userData['edgePolylines'] as Map<number, THREE.Vector3[]> | undefined)?.get(occHover.edgeId)
            ?? null;
          if (hPts) {
            const line = new THREE.Line(buildPolylineGeometry(hPts), hoverMat);
            line.renderOrder = EDGE_HOVER_RENDER_ORDER;
            scene.add(line);
            hoverLineRef.current = line;
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
        selectedChainIdsRef.current.delete(id);
      }
    });
    for (const id of edgeIds) {
      if (!selectedLinesRef.current.has(id)) {
        const edgeData = selectedEdgesDataRef.current.get(id);
        if (edgeData && edgeData.length >= 2) {
          // Chain-expanded edges use LineSegments (segment-pair format);
          // single edges use Line (continuous polyline).
          const isChain = selectedChainIdsRef.current.has(id);
          const line = isChain
            ? new THREE.LineSegments(buildPolylineGeometry(edgeData), selectedMat)
            : new THREE.Line(buildPolylineGeometry(edgeData), selectedMat);
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
    const invalidSet = invalidIdSetRef.current;
    selectedLinesRef.current.forEach((line, id) => {
      const invalid = invalidSet.has(id);
      // Swap between the shared selected (purple) and invalid (red) singletons.
      const desiredMat = invalid ? invalidMat : selectedMat;
      if (line.material !== desiredMat) line.material = desiredMat;
      const material = line.material as THREE.LineBasicMaterial;
      // Invalid edges pulse faster + brighter so the "not possible" warning reads
      // unmistakably; valid edges keep the gentle selection pulse.
      material.opacity = invalid
        ? 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(now * 0.013))
        : 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(now * 0.006));
      material.transparent = true;
    });
  });

  return null;
}
