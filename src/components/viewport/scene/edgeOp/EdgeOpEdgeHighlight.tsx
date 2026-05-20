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

import { useRef, useCallback, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useFrame, useThree, invalidate as invalidateFrame } from '@react-three/fiber';
import { useEdgePicker, type EdgePickResult } from '../../../../hooks/useEdgePicker';
import { extractEdgeTopology } from '../../../../engine/geometryEngine/core/solid/edgeTopology';
import { buildPolylineGeometry } from '../pickerGeometry';
import { applyLinePulse } from '../pickPulse';

/** Version tag matching nearestEdge.ts — bump both when lazy-fallback logic changes. */
const LAZY_TOPO_VERSION = 2;

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
}

/** Ordered points representing the picked edge: the full chained model edge
 *  when available, else the single hit segment. */
function edgePoints(result: EdgePickResult): THREE.Vector3[] {
  return result.chain && result.chain.length >= 2
    ? result.chain
    : [result.edgeVertexA, result.edgeVertexB];
}

function edgeId(result: EdgePickResult): string {
  const fid = (result.mesh.userData.featureId as string | undefined) ?? '';
  const prefix = fid ? `${fid}|` : '';
  const pts = edgePoints(result).map((p) => p.toArray().join(',')).join(':');
  return `${prefix}${result.mesh.uuid}:${pts}`;
}

