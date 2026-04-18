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

import { useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useCADStore } from '../../../store/cadStore';
import { useFacePicker, type FacePickResult } from '../../../hooks/useFacePicker';
import { usePickerSceneCleanup } from '../../../hooks/usePickerSceneCleanup';

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

export default function ShellFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const shellRemoveFaceIds = useCADStore((s) => s.shellRemoveFaceIds);
  const addShellRemoveFace = useCADStore((s) => s.addShellRemoveFace);
  const removeShellRemoveFace = useCADStore((s) => s.removeShellRemoveFace);

  const active = activeDialog === 'shell';

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
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      selectedMeshesRef.current.forEach((mesh) => {
        sceneRef.remove(mesh);
        mesh.geometry?.dispose?.();
      });
      selectedMeshesRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Map from face ID to overlay mesh
  const selectedMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());

  const handleHover = useCallback((result: FacePickResult | null) => {
    hoverResultRef.current = result;
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

  useFrame(({ scene }) => {
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

    // ── Hover overlay ────────────────────────────────────────────────────────
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
