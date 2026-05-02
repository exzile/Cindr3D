import { useState, useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { Sketch } from '../../../types/cad';
import SketchProfile from '../extrude/SketchProfile';
import ExtrudePreview from '../extrude/ExtrudePreview';
import ExtrudeGizmo from '../extrude/ExtrudeGizmo';
import FaceHighlight from '../extrude/FaceHighlight';
import { useFacePicker } from '../../../hooks/useFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

// Module-level scratch — never allocate in event handlers
const _mouse = new THREE.Vector2();

/**
 * Module-level flag set by ExtrudeGizmo on pointerdown and cleared after the
 * subsequent click event. Prevents the profile-picker click handler from
 * toggling (deselecting) the profile when the user releases a gizmo drag.
 */
export let _gizmoDragActive = false;
// eslint-disable-next-line react-refresh/only-export-components
export function setGizmoDragActive(v: boolean) { _gizmoDragActive = v; }

function parseSelectionId(id: string): { sketchId: string; profileIndex: number | null } {
  const parts = id.split('::');
  if (parts.length === 2) {
    const parsed = Number(parts[1]);
    if (Number.isFinite(parsed)) return { sketchId: parts[0], profileIndex: parsed };
  }
  return { sketchId: id, profileIndex: null };
}

function buildSelectionId(sketchId: string, profileIndex: number): string {
  return `${sketchId}::${profileIndex}`;
}

export default function ExtrudeTool() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);
  const selectedIds = useCADStore((s) => s.extrudeSelectedSketchIds);
  const setSelectedIds = useCADStore((s) => s.setExtrudeSelectedSketchIds);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const startExtrudeFromFace = useCADStore((s) => s.startExtrudeFromFace);
  const addFaceToExtrude = useCADStore((s) => s.addFaceToExtrude);
  const distance = useCADStore((s) => s.extrudeDistance);
  const direction = useCADStore((s) => s.extrudeDirection);
  const selectedFeatureId = useCADStore((s) => s.selectedFeatureId);
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [faceHit, setFaceHit] = useState<FacePickResult | null>(null);

  // Face picker for press-pull (EX-11: also active when sketch profiles are already selected).
  //  - No profiles → startExtrudeFromFace (replaces selection, press-pull flow)
  //  - Profiles already selected → addFaceToExtrude (appends coplanar face profile)
  // Profile meshes are excluded so the face picker doesn't fight the profile picker.
  useFacePicker({
    enabled: activeTool === 'extrude',
    filter: (mesh) => !mesh.userData?.profileKey,
    onHover: setFaceHit,
    onClick: (result) => {
      if (selectedIds.length === 0) {
        startExtrudeFromFace(result.boundary, result.normal, result.centroid);
      } else {
        addFaceToExtrude(result.boundary, result.normal, result.centroid);
      }
      setFaceHit(null);
    },
  });

  const features = useCADStore((s) => s.features);

  const focusedSketchId = useMemo(() => {
    const selectedFeature = features.find((f) => f.id === selectedFeatureId);
    return selectedFeature?.type === 'sketch' ? selectedFeature.sketchId : null;
  }, [features, selectedFeatureId]);

  // Only hide profiles that are already consumed by an extrude feature.
  const extrudable = useMemo(() => {
    const timelineSketchIds = new Set(
      features
        .filter((feature) => feature.type === 'sketch' && feature.sketchId)
        .map((feature) => feature.sketchId),
    );
    const fullyUsedSketchIds = new Set<string>();
    for (const feature of features.filter((f) => f.type === 'extrude' && !f.suppressed && f.id !== editingFeatureId)) {
      const sketchId = feature.sketchId?.split('::')[0];
      if (!sketchId) continue;
      const profileIndex = feature.params.profileIndex;
      if (!(typeof profileIndex === 'number' && Number.isFinite(profileIndex))) {
        fullyUsedSketchIds.add(sketchId);
      }
    }
    const candidates = sketches.filter((s) =>
      s.entities.length > 0 &&
      timelineSketchIds.has(s.id) &&
      !fullyUsedSketchIds.has(s.id) &&
      (!focusedSketchId || s.id === focusedSketchId)
    );
    const sketchTimelineIndex = new Map<string, number>();
    features.forEach((feature, index) => {
      if (feature.type === 'sketch' && feature.sketchId) {
        sketchTimelineIndex.set(feature.sketchId, index);
      }
    });
    const sameSketchPlane = (a: Sketch, b: Sketch) => {
      const aN = a.planeNormal.clone().normalize();
      const bN = b.planeNormal.clone().normalize();
      const dot = aN.dot(bN);
      if (Math.abs(Math.abs(dot) - 1) > 1e-3) return false;
      const aD = aN.dot(a.planeOrigin);
      const bD = dot >= 0 ? aN.dot(b.planeOrigin) : -aN.dot(b.planeOrigin);
      return Math.abs(aD - bD) <= 1e-2;
    };
    return candidates.filter((sketch, index) =>
      !candidates.some((other, otherIndex) => {
        if (otherIndex === index || !sameSketchPlane(sketch, other)) return false;
        const sketchIndex = sketchTimelineIndex.get(sketch.id) ?? index;
        const otherFeatureIndex = sketchTimelineIndex.get(other.id) ?? otherIndex;
        return otherFeatureIndex > sketchIndex;
      })
    );
  }, [sketches, features, focusedSketchId, editingFeatureId]);

  const consumedProfileIds = useMemo(() => new Set(
      features
        .filter((f) => f.type === 'extrude' && !f.suppressed && f.id !== editingFeatureId)
        .map((f) => {
          const sketchId = f.sketchId?.split('::')[0];
          const profileIndex = f.params.profileIndex;
          return sketchId && typeof profileIndex === 'number' && Number.isFinite(profileIndex)
            ? buildSelectionId(sketchId, profileIndex)
            : null;
        })
        .filter((id): id is string => !!id),
    ),
    [features, editingFeatureId],
  );

  const profileEntries = useMemo(() => {
    // Use the FLAT shape list so every closed region is a selectable profile
    // (rectangle + each inner circle are all clickable, Fusion 360 parity).
    return extrudable.flatMap((sketch) => {
      const count = GeometryEngine.sketchToProfileShapesFlat(sketch).length;
      return Array.from({ length: count }, (_, profileIndex) => ({
        sketch,
        profileIndex,
        selectionId: buildSelectionId(sketch.id, profileIndex),
      })).filter(({ selectionId, profileIndex }) =>
        !consumedProfileIds.has(selectionId) &&
        GeometryEngine.createProfileSketch(sketch, profileIndex) !== null
      );
    });
  }, [extrudable, consumedProfileIds]);

  const availableProfileIds = useMemo(
    () => new Set(profileEntries.map((entry) => entry.selectionId)),
    [profileEntries],
  );

  useEffect(() => {
    if (activeTool !== 'extrude') return;
    const next = selectedIds.filter((id) => availableProfileIds.has(id));
    if (next.length !== selectedIds.length) {
      setSelectedIds(next);
    }
  }, [activeTool, availableProfileIds, selectedIds, setSelectedIds]);

  const getSketchForSelection = (selectionId: string): Sketch | null => {
    const { sketchId, profileIndex } = parseSelectionId(selectionId);
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!sketch) return null;
    if (profileIndex === null) return sketch;
    return GeometryEngine.createProfileSketch(sketch, profileIndex);
  };

  const isSamePlane = (a: Sketch, b: Sketch) => {
    const aN = a.planeNormal.clone().normalize();
    const bN = b.planeNormal.clone().normalize();
    const dot = aN.dot(bN);
    if (Math.abs(Math.abs(dot) - 1) > 1e-3) return false;
    const aD = aN.dot(a.planeOrigin);
    const bD = dot >= 0 ? aN.dot(b.planeOrigin) : -aN.dot(b.planeOrigin);
    return Math.abs(aD - bD) <= 1e-2;
  };

  const toggleSelection = (selectionId: string, additive = false) => {
    if (selectedIds.includes(selectionId)) {
      const next = selectedIds.filter((id) => id !== selectionId);
      setSelectedIds(next);
      setStatusMessage(next.length > 0
        ? `${next.length} profile${next.length > 1 ? 's' : ''} selected — drag arrow or set distance, then OK`
        : 'Click a profile or face to extrude');
      return;
    }

    const incoming = getSketchForSelection(selectionId);
    if (!incoming) return;
    if (selectedIds.length > 0) {
      const first = getSketchForSelection(selectedIds[0]);
      const incomingBaseSketchId = parseSelectionId(selectionId).sketchId;
      const sameSourceSketch = selectedIds.every((id) => parseSelectionId(id).sketchId === incomingBaseSketchId);
      if (first && !isSamePlane(first, incoming)) {
        setSelectedIds([selectionId]);
        setStatusMessage('Profile selection moved to the clicked sketch plane');
        return;
      }
      if (!additive && !sameSourceSketch) {
        setSelectedIds([selectionId]);
        setStatusMessage('1 profile selected — drag arrow or set distance, then OK');
        return;
      }
    } else if (!additive) {
      setSelectedIds([selectionId]);
      setStatusMessage('1 profile selected — drag arrow or set distance, then OK');
      return;
    }

    const next = [...selectedIds, selectionId];
    setSelectedIds(next);
    setStatusMessage(`${next.length} profile${next.length > 1 ? 's' : ''} selected — drag arrow or set distance, then OK`);
  };

  // ─── Native DOM profile picking ───────────────────────────────────────
  // R3F's <primitive> onClick is unreliable for dynamically-created meshes.
  // Use native DOM listeners + Three.js raycaster (same pattern as useFacePicker)
  // to detect hover and click on profile meshes.
  const { gl, camera, raycaster, scene } = useThree();
  // Profile picking stays active even after first selection so the user can
  // click additional coplanar profiles. toggleSelection handles same-plane checks.
  const profilePickEnabled = activeTool === 'extrude';

  // Refs to avoid stale closures in DOM event handlers
  const toggleSelectionRef = useRef(toggleSelection);
  toggleSelectionRef.current = toggleSelection;
  const setHoveredIdRef = useRef(setHoveredId);
  setHoveredIdRef.current = setHoveredId;
  const setStatusMessageRef = useRef(setStatusMessage);
  setStatusMessageRef.current = setStatusMessage;
  const hoveredIdRef = useRef(hoveredId);
  hoveredIdRef.current = hoveredId;

  useEffect(() => {
    if (!profilePickEnabled) {
      // Clear hover when disabled
      if (hoveredIdRef.current !== null) {
        setHoveredIdRef.current(null);
      }
      return;
    }

    // Cache the profile-mesh list across pointermove events — scene.traverse
    // on every move is the single most expensive part of hover handling on
    // larger scenes. The effect is rerun (via the profileEntriesKey dep below)
    // whenever the set of profiles actually changes, so each run starts with
    // a fresh cache and holds it for the lifetime of that listener binding.
    const expectedProfileCount = profileEntries.length;
    let cachedMeshes: THREE.Mesh[] | null = null;
    const collectProfileMeshes = (): THREE.Mesh[] => {
      if (cachedMeshes && cachedMeshes.length >= expectedProfileCount) return cachedMeshes;
      const fresh: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.isMesh && m.userData?.profileKey) fresh.push(m);
      });
      cachedMeshes = fresh.length > 0 || expectedProfileCount === 0 ? fresh : null;
      return fresh;
    };

    const updateMouse = (event: { clientX: number; clientY: number }) => {
      const r = gl.domElement.getBoundingClientRect();
      _mouse.set(
        ((event.clientX - r.left) / r.width) * 2 - 1,
        -((event.clientY - r.top) / r.height) * 2 + 1,
      );
    };

    // Profile meshes are all coplanar on the sketch plane, so raycaster hits
    // come back with near-identical distances and the array order is unreliable.
    // Pick the hit whose mesh has the SMALLEST world-space bounding-box area —
    // that way clicking inside a small atomic region (lens, crescent) picks
    // that region and NOT the enclosing original shape. Each click independently
    // toggles exactly the region directly under the cursor.
    //
    // To select a larger containing shape (e.g. the whole rectangle rather
    // than the atomic rect-minus-circles), Alt+click to pick the LARGEST
    // profile under the cursor.
    const _boxTmp = new THREE.Box3();
    const _sz = new THREE.Vector3();
    // Returns NaN for meshes with empty/invalid bounding boxes so the picker
    // knows to skip them — a degenerate mesh (e.g. an overly-filtered thin
    // shape) otherwise reports an infinite area and mis-sorts the picker.
    const meshArea = (mesh: THREE.Mesh): number => {
      _boxTmp.setFromObject(mesh);
      if (_boxTmp.isEmpty()) return NaN;
      _boxTmp.getSize(_sz);
      if (!isFinite(_sz.x) || !isFinite(_sz.y) || !isFinite(_sz.z)) return NaN;
      const dims = [_sz.x, _sz.y, _sz.z].sort((a, b) => b - a);
      return dims[0] * dims[1];
    };
    const resolveHit = (
      hits: THREE.Intersection[],
      mode: 'smallest' | 'largest' = 'smallest',
    ): THREE.Mesh | null => {
      let best: THREE.Mesh | null = null;
      let bestArea = mode === 'smallest' ? Infinity : -Infinity;
      for (const hit of hits) {
        const mesh = hit.object as THREE.Mesh;
        const key = mesh.userData?.profileKey as string | undefined;
        if (!key) continue;
        const area = meshArea(mesh);
        if (!isFinite(area)) continue; // skip degenerate / empty meshes
        if (mode === 'smallest' ? area < bestArea : area > bestArea) {
          bestArea = area;
          best = mesh;
        }
      }
      return best;
    };

    const handlePointerMove = (event: PointerEvent) => {
      updateMouse(event);
      raycaster.setFromCamera(_mouse, camera);
      const hits = raycaster.intersectObjects(collectProfileMeshes(), false);
      // Hover tracks the SAME mode the click would use (Alt = largest).
      const mesh = resolveHit(hits, event.altKey ? 'largest' : 'smallest');
      if (mesh) {
        const key = mesh.userData.profileKey as string;
        if (hoveredIdRef.current !== key) {
          hoveredIdRef.current = key;
          setHoveredIdRef.current(key);
          setStatusMessageRef.current(
            event.altKey
              ? 'Alt+click to select containing shape'
              : 'Click to select profile — Shift/Ctrl+click to add more',
          );
        }
      } else if (hoveredIdRef.current !== null) {
        hoveredIdRef.current = null;
        setHoveredIdRef.current(null);
      }
    };

    // Track where the primary button was pressed so we can distinguish a
    // genuine click from a click-and-drag (which the user uses to orbit/pan
    // the camera). The browser fires `click` for any mousedown→mouseup on the
    // same element, even with lots of movement in between, so we have to
    // discriminate manually. 5px matches the "drag threshold" most UI libs use.
    const DRAG_THRESHOLD_PX = 5;
    let downX = 0;
    let downY = 0;
    let downValid = false;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      downX = event.clientX;
      downY = event.clientY;
      downValid = true;
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (_gizmoDragActive) { _gizmoDragActive = false; downValid = false; return; }
      // Skip clicks that came after a drag — the user was orbiting/panning.
      if (downValid) {
        const dx = event.clientX - downX;
        const dy = event.clientY - downY;
        downValid = false;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) return;
      }
      updateMouse(event);
      raycaster.setFromCamera(_mouse, camera);
      const hits = raycaster.intersectObjects(collectProfileMeshes(), false);
      const mesh = resolveHit(hits, event.altKey ? 'largest' : 'smallest');
      if (mesh) {
        const key = mesh.userData.profileKey as string;
        toggleSelectionRef.current(key, event.shiftKey || event.ctrlKey || event.metaKey);
      }
    };

    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('click', handleClick, true);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('click', handleClick, true);
      if (hoveredIdRef.current !== null) {
        hoveredIdRef.current = null;
        setHoveredIdRef.current(null);
      }
    };
    // `profileEntries` is included so the listener rebinds (and the cached
    // mesh list above is rebuilt) when profiles are added/removed — e.g. a
    // sketch edit changes the atomic-region count.
  }, [profilePickEnabled, gl, camera, raycaster, scene, profileEntries]);

  // Set hover status message whenever a face is being highlighted
  useEffect(() => {
    if (!faceHit) return;
    setStatusMessage(
      selectedIds.length === 0
        ? 'Click face to press-pull — extrude along its normal'
        : 'Click face to add as additional profile (EX-11)',
    );
  }, [faceHit, selectedIds.length, setStatusMessage]);

  const selectedSketches = useMemo(() =>
    selectedIds.map((id) => ({ id, sketch: getSketchForSelection(id) })).filter(
      (e): e is { id: string; sketch: Sketch } => e.sketch !== null,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIds, sketches],
  );

  // Use the first selected sketch for the gizmo arrow position
  const gizmoSketch = selectedSketches.length > 0 ? selectedSketches[0].sketch : null;

  if (activeTool !== 'extrude') return null;

  // Once a preview is active, hide the SELECTED profile overlays visually —
  // they would ghost through the solid preview fill. But keep the meshes
  // IN THE SCENE (hidden via opacity 0, not unmounted) so the DOM profile
  // picker can still raycast them for deselect/toggle clicks. Idle and hover
  // overlays always stay visible so the user can add more profiles.
  const previewActive = Math.abs(distance) >= 0.001;

  return (
    <group>
      {profileEntries.map(({ sketch, profileIndex, selectionId }) => {
        const isSelected = selectedIds.includes(selectionId);
        return (
          <SketchProfile
            key={selectionId}
            sketch={sketch}
            profileIndex={profileIndex}
            state={
              isSelected ? 'selected' :
              selectionId === hoveredId ? 'hover' : 'idle'
            }
            hidden={previewActive && isSelected}
          />
        );
      })}
      {selectedIds.length === 0 && faceHit && <FaceHighlight boundary={faceHit.boundary} />}
      {selectedSketches.map(({ id, sketch }) => (
        <ExtrudePreview key={id} sketch={sketch} distance={distance} direction={direction} />
      ))}
      {gizmoSketch && <ExtrudeGizmo sketch={gizmoSketch} />}
    </group>
  );
}
