// SketchDimensionAnnotations.tsx
// Renders dimension annotation geometry (extension lines, dimension lines,
// value labels) for the active sketch's SketchDimension entries.
// NOTE: SketchConstraint only carries geometric constraints; dimension data
// lives in sketch.dimensions (SketchDimension[]). This component is wired and
// ready — it will populate automatically once D28 adds dimension records.

import { useMemo, useEffect, useRef } from "react";
import { Html } from "@react-three/drei";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useCADStore } from "../../../store/cadStore";
import { GeometryEngine } from "../../../engine/GeometryEngine";
import {
  dimensionLabelStyle,
  toWorld,
  makePreallocatedSegments,
  writePairsToSegments,
} from "./sketchDimensions/annotationGeometry";
import { computeAnnotationData } from "./sketchDimensions/dimensionPairComputer";
import {
  openDimensionDeleteMenu,
  type DimensionContextMenuEvent,
} from "./sketchDimensions/dimensionContextMenu";
import { useCameraIdle } from "../hooks/useCameraIdle";

interface AnnData {
  dimensionId: string;
  /** Pre-allocated LineSegments — positions updated in-place by useFrame. */
  segments: THREE.LineSegments;
  /** Mutated in-place by useFrame; Html reads it each frame via invalidate(). */
  textPos: THREE.Vector3;
  label: string;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function SketchDimensionAnnotations() {
  const activeSketch = useCADStore((s) => s.activeSketch);
  const removeDimension = useCADStore((s) => s.removeDimension);
  const pendingNewDimensionId = useCADStore((s) => s.pendingNewDimensionId);
  const sketchDimEditId = useCADStore((s) => s.sketchDimEditId);
  const openSketchDimEdit = useCADStore((s) => s.openSketchDimEdit);
  const updateSketchDimEditScreen = useCADStore(
    (s) => s.updateSketchDimEditScreen,
  );
  const { camera, gl } = useThree();
  const cameraIdle = useCameraIdle();
  const closeContextMenuRef = useRef<(() => void) | null>(null);
  const draggingDimRef = useRef<{
    dimensionId: string;
    startScreenX: number;
    startScreenY: number;
    startPosition: { x: number; y: number };
    moved: boolean;
    // Cached once on first move — avoids repeated raycasts and layout reads
    sketchPlane: THREE.Plane | null;
    canvasRect: DOMRect | null;
    startSketchPos: { x: number; y: number } | null;
  } | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pendingMousePos = useRef<{ x: number; y: number } | null>(null);

  // ── Phase 1: structure memo ────────────────────────────────────────────────
  // Depends only on sketch ID + dimensions array reference. Constraint solving
  // spreads activeSketch but keeps the same dimensions array reference when
  // only entity positions changed → this memo does NOT rebuild during drag.
  // Creates pre-allocated LineSegments and fills initial positions.
  const annotations = useMemo<AnnData[]>(() => {
    if (!activeSketch?.dimensions?.length) return [];
    const annData = computeAnnotationData(activeSketch);
    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const origin = (activeSketch.planeOrigin ?? new THREE.Vector3(0, 0, 0)) as THREE.Vector3;
    return annData.map(({ dimensionId, label, pairs, textPos2D }) => {
      const segments = makePreallocatedSegments();
      writePairsToSegments(segments, pairs, origin, t1, t2);
      return { dimensionId, segments, textPos: toWorld(textPos2D, origin, t1, t2), label };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSketch?.id, activeSketch?.dimensions]);

  // ── Phase 2: position update via useFrame ─────────────────────────────────
  // Reads current activeSketch directly from store (always fresh). Recomputes
  // all pairs and writes into the EXISTING Float32Array — no GPU allocation.
  // This runs only during active rendering (frameloop="demand").
  useFrame(() => {
    const sketch = useCADStore.getState().activeSketch;
    if (!sketch?.dimensions?.length || annotations.length === 0) return;
    const annData = computeAnnotationData(sketch);
    const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
    const origin = (sketch.planeOrigin ?? new THREE.Vector3(0, 0, 0)) as THREE.Vector3;
    for (let i = 0; i < Math.min(annData.length, annotations.length); i++) {
      const { pairs, textPos2D } = annData[i];
      writePairsToSegments(annotations[i].segments, pairs, origin, t1, t2);
      annotations[i].textPos.set(
        origin.x + t1.x * textPos2D.x + t2.x * textPos2D.y,
        origin.y + t1.y * textPos2D.x + t2.y * textPos2D.y,
        origin.z + t1.z * textPos2D.x + t2.z * textPos2D.y,
      );
    }
  });


  // When a new dimension is committed via fireAndEdit, open the inline editor.
  // Read directly from the store (not the memoized annotations) to avoid a timing
  // dependency on the annotations memo having re-run first.
  useEffect(() => {
    if (!pendingNewDimensionId) return;
    const sketch = useCADStore.getState().activeSketch;
    const dim = sketch?.dimensions?.find((d) => d.id === pendingNewDimensionId);
    if (!dim) return;
    const { t1, t2 } = GeometryEngine.getSketchAxes(sketch!);
    const originVec = (sketch!.planeOrigin ??
      new THREE.Vector3(0, 0, 0)) as THREE.Vector3;
    const worldPos = originVec
      .clone()
      .addScaledVector(t1, dim.position.x)
      .addScaledVector(t2, dim.position.y);
    const vec = worldPos.clone().project(camera);
    const rect = gl.domElement.getBoundingClientRect();
    openSketchDimEdit(pendingNewDimensionId, dim.value.toFixed(2), true);
    updateSketchDimEditScreen(
      Math.round(((vec.x + 1) / 2) * rect.width + rect.left),
      Math.round(((1 - vec.y) / 2) * rect.height + rect.top),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNewDimensionId]);

  // Keep screen coordinates current whenever the active edit ID or annotations change
  useEffect(() => {
    if (!sketchDimEditId) return;
    const ann = annotations.find((a) => a.dimensionId === sketchDimEditId);
    if (!ann) return;
    const vec = ann.textPos.clone().project(camera);
    const rect = gl.domElement.getBoundingClientRect();
    updateSketchDimEditScreen(
      Math.round(((vec.x + 1) / 2) * rect.width + rect.left),
      Math.round(((1 - vec.y) / 2) * rect.height + rect.top),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketchDimEditId, annotations]);

  const openDimensionContextMenu = (
    dimensionId: string,
    event: DimensionContextMenuEvent,
  ) => {
    openDimensionDeleteMenu({
      closeRef: closeContextMenuRef,
      dimensionId,
      event,
      onDelete: (id) => {
        useCADStore.getState().pushUndo?.();
        removeDimension(id);
        useCADStore.setState({ statusMessage: "Dimension deleted" });
      },
    });
  };

  useEffect(
    () => () => {
      closeContextMenuRef.current?.();
    },
    [],
  );

  const toSketchCoord = (
    cx: number,
    cy: number,
    rect: DOMRect,
    plane: THREE.Plane,
    t1: THREE.Vector3,
    t2: THREE.Vector3,
    origin: THREE.Vector3,
  ) => {
    const ndc = new THREE.Vector2(
      ((cx - rect.left) / rect.width) * 2 - 1,
      -((cy - rect.top) / rect.height) * 2 + 1,
    );
    raycasterRef.current.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!raycasterRef.current.ray.intersectPlane(plane, hit)) return null;
    const d = hit.sub(origin);
    return { x: d.dot(t1), y: d.dot(t2) };
  };

  const applyDragMove = (clientX: number, clientY: number) => {
    const drag = draggingDimRef.current;
    if (!drag?.sketchPlane || !drag.canvasRect || !drag.startSketchPos) return;
    const state = useCADStore.getState();
    if (!state.activeSketch) return;
    const { t1, t2 } = GeometryEngine.getSketchAxes(state.activeSketch);
    const origin = (state.activeSketch.planeOrigin ??
      new THREE.Vector3(0, 0, 0)) as THREE.Vector3;
    const currSk = toSketchCoord(
      clientX,
      clientY,
      drag.canvasRect,
      drag.sketchPlane,
      t1,
      t2,
      origin,
    );
    if (!currSk) return;
    const newPos = {
      x: drag.startPosition.x + (currSk.x - drag.startSketchPos.x),
      y: drag.startPosition.y + (currSk.y - drag.startSketchPos.y),
    };
    const nextSketch = {
      ...state.activeSketch,
      dimensions: state.activeSketch.dimensions.map((d) =>
        d.id === drag.dimensionId ? { ...d, position: newPos } : d,
      ),
    };
    useCADStore.setState({
      activeSketch: nextSketch,
      sketches: state.sketches.map((s) =>
        s.id === nextSketch.id ? nextSketch : s,
      ),
    });
  };

  // Consume the latest pending mouse position once per animation frame — caps store
  // writes to the render rate regardless of how fast pointer events arrive.
  useFrame(() => {
    const pos = pendingMousePos.current;
    if (!pos) return;
    pendingMousePos.current = null;
    applyDragMove(pos.x, pos.y);
  });

  // Dispose each LineSegments' BufferGeometry when annotations are rebuilt or
  // the component unmounts. The shared dashed material is a singleton — leave it.
  useEffect(() => {
    return () => {
      for (const ann of annotations) {
        ann.segments.geometry?.dispose?.();
      }
    };
  }, [annotations]);

  if (!activeSketch || annotations.length === 0) return null;

  return (
    <group renderOrder={999}>
      {annotations.map((ann, i) => (
        <group key={i}>
          <primitive
            object={ann.segments}
            onContextMenu={(event: {
              stopPropagation: () => void;
              nativeEvent: MouseEvent;
            }) => openDimensionContextMenu(ann.dimensionId, event)}
          />
          {ann.dimensionId !== sketchDimEditId && (
            <Html
              position={ann.textPos}
              center
              style={{
                pointerEvents: cameraIdle ? "auto" : "none",
                visibility: cameraIdle ? "visible" : "hidden",
              }}
            >
              <div
                style={{
                  ...dimensionLabelStyle,
                  cursor: "grab",
                  userSelect: "none",
                }}
                onContextMenu={(event) =>
                  openDimensionContextMenu(ann.dimensionId, event)
                }
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const dim = activeSketch.dimensions.find(
                    (d) => d.id === ann.dimensionId,
                  );
                  if (!dim) return;
                  draggingDimRef.current = {
                    dimensionId: ann.dimensionId,
                    startScreenX: event.clientX,
                    startScreenY: event.clientY,
                    startPosition: { ...dim.position },
                    moved: false,
                    sketchPlane: null,
                    canvasRect: null,
                    startSketchPos: null,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const drag = draggingDimRef.current;
                  if (!drag) return;
                  const ddx = event.clientX - drag.startScreenX;
                  const ddy = event.clientY - drag.startScreenY;
                  if (!drag.moved && Math.hypot(ddx, ddy) < 3) return;
                  if (!drag.moved) {
                    useCADStore.getState().pushUndo?.();
                    drag.moved = true;
                    // Cache plane, rect, and start sketch position once per drag
                    const sketch = useCADStore.getState().activeSketch;
                    if (sketch) {
                      const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
                      const origin = (sketch.planeOrigin ??
                        new THREE.Vector3(0, 0, 0)) as THREE.Vector3;
                      drag.sketchPlane =
                        new THREE.Plane().setFromNormalAndCoplanarPoint(
                          t1.clone().cross(t2).normalize(),
                          origin,
                        );
                      drag.canvasRect = gl.domElement.getBoundingClientRect();
                      drag.startSketchPos = toSketchCoord(
                        drag.startScreenX,
                        drag.startScreenY,
                        drag.canvasRect,
                        drag.sketchPlane,
                        t1,
                        t2,
                        origin,
                      );
                    }
                  }
                  // Only store the latest position — useFrame consumes it once per render tick
                  pendingMousePos.current = {
                    x: event.clientX,
                    y: event.clientY,
                  };
                }}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  const wasDragging = draggingDimRef.current?.moved ?? false;
                  draggingDimRef.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  if (wasDragging) return;
                  // Single click without drag — no action (edit requires double-click)
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  draggingDimRef.current = null;
                  const dim = activeSketch.dimensions.find(
                    (d) => d.id === ann.dimensionId,
                  );
                  openSketchDimEdit(
                    ann.dimensionId,
                    dim
                      ? String(dim.value)
                      : ann.label.replace(/[^0-9.+-]/g, ""),
                    false,
                  );
                }}
              >
                {ann.label}
              </div>
            </Html>
          )}
        </group>
      ))}
    </group>
  );
}
