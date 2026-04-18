/**
 * ReplaceFaceInteraction — face picking for the Replace Face dialog (D171).
 *
 * Active when activeDialog === 'replace-face'.
 * Step 1: hover=blue, click → setReplaceFaceSource (sourceId === null)
 * Step 2: hover=green, click → setReplaceFaceTarget (sourceId set, targetId === null)
 * Renders source face polygon in orange, target in green.
 * Module-level material singletons.
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useCADStore } from '../../../store/cadStore';
import { useFacePicker, type FacePickResult } from '../../../hooks/useFacePicker';
import { usePickerSceneCleanup } from '../../../hooks/usePickerSceneCleanup';

// ── Module-level material singletons ─────────────────────────────────────────
const HOVER_SOURCE_MAT = new THREE.MeshBasicMaterial({
  color: 0x2196f3,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
  depthTest: false,
});

const HOVER_TARGET_MAT = new THREE.MeshBasicMaterial({
  color: 0x4caf50,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
  depthTest: false,
});

const SOURCE_MAT = new THREE.MeshBasicMaterial({
  color: 0xff6600,
  transparent: true,
  opacity: 0.5,
  side: THREE.DoubleSide,
  depthTest: false,
});

const TARGET_MAT = new THREE.MeshBasicMaterial({
  color: 0x4caf50,
  transparent: true,
  opacity: 0.5,
  side: THREE.DoubleSide,
  depthTest: false,
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildFaceGeometry(boundary: THREE.Vector3[]): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const n = boundary.length;
  if (n < 3) return geom;
  // Fan triangulation from first vertex
  const positions: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    positions.push(...boundary[0].toArray(), ...boundary[i].toArray(), ...boundary[i + 1].toArray());
  }
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ReplaceFaceInteraction() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const replaceFaceSourceId = useCADStore((s) => s.replaceFaceSourceId);
  const replaceFaceTargetId = useCADStore((s) => s.replaceFaceTargetId);
  const setReplaceFaceSource = useCADStore((s) => s.setReplaceFaceSource);
  const setReplaceFaceTarget = useCADStore((s) => s.setReplaceFaceTarget);

  const enabled = activeDialog === 'replace-face';

  const hoverResultRef = useRef<FacePickResult | null>(null);
  const sourceBoundaryRef = useRef<THREE.Vector3[] | null>(null);
  const targetBoundaryRef = useRef<THREE.Vector3[] | null>(null);

  // Scene objects (not React state — managed imperatively in useFrame)
  const hoverMeshRef = useRef<THREE.Mesh | null>(null);
  const sourceMeshRef = useRef<THREE.Mesh | null>(null);
  const targetMeshRef = useRef<THREE.Mesh | null>(null);
  usePickerSceneCleanup([hoverMeshRef, sourceMeshRef, targetMeshRef]);

  const handleHover = useCallback((result: FacePickResult | null) => {
    hoverResultRef.current = result;
  }, []);

  const handleClick = useCallback((result: FacePickResult) => {
    const id = result.centroid.toArray().join(',');
    if (replaceFaceSourceId === null) {
      sourceBoundaryRef.current = result.boundary.map((v) => v.clone());
      setReplaceFaceSource(id);
    } else if (replaceFaceTargetId === null) {
      targetBoundaryRef.current = result.boundary.map((v) => v.clone());
      setReplaceFaceTarget(id);
    }
  }, [replaceFaceSourceId, replaceFaceTargetId, setReplaceFaceSource, setReplaceFaceTarget]);

  useFacePicker({ enabled, onHover: handleHover, onClick: handleClick });

  useFrame(({ scene }) => {
    if (!enabled) {
      // Clean up all overlays
      if (hoverMeshRef.current) { scene.remove(hoverMeshRef.current); hoverMeshRef.current.geometry.dispose(); hoverMeshRef.current = null; }
      if (sourceMeshRef.current) { scene.remove(sourceMeshRef.current); sourceMeshRef.current.geometry.dispose(); sourceMeshRef.current = null; }
      if (targetMeshRef.current) { scene.remove(targetMeshRef.current); targetMeshRef.current.geometry.dispose(); targetMeshRef.current = null; }
      return;
    }

    // Hover overlay
    const hoverMat = replaceFaceSourceId === null ? HOVER_SOURCE_MAT : HOVER_TARGET_MAT;
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
        hoverMeshRef.current.material = hoverMat;
      }
    } else if (hoverMeshRef.current) {
      scene.remove(hoverMeshRef.current);
      hoverMeshRef.current.geometry.dispose();
      hoverMeshRef.current = null;
    }

    // Source overlay
    if (sourceBoundaryRef.current && !sourceMeshRef.current) {
      const mesh = new THREE.Mesh(buildFaceGeometry(sourceBoundaryRef.current), SOURCE_MAT);
      mesh.renderOrder = 100;
      scene.add(mesh);
      sourceMeshRef.current = mesh;
    }
    if (!replaceFaceSourceId && sourceMeshRef.current) {
      scene.remove(sourceMeshRef.current);
      sourceMeshRef.current.geometry.dispose();
      sourceMeshRef.current = null;
      sourceBoundaryRef.current = null;
    }

    // Target overlay
    if (targetBoundaryRef.current && !targetMeshRef.current) {
      const mesh = new THREE.Mesh(buildFaceGeometry(targetBoundaryRef.current), TARGET_MAT);
      mesh.renderOrder = 100;
      scene.add(mesh);
      targetMeshRef.current = mesh;
    }
    if (!replaceFaceTargetId && targetMeshRef.current) {
      scene.remove(targetMeshRef.current);
      targetMeshRef.current.geometry.dispose();
      targetMeshRef.current = null;
      targetBoundaryRef.current = null;
    }
  });

  return null;
}
