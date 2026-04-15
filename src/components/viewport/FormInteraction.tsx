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
import { useCADStore } from '../../store/cadStore';
import { SubdivisionEngine } from '../../engine/SubdivisionEngine';
import type { FormElementType } from '../../types/cad';

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
    gl.domElement.dispatchEvent; // no-op: just ensure gl is stable
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
      case 'form-pipe':         setStatusMessage('Form Pipe: select a path — coming soon'); break;
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
      case 'form-insert-edge':  setStatusMessage('Insert Edge: click a face to split — requires face-picker (blocked)'); break;
      case 'form-insert-point': setStatusMessage('Insert Point: click an edge to subdivide — requires edge-picker (blocked)'); break;
      case 'form-subdivide':    setStatusMessage('Subdivide: click anywhere to increase subdivision level (1–5) on the active body'); break;
      case 'form-bridge':       setStatusMessage('Bridge: select two open boundary edge loops — requires edge-loop picker (blocked)'); break;
      case 'form-fill-hole':    setStatusMessage('Fill Hole: click an open boundary edge to cap — requires boundary-edge picker (blocked)'); break;
      case 'form-weld':         setStatusMessage('Weld: select coincident vertices to merge — requires multi-vertex picker (blocked)'); break;
      case 'form-unweld':       setStatusMessage('Unweld: click a vertex to split into separate copies — requires vertex-picker (blocked)'); break;
      case 'form-crease':       setStatusMessage('Crease: click to mark all vertices sharp (crease=1) on the active body'); break;
      case 'form-uncrease':     setStatusMessage('Uncrease: click to clear all vertex creases (crease=0) on the active body'); break;
      case 'form-flatten':      setStatusMessage('Flatten: project selected vertices to a plane — requires plane-projection solver (blocked)'); break;
      case 'form-uniform':      setStatusMessage('Make Uniform: equalize edge lengths across the cage — requires length-equalizer (blocked)'); break;
      case 'form-pull':         setStatusMessage('Pull: drag cage vertices toward the limit surface — requires limit-surface solver (blocked)'); break;
      case 'form-interpolate':  setStatusMessage('Interpolate: fit cage to through-points — requires interpolation solver (blocked)'); break;
      case 'form-thicken':      setStatusMessage('Thicken Form: offset cage to create solid shell — requires offset-cage engine (blocked)'); break;
      case 'form-freeze':       setStatusMessage('Freeze: click a vertex to lock/unlock it — frozen vertices cannot be dragged'); break;
      default: break;
    }
    void del; // used only for form-delete case above
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, setStatusMessage]);
  // formSelection read only in form-delete; use getState() there to avoid over-running

  // ── D167: keyboard Delete handler ──────────────────────────────────────────
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
    // Swallow the click that ends a drag
    if (didDragRef.current) { didDragRef.current = false; return; }

    const prefix = `${activeTool.replace('form-', '')}${Date.now()}-`;

    switch (activeTool) {
      case 'form-box': {
        const d = SubdivisionEngine.createBoxCageData(20, 20, 20, prefix);
        addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Box', ...d, subdivisionLevel: 2, visible: true });
        setStatusMessage('T-Spline Box created — switch to Edit Form to reshape it');
        formMeshesRef.current = [];
        break;
      }
      case 'form-plane': {
        const d = SubdivisionEngine.createPlaneCageData(20, 20, prefix);
        addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Plane', ...d, subdivisionLevel: 2, visible: true });
        setStatusMessage('T-Spline Plane created');
        formMeshesRef.current = [];
        break;
      }
      case 'form-cylinder': {
        const d = SubdivisionEngine.createCylinderCageData(10, 20, 4, prefix);
        addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Cylinder', ...d, subdivisionLevel: 2, visible: true });
        setStatusMessage('T-Spline Cylinder created');
        formMeshesRef.current = [];
        break;
      }
      case 'form-sphere': {
        const d = SubdivisionEngine.createSphereCageData(10, prefix);
        addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Sphere', ...d, subdivisionLevel: 3, visible: true });
        setStatusMessage('T-Spline Sphere created');
        formMeshesRef.current = [];
        break;
      }
      case 'form-torus': {
        const d = SubdivisionEngine.createTorusCageData(15, 3, 4, 4, prefix);
        addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Torus', ...d, subdivisionLevel: 2, visible: true });
        setStatusMessage('T-Spline Torus created');
        formMeshesRef.current = [];
        break;
      }
      case 'form-quadball': {
        const d = SubdivisionEngine.createQuadballCageData(10, prefix);
        addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Quadball', ...d, subdivisionLevel: 3, visible: true });
        setStatusMessage('T-Spline Quadball created');
        formMeshesRef.current = [];
        break;
      }
      case 'form-face': {
        const d = SubdivisionEngine.createFaceCageData(10, prefix);
        addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Face', ...d, subdivisionLevel: 2, visible: true });
        setStatusMessage('T-Spline Face created');
        formMeshesRef.current = [];
        break;
      }
      case 'form-edit': {
        const result = pickNearestVertex(e);
        if (result) {
          setActiveFormBody(result.bodyId);
          setFormSelection({ bodyId: result.bodyId, type: 'vertex', ids: [result.vertex.id] });
          setStatusMessage('Vertex selected — drag to move');
        } else {
          setFormSelection(null);
          setStatusMessage('Edit Form: click a vertex to select; drag to move');
        }
        break;
      }
      case 'form-delete': {
        const result = pickNearestVertex(e);
        if (result) {
          setActiveFormBody(result.bodyId);
          setFormSelection({ bodyId: result.bodyId, type: 'vertex', ids: [result.vertex.id] });
          setStatusMessage('Vertex selected — press Delete to remove');
        }
        break;
      }
      case 'form-subdivide': {
        // D155: increment subdivision level of the active form body.
        // FormBodies renderer caps subdivision at 3 for performance — match here.
        const bodyId = useCADStore.getState().activeFormBodyId;
        if (!bodyId) {
          setStatusMessage('Subdivide: no active form body — place a primitive first');
          break;
        }
        const body = useCADStore.getState().formBodies.find((b) => b.id === bodyId);
        if (!body) break;
        const newLevel = Math.min(3, (body.subdivisionLevel ?? 1) + 1);
        setFormBodySubdivisionLevel(bodyId, newLevel);
        formMeshesRef.current = [];
        setStatusMessage(`Subdivision level set to ${newLevel}${newLevel === 3 ? ' (maximum)' : ''}`);
        break;
      }
      case 'form-crease': {
        // D160: mark all vertices of the active body as creased (crease=1)
        const bodyId = useCADStore.getState().activeFormBodyId;
        if (!bodyId) {
          setStatusMessage('Crease: no active form body');
          break;
        }
        setFormBodyCrease(bodyId, 1);
        setStatusMessage('Creased: all vertices marked sharp (crease=1)');
        break;
      }
      case 'form-uncrease': {
        // D160: clear crease on all vertices of the active body
        const bodyId = useCADStore.getState().activeFormBodyId;
        if (!bodyId) {
          setStatusMessage('Uncrease: no active form body');
          break;
        }
        setFormBodyCrease(bodyId, 0);
        setStatusMessage('Uncreased: all vertex creases cleared (crease=0)');
        break;
      }
      case 'form-freeze': {
        // D166: toggle freeze on the nearest vertex
        const result = pickNearestVertex(e);
        if (!result) {
          setStatusMessage('Freeze: click a vertex to lock/unlock it');
          break;
        }
        const { bodyId, vertex } = result;
        setActiveFormBody(bodyId);
        toggleFrozenFormVertex(vertex.id);
        // After toggle: if it's now in the set → frozen; if absent → unfrozen
        const nowFrozen = useCADStore.getState().frozenFormVertices.includes(vertex.id);
        setStatusMessage(nowFrozen ? `Vertex frozen — drag is blocked` : `Vertex unfrozen — drag restored`);
        break;
      }
      default: break;
    }
  }, [activeTool, addFormBody, pickNearestVertex, setActiveFormBody, setFormSelection, setStatusMessage,
      setFormBodySubdivisionLevel, setFormBodyCrease, toggleFrozenFormVertex]);

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
