import { useState, useEffect, useRef, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../store/cadStore';
import { useFacePicker } from '../../hooks/useFacePicker';
import type { FacePickResult } from '../../hooks/useFacePicker';
import FaceHighlight from './extrude/FaceHighlight';
import { GeometryEngine } from '../../engine/GeometryEngine';

// Singleton preview material — semi-transparent teal, never disposed
const _previewMat = new THREE.MeshPhysicalMaterial({
  color: 0x0d9488,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthWrite: false,
});

export default function RevolveTool() {
  const { gl } = useThree();

  const activeTool     = useCADStore((s) => s.activeTool);
  const profileMode    = useCADStore((s) => s.revolveProfileMode);
  const faceBoundary   = useCADStore((s) => s.revolveFaceBoundary);
  const revolveAngle   = useCADStore((s) => s.revolveAngle);
  const setAngle       = useCADStore((s) => s.setRevolveAngle);
  const revolveAxis    = useCADStore((s) => s.revolveAxis);
  const startFromFace  = useCADStore((s) => s.startRevolveFromFace);

  const [faceHit, setFaceHit] = useState<FacePickResult | null>(null);
  // Keeps the THREE.Vector3[] boundary alive for FaceHighlight + preview after clicking
  const [selBoundary, setSelBoundary] = useState<THREE.Vector3[] | null>(null);
  const dragRef = useRef<{ startX: number; startAngle: number } | null>(null);

  const isFaceMode    = activeTool === 'revolve' && profileMode === 'face';
  const isPicking     = isFaceMode && !faceBoundary;
  const hasFace       = isFaceMode && !!faceBoundary;

  // Clear selBoundary when the panel X chip clears the store boundary
  useEffect(() => {
    if (!faceBoundary) setSelBoundary(null);
  }, [faceBoundary]);

  // Face picker — active only while waiting for face selection
  useFacePicker({
    enabled: isPicking,
    onHover: setFaceHit,
    onClick: (result) => {
      setSelBoundary(result.boundary);   // keep highlight visible
      startFromFace(result.boundary, result.normal);
      setFaceHit(null);
    },
  });

  // Drag to set revolve angle after a face is selected.
  // capture:true on pointerdown so we can stopPropagation before OrbitControls sees it.
  useEffect(() => {
    if (!hasFace) return;
    const canvas = gl.domElement;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();  // prevent orbit rotation during angle drag
      dragRef.current = { startX: e.clientX, startAngle: useCADStore.getState().revolveAngle };
    };

    const onMove = (e: PointerEvent) => {
      if (!dragRef.current || !(e.buttons & 1)) return;
      const dx = e.clientX - dragRef.current.startX;
      // 1 px ≈ 0.7°, clamped 1–360
      const next = Math.max(1, Math.min(360, dragRef.current.startAngle + dx * 0.7));
      setAngle(Math.round(next));
    };

    const onUp = () => { dragRef.current = null; };

    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup',   onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup',   onUp);
    };
  }, [hasFace, gl, setAngle]);

  // Axis vector — recomputed only when revolveAxis changes
  const axisVec = useMemo(() => {
    if (revolveAxis === 'X') return new THREE.Vector3(1, 0, 0);
    if (revolveAxis === 'Z') return new THREE.Vector3(0, 0, 1);
    return new THREE.Vector3(0, 1, 0);
  }, [revolveAxis]);

  // Live preview mesh — rebuilt when boundary, angle or axis changes
  const previewMesh = useMemo(() => {
    if (!selBoundary || selBoundary.length < 3) return null;
    const rad = revolveAngle * (Math.PI / 180);
    const m = GeometryEngine.revolveFaceBoundary(selBoundary, axisVec, rad, false);
    if (m) m.material = _previewMat;
    return m;
  }, [selBoundary, revolveAngle, axisVec]);

  // Dispose preview geometry when it's replaced or the tool exits
  useEffect(() => {
    return () => { previewMesh?.geometry.dispose(); };
  }, [previewMesh]);

  if (!isFaceMode) return null;

  return (
    <>
      {/* Hover highlight while picking */}
      {isPicking && faceHit && <FaceHighlight boundary={faceHit.boundary} />}
      {/* Persistent highlight of the selected face */}
      {selBoundary && <FaceHighlight boundary={selBoundary} />}
      {/* Live preview of the revolved shape */}
      {previewMesh && <primitive object={previewMesh} />}
    </>
  );
}
