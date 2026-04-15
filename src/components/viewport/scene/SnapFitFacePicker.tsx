/**
 * SnapFitFacePicker (D181) — face picking for the Snap Fit dialog.
 *
 * Active when activeDialog === 'snap-fit' && snapFitFaceId === null.
 * Hover=blue highlight, click → setSnapFitFace(centroid string).
 * Module-level material singletons.
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useCADStore } from '../../../store/cadStore';
import { useFacePicker, type FacePickResult } from '../../../hooks/useFacePicker';

// ── Module-level material singletons ─────────────────────────────────────────
const HOVER_MAT = new THREE.MeshBasicMaterial({
  color: 0x2196f3,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
  depthTest: false,
});

const SELECTED_MAT = new THREE.MeshBasicMaterial({
  color: 0xff9800,
  transparent: true,
  opacity: 0.5,
  side: THREE.DoubleSide,
  depthTest: false,
});

// ── Helper ────────────────────────────────────────────────────────────────────
function buildFaceGeometry(boundary: THREE.Vector3[]): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const n = boundary.length;
  if (n < 3) return geom;
  const positions: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    positions.push(...boundary[0].toArray(), ...boundary[i].toArray(), ...boundary[i + 1].toArray());
  }
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SnapFitFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const snapFitFaceId = useCADStore((s) => s.snapFitFaceId);
  const setSnapFitFace = useCADStore((s) => s.setSnapFitFace);

  const pickEnabled = activeDialog === 'snap-fit' && snapFitFaceId === null;
  const overlayEnabled = activeDialog === 'snap-fit';

  const hoverResultRef = useRef<FacePickResult | null>(null);
  const selectedBoundaryRef = useRef<THREE.Vector3[] | null>(null);
  const hoverMeshRef = useRef<THREE.Mesh | null>(null);
  const selectedMeshRef = useRef<THREE.Mesh | null>(null);

  const handleHover = useCallback((result: FacePickResult | null) => {
    hoverResultRef.current = result;
  }, []);

  const handleClick = useCallback((result: FacePickResult) => {
    const id = result.centroid.toArray().join(',');
    selectedBoundaryRef.current = result.boundary.map((v) => v.clone());
    setSnapFitFace(id);
  }, [setSnapFitFace]);

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

    if (snapFitFaceId && selectedBoundaryRef.current && !selectedMeshRef.current) {
      const mesh = new THREE.Mesh(buildFaceGeometry(selectedBoundaryRef.current), SELECTED_MAT);
      mesh.renderOrder = 100;
      scene.add(mesh);
      selectedMeshRef.current = mesh;
    }
    if (!snapFitFaceId && selectedMeshRef.current) {
      scene.remove(selectedMeshRef.current);
      selectedMeshRef.current.geometry.dispose();
      selectedMeshRef.current = null;
      selectedBoundaryRef.current = null;
    }
  });

  return null;
}