export default function EdgeOpEdgeHighlight({
  enabled,
  edgeIds,
  addEdge,
  removeEdge,
  selectedColor,
}: EdgeOpEdgeHighlightProps) {
  // Per-instance materials (NOT module singletons) so we can pulse opacity
  // without mutating shared state. Disposed on unmount.
  const hoverMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: 0x2196f3, linewidth: 2, transparent: true, depthTest: false }),
    [],
  );
  const selectedMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: selectedColor, linewidth: 3, transparent: true, depthTest: false }),
    [selectedColor],
  );
  // Dark-orange overlay drawn under hover/selected to show ALL pickable edges
  // while the edge-op dialog is open. Lets the user see what's selectable
  // before they hover. Pulses subtly so it reads as interactive without
  // competing with hover/selection.
  const allEdgesMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: 0xb35900, transparent: true, depthTest: false }),
    [],
  );
  useEffect(() => () => { hoverMat.dispose(); }, [hoverMat]);
  useEffect(() => () => { selectedMat.dispose(); }, [selectedMat]);
  useEffect(() => () => { allEdgesMat.dispose(); }, [allEdgesMat]);

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
  const { scene: _scene, gl } = useThree();
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
        /* eslint-disable-next-line react-hooks/immutability */
        canvas.style.cursor = '';
        cursorOnRef.current = false;
      }
    };
  }, [_scene, gl]);

  const handleHover = useCallback((result: EdgePickResult | null) => {
    hoverResultRef.current = result;
    // Wake the demand loop so useFrame applies the hover change. Without
    // this, useFrame would need to invalidate every frame (~60 Hz) just to
    // stay alive in case the cursor moved — wasted renders while the user
    // is sitting still with the picker active. Invalidating only on
    // hover-change means an idle picker truly idles.
    invalidateFrame();
  }, []);

  // Set form of edgeIds — used both in handleClick (toggle existing edge =
  // O(1) lookup) and inside useFrame for the selected-line cleanup pass.
  // Rebuilt only when the prop changes, not on every frame: while the picker
  // is animating its pulse, useFrame can run at 60Hz; building this Set per
  // frame for a ~100-segment circle-rim selection is ~6000 ops/sec saved.
  const edgeIdSet = useMemo(() => new Set(edgeIds), [edgeIds]);

  const handleClick = useCallback((result: EdgePickResult) => {
    const id = edgeId(result);
    // Toggle: clicking an already-selected edge deselects it.
    if (edgeIdSet.has(id)) {
      removeEdge(id);
      return;
    }
    addEdge(id);
    selectedEdgesDataRef.current.set(id, edgePoints(result).map((p) => p.clone()));
  }, [addEdge, removeEdge, edgeIdSet]);

  useEdgePicker({
    enabled,
    onHover: handleHover,
    onClick: handleClick,
    filter: (m) => typeof m.userData.featureId === 'string',
  });

  // Build the all-edges overlay when the dialog opens. Walks every pickable
  // mesh in the scene, collects every segment of every edge in BOTH the live
  // topology and the ghostTopology (pre-cut edges from prior fillet/chamfer),
  // and packs them into one LineSegments — far cheaper than one Line per edge
  // for circle-rim bodies that have ~100 edges per body.
  useEffect(() => {
    if (!enabled) return;
    const sceneSnap = _scene;
    const positions: number[] = [];
    const _t1 = new THREE.Vector3();
    const _t2 = new THREE.Vector3();
    sceneSnap.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || typeof m.userData?.featureId !== 'string') return;
      m.updateWorldMatrix(true, false);
      const mw = m.matrixWorld;
      const geom = m.geometry;
      // Lazy topology extraction for old committed meshes that pre-date the
      // pre-toCreasedNormals extraction path (same fallback as nearestEdge.ts).
      // Without this, the overlay is silent on any fillet/chamfer committed
      // before topology stamping was added — the user sees no orange lines.
      const existingTopo = geom.userData.topology as { edges?: unknown[] } | undefined;
      if (!existingTopo?.edges?.length || geom.userData._topoV !== LAZY_TOPO_VERSION) {
        try {
          geom.computeBoundingBox();
          const bb = geom.boundingBox;
          const diag = bb ? bb.min.distanceTo(bb.max) : 1;
          const tol = Math.max(diag * 1e-4, 1e-5);
          const indexed = mergeVertices(geom, tol);
          const extracted = extractEdgeTopology(indexed);
          indexed.dispose();
          geom.userData.topology = extracted;
          geom.userData._topoV = LAZY_TOPO_VERSION;
        } catch { /* leave topology as-is — picker will retry on hover */ }
      }
      const topo = geom.userData.topology as { edges?: Array<{ polyline: THREE.Vector3[] }> } | undefined;
      const ghost = geom.userData.ghostTopology as { edges?: Array<{ polyline: THREE.Vector3[] }> } | undefined;
      const edges = [...(topo?.edges ?? []), ...(ghost?.edges ?? [])];
      for (const e of edges) {
        const pl = e.polyline;
        if (!pl || pl.length < 2) continue;
        for (let i = 0; i + 1 < pl.length; i++) {
          _t1.copy(pl[i]).applyMatrix4(mw);
          _t2.copy(pl[i + 1]).applyMatrix4(mw);
          positions.push(_t1.x, _t1.y, _t1.z, _t2.x, _t2.y, _t2.z);
        }
      }
    });
    if (positions.length === 0) return;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    const segs = new THREE.LineSegments(geom, allEdgesMat);
    segs.renderOrder = 99; // under hover (100) and selected (100)
    sceneSnap.add(segs);
    allEdgesRef.current = segs;
    invalidateFrame();
    return () => {
      sceneSnap.remove(segs);
      segs.geometry.dispose();
      allEdgesRef.current = null;
    };
  // edgeIds is included so a re-render after commit (which can swap geometry)
  // refreshes the overlay against the new mesh references.
  }, [enabled, _scene, allEdgesMat, edgeIds]);

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
        gl.domElement.style.cursor = '';
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
      hoverResultRef.current !== null || selectedLinesRef.current.size > 0 || edgeIds.length > 0 || allEdgesRef.current !== null;
    if (hasVisible) invalidate();

    const hr = hoverResultRef.current;

    // Cursor: crosshair while hovering a pickable edge.
    const wantCursor = !!hr;
    if (wantCursor !== cursorOnRef.current) {
      /* eslint-disable-next-line react-hooks/immutability */
      gl.domElement.style.cursor = wantCursor ? 'crosshair' : '';
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
          const hPts = hr.chain && hr.chain.length >= 2
            ? hr.chain
            : [hr.edgeVertexA, hr.edgeVertexB];
          if (!hoverLineRef.current) {
            const line = new THREE.Line(buildPolylineGeometry(hPts), hoverMat);
            line.renderOrder = 100;
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
          const line = new THREE.Line(buildPolylineGeometry(edgeData), selectedMat);
          line.renderOrder = 100;
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
    const repSelected = selectedLinesRef.current.values().next().value as THREE.Line | undefined;
    if (repSelected) applyLinePulse(repSelected, 1.0, now);
    // All-edges overlay: subtle 2 Hz opacity pulse so it reads as interactive
    // without competing with the brighter hover/selected lines.
    if (allEdgesRef.current) {
      const t = (now % 1000) / 1000; // 0..1 over 1s
      allEdgesMat.opacity = 0.45 + 0.25 * Math.sin(t * Math.PI * 2);
    }
  });

  return null;
}
