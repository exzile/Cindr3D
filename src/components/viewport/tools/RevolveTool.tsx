import { useState, useEffect, useRef, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useFacePicker } from '../../../hooks/useFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';
import FaceHighlight from '../extrude/FaceHighlight';
import { GeometryEngine } from '../../../engine/GeometryEngine';

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
  const revolveAngle2  = useCADStore((s) => s.revolveAngle2);
  const revolveDir     = useCADStore((s) => s.revolveDirection);
  const revolveAxis    = useCADStore((s) => s.revolveAxis);
  const startFromFace  = useCADStore((s) => s.startRevolveFromFace);
  const sketches       = useCADStore((s) => s.sketches);
  const selectedSketchId = useCADStore((s) => s.revolveSelectedSketchId);

  const [faceHit, setFaceHit] = useState<FacePickResult | null>(null);
  // Keeps the THREE.Vector3[] boundary alive for FaceHighlight + preview after clicking
  const [selBoundary, setSelBoundary] = useState<THREE.Vector3[] | null>(null);
  const dragRef = useRef<{ startX: number; startAngle: number } | null>(null);

  const isFaceMode    = activeTool === 'revolve' && profileMode === 'face';
  const isPicking     = isFaceMode && !faceBoundary;
  const hasFace       = isFaceMode && !!faceBoundary;

  // Clear selBoundary when the panel X chip clears the store boundary
  useEffect(() => {
    if (!faceBoundary) setSelBoundary(null); // eslint-disable-line react-hooks/set-state-in-effect -- sync local state with store
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

  const selectedSketch = useMemo(
    () => sketches.find((s) => s.id === selectedSketchId) ?? null,
    [sketches, selectedSketchId],
  );

  // Axis vector — supports X/Y/Z and (sketch mode) the sketch centerline,
  // mirroring commitRevolve so the preview matches the committed body.
  const axisVec = useMemo(() => {
    if (revolveAxis === 'X') return new THREE.Vector3(1, 0, 0);
    if (revolveAxis === 'Z') return new THREE.Vector3(0, 0, 1);
    if (revolveAxis === 'centerline' && selectedSketch) {
      const cl = selectedSketch.entities.find((e) => e.type === 'centerline' && e.points.length >= 2);
      if (cl) {
        const p0 = cl.points[0];
        const p1 = cl.points[cl.points.length - 1];
        const d = new THREE.Vector3(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
        if (d.lengthSq() > 1e-9) return d.normalize();
      }
    }
    return new THREE.Vector3(0, 1, 0);
  }, [revolveAxis, selectedSketch]);

  // Live preview mesh — same geometry fns + sweep resolver as the committed
  // RevolveBody, so "what you see is what you get" across one-side /
  // symmetric / two-sides for both sketch and face profiles.
  const previewMesh = useMemo(() => {
    const { phiStart, sweep } = GeometryEngine.resolveRevolveSweep(revolveAngle, revolveAngle2, revolveDir);
    if (Math.abs(sweep) < 1e-3) return null;
    let m: THREE.Mesh | null = null;
    if (profileMode === 'face') {
      if (!selBoundary || selBoundary.length < 3) return null;
      m = GeometryEngine.revolveFaceBoundary(selBoundary, axisVec, sweep, false, phiStart);
    } else {
      if (!selectedSketch) return null;
      m = GeometryEngine.revolveSketch(selectedSketch, sweep, axisVec, phiStart);
    }
    if (m) m.material = _previewMat;
    return m;
  }, [profileMode, selBoundary, selectedSketch, revolveAngle, revolveAngle2, revolveDir, axisVec]);

  // Dispose preview geometry when it's replaced or the tool exits
  useEffect(() => {
    return () => { previewMesh?.geometry.dispose(); };
  }, [previewMesh]);

  if (activeTool !== 'revolve') return null;

  return (
    <>
      {/* Face-mode picking highlights */}
      {isFaceMode && isPicking && faceHit && <FaceHighlight boundary={faceHit.boundary} />}
      {isFaceMode && selBoundary && <FaceHighlight boundary={selBoundary} />}
      {/* Live preview of the revolved shape — sketch AND face modes */}
      {previewMesh && <primitive object={previewMesh} />}
    </>
  );
}
