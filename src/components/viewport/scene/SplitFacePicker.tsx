/**
 * SplitFacePicker — D185
 * Face-picking for the Split Face dialog.
 * Active when activeDialog === 'split-face' && splitFaceId === null.
 * Hover=blue highlight, click → setSplitFace(id).
 * Module-level material singletons.
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useCADStore } from '../../../store/cadStore';
import { useFacePicker, type FacePickResult } from '../../../hooks/useFacePicker';
import { usePickerSceneCleanup } from '../../../hooks/usePickerSceneCleanup';
import { buildFaceGeometry } from './pickerGeometry';

// ── Module-level material singletons ─────────────────────────────────────────
const HOVER_MAT = new THREE.MeshBasicMaterial({
  color: 0x2196f3,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
  depthTest: false,
});

const SELECTED_MAT = new THREE.MeshBasicMaterial({
  color: 0xff6600,
  transparent: true,
  opacity: 0.5,
  side: THREE.DoubleSide,
  depthTest: false,
});

// ── Component ─────────────────────────────────────────────────────────────────
export default function SplitFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const splitFaceId = useCADStore((s) => s.splitFaceId);
  const setSplitFace = useCADStore((s) => s.setSplitFace);

  const pickEnabled = activeDialog === 'split-face' && splitFaceId === null;
  const overlayEnabled = activeDialog === 'split-face';

  const hoverResultRef = useRef<FacePickResult | null>(null);
  const selectedBoundaryRef = useRef<THREE.Vector3[] | null>(null);

  const hoverMeshRef = useRef<THREE.Mesh | null>(null);
  const selectedMeshRef = useRef<THREE.Mesh | null>(null);
  usePickerSceneCleanup([hoverMeshRef, selectedMeshRef]);

  const handleHover = useCallback((result: FacePickResult | null) => {
    hoverResultRef.current = result;
  }, []);

  const handleClick = useCallback((result: FacePickResult) => {
    const id = result.centroid.toArray().join(',');
    selectedBoundaryRef.current = result.boundary.map((v) => v.clone());
    setSplitFace(id);
  }, [setSplitFace]);

  useFacePicker({ enabled: pickEnabled, onHover: handleHover, onClick: handleClick });

  useFrame(({ scene }) => {
    if (!overlayEnabled) {
      if (hoverMeshRef.current) { scene.remove(hoverMeshRef.current); hoverMeshRef.current.geometry.dispose(); hoverMeshRef.current = null; }
      if (selectedMeshRef.current) { scene.remove(selectedMeshRef.current); selectedMeshRef.current.geometry.dispose(); selectedMeshRef.current = null; }
      return;
    }

    if (pickEnabled) {
      const hr = hoverResultRef.current;
      if (hr) {
        if (!hoverMeshRef.current) {
          const mesh = new THREE.Mesh(buildFaceGeometry(hr.boundary), HOVER_MAT);
          mesh.renderOrder = 99;
          scene.add(mesh);
          hoverMeshRef.current = mesh;
        } else {
          hoverMeshRef.current.geometry.dispose();
          hoverMeshRef.current.geometry = buildFaceGeometry(hr.boundary);
        }
      } else if (hoverMeshRef.current) {
        scene.remove(hoverMeshRef.current);
        hoverMeshRef.current.geometry.dispose();
        hoverMeshRef.current = null;
      }
    } else if (hoverMeshRef.current) {
      scene.remove(hoverMeshRef.current);
      hoverMeshRef.current.geometry.dispose();
      hoverMeshRef.current = null;
    }

    if (splitFaceId && selectedBoundaryRef.current && !selectedMeshRef.current) {
      const mesh = new THREE.Mesh(buildFaceGeometry(selectedBoundaryRef.current), SELECTED_MAT);
      mesh.renderOrder = 100;
      scene.add(mesh);
      selectedMeshRef.current = mesh;
    }
    if (!splitFaceId && selectedMeshRef.current) {
      scene.remove(selectedMeshRef.current);
      selectedMeshRef.current.geometry.dispose();
      selectedMeshRef.current = null;
      selectedBoundaryRef.current = null;
    }
  });

  return null;
}
