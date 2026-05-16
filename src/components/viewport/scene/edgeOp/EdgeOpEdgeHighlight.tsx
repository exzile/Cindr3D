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
import { useFrame, useThree } from '@react-three/fiber';
import { useEdgePicker, type EdgePickResult } from '../../../../hooks/useEdgePicker';
import { buildEdgeGeometry } from '../pickerGeometry';
import { applyLinePulse } from '../pickPulse';

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

function edgeId(result: EdgePickResult): string {
  const fid = (result.mesh.userData.featureId as string | undefined) ?? '';
  const prefix = fid ? `${fid}|` : '';
  return `${prefix}${result.mesh.uuid}:${result.edgeVertexA.toArray().join(',')}:${result.edgeVertexB.toArray().join(',')}`;
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
    () => new THREE.LineBasicMaterial({ color: selectedColor, linewidth: 2, transparent: true, depthTest: false }),
    [selectedColor],
  );
  useEffect(() => () => { hoverMat.dispose(); }, [hoverMat]);
  useEffect(() => () => { selectedMat.dispose(); }, [selectedMat]);

  const hoverLineRef = useRef<THREE.Line | null>(null);
  const hoverResultRef = useRef<EdgePickResult | null>(null);

  const selectedLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  const selectedEdgesDataRef = useRef<Map<string, { a: THREE.Vector3; b: THREE.Vector3 }>>(new Map());

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
  }, []);

  const handleClick = useCallback((result: EdgePickResult) => {
    const id = edgeId(result);
    // Toggle: clicking an already-selected edge deselects it.
    if (edgeIds.includes(id)) {
      removeEdge(id);
      return;
    }
    addEdge(id);
    selectedEdgesDataRef.current.set(id, {
      a: result.edgeVertexA.clone(),
      b: result.edgeVertexB.clone(),
    });
  }, [addEdge, removeEdge, edgeIds]);

  useEdgePicker({ enabled, onHover: handleHover, onClick: handleClick });

  useFrame(({ scene, invalidate }) => {
    if (!enabled) {
      if (hoverLineRef.current) {
        scene.remove(hoverLineRef.current);
        hoverLineRef.current.geometry.dispose();
        hoverLineRef.current = null;
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
    invalidate(); // keep rendering while picker is active (pulse + demand loop)

    const hr = hoverResultRef.current;

    // Cursor: crosshair while hovering a pickable edge.
    const wantCursor = !!hr;
    if (wantCursor !== cursorOnRef.current) {
      /* eslint-disable-next-line react-hooks/immutability */
      gl.domElement.style.cursor = wantCursor ? 'crosshair' : '';
      cursorOnRef.current = wantCursor;
    }

    // Hover line
    if (hr) {
      if (!hoverLineRef.current) {
        const line = new THREE.Line(buildEdgeGeometry(hr.edgeVertexA, hr.edgeVertexB), hoverMat);
        line.renderOrder = 100;
        scene.add(line);
        hoverLineRef.current = line;
      } else {
        hoverLineRef.current.geometry.dispose();
        hoverLineRef.current.geometry = buildEdgeGeometry(hr.edgeVertexA, hr.edgeVertexB);
      }
    } else if (hoverLineRef.current) {
      scene.remove(hoverLineRef.current);
      hoverLineRef.current.geometry.dispose();
      hoverLineRef.current = null;
    }

    // Sync selected lines with edgeIds
    selectedLinesRef.current.forEach((line, id) => {
      if (!edgeIds.includes(id)) {
        scene.remove(line);
        line.geometry.dispose();
        selectedLinesRef.current.delete(id);
        selectedEdgesDataRef.current.delete(id);
      }
    });
    for (const id of edgeIds) {
      if (!selectedLinesRef.current.has(id)) {
        const edgeData = selectedEdgesDataRef.current.get(id);
        if (edgeData) {
          const line = new THREE.Line(buildEdgeGeometry(edgeData.a, edgeData.b), selectedMat);
          line.renderOrder = 100;
          scene.add(line);
          selectedLinesRef.current.set(id, line);
        }
      }
    }

    // Pulse: hovered line bright, selected lines a subtler steady pulse.
    const now = performance.now();
    if (hoverLineRef.current) applyLinePulse(hoverLineRef.current, 1, now);
    selectedLinesRef.current.forEach((line) => applyLinePulse(line, 0.85, now));
  });

  return null;
}
