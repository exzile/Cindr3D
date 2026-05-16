import { useRef, useCallback, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useFacePicker, type FacePickResult } from '../../../hooks/useFacePicker';
import { usePickerSceneCleanup } from '../../../hooks/usePickerSceneCleanup';
import { buildFaceGeometry } from './pickerGeometry';
import { usePickCursor, pulseFactor } from './pickPulse';

export interface UseSimpleFacePickerOptions {
  overlayEnabled: boolean;
  pickEnabled: boolean;
  selectedFaceId: string | null | undefined;
  onCommit: (result: FacePickResult) => void;
  hoverColor?: number;
  selectedColor?: number;
}

/**
 * useSimpleFacePicker — shared implementation for the "hover blue / selected orange" face
 * picker pattern used by 9 of the 11 face picker components.
 *
 * Materials are created once per hook instance (lazy ref init) and disposed on unmount.
 * The useFrame body — hover overlay, selected overlay, invalidate while active — is
 * centralised here so bug fixes apply to all callers.
 */
export function useSimpleFacePicker({
  overlayEnabled,
  pickEnabled,
  selectedFaceId,
  onCommit,
  hoverColor = 0x2196f3,
  selectedColor = 0xff6600,
}: UseSimpleFacePickerOptions): void {
  // Lazy material init — created once, not per render
  const hoverMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const selectedMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  if (!hoverMatRef.current) {
    hoverMatRef.current = new THREE.MeshBasicMaterial({
      color: hoverColor,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthTest: false,
    });
  }
  if (!selectedMatRef.current) {
    selectedMatRef.current = new THREE.MeshBasicMaterial({
      color: selectedColor,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthTest: false,
    });
  }

  useEffect(() => {
    return () => {
      hoverMatRef.current?.dispose();
      selectedMatRef.current?.dispose();
    };
  }, []);

  const hoverResultRef = useRef<FacePickResult | null>(null);
  const selectedBoundaryRef = useRef<THREE.Vector3[] | null>(null);
  const hoverMeshRef = useRef<THREE.Mesh | null>(null);
  const selectedMeshRef = useRef<THREE.Mesh | null>(null);
  usePickerSceneCleanup([hoverMeshRef, selectedMeshRef]);

  // Drive the crosshair cursor while a pickable face is under the pointer.
  const [hovering, setHovering] = useState(false);
  usePickCursor(pickEnabled, hovering);

  const handleHover = useCallback((result: FacePickResult | null) => {
    hoverResultRef.current = result;
    setHovering(result !== null);
  }, []);

  const handleClick = useCallback((result: FacePickResult) => {
    selectedBoundaryRef.current = result.boundary.map((v) => v.clone());
    onCommit(result);
  }, [onCommit]);

  useFacePicker({ enabled: pickEnabled, onHover: handleHover, onClick: handleClick });

  useFrame(({ scene, invalidate, clock }) => {
    const hoverMat = hoverMatRef.current!;
    const selectedMat = selectedMatRef.current!;

    if (!overlayEnabled) {
      if (hoverMeshRef.current) { scene.remove(hoverMeshRef.current); hoverMeshRef.current.geometry.dispose(); hoverMeshRef.current = null; }
      if (selectedMeshRef.current) { scene.remove(selectedMeshRef.current); selectedMeshRef.current.geometry.dispose(); selectedMeshRef.current = null; }
      selectedBoundaryRef.current = null;
      return;
    }
    invalidate();

    // ── Hover overlay ────────────────────────────────────────────────────────
    if (pickEnabled) {
      const hr = hoverResultRef.current;
      if (hr) {
        if (!hoverMeshRef.current) {
          const mesh = new THREE.Mesh(buildFaceGeometry(hr.boundary), hoverMat);
          mesh.renderOrder = 99;
          scene.add(mesh);
          hoverMeshRef.current = mesh;
        } else {
          hoverMeshRef.current.geometry.dispose();
          hoverMeshRef.current.geometry = buildFaceGeometry(hr.boundary);
        }
        // Subtle breathing pulse on the hover highlight (per-instance mat).
        hoverMat.opacity = 0.3 + 0.35 * pulseFactor(clock.elapsedTime * 1000);
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

    // ── Selected face overlay ────────────────────────────────────────────────
    if (selectedFaceId && selectedBoundaryRef.current && !selectedMeshRef.current) {
      const mesh = new THREE.Mesh(buildFaceGeometry(selectedBoundaryRef.current), selectedMat);
      mesh.renderOrder = 100;
      scene.add(mesh);
      selectedMeshRef.current = mesh;
    }
    if (!selectedFaceId && selectedMeshRef.current) {
      scene.remove(selectedMeshRef.current);
      selectedMeshRef.current.geometry.dispose();
      selectedMeshRef.current = null;
      selectedBoundaryRef.current = null;
    }
  });
}
