import { useRef, useCallback, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { FacePickResult } from '../../../types/face-picker.types';
import { usePickerSceneCleanup } from '../../../hooks/usePickerSceneCleanup';
import { usePickCursor, pulseFactor } from './pickPulse';
import { useOccFacePicker, type OccFacePickResult } from './OccFacePicker';
import { getMeshTessellation, buildFaceHighlightGeometry, faceIdAtTriangle } from '../../../engine/occ/picking';

export interface UseSimpleFacePickerOptions {
  overlayEnabled: boolean;
  pickEnabled: boolean;
  selectedFaceId: string | null | undefined;
  onCommit: (result: FacePickResult) => void;
  hoverColor?: number;
  selectedColor?: number;
}

/**
 * Shared OCC face picker implementation for the hover blue / selected orange pattern.
 */
export function useSimpleFacePicker({
  overlayEnabled,
  pickEnabled,
  selectedFaceId,
  onCommit,
  hoverColor = 0x2196f3,
  selectedColor = 0xff6600,
}: UseSimpleFacePickerOptions): void {
  const hoverMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const selectedMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  if (hoverMatRef.current == null) {
    hoverMatRef.current = new THREE.MeshBasicMaterial({
      color: hoverColor,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthTest: false,
    });
  }
  if (selectedMatRef.current == null) {
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

  const hoverMeshRef = useRef<THREE.Mesh | null>(null);
  const selectedMeshRef = useRef<THREE.Mesh | null>(null);
  usePickerSceneCleanup([hoverMeshRef, selectedMeshRef]);

  const occHoverRef = useRef<OccFacePickResult | null>(null);
  const occSelectedRef = useRef<OccFacePickResult | null>(null);

  const [hovering, setHovering] = useState(false);
  usePickCursor(pickEnabled, hovering);

  const handleOccHover = useCallback((result: OccFacePickResult | null) => {
    occHoverRef.current = result;
    setHovering(result !== null);
  }, []);

  const handleOccClick = useCallback((result: OccFacePickResult) => {
    occSelectedRef.current = result;
    onCommit({
      mesh: result.mesh,
      faceIndex: result.triangleIndex,
      boundary: [],
      normal: result.normal,
      centroid: result.point,
      occBodyId: result.bodyId,
      occFaceId: result.faceId,
    });
  }, [onCommit]);

  useOccFacePicker({ enabled: pickEnabled, onHover: handleOccHover, onClick: handleOccClick });

  useFrame(({ scene, invalidate, clock }) => {
    const hoverMat = hoverMatRef.current!;
    const selectedMat = selectedMatRef.current!;

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
      occSelectedRef.current = null;
      return;
    }
    invalidate();

    if (pickEnabled) {
      const occ = occHoverRef.current;
      const tess = occ ? getMeshTessellation(occ.mesh) : null;
      const hoverGeo = occ && tess
        ? buildFaceHighlightGeometry(tess, faceIdAtTriangle(tess, occ.triangleIndex))
        : null;
      if (hoverGeo) {
        if (!hoverMeshRef.current) {
          const mesh = new THREE.Mesh(hoverGeo, hoverMat);
          mesh.renderOrder = 99;
          scene.add(mesh);
          hoverMeshRef.current = mesh;
        } else {
          hoverMeshRef.current.geometry.dispose();
          hoverMeshRef.current.geometry = hoverGeo;
        }
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

    const selectedOcc = occSelectedRef.current;
    if (selectedFaceId && selectedOcc) {
      const tess = getMeshTessellation(selectedOcc.mesh);
      const selectedGeo = tess ? buildFaceHighlightGeometry(tess, selectedOcc.faceId) : null;
      if (selectedGeo) {
        if (!selectedMeshRef.current) {
          const mesh = new THREE.Mesh(selectedGeo, selectedMat);
          mesh.renderOrder = 100;
          scene.add(mesh);
          selectedMeshRef.current = mesh;
        } else {
          selectedMeshRef.current.geometry.dispose();
          selectedMeshRef.current.geometry = selectedGeo;
        }
      }
    } else if (selectedMeshRef.current) {
      scene.remove(selectedMeshRef.current);
      selectedMeshRef.current.geometry.dispose();
      selectedMeshRef.current = null;
      occSelectedRef.current = null;
    }
  });
}
