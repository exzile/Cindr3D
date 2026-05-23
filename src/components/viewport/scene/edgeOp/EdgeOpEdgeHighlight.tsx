/**
 * EdgeOpEdgeHighlight — generic edge picking + highlight overlay for
 * edge-modification tools (fillet, chamfer, …).
 *
 * Fillet and chamfer had near-identical bespoke copies of this; the only
 * differences are which dialog enables it, which store list it pushes to,
 * and the selected-edge colour. This is the single shared implementation —
 * thin per-tool wrappers (FilletEdgeHighlight / ChamferEdgeHighlight) just
 * pass config.
 *
 * Edge ID format: `${featureId}|${meshUuid}:${ax,ay,az}:${bx,by,bz}` — the
 * featureId prefix lets the commit find primitive features whose mesh is not
 * stored in feature.mesh. (Chamfer previously used the legacy prefix-less
 * format and so could not resolve primitives — fixed by sharing this.)
 *
 * Selection feedback: hovered and selected edge lines PULSE (opacity) and the
 * cursor switches to crosshair while hovering a pickable edge — see
 * `pickPulse.ts` (shared with the face pickers).
 */

import { useRef, useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  useFrame,
  useThree,
  invalidate as invalidateFrame,
} from "@react-three/fiber";
import {
  useEdgePicker,
  type EdgePickResult,
} from "../../../../hooks/useEdgePicker";
import { useFacePicker } from "../../../../hooks/useFacePicker";
import type { FacePickResult } from "../../../../types/face-picker.types";
import { extractEdgeTopology } from "../../../../engine/geometryEngine/core/solid/edgeTopology";
import { buildPolylineGeometry } from "../pickerGeometry";
import { applyLinePulse } from "../pickPulse";

/** Version tag matching nearestEdge.ts — bump both when lazy-fallback logic changes. */
const LAZY_TOPO_VERSION = 10;

interface EdgeOpEdgeHighlightProps {
  /** activeDialog matches this tool's dialog. */
  enabled: boolean;
  /** Current selected edge IDs from the store. */
  edgeIds: string[];
  /** Store action: add an edge ID. */
  addEdge: (id: string) => void;
  /** Store action: remove an edge ID (click toggles). */
  removeEdge: (id: string) => void;
  /** Selected-edge line colour (hover is always blue). */
  selectedColor: number;
  /** Whether this operation supports curved/circular edge chains. */
  allowCurvedEdges?: boolean;
  /**
   * 'edge' (default): user picks individual edges.
   * 'face': user clicks a face — all boundary edges of that face are added at once.
   * Used for Rule Fillet (Task 13) and Full-Round Fillet auto-pick (Task 12).
   */
  pickMode?: "edge" | "face";
  /**
   * Called in face mode after the boundary edges are added, with the
   * auto-computed inradius of the face boundary.
   * Used by the full-round fillet to set the radius automatically.
   */
  onFacePicked?: (inradius: number) => void;
}

/** Ordered points representing the picked edge: the full chained model edge
 *  when available, else the single hit segment. */
function edgePoints(result: EdgePickResult): THREE.Vector3[] {
  return result.chain && result.chain.length >= 2
    ? result.chain
    : [result.edgeVertexA, result.edgeVertexB];
}

/** Normalize to 4 dp so pick-precision drift doesn't create stale IDs (Task 15). */
const normCoord = (n: number) => +n.toFixed(4);

function edgeId(result: EdgePickResult): string {
  const fid = (result.mesh.userData.featureId as string | undefined) ?? "";
  const prefix = fid ? `${fid}|` : "";
  const pts = edgePoints(result)
    .map((p) => p.toArray().map(normCoord).join(","))
    .join(":");
  return `${prefix}${result.mesh.uuid}:${pts}`;
}

/**
 * Build edge IDs from a face boundary polygon (Task 13 / Rule fillet).
 * Each consecutive pair of boundary points becomes one edge ID, using the
 * world-space coordinate format that parseEdgeIds expects.
 */
