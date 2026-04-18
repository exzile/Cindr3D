/**
 * ExtrudeStartEntityPicker — EX-4 "From Entity" start face picker.
 *
 * Active when the extrude panel is open AND extrudeStartType === 'entity'
 * AND no start face has been selected yet. Clicking a body face stores
 * its normal + centroid as the extrude start position.
 *
 * Visual: green hover overlay, teal selected overlay.
 *
 * Module-level material singletons + scratch vectors — no per-frame allocation.
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useCADStore } from '../../../store/cadStore';
import { useFacePicker, type FacePickResult } from '../../../hooks/useFacePicker';
import { usePickerSceneCleanup } from '../../../hooks/usePickerSceneCleanup';

// ── Material singletons ───────────────────────────────────────────────────────
const HOVER_MAT = new THREE.MeshBasicMaterial({
  color: 0x44cc88,
  transparent: true,
  opacity: 0.4,
  side: THREE.DoubleSide,
  depthTest: false,
});
const SELECTED_MAT = new THREE.MeshBasicMaterial({
  color: 0x00aacc,
  transparent: true,
  opacity: 0.5,
  side: THREE.DoubleSide,
  depthTest: false,
});

function buildFaceGeom(boundary: THREE.Vector3[]): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const n = boundary.length;
  if (n < 3) return geom;
  const pos: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    pos.push(...boundary[0].toArray(), ...boundary[i].toArray(), ...boundary[i + 1].toArray());
  }
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.computeVertexNormals();
  return geom;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function ExtrudeStartEntityPicker() {
  const activeTool    = useCADStore((s) => s.activeTool);
  const startType     = useCADStore((s) => s.extrudeStartType);
  const faceCentroid  = useCADStore((s) => s.extrudeStartFaceCentroid);
  const setStartFace  = useCADStore((s) => s.setExtrudeStartFace);

  const isEntityMode  = startType === 'entity';
  const pickEnabled   = activeTool === 'extrude' && isEntityMode && faceCentroid === null;
  const overlayEnabled = activeTool === 'extrude' && isEntityMode;

  const hoverRef     = useRef<FacePickResult | null>(null);
  const selBoundary  = useRef<THREE.Vector3[] | null>(null);

  const hoverMeshRef = useRef<THREE.Mesh | null>(null);
  const selMeshRef   = useRef<THREE.Mesh | null>(null);
  usePickerSceneCleanup([hoverMeshRef, selMeshRef]);

  const handleHover  = useCallback((r: FacePickResult | null) => { hoverRef.current = r; }, []);

  const handleClick  = useCallback((r: FacePickResult) => {
    selBoundary.current = r.boundary.map((v) => v.clone());
    setStartFace(
      [r.normal.x, r.normal.y, r.normal.z],
      [r.centroid.x, r.centroid.y, r.centroid.z],
    );
  }, [setStartFace]);

  useFacePicker({ enabled: pickEnabled, onHover: handleHover, onClick: handleClick });

  useFrame(({ scene }) => {
    if (!overlayEnabled) {
      if (hoverMeshRef.current) { scene.remove(hoverMeshRef.current); hoverMeshRef.current.geometry.dispose(); hoverMeshRef.current = null; }
      if (selMeshRef.current)   { scene.remove(selMeshRef.current);   selMeshRef.current.geometry.dispose();   selMeshRef.current   = null; }
      return;
    }

    // Hover overlay
    if (pickEnabled) {
      const hr = hoverRef.current;
      if (hr) {
        if (!hoverMeshRef.current) {
          const m = new THREE.Mesh(buildFaceGeom(hr.boundary), HOVER_MAT);
          m.renderOrder = 99;
          scene.add(m);
          hoverMeshRef.current = m;
        } else {
          hoverMeshRef.current.geometry.dispose();
          hoverMeshRef.current.geometry = buildFaceGeom(hr.boundary);
        }
      } else if (hoverMeshRef.current) {
        scene.remove(hoverMeshRef.current); hoverMeshRef.current.geometry.dispose(); hoverMeshRef.current = null;
      }
    } else if (hoverMeshRef.current) {
      scene.remove(hoverMeshRef.current); hoverMeshRef.current.geometry.dispose(); hoverMeshRef.current = null;
    }

    // Selected overlay
    if (faceCentroid && selBoundary.current && !selMeshRef.current) {
      const m = new THREE.Mesh(buildFaceGeom(selBoundary.current), SELECTED_MAT);
      m.renderOrder = 100;
      scene.add(m);
      selMeshRef.current = m;
    }
    if (!faceCentroid && selMeshRef.current) {
      scene.remove(selMeshRef.current); selMeshRef.current.geometry.dispose(); selMeshRef.current = null;
      selBoundary.current = null;
    }
  });

  return null;
}
