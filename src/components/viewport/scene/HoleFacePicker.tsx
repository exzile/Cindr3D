/**
 * HoleFacePicker — face picking + in-viewport preview for the Hole dialog.
 *
 * Active when activeDialog === 'hole'.
 *  - No face selected: hover highlight + click → setHoleFace(id, normal, centroid).
 *  - Face selected: orange selected-face polygon, red translucent cylindrical
 *    preview drilled along the inward face normal, and a floating drei <Html>
 *    diameter chip pinned to the face centroid (Fusion 360 style).
 *
 * Module-level material singletons + scratch vectors (no per-frame allocs).
 * All BufferGeometry instances are disposed before being replaced.
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useCADStore } from '../../../store/cadStore';
import { useFacePicker, type FacePickResult } from '../../../hooks/useFacePicker';
import { usePickerSceneCleanup } from '../../../hooks/usePickerSceneCleanup';

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

const PREVIEW_MAT = new THREE.MeshBasicMaterial({
  color: 0xff3030,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthWrite: false,
});

// Module-level scratch — never allocate per frame
const _normal = new THREE.Vector3();
const _centroid = new THREE.Vector3();
const _drillDir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

// ── Helpers ──────────────────────────────────────────────────────────────────
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

// ── Component ────────────────────────────────────────────────────────────────
export default function HoleFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const holeFaceId = useCADStore((s) => s.holeFaceId);
  const holeFaceNormal = useCADStore((s) => s.holeFaceNormal);
  const holeFaceCentroid = useCADStore((s) => s.holeFaceCentroid);
  const setHoleFace = useCADStore((s) => s.setHoleFace);

  const pickEnabled = activeDialog === 'hole' && holeFaceId === null;
  const overlayEnabled = activeDialog === 'hole';

  const hoverResultRef = useRef<FacePickResult | null>(null);
  const selectedBoundaryRef = useRef<THREE.Vector3[] | null>(null);

  const hoverMeshRef = useRef<THREE.Mesh | null>(null);
  const selectedMeshRef = useRef<THREE.Mesh | null>(null);
  const previewMeshRef = useRef<THREE.Mesh | null>(null);
  // Cached cylinder dimensions — only rebuild when dia/depth actually change.
  const previewSigRef = useRef<{ dia: number; depth: number }>({ dia: -1, depth: -1 });
  usePickerSceneCleanup([hoverMeshRef, selectedMeshRef, previewMeshRef]);

  const handleHover = useCallback((result: FacePickResult | null) => {
    hoverResultRef.current = result;
  }, []);

  const handleClick = useCallback(
    (result: FacePickResult) => {
      const id = result.centroid.toArray().join(',');
      selectedBoundaryRef.current = result.boundary.map((v) => v.clone());
      setHoleFace(
        id,
        [result.normal.x, result.normal.y, result.normal.z],
        [result.centroid.x, result.centroid.y, result.centroid.z],
      );
    },
    [setHoleFace],
  );

  useFacePicker({ enabled: pickEnabled, onHover: handleHover, onClick: handleClick });

  useFrame(({ scene }) => {
    // Tear everything down when the dialog is not open.
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
      if (previewMeshRef.current) {
        scene.remove(previewMeshRef.current);
        previewMeshRef.current.geometry.dispose();
        previewMeshRef.current = null;
      }
      return;
    }

    // ── Hover overlay (only while picking) ─────────────────────────────────
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

    // ── Selected face overlay ──────────────────────────────────────────────
    if (holeFaceId && selectedBoundaryRef.current && !selectedMeshRef.current) {
      const mesh = new THREE.Mesh(buildFaceGeometry(selectedBoundaryRef.current), SELECTED_MAT);
      mesh.renderOrder = 100;
      scene.add(mesh);
      selectedMeshRef.current = mesh;
    }
    if (!holeFaceId && selectedMeshRef.current) {
      scene.remove(selectedMeshRef.current);
      selectedMeshRef.current.geometry.dispose();
      selectedMeshRef.current = null;
      selectedBoundaryRef.current = null;
    }

    // ── Cylindrical preview at the picked face ─────────────────────────────
    if (holeFaceId && holeFaceNormal && holeFaceCentroid) {
      const dia = useCADStore.getState().holeDraftDiameter;
      const depth = useCADStore.getState().holeDraftDepth;

      _normal.set(holeFaceNormal[0], holeFaceNormal[1], holeFaceNormal[2]).normalize();
      _centroid.set(holeFaceCentroid[0], holeFaceCentroid[1], holeFaceCentroid[2]);
      _drillDir.copy(_normal).multiplyScalar(-1);
      _quat.setFromUnitVectors(_up, _drillDir);

      // Only rebuild the cylinder when dia/depth actually change. Previously
      // the else branch ran every frame and re-allocated a 32-segment
      // CylinderGeometry on every tick — a continuous GPU + GC churn for as
      // long as the dialog stayed open with a face selected.
      const sigDia = previewSigRef.current.dia;
      const sigDepth = previewSigRef.current.depth;
      const dirty = sigDia !== dia || sigDepth !== depth;
      if (!previewMeshRef.current) {
        const geom = new THREE.CylinderGeometry(dia / 2, dia / 2, depth, 32, 1, true);
        geom.translate(0, -depth / 2, 0);
        const mesh = new THREE.Mesh(geom, PREVIEW_MAT);
        mesh.renderOrder = 95;
        scene.add(mesh);
        previewMeshRef.current = mesh;
        previewSigRef.current.dia = dia;
        previewSigRef.current.depth = depth;
      } else if (dirty) {
        previewMeshRef.current.geometry.dispose();
        const geom = new THREE.CylinderGeometry(dia / 2, dia / 2, depth, 32, 1, true);
        geom.translate(0, -depth / 2, 0);
        previewMeshRef.current.geometry = geom;
        previewSigRef.current.dia = dia;
        previewSigRef.current.depth = depth;
      }
      previewMeshRef.current.position.copy(_centroid);
      previewMeshRef.current.quaternion.copy(_quat);
    } else if (previewMeshRef.current) {
      scene.remove(previewMeshRef.current);
      previewMeshRef.current.geometry.dispose();
      previewMeshRef.current = null;
      previewSigRef.current.dia = -1;
      previewSigRef.current.depth = -1;
    }
  });

  // Floating diameter chip — rendered only after a face is picked.
  if (!overlayEnabled || !holeFaceId || !holeFaceCentroid) return null;
  return (
    <Html
      position={[holeFaceCentroid[0], holeFaceCentroid[1], holeFaceCentroid[2]]}
      center
      zIndexRange={[200, 0]}
      style={{ pointerEvents: 'auto' }}
    >
      <HoleDimensionChip />
    </Html>
  );
}

// ── Floating diameter chip (Fusion 360 style) ───────────────────────────────
function HoleDimensionChip() {
  const dia = useCADStore((s) => s.holeDraftDiameter);
  const setDia = useCADStore((s) => s.setHoleDraftDiameter);
  return (
    <div
      className="hole-dim-chip"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="number"
        min={0.1}
        step={0.5}
        value={dia}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n) && n > 0) setDia(n);
        }}
        aria-label="Diameter (mm)"
      />
      <span className="hole-dim-chip__unit">mm</span>
    </div>
  );
}
