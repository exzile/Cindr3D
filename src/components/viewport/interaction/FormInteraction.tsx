/**
 * FormInteraction — handles all Form workspace tool interactions:
 *   D140-D147: Place T-Spline primitives
 *   D152: Edit Form — click to select nearest cage vertex, drag to move
 *   D153-D166: MODIFY stubs (Insert Edge, Subdivide, Bridge, …)
 *   D167: Delete (remove selected face / edge / vertex from the cage)
 *
 * Rendered inside the R3F Canvas when activeTool is a 'form-*' tool.
 *
 * Performance rules followed:
 *   - All per-call THREE objects are stable scratch refs (no per-frame allocation)
 *   - Scene mesh lookup is cached in a ref updated only when formBodies changes
 *   - useCADStore.getState() used inside event handlers (not reactive subscriptions)
 */
import { useEffect, useCallback, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import type { FormElementType } from '../../../types/cad';
import { handleFormCanvasClick as handleFormCanvasClickHelper } from './formInteraction/handleFormCanvasClick';
import { useFormPickerTools } from './formInteraction/hooks/useFormPickerTools';

// ─── Module-level scratch objects (never allocated per-call) ──────────────────
/** Scratch Vector3 used only inside nearestCageVertex. */
const _vScratch = new THREE.Vector3();

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Write NDC coordinates for a pointer event into `out`.
 * Avoids allocating a new Vector2 per call.
 */
function writeNDC(
  e: MouseEvent,
  canvas: HTMLCanvasElement,
  out: THREE.Vector2,
): void {
  const rect = canvas.getBoundingClientRect();
  out.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
}

/**
 * Find the cage vertex closest to `worldPoint`.
 * Uses the module-level `_vScratch` — must not be called concurrently.
 */
function nearestCageVertex(
  body: ReturnType<typeof useCADStore.getState>['formBodies'][number],
  worldPoint: THREE.Vector3,
): { id: string; position: [number, number, number] } | null {
  let best: { id: string; position: [number, number, number] } | null = null;
  let bestDist = Infinity;
  for (const v of body.vertices) {
    const d = _vScratch.set(...v.position).distanceToSquared(worldPoint);
    if (d < bestDist) { bestDist = d; best = v; }
  }
  return best;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FormInteraction() {
  const { gl, camera } = useThree();

  // ── Stable scratch refs — allocated once per component lifetime ────────────
  const raycaster   = useRef(new THREE.Raycaster());
  const _ndc        = useRef(new THREE.Vector2());
  const _rayTarget  = useRef(new THREE.Vector3());
  const _camDir     = useRef(new THREE.Vector3());
  const _dragPlane  = useRef(new THREE.Plane());
  const _hitPoint   = useRef(new THREE.Vector3());

  /** Cached list of pickable form meshes; rebuilt when formBodies changes. */
  const formMeshesRef = useRef<THREE.Object3D[]>([]);

  const activeTool               = useCADStore((s) => s.activeTool);
  const formBodies               = useCADStore((s) => s.formBodies);
  const activeFormBodyId         = useCADStore((s) => s.activeFormBodyId);
  const formSelection            = useCADStore((s) => s.formSelection);
  const setActiveFormBody        = useCADStore((s) => s.setActiveFormBody);
  const setFormSelection         = useCADStore((s) => s.setFormSelection);
  const deleteFormElements       = useCADStore((s) => s.deleteFormElements);
  const updateFormVertices       = useCADStore((s) => s.updateFormVertices);
  const setStatusMessage         = useCADStore((s) => s.setStatusMessage);
  const addFormBody              = useCADStore((s) => s.addFormBody);
  const removeFormBody           = useCADStore((s) => s.removeFormBody);
  const setFormBodySubdivisionLevel = useCADStore((s) => s.setFormBodySubdivisionLevel);
  const setFormBodyCrease        = useCADStore((s) => s.setFormBodyCrease);
  const toggleFrozenFormVertex   = useCADStore((s) => s.toggleFrozenFormVertex);

  /** Drag state — ref avoids stale closures and needless re-renders. */
  const dragRef = useRef<{
    active: boolean;
    bodyId: string;
    vertexId: string;
  } | null>(null);
  /** Set to true on first pointermove after pointerdown; used to suppress click. */
  const didDragRef = useRef(false);

  // ── FM3/FM5/FM7 multi-pick accumulator refs ────────────────────────────────
  /** FM3 Bridge: first edge loop vertex IDs (null = waiting for first pick) */
  const bridgeLoop1Ref = useRef<string[] | null>(null);
  /** FM5 Weld: accumulated vertex IDs (cleared on third click or merge) */
  const weldSelRef = useRef<string[]>([]);
  /** FM7 Flatten: accumulated vertex IDs */
  const flattenSelRef = useRef<string[]>([]);

  // Auto-activate the first body when entering the Form workspace
  useEffect(() => {
    if (!activeFormBodyId && formBodies.length > 0) {
      setActiveFormBody(formBodies[0].id);
    }
  }, [activeFormBodyId, formBodies, setActiveFormBody]);

  // Rebuild the pickable mesh cache whenever formBodies changes
  useEffect(() => {
    // FormBodies renders with userData.formBodyId set on each smooth mesh
    const meshes: THREE.Object3D[] = [];
    void gl; // ensure gl is a stable dep for this effect
    // We traverse the THREE scene directly via the renderer; it's fine here
    // because this effect only runs when formBodies array reference changes
    // The safe cross-platform approach: rebuild from scene on next pick call.
    // Mark the cache as dirty here by clearing it; it gets repopulated lazily.
    void gl;
    formMeshesRef.current = meshes;
  }, [formBodies, gl]);

  // Status message on tool activation
  useEffect(() => {
    if (!activeTool.startsWith('form-')) return;
    const del = activeTool === 'form-delete';
    switch (activeTool) {
      case 'form-box':          setStatusMessage('Form Box: click to place a T-Spline box'); break;
      case 'form-plane':        setStatusMessage('Form Plane: click to place a flat T-Spline plane'); break;
      case 'form-cylinder':     setStatusMessage('Form Cylinder: click to place a T-Spline cylinder'); break;
      case 'form-sphere':       setStatusMessage('Form Sphere: click to place a T-Spline sphere'); break;
      case 'form-torus':        setStatusMessage('Form Torus: click to place a T-Spline torus'); break;
      case 'form-quadball':     setStatusMessage('Form Quadball: click to place a T-Spline quadball'); break;
      case 'form-pipe':         setStatusMessage('Form Pipe: click to sweep a tube along the first available path sketch'); break;
      case 'form-face':         setStatusMessage('Form Face: click to place a single T-Spline face'); break;
      case 'form-extrude':      setStatusMessage('Form Extrude: select edges to extrude — coming soon'); break;
      case 'form-revolve':      setStatusMessage('Form Revolve: select edges to revolve — coming soon'); break;
      case 'form-sweep':        setStatusMessage('Form Sweep: select edges to sweep — coming soon'); break;
      case 'form-loft':         setStatusMessage('Form Loft: select profile edges to loft — coming soon'); break;
      case 'form-edit':         setStatusMessage('Edit Form: click a vertex to select; drag to move'); break;
      case 'form-delete':
        setStatusMessage(
          formSelection
            ? `Delete: press Delete/Backspace to remove ${formSelection.ids.length} ${formSelection.type}(s)`
            : 'Delete: click a vertex or face, then press Delete',
        );
        break;
      case 'form-insert-edge':  setStatusMessage('Insert Edge: click a face to split into two quads'); break;
      case 'form-insert-point': setStatusMessage('Insert Point: click an edge to insert a midpoint vertex'); break;
      case 'form-subdivide':    setStatusMessage('Subdivide: click anywhere to increase subdivision level (1–5) on the active body'); break;
      case 'form-bridge':       setStatusMessage('Bridge: click first boundary edge, then second to connect loops'); break;
      case 'form-fill-hole':    setStatusMessage('Fill Hole: click any boundary edge to cap the open hole'); break;
      case 'form-weld':         setStatusMessage('Weld: click vertices to select (2+), then click again to merge'); break;
      case 'form-unweld':       setStatusMessage('Unweld: click a vertex to split it into per-face copies'); break;
      case 'form-crease':       setStatusMessage('Crease: click to mark all vertices sharp (crease=1) on the active body'); break;
      case 'form-uncrease':     setStatusMessage('Uncrease: click to clear all vertex creases (crease=0) on the active body'); break;
      case 'form-flatten':      setStatusMessage('Flatten: click vertices to select, then click again to flatten to XZ plane'); break;
      case 'form-uniform':      setStatusMessage('Make Uniform: click anywhere to apply 3 Laplacian smoothing iterations'); break;
      case 'form-pull':         setStatusMessage('Pull: click anywhere to pull cage vertices toward the Catmull-Clark limit surface'); break;
      case 'form-interpolate':  setStatusMessage('Interpolate: click anywhere to snap cage vertices to nearest original positions'); break;
      case 'form-thicken':      setStatusMessage('Thicken Form: click anywhere to add a 2-unit thickness shell to the cage'); break;
      case 'form-freeze':       setStatusMessage('Freeze: click a vertex to lock/unlock it — frozen vertices cannot be dragged'); break;
      default: break;
    }
    void del; // used only for form-delete case above
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, setStatusMessage]);
  // formSelection read only in form-delete; use getState() there to avoid over-running
  useFormPickerTools({
    activeTool,
    bridgeLoop1Ref,
    weldSelectionRef: weldSelRef,
    flattenSelectionRef: flattenSelRef,
    formMeshesRef,
    setStatusMessage,
    addFormBody,
    removeFormBody,
  });

  // D167: keyboard Delete handler
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (activeTool !== 'form-delete') return;
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const sel = useCADStore.getState().formSelection;
    if (!sel || sel.ids.length === 0) {
      setStatusMessage('Delete: nothing selected');
      return;
    }
    deleteFormElements(sel.type as FormElementType, sel.ids);
    setStatusMessage(`Deleted ${sel.ids.length} ${sel.type}(s)`);
  }, [activeTool, deleteFormElements, setStatusMessage]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Raycast helper — uses cached mesh list; falls back to scene walk ────────
  const pickNearestVertex = useCallback((e: MouseEvent) => {
    writeNDC(e, gl.domElement, _ndc.current);
    raycaster.current.setFromCamera(_ndc.current, camera);

    // If mesh cache is empty, rebuild from scene (happens after formBodies change)
    if (formMeshesRef.current.length === 0) {
      const meshes: THREE.Object3D[] = [];
      // Access R3F scene via the renderer's internal scene reference
      // Safe: called only in user event handlers, not in useFrame
      const r3fRoot = (gl as unknown as { __r3f?: { fiber?: { root?: { current?: THREE.Scene } } } }).__r3f;
      const sceneObj = r3fRoot?.fiber?.root?.current;
      if (sceneObj) {
        sceneObj.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && o.userData.formBodyId) meshes.push(o);
        });
      }
      formMeshesRef.current = meshes;
    }

    const hits = raycaster.current.intersectObjects(formMeshesRef.current, false);
    if (hits.length === 0) return null;

    const hit = hits[0];
    _hitPoint.current.copy(hit.point);
    const bodyId = hit.object.userData.formBodyId as string;
    const body = useCADStore.getState().formBodies.find((b) => b.id === bodyId);
    if (!body) return null;
    const vertex = nearestCageVertex(body, _hitPoint.current);
    if (!vertex) return null;
    return { bodyId, vertex };
  }, [gl, camera]);

  // ── D152: pointerdown — start drag ─────────────────────────────────────────
  const handlePointerDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0 || activeTool !== 'form-edit') return;
    didDragRef.current = false;
    const result = pickNearestVertex(e);
    if (!result) return;
    const { bodyId, vertex } = result;

    // D166: frozen vertex — block dragging
    if (useCADStore.getState().frozenFormVertices.includes(vertex.id)) {
      setActiveFormBody(bodyId);
      setFormSelection({ bodyId, type: 'vertex', ids: [vertex.id] });
      setStatusMessage('Vertex is frozen — use Freeze tool to unlock it');
      return;
    }

    // Build drag plane: camera-facing, through the picked vertex position
    camera.getWorldDirection(_camDir.current);
    _vScratch.set(...vertex.position);
    _dragPlane.current.setFromNormalAndCoplanarPoint(_camDir.current, _vScratch);

    dragRef.current = { active: true, bodyId, vertexId: vertex.id };
    setActiveFormBody(bodyId);
    setFormSelection({ bodyId, type: 'vertex', ids: [vertex.id] });
    setStatusMessage('Vertex selected — drag to move');
  }, [activeTool, pickNearestVertex, camera, setActiveFormBody, setFormSelection, setStatusMessage]);

  // ── D152: pointermove — live vertex drag (no per-frame allocation) ──────────
  const handlePointerMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag?.active) return;
    didDragRef.current = true;
    writeNDC(e, gl.domElement, _ndc.current);
    raycaster.current.setFromCamera(_ndc.current, camera);
    const hit = raycaster.current.ray.intersectPlane(_dragPlane.current, _rayTarget.current);
    if (!hit) return;
    updateFormVertices(drag.bodyId, [{
      id: drag.vertexId,
      position: [_rayTarget.current.x, _rayTarget.current.y, _rayTarget.current.z],
    }]);
    // Invalidate mesh cache since the cage changed
    formMeshesRef.current = [];
  }, [gl, camera, updateFormVertices]);

  // ── D152: pointerup — end drag ──────────────────────────────────────────────
  const handlePointerUp = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    if (dragRef.current?.active) {
      dragRef.current.active = false;
      if (didDragRef.current) {
        setStatusMessage('Vertex moved — click another vertex or drag again');
      }
    }
  }, [setStatusMessage]);

  // ── Click handler: place primitives + select for non-drag tools ─────────────
  const handleCanvasClick = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    if (didDragRef.current) { didDragRef.current = false; return; }

    handleFormCanvasClickHelper(e, {
      activeTool,
      addFormBody,
      removeFormBody,
      setActiveFormBody,
      setFormSelection,
      setStatusMessage,
      setFormBodySubdivisionLevel,
      setFormBodyCrease,
      toggleFrozenFormVertex,
      formMeshesRef,
      pickNearestVertex,
    });
  }, [activeTool, addFormBody, removeFormBody, pickNearestVertex, setActiveFormBody,
      setFormSelection, setStatusMessage, setFormBodySubdivisionLevel, setFormBodyCrease,
      toggleFrozenFormVertex]);

  // Register all canvas event listeners
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('click', handleCanvasClick);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('click', handleCanvasClick);
    };
  }, [gl, handlePointerDown, handlePointerMove, handlePointerUp, handleCanvasClick]);

  // FormInteraction renders no 3D geometry — FormBodies is the sibling renderer
  return null;
}
