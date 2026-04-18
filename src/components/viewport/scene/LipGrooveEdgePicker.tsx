/**
 * LipGrooveEdgePicker (D182) — edge picking for the Lip/Groove dialog.
 *
 * Active when activeDialog === 'lip-groove' && lipGrooveEdgeId === null.
 * Hover=blue line, click → setLipGrooveEdge(midpoint string).
 * Module-level material singletons.
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useCADStore } from '../../../store/cadStore';
import { useEdgePicker, type EdgePickResult } from '../../../hooks/useEdgePicker';
import { usePickerSceneCleanup } from '../../../hooks/usePickerSceneCleanup';
import { buildEdgeGeometry } from './pickerGeometry';

// ── Module-level material singletons ─────────────────────────────────────────
const HOVER_MAT = new THREE.LineBasicMaterial({
  color: 0x2196f3,
  linewidth: 2,
  depthTest: false,
});

const SELECTED_MAT = new THREE.LineBasicMaterial({
  color: 0xff9800,
  linewidth: 2,
  depthTest: false,
});

// ── Component ─────────────────────────────────────────────────────────────────
export default function LipGrooveEdgePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const lipGrooveEdgeId = useCADStore((s) => s.lipGrooveEdgeId);
  const setLipGrooveEdge = useCADStore((s) => s.setLipGrooveEdge);

  const pickEnabled = activeDialog === 'lip-groove' && lipGrooveEdgeId === null;
  const overlayEnabled = activeDialog === 'lip-groove';

  const hoverLineRef = useRef<THREE.Line | null>(null);
  // Note: also typed in usePickerSceneCleanup as Object3D — Line satisfies that.
  const hoverResultRef = useRef<EdgePickResult | null>(null);
  const selectedLineRef = useRef<THREE.Line | null>(null);
  usePickerSceneCleanup([
    hoverLineRef as React.MutableRefObject<THREE.Object3D | null>,
    selectedLineRef as React.MutableRefObject<THREE.Object3D | null>,
  ]);
  const selectedEdgeDataRef = useRef<{ a: THREE.Vector3; b: THREE.Vector3 } | null>(null);

  const handleHover = useCallback((result: EdgePickResult | null) => {
    hoverResultRef.current = result;
  }, []);

  const handleClick = useCallback((result: EdgePickResult) => {
    const id = result.midpoint.toArray().join(',');
    selectedEdgeDataRef.current = { a: result.edgeVertexA.clone(), b: result.edgeVertexB.clone() };
    setLipGrooveEdge(id);
  }, [setLipGrooveEdge]);

  useEdgePicker({ enabled: pickEnabled, onHover: handleHover, onClick: handleClick });

  useFrame(({ scene }) => {
    if (!overlayEnabled) {
      if (hoverLineRef.current) { scene.remove(hoverLineRef.current); hoverLineRef.current.geometry.dispose(); hoverLineRef.current = null; }
      if (selectedLineRef.current) { scene.remove(selectedLineRef.current); selectedLineRef.current.geometry.dispose(); selectedLineRef.current = null; }
      return;
    }

    // Hover line
    if (pickEnabled) {
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
    } else if (hoverLineRef.current) {
      scene.remove(hoverLineRef.current);
      hoverLineRef.current.geometry.dispose();
      hoverLineRef.current = null;
    }

    // Selected edge line
    if (lipGrooveEdgeId && selectedEdgeDataRef.current && !selectedLineRef.current) {
      const { a, b } = selectedEdgeDataRef.current;
      const line = new THREE.Line(buildEdgeGeometry(a, b), SELECTED_MAT);
      line.renderOrder = 101;
      scene.add(line);
      selectedLineRef.current = line;
    }
    if (!lipGrooveEdgeId && selectedLineRef.current) {
      scene.remove(selectedLineRef.current);
      selectedLineRef.current.geometry.dispose();
      selectedLineRef.current = null;
      selectedEdgeDataRef.current = null;
    }
  });

  return null;
}
