/**
 * DraftPartingLinePicker — face picker for the Draft dialog parting-line mode (SOL-I3).
 *
 * Active when activeDialog === 'draft' and no parting face is selected yet.
 * Click a face to use it as the parting reference plane for the draft.
 * Hover: blue highlight. Selected: orange highlight.
 *
 * Module-level material singletons. All BufferGeometry instances are disposed
 * before being replaced to prevent GPU memory leaks.
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

// ── Component ────────────────────────────────────────────────────────────────
export default function DraftPartingLinePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const draftPartingFaceId = useCADStore((s) => s.draftPartingFaceId);
  const setDraftPartingFace = useCADStore((s) => s.setDraftPartingFace);

  // Only active in draft dialog for parting-line mode — we let the dialog
  // manage the enabled flag by checking the draft type in the store would
  // require extra state. Instead we let the picker run whenever the dialog
  // is open and not yet picked; the dialog handles showing/hiding the hint.
  const pickEnabled = activeDialog === 'draft' && draftPartingFaceId === null;
  const overlayEnabled = activeDialog === 'draft';

  const hoverResultRef = useRef<FacePickResult | null>(null);
  const selectedBoundaryRef = useRef<THREE.Vector3[] | null>(null);

  const hoverMeshRef = useRef<THREE.Mesh | null>(null);
  const selectedMeshRef = useRef<THREE.Mesh | null>(null);
  usePickerSceneCleanup([hoverMeshRef, selectedMeshRef]);

  const handleHover = useCallback((result: FacePickResult | null) => {
    hoverResultRef.current = result;
  }, []);

  const handleClick = useCallback(
    (result: FacePickResult) => {
      const id = result.centroid.toArray().join(',');
      selectedBoundaryRef.current = result.boundary.map((v) => v.clone());
      setDraftPartingFace(
        id,
        [result.normal.x, result.normal.y, result.normal.z],
        [result.centroid.x, result.centroid.y, result.centroid.z],
      );
    },
    [setDraftPartingFace],
  );

  useFacePicker({ enabled: pickEnabled, onHover: handleHover, onClick: handleClick });

  useFrame(({ scene }) => {
    if (!overlayEnabled) {
      if (hoverMeshRef.current) {
        scene.remove(hoverMeshRef.current);
        hoverMeshRef.current.geometry.dispose();
        hoverMeshRef.current = null;
      }
      if (selectedMeshRef.current) {
        scene.remove(selectedMeshRef.current);
        selectedMeshRef.current.geometry.dispose();
        selectedMeshRef.current = null;
      }
      selectedBoundaryRef.current = null;
      return;
    }

    // ── Hover overlay (only while picking) ────────────────────────────────
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

    // ── Selected face overlay ─────────────────────────────────────────────
    if (draftPartingFaceId && selectedBoundaryRef.current && !selectedMeshRef.current) {
      const mesh = new THREE.Mesh(buildFaceGeometry(selectedBoundaryRef.current), SELECTED_MAT);
      mesh.renderOrder = 100;
      scene.add(mesh);
      selectedMeshRef.current = mesh;
    }
    if (!draftPartingFaceId && selectedMeshRef.current) {
      scene.remove(selectedMeshRef.current);
      selectedMeshRef.current.geometry.dispose();
      selectedMeshRef.current = null;
      selectedBoundaryRef.current = null;
    }
  });

  return null;
}
