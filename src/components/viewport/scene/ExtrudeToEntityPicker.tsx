/**
 * ExtrudeToEntityPicker — EX-3 "To Object" terminus face picker.
 *
 * Active whenever the extrude panel is open AND extrudeExtentType or
 * extrudeExtentType2 is 'to-object'. The user clicks a body face to
 * set the plane the extrude terminates at; the centroid + normal are
 * stored so commitExtrude can derive the effective distance.
 *
 * Visual: blue hover overlay (same as HoleFacePicker), orange selected overlay.
 *
 * Module-level singletons + scratch vectors — no per-frame allocation.
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useCADStore } from '../../../store/cadStore';
import { useFacePicker, type FacePickResult } from '../../../hooks/useFacePicker';

// ── Material singletons ───────────────────────────────────────────────────────
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
export default function ExtrudeToEntityPicker() {
  const activeTool     = useCADStore((s) => s.activeTool);
  const extentType     = useCADStore((s) => s.extrudeExtentType);
  const extentType2    = useCADStore((s) => s.extrudeExtentType2);
  const faceId         = useCADStore((s) => s.extrudeToEntityFaceId);
  const setFace        = useCADStore((s) => s.setExtrudeToEntityFace);

  const isToObject  = extentType === 'to-object' || extentType2 === 'to-object';
  const pickEnabled = activeTool === 'extrude' && isToObject && faceId === null;
  const overlayEnabled = activeTool === 'extrude' && isToObject;

  const hoverRef     = useRef<FacePickResult | null>(null);
  const selBoundary  = useRef<THREE.Vector3[] | null>(null);

  const hoverMeshRef = useRef<THREE.Mesh | null>(null);
  const selMeshRef   = useRef<THREE.Mesh | null>(null);

  const handleHover  = useCallback((r: FacePickResult | null) => { hoverRef.current = r; }, []);

  const handleClick  = useCallback((r: FacePickResult) => {
    const id = r.centroid.toArray().join(',');
    selBoundary.current = r.boundary.map((v) => v.clone());
    setFace(
      id,
      [r.normal.x, r.normal.y, r.normal.z],
      [r.centroid.x, r.centroid.y, r.centroid.z],
    );
  }, [setFace]);

  useFacePicker({ enabled: pickEnabled, onHover: handleHover, onClick: handleClick });

  useFrame(({ scene }) => {
    // Tear down when not relevant
    if (!overlayEnabled) {
      if (hoverMeshRef.current) { scene.remove(hoverMeshRef.current); hoverMeshRef.current.geometry.dispose(); hoverMeshRef.current = null; }
      if (selMeshRef.current)   { scene.remove(selMeshRef.current);   selMeshRef.current.geometry.dispose();   selMeshRef.current   = null; }
      return;
    }

    // Hover overlay (only while picking)
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

    // Selected face overlay
    if (faceId && selBoundary.current && !selMeshRef.current) {
      const m = new THREE.Mesh(buildFaceGeom(selBoundary.current), SELECTED_MAT);
      m.renderOrder = 100;
      scene.add(m);
      selMeshRef.current = m;
    }
    if (!faceId && selMeshRef.current) {
      scene.remove(selMeshRef.current); selMeshRef.current.geometry.dispose(); selMeshRef.current = null;
      selBoundary.current = null;
    }
  });

  return null;
}