function faceEdgeIds(result: FacePickResult): string[] {
  const fid = (result.mesh.userData.featureId as string | undefined) ?? "";
  const prefix = fid ? `${fid}|` : "";
  const uuid = result.mesh.uuid;
  const b = result.boundary;
  const ids: string[] = [];
  for (let i = 0; i + 1 < b.length; i++) {
    const a = b[i]
      .toArray()
      .map((n) => +n.toFixed(4))
      .join(",");
    const bk = b[i + 1]
      .toArray()
      .map((n) => +n.toFixed(4))
      .join(",");
    ids.push(`${prefix}${uuid}:${a}:${bk}`);
  }
  return ids;
}

/**
 * Compute the inradius of a boundary polygon = min distance from centroid to
 * any boundary edge. Used for full-round fillet auto-radius (Task 12).
 */
function faceInradius(
  boundary: THREE.Vector3[],
  centroid: THREE.Vector3,
): number {
  let minDist = Infinity;
  const _seg = new THREE.Vector3();
  const _cp = new THREE.Vector3();
  for (let i = 0; i + 1 < boundary.length; i++) {
    const a = boundary[i];
    const b = boundary[i + 1];
    _seg.subVectors(b, a);
    const lenSq = _seg.lengthSq();
    if (lenSq < 1e-12) continue;
    const t = THREE.MathUtils.clamp(
      _cp.subVectors(centroid, a).dot(_seg) / lenSq,
      0,
      1,
    );
    const dist = centroid.distanceTo(a.clone().addScaledVector(_seg, t));
    if (dist < minDist) minDist = dist;
  }
  return Math.max(0.01, minDist === Infinity ? 0 : minDist);
}

function isCurvedEdge(
  edge: { polyline?: THREE.Vector3[] } | EdgePickResult,
): boolean {
  const pts = "mesh" in edge ? edgePoints(edge) : edge.polyline;
  return (pts?.length ?? 0) > 2;
}

function guideEdgesForOverlay(
  displayEdges: Array<{ polyline: THREE.Vector3[] }> | undefined,
  ghostEdges: Array<{ polyline: THREE.Vector3[] }> | undefined,
  topoEdges: Array<{ polyline: THREE.Vector3[] }>,
  allowCurvedEdges: boolean,
): Array<{ polyline: THREE.Vector3[] }> {
  const edges = displayEdges?.length
    ? displayEdges
    : ghostEdges?.length
      ? ghostEdges
      : topoEdges;
  return allowCurvedEdges ? edges : edges.filter((edge) => !isCurvedEdge(edge));
}

function pointSegmentDistanceSq(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
): number {
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-12) return p.distanceToSquared(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / lenSq, 0, 1);
  return p.distanceToSquared(a.clone().addScaledVector(ab, t));
}

function pointPolylineDistanceSq(
  p: THREE.Vector3,
  polyline: THREE.Vector3[],
): number {
  let best = Infinity;
  for (let i = 0; i + 1 < polyline.length; i++) {
    best = Math.min(
      best,
      pointSegmentDistanceSq(p, polyline[i], polyline[i + 1]),
    );
  }
  return best;
}

