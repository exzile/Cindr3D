/**
 * ChamferEdgeHighlight — edge picking overlay for the Chamfer dialog.
 * Active when activeDialog === 'chamfer'. Uses useEdgePicker to highlight
 * edges on hover (blue) and add them to chamferEdgeIds on click (yellow-green).
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
  color: 0xaacc00,
  linewidth: 2,
  depthTest: false,
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function edgeId(result: EdgePickResult): string {
  return `${result.mesh.uuid}:${result.edgeVertexA.toArray().join(',')}:${result.edgeVertexB.toArray().join(',')}`;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function ChamferEdgeHighlight() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const chamferEdgeIds = useCADStore((s) => s.chamferEdgeIds);
  const addChamferEdge = useCADStore((s) => s.addChamferEdge);

  const enabled = activeDialog === 'chamfer';

  const hoverLineRef = useRef<THREE.Line | null>(null);
  const hoverResultRef = useRef<EdgePickResult | null>(null);

  const selectedLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  const selectedEdgesDataRef = useRef<Map<string, { a: THREE.Vector3; b: THREE.Vector3 }>>(new Map());

  // Unmount cleanup — useFrame's `!enabled` branch only fires while the
  // component is still mounted. If the parent dialog/route unmounts while
  // enabled is still true (HMR, route swap, viewport teardown) the hover
  // line + every selected-edge highlight stays orphaned in the scene with
  // un-disposed BufferGeometries. usePickerSceneCleanup doesn't fit here
  // because selectedLinesRef holds a Map, so do it inline.
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
    addChamferEdge(id);
    selectedEdgesDataRef.current.set(id, {
      a: result.edgeVertexA.clone(),
      b: result.edgeVertexB.clone(),
    });
  }, [addChamferEdge]);

  useEdgePicker({ enabled, onHover: handleHover, onClick: handleClick });

  useFrame(({ scene }) => {
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

    selectedLinesRef.current.forEach((line, id) => {
      if (!chamferEdgeIds.includes(id)) {
        scene.remove(line);
        line.geometry.dispose();
        selectedLinesRef.current.delete(id);
        selectedEdgesDataRef.current.delete(id);
      }
    });

    for (const id of chamferEdgeIds) {
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
