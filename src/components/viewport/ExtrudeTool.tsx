import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore, type ExtrudeDirection } from '../../store/cadStore';
import { GeometryEngine } from '../../engine/GeometryEngine';
import type { Sketch } from '../../types/cad';

// Shared materials — created once (module-level). Never dispose these.
const PROFILE_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.18,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const PROFILE_HOVER_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x60a5fa,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const PROFILE_SELECTED_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const PREVIEW_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0x3b82f6,
  metalness: 0.15,
  roughness: 0.35,
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
});
// Red preview used when press-pulling INTO a body (cut mode)
const PREVIEW_MATERIAL_CUT = new THREE.MeshPhysicalMaterial({
  color: 0xef4444,
  metalness: 0.15,
  roughness: 0.35,
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
});
const ARROW_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
const ARROW_MATERIAL_CUT = new THREE.MeshBasicMaterial({ color: 0xef4444 });
const ARROW_LINE_MATERIAL = new THREE.LineBasicMaterial({ color: 0xffaa00 });
const ARROW_LINE_MATERIAL_CUT = new THREE.LineBasicMaterial({ color: 0xef4444 });
// Face-highlight materials for press-pull face picking
const FACE_HIGHLIGHT_FILL = new THREE.MeshBasicMaterial({
  color: 0x60a5fa,
  transparent: true,
  opacity: 0.4,
  side: THREE.DoubleSide,
  depthWrite: false,
  depthTest: false,
});
const FACE_HIGHLIGHT_OUTLINE = new THREE.LineBasicMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.95,
  depthTest: false,
});
// ── Profile picking ────────────────────────────────────────────────────────

function SketchProfile({
  sketch, state, onSelect, onHover, onUnhover,
}: {
  sketch: Sketch;
  state: 'idle' | 'hover' | 'selected';
  onSelect: () => void;
  onHover: () => void;
  onUnhover: () => void;
}) {
  const material =
    state === 'selected' ? PROFILE_SELECTED_MATERIAL :
    state === 'hover'    ? PROFILE_HOVER_MATERIAL    :
                           PROFILE_MATERIAL;

  const mesh = useMemo(
    () => GeometryEngine.createSketchProfileMesh(sketch, material),
    [sketch, material],
  );

  useEffect(() => {
    if (mesh) {
      // Tag pickable so the unified ExtrudeTool raycaster catches it and
      // routes click → setSelectedId(sketch.id). Distinguishes from body faces
      // via userData.sketchId.
      mesh.userData.pickable = true;
      mesh.userData.sketchId = sketch.id;
    }
    return () => { mesh?.geometry.dispose(); };
  }, [mesh, sketch.id]);

  if (!mesh) return null;

  return (
    <primitive
      object={mesh}
      renderOrder={1000}
      onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(); }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(); }}
      onPointerOut={() => onUnhover()}
    />
  );
}

// ── Live extrude preview ───────────────────────────────────────────────────

function ExtrudePreview({ sketch, distance, direction }: {
  sketch: Sketch;
  distance: number;
  direction: ExtrudeDirection;
}) {
  // Signed distance: negative = press-pulled INTO the body → cut preview.
  // Always extrude with positive depth, then offset backwards when reverse.
  const isCut = distance < 0;
  const absDistance = Math.abs(distance);
  const effectiveDirection: ExtrudeDirection = isCut ? 'reverse' : direction;

  const mesh = useMemo(() => {
    if (absDistance < 0.001) return null;
    const m = GeometryEngine.extrudeSketch(sketch, absDistance);
    if (!m) return null;
    m.material = isCut ? PREVIEW_MATERIAL_CUT : PREVIEW_MATERIAL;
    if (effectiveDirection !== 'normal') {
      const offset = effectiveDirection === 'symmetric' ? absDistance / 2 : absDistance;
      m.position.sub(GeometryEngine.getSketchExtrudeNormal(sketch).multiplyScalar(offset));
    }
    return m;
  }, [sketch, absDistance, effectiveDirection, isCut]);

  useEffect(() => {
    return () => { mesh?.geometry.dispose(); };
  }, [mesh]);

  if (!mesh) return null;
  return <primitive object={mesh} />;
}

// ── Arrow gizmo ────────────────────────────────────────────────────────────

