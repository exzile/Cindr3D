/**
 * HoleFacePicker - OCC face picking and in-viewport preview for the Hole dialog.
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useCADStore } from '../../../store/cadStore';
import { usePickerSceneCleanup } from '../../../hooks/usePickerSceneCleanup';
import { useOccFacePicker, type OccFacePickResult } from './OccFacePicker';
import { getMeshTessellation, buildFaceHighlightGeometry } from '../../../engine/occ/picking';
import { isFacePlanar } from '../../../engine/occ/geomSurface';
import { globalBRepBodyRegistry } from '../../../engine/occ/globalRegistry';
import { getOccSync } from '../../../engine/occ/loader';
import { usePickCursor, pulseFactor } from './pickPulse';

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

const _normal = new THREE.Vector3();
const _centroid = new THREE.Vector3();
const _drillDir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

export default function HoleFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const holeFaceId = useCADStore((s) => s.holeFaceId);
  const holeFaceNormal = useCADStore((s) => s.holeFaceNormal);
  const holeFaceCentroid = useCADStore((s) => s.holeFaceCentroid);
  const setHoleFace = useCADStore((s) => s.setHoleFace);

  const pickEnabled = activeDialog === 'hole' && holeFaceId === null;
  const overlayEnabled = activeDialog === 'hole';

  const pulseHoverMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  useEffect(() => {
    const material = HOVER_MAT.clone();
    pulseHoverMatRef.current = material;
    return () => {
      material.dispose();
      pulseHoverMatRef.current = null;
    };
  }, []);

  const [hovering, setHovering] = useState(false);
  usePickCursor(pickEnabled, hovering);

  const occHoverRef = useRef<OccFacePickResult | null>(null);
  const occSelectedRef = useRef<OccFacePickResult | null>(null);
  const hoverMeshRef = useRef<THREE.Mesh | null>(null);
  const selectedMeshRef = useRef<THREE.Mesh | null>(null);
  const previewMeshRef = useRef<THREE.Mesh | null>(null);
  const hoverSigRef = useRef<string | null>(null);
  const selectedSigRef = useRef<string | null>(null);
  const previewSigRef = useRef<{ dia: number; depth: number }>({ dia: -1, depth: -1 });
  const planarFaceCacheRef = useRef<Map<string, boolean>>(new Map());
  usePickerSceneCleanup([hoverMeshRef, selectedMeshRef, previewMeshRef]);

  const isOccFacePlanar = useCallback((result: OccFacePickResult): boolean => {
    const key = `${result.bodyId}:${result.faceId}`;
    const cached = planarFaceCacheRef.current.get(key);
    if (cached !== undefined) return cached;
    const occ = getOccSync();
    if (!occ) return false;
    const body = globalBRepBodyRegistry.get(result.bodyId);
    if (!body) return false;
    const planar = isFacePlanar(occ.oc, body, result.faceId);
    planarFaceCacheRef.current.set(key, planar);
    return planar;
  }, []);

  const handleOccHover = useCallback((result: OccFacePickResult | null) => {
    if (!result || !isOccFacePlanar(result)) {
      setHovering(false);
      occHoverRef.current = null;
      return;
    }
    setHovering(true);
    occHoverRef.current = result;
  }, [isOccFacePlanar]);

  const handleOccClick = useCallback((result: OccFacePickResult) => {
    if (!isOccFacePlanar(result)) return;
    occSelectedRef.current = result;
    const id = `occ:${result.bodyId}:${result.faceId}`;
    setHoleFace(
      id,
      [result.normal.x, result.normal.y, result.normal.z],
      [result.point.x, result.point.y, result.point.z],
    );
  }, [isOccFacePlanar, setHoleFace]);

  useOccFacePicker({ enabled: pickEnabled, onHover: handleOccHover, onClick: handleOccClick });

  useFrame(({ scene, invalidate, clock }) => {
    if (!overlayEnabled) {
      planarFaceCacheRef.current.clear();
      if (hoverMeshRef.current) {
        scene.remove(hoverMeshRef.current);
        hoverMeshRef.current.geometry.dispose();
        hoverMeshRef.current = null;
      }
      hoverSigRef.current = null;
      if (selectedMeshRef.current) {
        scene.remove(selectedMeshRef.current);
        selectedMeshRef.current.geometry.dispose();
        selectedMeshRef.current = null;
      }
      selectedSigRef.current = null;
      if (previewMeshRef.current) {
        scene.remove(previewMeshRef.current);
        previewMeshRef.current.geometry.dispose();
        previewMeshRef.current = null;
      }
      occHoverRef.current = null;
      occSelectedRef.current = null;
      return;
    }
    if (pickEnabled && occHoverRef.current) invalidate();

    if (pickEnabled) {
      const occHover = occHoverRef.current;
      const tess = occHover ? getMeshTessellation(occHover.mesh) : null;
      const pulseHoverMat = pulseHoverMatRef.current;
      if (occHover && tess && pulseHoverMat) {
        const sig = `${occHover.bodyId}:${occHover.faceId}`;
        if (!hoverMeshRef.current || hoverSigRef.current !== sig) {
          const hoverGeo = buildFaceHighlightGeometry(tess, occHover.faceId);
          if (hoverMeshRef.current) {
            hoverMeshRef.current.geometry.dispose();
            hoverMeshRef.current.geometry = hoverGeo;
          } else {
            const mesh = new THREE.Mesh(hoverGeo, pulseHoverMat);
            mesh.renderOrder = 99;
            scene.add(mesh);
            hoverMeshRef.current = mesh;
          }
          hoverSigRef.current = sig;
        }
        pulseHoverMat.opacity = 0.3 + 0.35 * pulseFactor(clock.elapsedTime * 1000);
      } else if (hoverMeshRef.current) {
        scene.remove(hoverMeshRef.current);
        hoverMeshRef.current.geometry.dispose();
        hoverMeshRef.current = null;
        hoverSigRef.current = null;
      }
    } else if (hoverMeshRef.current) {
      scene.remove(hoverMeshRef.current);
      hoverMeshRef.current.geometry.dispose();
      hoverMeshRef.current = null;
      hoverSigRef.current = null;
    }

    const occSelected = occSelectedRef.current;
    if (holeFaceId && occSelected) {
      const tess = getMeshTessellation(occSelected.mesh);
      if (tess) {
        const sig = `${occSelected.bodyId}:${occSelected.faceId}`;
        if (!selectedMeshRef.current || selectedSigRef.current !== sig) {
          const selectedGeo = buildFaceHighlightGeometry(tess, occSelected.faceId);
          if (selectedMeshRef.current) {
            selectedMeshRef.current.geometry.dispose();
            selectedMeshRef.current.geometry = selectedGeo;
          } else {
            const mesh = new THREE.Mesh(selectedGeo, SELECTED_MAT);
            mesh.renderOrder = 100;
            scene.add(mesh);
            selectedMeshRef.current = mesh;
          }
          selectedSigRef.current = sig;
        }
      }
    }
    if (!holeFaceId && selectedMeshRef.current) {
      scene.remove(selectedMeshRef.current);
      selectedMeshRef.current.geometry.dispose();
      selectedMeshRef.current = null;
      selectedSigRef.current = null;
      occSelectedRef.current = null;
    }

    if (holeFaceId && holeFaceNormal && holeFaceCentroid) {
      const dia = useCADStore.getState().holeDraftDiameter;
      const depth = useCADStore.getState().holeDraftDepth;

      _normal.set(holeFaceNormal[0], holeFaceNormal[1], holeFaceNormal[2]).normalize();
      _centroid.set(holeFaceCentroid[0], holeFaceCentroid[1], holeFaceCentroid[2]);
      _drillDir.copy(_normal).multiplyScalar(-1);
      _quat.setFromUnitVectors(_up, _drillDir);

      const dirty = previewSigRef.current.dia !== dia || previewSigRef.current.depth !== depth;
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
