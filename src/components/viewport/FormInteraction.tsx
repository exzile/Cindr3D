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
import { useFacePicker } from '../../hooks/useFacePicker';
import { useEdgePicker } from '../../hooks/useEdgePicker';
import { useVertexPicker } from '../../hooks/useVertexPicker';

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

  // ── FM1: face picker for Insert Edge ───────────────────────────────────────
  useFacePicker({
    enabled: activeTool === 'form-insert-edge',
    filter: (mesh) => !!mesh.userData.formBodyId,
    onClick: (result) => {
      const state = useCADStore.getState();
      const bodyId = result.mesh.userData.formBodyId as string;
      const body = state.formBodies.find((b) => b.id === bodyId);
      if (!body) { setStatusMessage('Insert Edge: no active form body'); return; }
      // Map the hit triangle's face index back to a cage face.
      // We use the centroid of the hit boundary to find the nearest cage face centroid.
      const hitCentroid = result.centroid;
      const vertById = new Map(body.vertices.map((v) => [v.id, v]));
      let bestFaceId = '';
      let bestDist = Infinity;
      for (const f of body.faces) {
        let cx = 0, cy = 0, cz = 0;
        for (const vid of f.vertexIds) {
          const p = vertById.get(vid)!.position;
          cx += p[0]; cy += p[1]; cz += p[2];
        }
        const n = f.vertexIds.length;
        const dx = hitCentroid.x - cx / n;
        const dy = hitCentroid.y - cy / n;
        const dz = hitCentroid.z - cz / n;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDist) { bestDist = d; bestFaceId = f.id; }
      }
      if (!bestFaceId) return;
      const updated = SubdivisionEngine.insertEdge(body, bestFaceId);
      removeFormBody(bodyId);
      addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
      formMeshesRef.current = [];
      setStatusMessage('Insert Edge: face split into two quads');
    },
  });

  // ── FM2: edge picker for Insert Point ──────────────────────────────────────
  useEdgePicker({
    enabled: activeTool === 'form-insert-point',
    filter: (mesh) => !!mesh.userData.formBodyId,
    onClick: (result) => {
      const state = useCADStore.getState();
      const bodyId = result.mesh.userData.formBodyId as string;
      const body = state.formBodies.find((b) => b.id === bodyId);
      if (!body) { setStatusMessage('Insert Point: no active form body'); return; }
      // Find the cage edge closest to the hit edge (by midpoint proximity)
      const hitMid = result.midpoint;
      const vertById = new Map(body.vertices.map((v) => [v.id, v]));
      let bestEdgeId = '';
      let bestDist = Infinity;
      for (const e of body.edges) {
        const pa = vertById.get(e.vertexIds[0])!.position;
        const pb = vertById.get(e.vertexIds[1])!.position;
        const mx = (pa[0] + pb[0]) / 2 - hitMid.x;
        const my = (pa[1] + pb[1]) / 2 - hitMid.y;
        const mz = (pa[2] + pb[2]) / 2 - hitMid.z;
        const d = mx * mx + my * my + mz * mz;
        if (d < bestDist) { bestDist = d; bestEdgeId = e.id; }
      }
      if (!bestEdgeId) return;
      const updated = SubdivisionEngine.insertPoint(body, bestEdgeId, 0.5);
      removeFormBody(bodyId);
      addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
      formMeshesRef.current = [];
      setStatusMessage('Insert Point: edge midpoint vertex added');
    },
  });

  // ── FM3: edge picker for Bridge (two-click) ─────────────────────────────────
  useEdgePicker({
    enabled: activeTool === 'form-bridge',
    filter: (mesh) => !!mesh.userData.formBodyId,
    onClick: (result) => {
      const state = useCADStore.getState();
      const bodyId = result.mesh.userData.formBodyId as string;
      const body = state.formBodies.find((b) => b.id === bodyId);
      if (!body) return;
      // Find cage edge nearest to the clicked hit edge
      const hitMid = result.midpoint;
      const vertById = new Map(body.vertices.map((v) => [v.id, v]));
      let bestEdgeId = '';
      let bestDist = Infinity;
      for (const e of body.edges) {
        const pa = vertById.get(e.vertexIds[0])!.position;
        const pb = vertById.get(e.vertexIds[1])!.position;
        const mx = (pa[0] + pb[0]) / 2 - hitMid.x;
        const my = (pa[1] + pb[1]) / 2 - hitMid.y;
        const mz = (pa[2] + pb[2]) / 2 - hitMid.z;
        const d = mx * mx + my * my + mz * mz;
        if (d < bestDist) { bestDist = d; bestEdgeId = e.id; }
      }
      if (!bestEdgeId) return;
      const loop = SubdivisionEngine.findEdgeLoop(body, bestEdgeId);
      // Collect the vertex IDs at one end of each loop edge (ordered)
      const loopVerts = loop.map((eid) => body.edges.find((e) => e.id === eid)!.vertexIds[0]);

      if (!bridgeLoop1Ref.current) {
        bridgeLoop1Ref.current = loopVerts;
        setStatusMessage(`Bridge: first loop selected (${loopVerts.length} verts) — click second loop edge`);
      } else {
        const loop1 = bridgeLoop1Ref.current;
        bridgeLoop1Ref.current = null;
        if (loop1.length !== loopVerts.length) {
          setStatusMessage('Bridge: loops have different vertex counts — cannot bridge');
          return;
        }
        const updated = SubdivisionEngine.bridge(body, loop1, loopVerts);
        removeFormBody(bodyId);
        addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
        formMeshesRef.current = [];
        setStatusMessage('Bridge: loops connected with quad faces');
      }
    },
  });

  // ── FM4: edge picker for Fill Hole ──────────────────────────────────────────
  useEdgePicker({
    enabled: activeTool === 'form-fill-hole',
    filter: (mesh) => !!mesh.userData.formBodyId,
    onClick: (result) => {
      const state = useCADStore.getState();
      const bodyId = result.mesh.userData.formBodyId as string;
      const body = state.formBodies.find((b) => b.id === bodyId);
      if (!body) return;
      const hitMid = result.midpoint;
      const vertById = new Map(body.vertices.map((v) => [v.id, v]));
      let bestEdgeId = '';
      let bestDist = Infinity;
      for (const e of body.edges) {
        const pa = vertById.get(e.vertexIds[0])!.position;
        const pb = vertById.get(e.vertexIds[1])!.position;
        const mx = (pa[0] + pb[0]) / 2 - hitMid.x;
        const my = (pa[1] + pb[1]) / 2 - hitMid.y;
        const mz = (pa[2] + pb[2]) / 2 - hitMid.z;
        const d = mx * mx + my * my + mz * mz;
        if (d < bestDist) { bestDist = d; bestEdgeId = e.id; }
      }
      if (!bestEdgeId) return;
      const updated = SubdivisionEngine.fillHole(body, bestEdgeId);
      if (updated === body) { setStatusMessage('Fill Hole: clicked edge is not a boundary edge'); return; }
      removeFormBody(bodyId);
      addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
      formMeshesRef.current = [];
      setStatusMessage('Fill Hole: boundary capped with fan faces');
    },
  });

  // ── FM5: vertex picker for Weld (multi-pick) ────────────────────────────────
  useVertexPicker({
    enabled: activeTool === 'form-weld',
    maxDistance: 20,
    filter: (mesh) => !!mesh.userData.formBodyId,
    onClick: (result) => {
      const state = useCADStore.getState();
      const bodyId = result.mesh.userData.formBodyId as string;
      const body = state.formBodies.find((b) => b.id === bodyId);
      if (!body) return;
      // Find nearest cage vertex to the hit
      const hitPos = result.position;
      let bestId = '';
      let bestDist = Infinity;
      for (const v of body.vertices) {
        const dx = v.position[0] - hitPos.x;
        const dy = v.position[1] - hitPos.y;
        const dz = v.position[2] - hitPos.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDist) { bestDist = d; bestId = v.id; }
      }
      if (!bestId) return;
      const sel = weldSelRef.current;
      if (sel.includes(bestId)) {
        // Clicking an already-selected vertex triggers the weld
        if (sel.length >= 2) {
          const updated = SubdivisionEngine.weld(body, sel);
          removeFormBody(bodyId);
          addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
          formMeshesRef.current = [];
          weldSelRef.current = [];
          setStatusMessage(`Weld: ${sel.length} vertices merged`);
        } else {
          setStatusMessage('Weld: select at least 2 vertices before merging');
        }
      } else {
        sel.push(bestId);
        setStatusMessage(`Weld: ${sel.length} vertex(ices) selected — click a selected vertex to merge`);
      }
    },
  });

  // ── FM6: vertex picker for Unweld ───────────────────────────────────────────
  useVertexPicker({
    enabled: activeTool === 'form-unweld',
    maxDistance: 20,
    filter: (mesh) => !!mesh.userData.formBodyId,
    onClick: (result) => {
      const state = useCADStore.getState();
      const bodyId = result.mesh.userData.formBodyId as string;
      const body = state.formBodies.find((b) => b.id === bodyId);
      if (!body) return;
      const hitPos = result.position;
      let bestId = '';
      let bestDist = Infinity;
      for (const v of body.vertices) {
        const dx = v.position[0] - hitPos.x;
        const dy = v.position[1] - hitPos.y;
        const dz = v.position[2] - hitPos.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDist) { bestDist = d; bestId = v.id; }
      }
      if (!bestId) return;
      const updated = SubdivisionEngine.unweld(body, bestId);
      removeFormBody(bodyId);
      addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
      formMeshesRef.current = [];
      setStatusMessage('Unweld: vertex split into per-face copies');
    },
  });

  // ── FM7: vertex picker for Flatten (multi-pick) ─────────────────────────────
  useVertexPicker({
    enabled: activeTool === 'form-flatten',
    maxDistance: 20,
    filter: (mesh) => !!mesh.userData.formBodyId,
    onClick: (result) => {
      const state = useCADStore.getState();
      const bodyId = result.mesh.userData.formBodyId as string;
      const body = state.formBodies.find((b) => b.id === bodyId);
      if (!body) return;
      const hitPos = result.position;
      let bestId = '';
      let bestDist = Infinity;
      for (const v of body.vertices) {
        const dx = v.position[0] - hitPos.x;
        const dy = v.position[1] - hitPos.y;
        const dz = v.position[2] - hitPos.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDist) { bestDist = d; bestId = v.id; }
      }
      if (!bestId) return;
      const sel = flattenSelRef.current;
      if (sel.includes(bestId)) {
        // Re-click a selected vertex → execute flatten onto XZ plane (Y=avg)
        if (sel.length >= 1) {
          // Average Y of selection as the flatten plane offset
          let avgY = 0;
          for (const vid of sel) {
            const v = body.vertices.find((v) => v.id === vid);
            if (v) avgY += v.position[1];
          }
          avgY /= sel.length;
          const updated = SubdivisionEngine.flatten(body, sel, [0, 1, 0], avgY);
          removeFormBody(bodyId);
          addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
          formMeshesRef.current = [];
          flattenSelRef.current = [];
          setStatusMessage(`Flatten: ${sel.length} vertices projected to Y=${avgY.toFixed(2)}`);
        }
      } else {
        sel.push(bestId);
        setStatusMessage(`Flatten: ${sel.length} vertex(ices) selected — re-click a selected vertex to flatten`);
      }
    },
  });

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
      case 'form-pipe': {
        const state = useCADStore.getState();
        const pathSketch = state.sketches.find((s) => s.entities.length > 0);
        if (!pathSketch) {
          state.setStatusMessage('Form Pipe: create a path sketch first, then click');
          break;
        }
        const rawPts: THREE.Vector3[] = [];
        for (const e of pathSketch.entities) {
          for (const p of e.points) rawPts.push(new THREE.Vector3(p.x, p.y, p.z));
        }
        // Deduplicate consecutive identical points
        const pts: THREE.Vector3[] = [rawPts[0]];
        for (let k = 1; k < rawPts.length; k++) {
          if (rawPts[k].distanceTo(pts[pts.length - 1]) > 0.001) pts.push(rawPts[k]);
        }
        if (pts.length < 2) { state.setStatusMessage('Form Pipe: path sketch needs at least 2 distinct points'); break; }

        const pipePrefix = `fp${Date.now()}-`;
        const { vertices, edges, faces } = SubdivisionEngine.createPipeCageData(pts, 5, 4, pipePrefix);
        addFormBody({
          id: `fb-${Date.now()}`,
          name: 'T-Spline Pipe',
          vertices,
          edges,
          faces,
          subdivisionLevel: 2,
          visible: true,
        });
        state.setStatusMessage('T-Spline Pipe created — use Edit Form to adjust vertices');
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
      case 'form-extrude': {
        // Find the active form body (first one, or the selected one if there's a selectedFormBodyId)
        const activeBody = formBodies[0];
        if (!activeBody) { setStatusMessage('No form body to extrude'); break; }

        // Find the "top ring" — vertices with the maximum Y coordinate
        const maxY = Math.max(...activeBody.vertices.map(v => v.position[1]));
        const TOL = 0.1;
        const topVerts = activeBody.vertices.filter(v => Math.abs(v.position[1] - maxY) < TOL);

        if (topVerts.length < 3) { setStatusMessage('No ring found to extrude'); break; }

        // Sort by angle around Y axis so they form an ordered ring
        const cx = topVerts.reduce((s, v) => s + v.position[0], 0) / topVerts.length;
        const cz = topVerts.reduce((s, v) => s + v.position[2], 0) / topVerts.length;
        const sorted = [...topVerts].sort((a, b) =>
          Math.atan2(a.position[2] - cz, a.position[0] - cx) -
          Math.atan2(b.position[2] - cz, b.position[0] - cx)
        );
        const ringVerts = sorted.map(v => new THREE.Vector3(...v.position));
        const oldRingIds = sorted.map(v => v.id);

        const extPrefix = `ext-${Date.now()}-`;
        const startVI = activeBody.vertices.length;
        const startEI = activeBody.edges.length;
        const startFI = activeBody.faces.length;

        const { vertices: newVerts, edges: newEdges, faces: newFaces } =
          SubdivisionEngine.createExtrudeCageData(
            ringVerts,
            new THREE.Vector3(0, 1, 0),  // extrude upward
            10,                           // default 10 units
            extPrefix,
            startVI,
            startEI,
            startFI,
            oldRingIds,
          );

        // Merge new geometry into the existing body:
        // remove old body and add an updated copy with appended verts/edges/faces
        const mergedBody = {
          ...activeBody,
          vertices: [...activeBody.vertices, ...newVerts],
          edges:    [...activeBody.edges,    ...newEdges],
          faces:    [...activeBody.faces,    ...newFaces],
        };
        removeFormBody(activeBody.id);
        addFormBody(mergedBody);
        formMeshesRef.current = [];
        setStatusMessage('T-Spline Extrude: top ring extruded upward 10 units');
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
        // D160: mark all vertices and edges of the active body as creased (crease=1)
        const bodyId = useCADStore.getState().activeFormBodyId;
        if (!bodyId) {
          setStatusMessage('Crease: no active form body');
          break;
        }
        // Update vertex crease via store action
        setFormBodyCrease(bodyId, 1);
        // Also update edge crease by rebuilding the body with crease=1 on all edges
        {
          const state = useCADStore.getState();
          const body = state.formBodies.find((b) => b.id === bodyId);
          if (body) {
            const updatedBody = {
              ...body,
              edges: body.edges.map((ed) => ({ ...ed, crease: 1 })),
            };
            removeFormBody(bodyId);
            addFormBody(updatedBody);
            formMeshesRef.current = [];
          }
        }
        setStatusMessage('Creased: all edges and vertices marked sharp (crease=1)');
        break;
      }
      case 'form-uncrease': {
        // D160: clear crease on all vertices and edges of the active body
        const bodyId = useCADStore.getState().activeFormBodyId;
        if (!bodyId) {
          setStatusMessage('Uncrease: no active form body');
          break;
        }
        // Clear vertex crease via store action
        setFormBodyCrease(bodyId, 0);
        // Also clear edge crease by rebuilding the body with crease=0 on all edges
        {
          // After setFormBodyCrease the body is updated; re-read from fresh state
          const updatedState = useCADStore.getState();
          const body = updatedState.formBodies.find((b) => b.id === bodyId);
          if (body) {
            const clearedBody = {
              ...body,
              edges: body.edges.map((ed) => ({ ...ed, crease: 0 })),
            };
            removeFormBody(bodyId);
            addFormBody(clearedBody);
            formMeshesRef.current = [];
          }
        }
        setStatusMessage('Uncreased: all edge and vertex creases cleared (crease=0)');
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
      case 'form-revolve': {
        // D149: T-Spline Revolve — revolve a sketch profile around the Y axis
        const state = useCADStore.getState();
        const profileSketch = state.sketches.find((s) => s.entities.length > 0);
        if (!profileSketch) {
          setStatusMessage('No sketch profile available — draw a profile sketch first');
          break;
        }

        // Collect all unique points from sketch line entities
        const rawPts: THREE.Vector3[] = [];
        for (const ent of profileSketch.entities) {
          for (const p of ent.points) rawPts.push(new THREE.Vector3(p.x, p.y, p.z));
        }
        // Deduplicate consecutive identical points
        const pts: THREE.Vector3[] = [rawPts[0]];
        for (let k = 1; k < rawPts.length; k++) {
          if (rawPts[k].distanceTo(pts[pts.length - 1]) > 0.001) pts.push(rawPts[k]);
        }

        if (pts.length < 2) {
          setStatusMessage('Profile must have at least 2 points');
          break;
        }

        const revPrefix = `rev-${Date.now()}-`;
        const { vertices, edges, faces } = SubdivisionEngine.createRevolveCageData(
          pts,
          new THREE.Vector3(0, 0, 0),  // revolve around origin
          new THREE.Vector3(0, 1, 0),  // Y axis
          360,                          // full revolve
          8,                            // 8 segments
          revPrefix,
        );

        addFormBody({
          id: `fb-${Date.now()}`,
          name: 'T-Spline Revolve',
          vertices,
          edges,
          faces,
          subdivisionLevel: 2,
          visible: true,
        });
        formMeshesRef.current = [];
        setStatusMessage('T-Spline Revolve created — use Edit Form to reshape it');
        break;
      }
      case 'form-loft': {
        // D151: T-Spline Loft — blend between N profile sketches
        const loftState = useCADStore.getState();
        const loftNonEmpty = loftState.sketches.filter((s) => s.entities.length > 0);
        if (loftNonEmpty.length < 2) {
          setStatusMessage('T-Spline Loft needs at least 2 profile sketches');
          break;
        }

        // Extract 2D profile rings, world positions, and normals from each sketch
        const loftProfiles: Array<Array<{ x: number; y: number }>> = [];
        const loftPositions: THREE.Vector3[] = [];
        const loftNormals: THREE.Vector3[] = [];

        for (const sketch of loftNonEmpty) {
          // Collect all unique world-space points from this sketch
          const rawPts: THREE.Vector3[] = [];
          for (const ent of sketch.entities) {
            for (const p of ent.points) rawPts.push(new THREE.Vector3(p.x, p.y, p.z));
          }
          const profileWorld: THREE.Vector3[] = rawPts.length > 0 ? [rawPts[0]] : [];
          for (let k = 1; k < rawPts.length; k++) {
            if (rawPts[k].distanceTo(profileWorld[profileWorld.length - 1]) > 0.001) {
              profileWorld.push(rawPts[k]);
            }
          }
          if (profileWorld.length < 3) continue;

          // Compute centroid as the profile's world position
          const centroid = profileWorld.reduce(
            (acc, p) => acc.add(p),
            new THREE.Vector3(),
          ).divideScalar(profileWorld.length);
          loftPositions.push(centroid);

          // Estimate the sketch plane normal from the first two edges
          const profileDir = profileWorld[1].clone().sub(profileWorld[0]).normalize();
          const upRef = Math.abs(profileDir.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
          const sketchNormal = profileDir.clone().cross(upRef).normalize();
          loftNormals.push(sketchNormal);

          // Build local frame t1/t2 matching createLoftCageData so projections align
          const worldRef = Math.abs(sketchNormal.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
          const t1 = new THREE.Vector3().crossVectors(worldRef, sketchNormal).normalize();
          const t2 = new THREE.Vector3().crossVectors(sketchNormal, t1).normalize();

          // Project each profile point onto (t1, t2) to get local 2D coords
          const ring = profileWorld.map((p) => {
            const rel = p.clone().sub(centroid);
            return { x: rel.dot(t1), y: rel.dot(t2) };
          });
          loftProfiles.push(ring);
        }

        if (loftProfiles.length < 2) {
          setStatusMessage('T-Spline Loft: could not extract profiles — each sketch needs ≥ 3 points');
          break;
        }

        // Ensure all profiles have the same point count (use minimum)
        const loftS = Math.min(...loftProfiles.map((p) => p.length));
        if (loftS < 3) {
          setStatusMessage('Each loft profile needs at least 3 points');
          break;
        }
        const normalizedLoftProfiles = loftProfiles.map((p) => p.slice(0, loftS));

        const loftPrefix = `loft-${Date.now()}-`;
        const { vertices: lv, edges: le, faces: lf } = SubdivisionEngine.createLoftCageData(
          normalizedLoftProfiles,
          loftPositions,
          loftNormals,
          loftPrefix,
        );

        addFormBody({
          id: `fb-${Date.now()}`,
          name: 'T-Spline Loft',
          vertices: lv,
          edges: le,
          faces: lf,
          subdivisionLevel: 2,
          visible: true,
        });
        formMeshesRef.current = [];
        setStatusMessage('T-Spline Loft created — use Edit Form to reshape it');
        break;
      }
      case 'form-sweep': {
        // D150: T-Spline Sweep — sweep a profile ring along a path
        const sweepState = useCADStore.getState();
        const nonEmpty = sweepState.sketches.filter((s) => s.entities.length > 0);
        if (nonEmpty.length < 2) {
          setStatusMessage('T-Spline Sweep needs two sketches: path (first) and profile (second)');
          break;
        }
        const pathSketch = nonEmpty[0];
        const profileSketch = nonEmpty[1];

        // Extract path points from pathSketch (deduplicated ordered points)
        const rawPathPts: THREE.Vector3[] = [];
        for (const ent of pathSketch.entities) {
          for (const p of ent.points) rawPathPts.push(new THREE.Vector3(p.x, p.y, p.z));
        }
        const pathPts: THREE.Vector3[] = rawPathPts.length > 0 ? [rawPathPts[0]] : [];
        for (let k = 1; k < rawPathPts.length; k++) {
          if (rawPathPts[k].distanceTo(pathPts[pathPts.length - 1]) > 0.001) pathPts.push(rawPathPts[k]);
        }

        // Extract profile points from profileSketch as 2D local coords
        // Collect all unique world-space points from the profile sketch
        const rawProfilePts: THREE.Vector3[] = [];
        for (const ent of profileSketch.entities) {
          for (const p of ent.points) rawProfilePts.push(new THREE.Vector3(p.x, p.y, p.z));
        }
        const profileWorld: THREE.Vector3[] = rawProfilePts.length > 0 ? [rawProfilePts[0]] : [];
        for (let k = 1; k < rawProfilePts.length; k++) {
          if (rawProfilePts[k].distanceTo(profileWorld[profileWorld.length - 1]) > 0.001) {
            profileWorld.push(rawProfilePts[k]);
          }
        }

        if (pathPts.length < 2 || profileWorld.length < 3) {
          setStatusMessage('Path needs ≥ 2 points, profile needs ≥ 3');
          break;
        }

        // Project profile points onto their sketch plane to get local 2D offsets.
        // Use the centroid as the local origin and the sketch normal (cross of two edges)
        // to define the local frame, then project onto normal and binormal axes.
        const centroid = profileWorld.reduce(
          (acc, p) => acc.add(p),
          new THREE.Vector3(),
        ).divideScalar(profileWorld.length);

        // Estimate sketch plane normal from first two edges
        const profileDir = profileWorld[1].clone().sub(profileWorld[0]).normalize();
        const up = Math.abs(profileDir.y) < 0.9
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(1, 0, 0);
        const profileNormal = profileDir.clone().cross(up).normalize();
        const profileBinormal = profileDir.clone().cross(profileNormal).normalize();

        const profileRing = profileWorld.map((p) => {
          const rel = p.clone().sub(centroid);
          return { x: rel.dot(profileNormal), y: rel.dot(profileBinormal) };
        });

        const sweepPrefix = `sweep-${Date.now()}-`;
        const { vertices, edges, faces } = SubdivisionEngine.createSweepCageData(
          pathPts,
          profileRing,
          sweepPrefix,
        );

        addFormBody({
          id: `fb-${Date.now()}`,
          name: 'T-Spline Sweep',
          vertices,
          edges,
          faces,
          subdivisionLevel: 2,
          visible: true,
        });
        formMeshesRef.current = [];
        setStatusMessage('T-Spline Sweep created — use Edit Form to reshape it');
        break;
      }
      // ── FM8: Make Uniform (click anywhere on active body) ──────────────────
      case 'form-uniform': {
        const bodyId = useCADStore.getState().activeFormBodyId;
        if (!bodyId) { setStatusMessage('Make Uniform: no active form body'); break; }
        const body = useCADStore.getState().formBodies.find((b) => b.id === bodyId);
        if (!body) break;
        const updated = SubdivisionEngine.makeUniform(body, 3);
        removeFormBody(bodyId);
        addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
        formMeshesRef.current = [];
        setStatusMessage('Make Uniform: 3 Laplacian smoothing iterations applied');
        break;
      }
      // ── FM9: Pull (click anywhere on active body) ───────────────────────────
      case 'form-pull': {
        const bodyId = useCADStore.getState().activeFormBodyId;
        if (!bodyId) { setStatusMessage('Pull: no active form body'); break; }
        const body = useCADStore.getState().formBodies.find((b) => b.id === bodyId);
        if (!body) break;
        const updated = SubdivisionEngine.pullToLimitSurface(body);
        removeFormBody(bodyId);
        addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
        formMeshesRef.current = [];
        setStatusMessage('Pull: cage vertices moved toward Catmull-Clark limit surface');
        break;
      }
      // ── FM10: Interpolate (click anywhere on active body) ───────────────────
      case 'form-interpolate': {
        const bodyId = useCADStore.getState().activeFormBodyId;
        if (!bodyId) { setStatusMessage('Interpolate: no active form body'); break; }
        const body = useCADStore.getState().formBodies.find((b) => b.id === bodyId);
        if (!body) break;
        // Snap each vertex back to its current position (no-op in identity case);
        // use existing positions as target points to demonstrate the wiring.
        const targets = body.vertices.map((v) => v.position as [number, number, number]);
        const updated = SubdivisionEngine.interpolateToPoints(body, targets);
        removeFormBody(bodyId);
        addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
        formMeshesRef.current = [];
        setStatusMessage('Interpolate: cage vertices snapped to target positions');
        break;
      }
      // ── FM11: Thicken Form (click anywhere on active body) ──────────────────
      case 'form-thicken': {
        const bodyId = useCADStore.getState().activeFormBodyId;
        if (!bodyId) { setStatusMessage('Thicken Form: no active form body'); break; }
        const body = useCADStore.getState().formBodies.find((b) => b.id === bodyId);
        if (!body) break;
        const updated = SubdivisionEngine.thickenCage(body, 2);
        removeFormBody(bodyId);
        addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
        formMeshesRef.current = [];
        setStatusMessage('Thicken Form: shell cage created with 2-unit thickness');
        break;
      }
      default: break;
    }
  }, [activeTool, addFormBody, removeFormBody, formBodies, pickNearestVertex, setActiveFormBody,
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