function ExtrudeGizmo({ sketch }: { sketch: Sketch }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls as { enabled: boolean } | null);
  const distance = useCADStore((s) => s.extrudeDistance);
  const setDistance = useCADStore((s) => s.setExtrudeDistance);

  // Cut mode = signed distance is negative (dragged into the body)
  const isCut = distance < 0;

  // Compute centroid + world normal once per sketch
  const { centroid, normal } = useMemo(() => {
    const c = GeometryEngine.getSketchProfileCentroid(sketch) ?? new THREE.Vector3();
    return { centroid: c, normal: GeometryEngine.getSketchExtrudeNormal(sketch) };
  }, [sketch]);

  // Arrow tip flips automatically with signed distance
  const arrowTip = useMemo(
    () => centroid.clone().addScaledVector(normal, distance),
    [centroid, normal, distance],
  );

  // Line geometry rebuilt whenever arrow tip moves
  const arrowLine = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints([centroid, arrowTip]);
    return new THREE.Line(geom, isCut ? ARROW_LINE_MATERIAL_CUT : ARROW_LINE_MATERIAL);
  }, [centroid, arrowTip, isCut]);

  useEffect(() => {
    return () => { arrowLine.geometry.dispose(); };
  }, [arrowLine]);

  // Cone quaternion: rotate default +Y to the effective arrow direction.
  // Cut mode flips the cone to point INTO the body.
  const coneQuat = useMemo(() => {
    const up = new THREE.Vector3(0, 1, 0);
    const dir = isCut ? normal.clone().negate() : normal;
    return new THREE.Quaternion().setFromUnitVectors(up, dir);
  }, [normal, isCut]);

  // Drag: track pointer ray → project onto (centroid, normal) axis line
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef(0);

  const rayToAxisDistance = useCallback((ndc: THREE.Vector2): number | null => {
    const ray = new THREE.Ray();
    ray.origin.setFromMatrixPosition(camera.matrixWorld);
    ray.direction.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(ray.origin).normalize();
    const w0 = ray.origin.clone().sub(centroid);
    const b = ray.direction.dot(normal);
    const d = ray.direction.dot(w0);
    const e = normal.dot(w0);
    const denom = 1 - b * b;
    if (Math.abs(denom) < 1e-4) return null; // ray parallel to axis
    return (e - b * d) / denom;
  }, [camera, centroid, normal]);

  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const sAtPointer = rayToAxisDistance(ndc);
    if (sAtPointer === null) return;
    draggingRef.current = true;
    dragOffsetRef.current = useCADStore.getState().extrudeDistance - sAtPointer;
    if (controls) controls.enabled = false;
    gl.domElement.style.cursor = 'ns-resize';
  }, [gl, rayToAxisDistance, controls]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const s = rayToAxisDistance(ndc);
      if (s === null) return;
      // Signed distance — allow negative so dragging INTO the face becomes
      // press-pull cut. Snap to 0.01 but don't clamp out the zero crossing.
      const newDist = Math.round((s + dragOffsetRef.current) * 100) / 100;
      if (newDist !== useCADStore.getState().extrudeDistance) setDistance(newDist);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (controls) controls.enabled = true;
      gl.domElement.style.cursor = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [gl, rayToAxisDistance, setDistance, controls]);

  return (
    <group renderOrder={2000}>
      <primitive object={arrowLine} />
      <mesh
        position={arrowTip}
        quaternion={coneQuat}
        onPointerDown={onPointerDown}
        onPointerOver={() => { gl.domElement.style.cursor = 'ns-resize'; }}
        onPointerOut={() => { if (!draggingRef.current) gl.domElement.style.cursor = ''; }}
      >
        <coneGeometry args={[1.2, 4, 16]} />
        <primitive object={isCut ? ARROW_MATERIAL_CUT : ARROW_MATERIAL} attach="material" />
      </mesh>
    </group>
  );
}

// ── Face highlight (press-pull hover) ──────────────────────────────────────

/** Renders a translucent fill + outline over a coplanar boundary loop. */
function FaceHighlight({ boundary }: { boundary: THREE.Vector3[] }) {
  // Build a flat polygon in WORLD space directly from the boundary points.
  // We don't project to plane-local coords — that just adds bugs. The mesh
  // is rendered in world space with depthTest disabled so it always shows on
  // top of the underlying body face.
  const { fillGeom, outlineGeom } = useMemo(() => {
    if (boundary.length < 3) return { fillGeom: null, outlineGeom: null };

    // Triangulate the boundary as a fan (works for convex faces — cube faces
    // are always convex). For non-convex faces this would fail, but they're
    // out of scope for v1.
    const positions: number[] = [];
    const indices: number[] = [];
    for (const p of boundary) positions.push(p.x, p.y, p.z);
    for (let i = 1; i < boundary.length - 1; i++) {
      indices.push(0, i, i + 1);
    }
    const fillGeom = new THREE.BufferGeometry();
    fillGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    fillGeom.setIndex(indices);
    fillGeom.computeVertexNormals();

    // Outline: closed line loop visiting each boundary point in order
    const outlinePositions: number[] = [];
    for (const p of boundary) outlinePositions.push(p.x, p.y, p.z);
    const outlineGeom = new THREE.BufferGeometry();
    outlineGeom.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));

    return { fillGeom, outlineGeom };
  }, [boundary]);

  useEffect(() => {
    return () => {
      fillGeom?.dispose();
      outlineGeom?.dispose();
    };
  }, [fillGeom, outlineGeom]);

  if (!fillGeom || !outlineGeom) return null;

  return (
    <group renderOrder={2000}>
      <mesh geometry={fillGeom} material={FACE_HIGHLIGHT_FILL} renderOrder={2000} />
      <lineLoop geometry={outlineGeom} material={FACE_HIGHLIGHT_OUTLINE} renderOrder={2001} />
    </group>
  );
}

// ── Root tool component ────────────────────────────────────────────────────

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