function filterStaleDisplayEdges(
  displayEdges: Array<{ polyline: THREE.Vector3[] }> | undefined,
  ghostEdges: Array<{ polyline: THREE.Vector3[] }> | undefined,
  bounds: THREE.Box3 | null,
): Array<{ polyline: THREE.Vector3[] }> | undefined {
  if (!displayEdges?.length) return displayEdges;
  const diag = Math.max(bounds?.min.distanceTo(bounds.max) ?? 1, 1);
  const nearSq = Math.max((diag * 1.5e-2) ** 2, 1e-6);
  const curveEdges = displayEdges.filter(
    (edge) => (edge.polyline?.length ?? 0) > 2,
  );
  return displayEdges.filter((edge) => {
    const pl = edge.polyline;
    if (!pl || pl.length < 2) return false;
    if (ghostEdges?.length) {
      let nearGhost = 0;
      for (const p of pl) {
        if (
          ghostEdges.some(
            (ghost) => pointPolylineDistanceSq(p, ghost.polyline) <= nearSq,
          )
        )
          nearGhost++;
      }
      if (nearGhost / pl.length >= 0.5) return false;
    }
    if (pl.length === 2 && curveEdges.length > 0) {
      const aNearCurve = curveEdges.some(
        (curve) => pointPolylineDistanceSq(pl[0], curve.polyline) <= nearSq,
      );
      const bNearCurve = curveEdges.some(
        (curve) => pointPolylineDistanceSq(pl[1], curve.polyline) <= nearSq,
      );
      if (aNearCurve || bNearCurve) {
        const mid = pl[0].clone().add(pl[1]).multiplyScalar(0.5);
        const midNearCurve = curveEdges.some(
          (curve) => pointPolylineDistanceSq(mid, curve.polyline) <= nearSq * 4,
        );
        if (!midNearCurve) return false;
      }
    }
    return true;
  });
}

function guideSegmentIsVisible(
  a: THREE.Vector3,
  b: THREE.Vector3,
  camera: THREE.Camera,
  raycaster: THREE.Raycaster,
  pickables: THREE.Mesh[],
): boolean {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const ndc = mid.clone().project(camera);
  if (ndc.z > 1) return false;
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
  const distToEdge = raycaster.ray.origin.distanceTo(mid);
  if (distToEdge < 1e-6) return true;
  raycaster.far = distToEdge * 1.5;
  const hits = raycaster.intersectObjects(pickables, false);
  if (hits.length === 0) return true;
  const eps = Math.max(distToEdge * 0.005, 1e-3);
  return hits[0].distance >= distToEdge - eps;
}

