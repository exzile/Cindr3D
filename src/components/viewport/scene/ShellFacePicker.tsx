/**
 * ShellFacePicker — multi-face picker for the Shell dialog (SOL-I2).
 *
 * Active when activeDialog === 'shell'.
 * Click a face to toggle it in shellRemoveFaceIds. Already-selected faces
 * are highlighted in orange; hovered face is highlighted in blue.
 *
 * Module-level material singletons. All BufferGeometry instances are disposed
 * before being replaced to prevent GPU memory leaks.
 */

import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useCADStore } from '../../../store/cadStore';
import { useFacePicker, type FacePickResult } from '../../../hooks/useFacePicker';
import { usePickerSceneCleanup } from '../../../hooks/usePickerSceneCleanup';
import { buildFaceGeometry } from './pickerGeometry';
import { usePickCursor, pulseFactor } from './pickPulse';

// ── Module-level material singletons ─────────────────────────────────────────
const HOVER_MAT = new THREE.MeshBasicMaterial({
  color: 0x2196f3,
  transparent: true,
  opacity: 0.4,
  side: THREE.DoubleSide,
  depthTest: false,
});

const SELECTED_MAT = new THREE.MeshBasicMaterial({
  color: 0xff6600,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
  depthTest: false,
});

export default function ShellFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const shellRemoveFaceIds = useCADStore((s) => s.shellRemoveFaceIds);
  const addShellRemoveFace = useCADStore((s) => s.addShellRemoveFace);
  const removeShellRemoveFace = useCADStore((s) => s.removeShellRemoveFace);

  const active = activeDialog === 'shell';

  // Per-instance clone of the shared HOVER_MAT so we can pulse opacity without
  // mutating the module-level singleton (one clone per component lifetime).
  const pulseHoverMat = useMemo(() => HOVER_MAT.clone(), []);
  useEffect(() => () => { pulseHoverMat.dispose(); }, [pulseHoverMat]);

  // Crosshair cursor while a pickable face is hovered.
  const [hovering, setHovering] = useState(false);
  usePickCursor(active, hovering);

  // Track hover result and selected face boundaries
  const hoverResultRef = useRef<FacePickResult | null>(null);
  // Map from face ID to boundary for rendering overlays
  const selectedBoundariesRef = useRef<Map<string, THREE.Vector3[]>>(new Map());

  const hoverMeshRef = useRef<THREE.Mesh | null>(null);
  usePickerSceneCleanup([hoverMeshRef]);
  // The Map of selected per-face meshes also needs unmount cleanup so HMR /
  // viewport teardown doesn't strand them in the scene with leaked geometries.
  const { scene: _scene } = useThree();
  useEffect(() => {
    const sceneRef = _scene;
    const selectedMeshes = selectedMeshesRef.current;
    return () => {
      selectedMeshes.forEach((mesh) => {
        sceneRef.remove(mesh);
        mesh.geometry?.dispose?.();
      });
      selectedMeshes.clear();
    };
  }, [_scene]);
  // Map from face ID to overlay mesh
  const selectedMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());

  const handleHover = useCallback((result: FacePickResult | null) => {
    hoverResultRef.current = result;
    setHovering(result !== null);
  }, []);

  const handleClick = useCallback(
    (result: FacePickResult) => {
      const id = result.centroid.toArray().join(',');
      if (shellRemoveFaceIds.includes(id)) {
        removeShellRemoveFace(id);
        selectedBoundariesRef.current.delete(id);
      } else {
        addShellRemoveFace(id);
        selectedBoundariesRef.current.set(id, result.boundary.map((v) => v.clone()));
      }
    },
    [shellRemoveFaceIds, addShellRemoveFace, removeShellRemoveFace],
  );

  useFacePicker({ enabled: active, onHover: handleHover, onClick: handleClick });

  useFrame(({ scene, invalidate, clock }) => {
    if (!active) {
      // Clean up all overlays when dialog is closed
      if (hoverMeshRef.current) {
        scene.remove(hoverMeshRef.current);
        hoverMeshRef.current.geometry.dispose();
        hoverMeshRef.current = null;
      }
      selectedMeshesRef.current.forEach((mesh) => {
        scene.remove(mesh);
        mesh.geometry.dispose();
      });
      selectedMeshesRef.current.clear();
      selectedBoundariesRef.current.clear();
      return;
    }
    invalidate(); // keep rendering while picker is active

    // ── Hover overlay ────────────────────────────────────────────────────────
    const hr = hoverResultRef.current;
    if (hr) {
      if (!hoverMeshRef.current) {
        const mesh = new THREE.Mesh(buildFaceGeometry(hr.boundary), pulseHoverMat);
        mesh.renderOrder = 99;
        scene.add(mesh);
        hoverMeshRef.current = mesh;
      } else {
        hoverMeshRef.current.geometry.dispose();
        hoverMeshRef.current.geometry = buildFaceGeometry(hr.boundary);
      }
      // Subtle breathing pulse on the hover highlight (per-instance clone).
      pulseHoverMat.opacity = 0.25 + 0.35 * pulseFactor(clock.elapsedTime * 1000);
    } else if (hoverMeshRef.current) {
      scene.remove(hoverMeshRef.current);
      hoverMeshRef.current.geometry.dispose();
      hoverMeshRef.current = null;
    }

    // ── Selected face overlays ───────────────────────────────────────────────
    // Read imperatively to avoid stale-closure on array reference.
    const currentIds = new Set(useCADStore.getState().shellRemoveFaceIds);
    currentIds.forEach((id) => {
      if (!selectedMeshesRef.current.has(id)) {
        const boundary = selectedBoundariesRef.current.get(id);
        if (boundary) {
          const mesh = new THREE.Mesh(buildFaceGeometry(boundary), SELECTED_MAT);
          mesh.renderOrder = 100;
          scene.add(mesh);
          selectedMeshesRef.current.set(id, mesh);
        }
      }
    });
    // Remove meshes for deselected faces
    selectedMeshesRef.current.forEach((mesh, id) => {
      if (!currentIds.has(id)) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        selectedMeshesRef.current.delete(id);
      }
    });

  });

  return null;
}
