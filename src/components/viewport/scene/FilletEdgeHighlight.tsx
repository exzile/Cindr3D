/**
 * FilletEdgeHighlight — edge picking overlay for the Fillet dialog.
 * Active when activeDialog === 'fillet'. Uses useEdgePicker to highlight
 * edges on hover (blue) and add them to filletEdgeIds on click (orange).
 */

import { useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useCADStore } from '../../../store/cadStore';
import { useEdgePicker, type EdgePickResult } from '../../../hooks/useEdgePicker';
import { buildEdgeGeometry } from './pickerGeometry';

// ── Module-level material singletons ────────────────────────────────────────
const HOVER_MAT = new THREE.LineBasicMaterial({
  color: 0x2196f3,
  linewidth: 2,
  depthTest: false,
});

const SELECTED_MAT = new THREE.LineBasicMaterial({
  color: 0xff6600,
  linewidth: 2,
  depthTest: false,
});

// ── Helpers ──────────────────────────────────────────────────────────────────
// Edge ID format: `${featureId}|${meshUuid}:${ax,ay,az}:${bx,by,bz}`
// The featureId prefix (joined with `|`) lets commitFillet find the source
// feature directly via f.id lookup instead of matching by mesh UUID, which
// fails for primitive features whose mesh isn't stored in feature.mesh.
function edgeId(result: EdgePickResult): string {
  const fid = (result.mesh.userData.featureId as string | undefined) ?? '';
  const prefix = fid ? `${fid}|` : '';
  return `${prefix}${result.mesh.uuid}:${result.edgeVertexA.toArray().join(',')}:${result.edgeVertexB.toArray().join(',')}`;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function FilletEdgeHighlight() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const filletEdgeIds = useCADStore((s) => s.filletEdgeIds);
  const addFilletEdge = useCADStore((s) => s.addFilletEdge);
  const removeFilletEdge = useCADStore((s) => s.removeFilletEdge);

  const enabled = activeDialog === 'fillet';

  // Store hover result in a ref — no re-render needed, just update line geometry
  const hoverLineRef = useRef<THREE.Line | null>(null);
  const hoverResultRef = useRef<EdgePickResult | null>(null);

  // Selected edge lines: map from edgeId -> { line, edgeVertA, edgeVertB }
  const selectedLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  const selectedEdgesDataRef = useRef<Map<string, { a: THREE.Vector3; b: THREE.Vector3 }>>(new Map());

  // Unmount cleanup — see ChamferEdgeHighlight for the same pattern + reasoning.
  // Round 3 fixed disabled-branch leaks; round 5 caught that unmount-while-
  // enabled still strands the hover line + every selected-edge highlight.
  const { scene: _scene } = useThree();
  useEffect(() => {
    const sceneRef = _scene;
    const selectedLines = selectedLinesRef.current;
    const selectedEdges = selectedEdgesDataRef.current;
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
    };
  }, [_scene]);

  const handleHover = useCallback((result: EdgePickResult | null) => {
    hoverResultRef.current = result;
  }, []);

  const handleClick = useCallback((result: EdgePickResult) => {
    const id = edgeId(result);
    // Toggle: clicking an already-selected edge deselects it.
    if (filletEdgeIds.includes(id)) {
      removeFilletEdge(id);
      return;
    }
    addFilletEdge(id);
    // Store edge data for rendering
    selectedEdgesDataRef.current.set(id, {
      a: result.edgeVertexA.clone(),
      b: result.edgeVertexB.clone(),
    });
  }, [addFilletEdge, removeFilletEdge, filletEdgeIds]);

  useEdgePicker({ enabled, onHover: handleHover, onClick: handleClick });

  useFrame(({ scene, invalidate }) => {
    if (!enabled) {
      // Tear down BOTH the hover preview AND every selected-edge highlight when
      // the dialog closes. Previous code only disposed hoverLineRef, leaving the
      // selected-edge geometries leaking and orphaned in the scene.
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
      return;
    }
    invalidate(); // keep rendering while picker is active

    // Update hover line
    const hr = hoverResultRef.current;
    if (hr) {
      if (!hoverLineRef.current) {
        const line = new THREE.Line(buildEdgeGeometry(hr.edgeVertexA, hr.edgeVertexB), HOVER_MAT);
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

    // Sync selected lines with filletEdgeIds
    // Remove lines for edges no longer in the set
    selectedLinesRef.current.forEach((line, id) => {
      if (!filletEdgeIds.includes(id)) {
        scene.remove(line);
        line.geometry.dispose();
        selectedLinesRef.current.delete(id);
        selectedEdgesDataRef.current.delete(id);
      }
    });

    // Add lines for new edge IDs
    for (const id of filletEdgeIds) {
      if (!selectedLinesRef.current.has(id)) {
        const edgeData = selectedEdgesDataRef.current.get(id);
        if (edgeData) {
          const line = new THREE.Line(buildEdgeGeometry(edgeData.a, edgeData.b), SELECTED_MAT);
          line.renderOrder = 100;
          scene.add(line);
          selectedLinesRef.current.set(id, line);
        }
      }
    }
  });

  return null;
}