export default function EdgeOpEdgeHighlight({
  enabled,
  edgeIds,
  addEdge,
  removeEdge,
  selectedColor,
  allowCurvedEdges = false,
  pickMode = "edge",
  onFacePicked,
}: EdgeOpEdgeHighlightProps) {
  // Per-instance materials (NOT module singletons) so we can pulse opacity
  // without mutating shared state. Disposed on unmount.
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
  // Orange overlay drawn under hover/selected to show all pickable guide edges.
  // while the edge-op dialog is open. Lets the user see what's selectable
  // before they hover. Pulses subtly so it reads as interactive without
  // competing with hover/selection.
  const allEdgesMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0xff7a00,
        transparent: true,
        depthTest: true,
        depthWrite: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      hoverMat.dispose();
    },
    [hoverMat],
  );
  useEffect(
    () => () => {
      selectedMat.dispose();
    },
    [selectedMat],
  );
  useEffect(
    () => () => {
      allEdgesMat.dispose();
    },
    [allEdgesMat],
  );

  const allEdgesRef = useRef<THREE.LineSegments | null>(null);

  const hoverLineRef = useRef<THREE.Line | null>(null);
  const hoverResultRef = useRef<EdgePickResult | null>(null);
  // Identity of the hover edge whose geometry is currently built. The pulse
  // keeps the demand loop running (invalidate()), so without this the hover
  // line's BufferGeometry was disposed + rebuilt EVERY frame while the cursor
  // sat on one edge. `hoverResultRef` only changes on pointermove; the stable
  // edge id changes only when a DIFFERENT model edge is hovered — so we rebuild
  // exactly when the rendered polyline would actually differ.
  const renderedHoverRef = useRef<EdgePickResult | null>(null);
  const renderedHoverIdRef = useRef<string | null>(null);

  const selectedLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  // id → the full ordered polyline of the selected model edge (≥2 points).
  const selectedEdgesDataRef = useRef<Map<string, THREE.Vector3[]>>(new Map());

  // Imperative cursor: a reactive `hovering` state would re-render on every
  // pointermove (the dep-storm the R3F patterns warn about), so the cursor is
  // driven in useFrame from the hover ref instead. cursorOnRef avoids
  // redundant DOM writes every frame.
  const { scene: _scene, gl, camera } = useThree();
  const cursorOnRef = useRef(false);

  // Unmount cleanup — useFrame's `!enabled` branch only fires while still
  // mounted; if the parent unmounts while enabled (HMR / route swap) the
  // hover line + every selected highlight would be stranded with un-disposed
  // BufferGeometries.
  useEffect(() => {
    const sceneRef = _scene;
    const selectedLines = selectedLinesRef.current;
    const selectedEdges = selectedEdgesDataRef.current;
    const canvas = gl.domElement;
    return () => {
      if (hoverLineRef.current) {
        sceneRef.remove(hoverLineRef.current);
        hoverLineRef.current.geometry.dispose();
        hoverLineRef.current = null;
      }
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

  const handleHover = useCallback(
    (result: EdgePickResult | null) => {
      if (result && !allowCurvedEdges && isCurvedEdge(result)) {
        hoverResultRef.current = null;
        invalidateFrame();
        return;
      }
      hoverResultRef.current = result;
      // Wake the demand loop so useFrame applies the hover change. Without
      // this, useFrame would need to invalidate every frame (~60 Hz) just to
      // stay alive in case the cursor moved — wasted renders while the user
      // is sitting still with the picker active. Invalidating only on
      // hover-change means an idle picker truly idles.
      invalidateFrame();
    },
    [allowCurvedEdges],
  );

  // Set form of edgeIds — used both in handleClick (toggle existing edge =
  // O(1) lookup) and inside useFrame for the selected-line cleanup pass.
  // Rebuilt only when the prop changes, not on every frame: while the picker
  // is animating its pulse, useFrame can run at 60Hz; building this Set per
  // frame for a ~100-segment circle-rim selection is ~6000 ops/sec saved.
  const edgeIdSet = useMemo(() => new Set(edgeIds), [edgeIds]);

  const handleClick = useCallback(
    (result: EdgePickResult) => {
      if (!allowCurvedEdges && isCurvedEdge(result)) return;
      const id = edgeId(result);
      // Toggle: clicking an already-selected edge deselects it.
      if (edgeIdSet.has(id)) {
        removeEdge(id);
        return;
      }
      addEdge(id);
      selectedEdgesDataRef.current.set(
        id,
        edgePoints(result).map((p) => p.clone()),
      );
    },
    [addEdge, removeEdge, edgeIdSet, allowCurvedEdges],
  );

  useEdgePicker({
    enabled: enabled && pickMode === "edge",
    onHover: handleHover,
    onClick: handleClick,
    filter: (m) => typeof m.userData.featureId === "string",
  });

  // Face pick mode (Task 13 / Rule fillet, Task 12 / Full-round):
  // clicking a face adds all its boundary edges in one shot.
  const handleFaceClick = useCallback(
    (result: FacePickResult) => {
      const ids = faceEdgeIds(result);
      for (const id of ids) {
        if (!edgeIdSet.has(id)) {
          addEdge(id);
        }
      }
      if (onFacePicked) {
        onFacePicked(faceInradius(result.boundary, result.centroid));
      }
      invalidateFrame();
    },
    [addEdge, edgeIdSet, onFacePicked],
  );

  useFacePicker({
    enabled: enabled && pickMode === "face",
    onClick: handleFaceClick,
    filter: (m) => typeof m.userData.featureId === "string",
  });

  // Build the all-edges overlay when the dialog opens. Walks every pickable
  // mesh in the scene, collects every segment of every display topology edge,
  // and packs them into one LineSegments — far cheaper than one Line per edge
  // for circle-rim bodies that have ~100 edges per body. Edge-cut results may
  // carry a clean `displayTopology` because their extracted post-CSG topology
  // can include noisy fan edges. Ghost topology remains searchable by the
  // picker; for older committed meshes that predate displayTopology, it is a
  // better visual fallback than the noisy post-cut extraction.
  useEffect(() => {
    if (!enabled) return;
    const sceneSnap = _scene;
    const positions: number[] = [];
    const _t1 = new THREE.Vector3();
    const _t2 = new THREE.Vector3();
    const pickables: THREE.Mesh[] = [];
    sceneSnap.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || typeof m.userData?.featureId !== "string") return;
      pickables.push(m);
    });
    const guideRaycaster = new THREE.Raycaster();
    for (const m of pickables) {
      m.updateWorldMatrix(true, false);
      const mw = m.matrixWorld;
      const geom = m.geometry;
      geom.computeBoundingBox();
      const geomBounds = geom.boundingBox;
      // Lazy topology extraction for old committed meshes that pre-date the
      // pre-toCreasedNormals extraction path (same fallback as nearestEdge.ts).
      // Without this, the overlay is silent on any fillet/chamfer committed
      // before topology stamping was added — the user sees no orange lines.
      const existingTopo = geom.userData.topology as
        | { edges?: unknown[] }
        | undefined;
      const topoV = geom.userData._topoV as number | undefined;
      const hasEdgeCutMetadata =
        !!geom.userData.displayTopology || !!geom.userData.ghostTopology;
      const staleTopology =
        topoV !== undefined ? topoV < LAZY_TOPO_VERSION : hasEdgeCutMetadata;
      if (!existingTopo?.edges?.length || staleTopology) {
        try {
          const diag = geomBounds
            ? geomBounds.min.distanceTo(geomBounds.max)
            : 1;
          const tol = Math.max(diag * 1e-4, 1e-5);
          const indexed = mergeVertices(geom, tol);
          const extracted = extractEdgeTopology(indexed);
          indexed.dispose();
          geom.userData.topology = extracted;
          geom.userData._topoV = LAZY_TOPO_VERSION;
        } catch {
          /* leave topology as-is — picker will retry on hover */
        }
      }
      const displayTopo = geom.userData.displayTopology as
        | { edges?: Array<{ polyline: THREE.Vector3[] }> }
        | undefined;
      const ghost = geom.userData.ghostTopology as
        | { edges?: Array<{ polyline: THREE.Vector3[] }> }
        | undefined;
      const topo = geom.userData.topology as
        | { edges?: Array<{ polyline: THREE.Vector3[] }> }
        | undefined;
      const topoEdges = topo?.edges ?? [];
      const displayEdges = staleTopology
        ? filterStaleDisplayEdges(displayTopo?.edges, ghost?.edges, geomBounds)
        : displayTopo?.edges;
      const edges = guideEdgesForOverlay(
        displayEdges,
        ghost?.edges,
        topoEdges,
        allowCurvedEdges,
      );
      for (const e of edges) {
        const pl = e.polyline;
        if (!pl || pl.length < 2) continue;
        for (let i = 0; i + 1 < pl.length; i++) {
          _t1.copy(pl[i]).applyMatrix4(mw);
          _t2.copy(pl[i + 1]).applyMatrix4(mw);
          if (
            !guideSegmentIsVisible(_t1, _t2, camera, guideRaycaster, pickables)
          )
            continue;
          positions.push(_t1.x, _t1.y, _t1.z, _t2.x, _t2.y, _t2.z);
        }
      }
    }
    if (positions.length === 0) return;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), 3),
    );
    const segs = new THREE.LineSegments(geom, allEdgesMat);
    segs.renderOrder = 1400; // above sketch display, under hover/selected.
    sceneSnap.add(segs);
    allEdgesRef.current = segs;
    invalidateFrame();
    return () => {
      sceneSnap.remove(segs);
      segs.geometry.dispose();
      allEdgesRef.current = null;
    };
    // Rebuild only when the overlay/tool or mesh topology inputs change. Selected
    // edgeIds are rendered by the lightweight selected-line pass below.
  }, [enabled, _scene, camera, allEdgesMat, allowCurvedEdges]);

  useFrame(({ scene, invalidate }) => {
    if (!enabled) {
      if (hoverLineRef.current) {
        scene.remove(hoverLineRef.current);
        hoverLineRef.current.geometry.dispose();
        hoverLineRef.current = null;
        renderedHoverRef.current = null;
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
    // Only keep the demand loop spinning while there's something visible to
    // animate (the pulse). When no edge is hovered AND no edge is selected,
    // the picker has nothing to render — let the canvas idle. Hover changes
    // already wake the loop via invalidate in handleHover; edgeIds changes
    // trigger a React re-render which runs useFrame at least once anyway.
    const hasVisible =
      hoverResultRef.current !== null ||
      selectedLinesRef.current.size > 0 ||
      edgeIds.length > 0 ||
      allEdgesRef.current !== null;
    if (hasVisible) invalidate();

    const hr = hoverResultRef.current;

    // Cursor: crosshair while hovering a pickable edge.
    const wantCursor = !!hr;
    if (wantCursor !== cursorOnRef.current) {
      gl.domElement.style.cursor = wantCursor ? "crosshair" : "";
      cursorOnRef.current = wantCursor;
    }

    // Hover line — draw the FULL chained model edge when available. Only
    // (re)build the geometry when the hovered model edge actually changes;
    // every frame in between is just the pulse mutating opacity.
    if (hr) {
      if (hr !== renderedHoverRef.current) {
        renderedHoverRef.current = hr;
        const id = edgeId(hr);
        if (id !== renderedHoverIdRef.current || !hoverLineRef.current) {
          renderedHoverIdRef.current = id;
          const hPts =
            hr.chain && hr.chain.length >= 2
              ? hr.chain
              : [hr.edgeVertexA, hr.edgeVertexB];
          if (!hoverLineRef.current) {
            const line = new THREE.Line(buildPolylineGeometry(hPts), hoverMat);
            line.renderOrder = 1401;
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
      renderedHoverRef.current = null;
      renderedHoverIdRef.current = null;
    }

    // Sync selected lines with edgeIds. Per-frame loop, so the membership
    // test goes through the memoised `edgeIdSet` instead of an
    // `Array.includes` scan — N×M -> N+M on selections with many rim
    // segments, AND the Set itself is built only when edgeIds changes
    // (not per frame).
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
          const line = new THREE.Line(
            buildPolylineGeometry(edgeData),
            selectedMat,
          );
          line.renderOrder = 1401;
          scene.add(line);
          selectedLinesRef.current.set(id, line);
        }
      }
    }

    // Pulse: hovered line bright, selected lines a subtler steady pulse.
    // applyLinePulse mutates material.opacity, and every selected line shares
    // ONE selectedMat (created once via useMemo), so calling it per-line
    // mutated the same material N times per frame with the same result. We
    // pulse the material reference once instead — every selected line picks
    // up the new opacity. The hover line has its own material.
    const now = performance.now();
    if (hoverLineRef.current) applyLinePulse(hoverLineRef.current, 1, now);
    const repSelected = selectedLinesRef.current.values().next().value as
      | THREE.Line
      | undefined;
    if (repSelected) applyLinePulse(repSelected, 1.0, now);
    // All-edges overlay: subtle 2 Hz opacity pulse so it reads as interactive
    // without competing with the brighter hover/selected lines.
    if (allEdgesRef.current) {
      const t = (now % 1000) / 1000; // 0..1 over 1s
      const material = allEdgesRef.current.material;
      if (material instanceof THREE.LineBasicMaterial) {
        material.opacity = 0.75 + 0.15 * Math.sin(t * Math.PI * 2);
      }
    }
  });

  return null;
}
