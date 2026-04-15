import { useRef, useState, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../store/cadStore';
import { GeometryEngine } from '../../engine/GeometryEngine';
import type { Sketch } from '../../types/cad';
import SketchProfile from './extrude/SketchProfile';
import ExtrudePreview from './extrude/ExtrudePreview';
import ExtrudeGizmo from './extrude/ExtrudeGizmo';
import FaceHighlight from './extrude/FaceHighlight';

export default function ExtrudeTool() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);
  const selectedId = useCADStore((s) => s.extrudeSelectedSketchId);
  const setSelectedId = useCADStore((s) => s.setExtrudeSelectedSketchId);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const startExtrudeFromFace = useCADStore((s) => s.startExtrudeFromFace);
  const distance = useCADStore((s) => s.extrudeDistance);
  const direction = useCADStore((s) => s.extrudeDirection);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Press-pull face hit (boundary in world space + normal + centroid)
  const [faceHit, setFaceHit] = useState<{
    boundary: THREE.Vector3[];
    normal: THREE.Vector3;
    centroid: THREE.Vector3;
  } | null>(null);
  // Mirror to ref so the pointer handler doesn't depend on the state value
  const faceHitRef = useRef(faceHit);
  useEffect(() => { faceHitRef.current = faceHit; }, [faceHit]);

  // Stable scratch refs for the hot-path raycaster (per gotchas memory)
  const _mouse = useRef(new THREE.Vector2());
  const { gl, camera, raycaster, scene } = useThree();

  // Face raycaster — only active in extrude mode AND only while no profile is selected
  useEffect(() => {
    if (activeTool !== 'extrude' || selectedId) {
      // Clear any stale highlight when leaving picker mode
      if (faceHitRef.current) setFaceHit(null);
      return;
    }

    const collectPickable = (): THREE.Mesh[] => {
      const out: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.isMesh && obj.userData?.pickable) out.push(m);
      });
      return out;
    };

    const updateMouse = (event: { clientX: number; clientY: number }) => {
      const r = gl.domElement.getBoundingClientRect();
      _mouse.current.set(
        ((event.clientX - r.left) / r.width) * 2 - 1,
        -((event.clientY - r.top) / r.height) * 2 + 1,
      );
    };

    const handlePointerMove = (event: PointerEvent) => {
      updateMouse(event);
      raycaster.setFromCamera(_mouse.current, camera);
      const hits = raycaster.intersectObjects(collectPickable(), false);
      if (hits.length > 0 && hits[0].faceIndex !== undefined && hits[0].face) {
        const hit = hits[0];
        // Two pickable kinds: sketch profiles (have userData.sketchId) → just
        // hover the existing R3F state; body faces → compute the boundary loop.
        if (hit.object.userData?.sketchId) {
          // The R3F onPointerOver on SketchProfile already handles hover styling,
          // so we just clear any face hit and let R3F take the visual lead.
          if (faceHitRef.current) setFaceHit(null);
          return;
        }
        const result = GeometryEngine.computeCoplanarFaceBoundary(hit.object as THREE.Mesh, hit.faceIndex!);
        if (result) {
          setFaceHit(result);
          setStatusMessage('Click face to press-pull — extrude along its normal');
          return;
        }
      }
      if (faceHitRef.current) setFaceHit(null);
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      updateMouse(event);
      raycaster.setFromCamera(_mouse.current, camera);
      const hits = raycaster.intersectObjects(collectPickable(), false);
      if (hits.length === 0) return;
      const hit = hits[0];
      // Sketch profile? Route to setSelectedId via the store.
      const skId = hit.object.userData?.sketchId as string | undefined;
      if (skId) {
        event.stopPropagation();
        setSelectedId(skId);
        const sk = useCADStore.getState().sketches.find((s) => s.id === skId);
        if (sk) setStatusMessage(`Profile "${sk.name}" selected — drag arrow or set distance, then OK`);
        return;
      }
      // Body face → compute boundary + start press-pull
      if (hit.faceIndex !== undefined && hit.face) {
        const result = GeometryEngine.computeCoplanarFaceBoundary(hit.object as THREE.Mesh, hit.faceIndex!);
        if (result) {
          event.stopPropagation();
          startExtrudeFromFace(result.boundary, result.normal, result.centroid);
          setFaceHit(null);
        }
      }
    };

    const canvas = gl.domElement;
    canvas.addEventListener('pointermove', handlePointerMove);
    // Capture phase so we win the race against R3F's onClick on SketchProfile meshes
    canvas.addEventListener('click', handleClick, true);
    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('click', handleClick, true);
      setFaceHit(null);
    };
  }, [activeTool, selectedId, gl, camera, raycaster, scene, startExtrudeFromFace, setStatusMessage]);

  if (activeTool !== 'extrude') return null;

  const extrudable = sketches.filter((s) => s.entities.length > 0);
  const selectedSketch = extrudable.find((s) => s.id === selectedId);

  const handleHover = (sketch: Sketch) => {
    setHoveredId(sketch.id);
    if (!selectedId) setStatusMessage(`Click "${sketch.name}" to extrude it`);
  };

  const handleUnhover = (id: string) => {
    setHoveredId((prev) => (prev === id ? null : prev));
  };

  const handleSelect = (sketch: Sketch) => {
    setSelectedId(sketch.id);
    setStatusMessage(`Profile "${sketch.name}" selected — drag arrow or set distance, then OK`);
  };

  return (
    <group>
      {extrudable.map((s) => (
        <SketchProfile
          key={s.id}
          sketch={s}
          state={
            s.id === selectedId ? 'selected' :
            s.id === hoveredId  ? 'hover'    : 'idle'
          }
          onSelect={() => handleSelect(s)}
          onHover={() => handleHover(s)}
          onUnhover={() => handleUnhover(s.id)}
        />
      ))}
      {/* Press-pull face highlight (only while no profile selected) */}
      {!selectedId && faceHit && <FaceHighlight boundary={faceHit.boundary} />}
      {selectedSketch && (
        <>
          <ExtrudePreview sketch={selectedSketch} distance={distance} direction={direction} />
          <ExtrudeGizmo sketch={selectedSketch} />
        </>
      )}
    </group>
  );
}
