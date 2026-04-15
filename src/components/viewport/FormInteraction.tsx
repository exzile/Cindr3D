/**
 * FormInteraction — handles all Form workspace tool interactions:
 *   D152: Edit Form (select + drag cage elements)
 *   D153-D166: MODIFY stubs (Insert Edge, Subdivide, Bridge, …)
 *   D167: Delete (remove selected face / edge / vertex from the cage)
 *
 * Rendered inside the R3F Canvas when activeTool is a 'form-*' tool and
 * there is at least one Form body in the scene.
 */
import { useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { useCADStore } from '../../store/cadStore';
import { SubdivisionEngine } from '../../engine/SubdivisionEngine';
import type { FormElementType } from '../../types/cad';

// ─── Component ────────────────────────────────────────────────────────────────

export default function FormInteraction() {
  const { gl } = useThree();

  const activeTool      = useCADStore((s) => s.activeTool);
  const formBodies      = useCADStore((s) => s.formBodies);
  const activeFormBodyId = useCADStore((s) => s.activeFormBodyId);
  const formSelection   = useCADStore((s) => s.formSelection);
  const setActiveFormBody = useCADStore((s) => s.setActiveFormBody);
  const setFormSelection  = useCADStore((s) => s.setFormSelection);
  const deleteFormElements = useCADStore((s) => s.deleteFormElements);
  const setStatusMessage  = useCADStore((s) => s.setStatusMessage);
  const addFormBody       = useCADStore((s) => s.addFormBody);

  // Auto-activate the first body when entering the Form workspace
  useEffect(() => {
    if (!activeFormBodyId && formBodies.length > 0) {
      setActiveFormBody(formBodies[0].id);
    }
  }, [activeFormBodyId, formBodies, setActiveFormBody]);

  // Status message on tool activation
  useEffect(() => {
    if (!activeTool.startsWith('form-')) return;
    switch (activeTool) {
      // CREATE panel (D140-D151)
      case 'form-box':         setStatusMessage('Form Box: click to place a T-Spline box at the origin'); break;
      case 'form-plane':       setStatusMessage('Form Plane: click to place a flat T-Spline plane — requires D139 kernel (coming soon)'); break;
      case 'form-cylinder':    setStatusMessage('Form Cylinder: click to place a T-Spline cylinder — requires D139 kernel (coming soon)'); break;
      case 'form-sphere':      setStatusMessage('Form Sphere: click to place a T-Spline sphere — requires D139 kernel (coming soon)'); break;
      case 'form-torus':       setStatusMessage('Form Torus: click to place a T-Spline torus — requires D139 kernel (coming soon)'); break;
      case 'form-quadball':    setStatusMessage('Form Quadball: click to place a T-Spline quadball — requires D139 kernel (coming soon)'); break;
      case 'form-pipe':        setStatusMessage('Form Pipe: select a path to create a T-Spline pipe — requires D139 kernel (coming soon)'); break;
      case 'form-face':        setStatusMessage('Form Face: click to place a single T-Spline face — requires D139 kernel (coming soon)'); break;
      case 'form-extrude':     setStatusMessage('Form Extrude: select edges to extrude along a vector — requires D139 kernel (coming soon)'); break;
      case 'form-revolve':     setStatusMessage('Form Revolve: select edges to revolve around an axis — requires D139 kernel (coming soon)'); break;
      case 'form-sweep':       setStatusMessage('Form Sweep: select edges to sweep along a path — requires D139 kernel (coming soon)'); break;
      case 'form-loft':        setStatusMessage('Form Loft: select profile edges to loft between — requires D139 kernel (coming soon)'); break;
      // MODIFY panel (D152-D167)
      case 'form-edit':
        setStatusMessage('Edit Form: click a face, edge or vertex to select; drag to move');
        break;
      case 'form-delete':
        setStatusMessage(
          formSelection
            ? `Delete: press Delete / Backspace to remove ${formSelection.ids.length} selected ${formSelection.type}(s)`
            : 'Delete: click a face, edge or vertex to select it, then press Delete',
        );
        break;
      case 'form-insert-edge':   setStatusMessage('Insert Edge: click on a face to insert a new edge loop — coming soon'); break;
      case 'form-insert-point':  setStatusMessage('Insert Point: click on an edge to add a vertex — coming soon'); break;
      case 'form-subdivide':     setStatusMessage('Subdivide: click a face to increase its subdivision density — coming soon'); break;
      case 'form-bridge':        setStatusMessage('Bridge: select two open edges to create a bridging tube — coming soon'); break;
      case 'form-fill-hole':     setStatusMessage('Fill Hole: click an open boundary edge to cap it — coming soon'); break;
      case 'form-weld':          setStatusMessage('Weld: click coincident vertices to merge them — coming soon'); break;
      case 'form-unweld':        setStatusMessage('Unweld: click a vertex to split it — coming soon'); break;
      case 'form-crease':        setStatusMessage('Crease: click an edge to mark it as sharp — coming soon'); break;
      case 'form-uncrease':      setStatusMessage('Uncrease: click a creased edge to smooth it — coming soon'); break;
      case 'form-flatten':       setStatusMessage('Flatten: click vertices to project them onto a plane — coming soon'); break;
      case 'form-uniform':       setStatusMessage('Uniform: click faces to equalize their sizes — coming soon'); break;
      case 'form-pull':          setStatusMessage('Pull: drag vertices toward another surface — coming soon'); break;
      case 'form-interpolate':   setStatusMessage('Interpolate: smooth transition between selected vertex sets — coming soon'); break;
      case 'form-thicken':       setStatusMessage('Thicken: shell the subdivision surface into a solid — coming soon'); break;
      case 'form-freeze':        setStatusMessage('Freeze: lock vertices from Edit Form manipulation — coming soon'); break;
      default: break;
    }
  }, [activeTool, formSelection, setStatusMessage]);

  // ── D167: keyboard Delete handler ──────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (activeTool !== 'form-delete') return;
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (!formSelection || formSelection.ids.length === 0) {
      setStatusMessage('Delete: nothing selected');
      return;
    }
    const { type, ids } = formSelection;
    deleteFormElements(type as FormElementType, ids);
    setStatusMessage(`Deleted ${ids.length} ${type}(s) from cage`);
  }, [activeTool, formSelection, deleteFormElements, setStatusMessage]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Click handler: place primitives + select cage elements ─────────────────
  const handleCanvasClick = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;

    // ── D140: Place a T-Spline box ──────────────────────────────────────────
    if (activeTool === 'form-box') {
      const cageData = SubdivisionEngine.createBoxCageData(20, 20, 20, `box${Date.now()}-`);
      addFormBody({
        id: `fb-${Date.now()}`,
        name: 'T-Spline Box',
        ...cageData,
        subdivisionLevel: 2,
        visible: true,
      });
      setStatusMessage('T-Spline Box created. Switch to Edit Form to modify the cage.');
      return;
    }

    // ── D152 / D167: select cage face/edge/vertex ───────────────────────────
    if (activeTool !== 'form-edit' && activeTool !== 'form-delete') return;

    // TODO (D152): cast a ray against the active cage mesh and find the
    // nearest face / edge / vertex. For now stub with first-face selection.
    setStatusMessage(
      activeTool === 'form-delete'
        ? 'Delete: ray-picking against cage mesh — requires cage-pick infrastructure'
        : 'Edit Form: ray-picking cage elements — requires cage-pick infrastructure',
    );

    if (formBodies.length > 0) {
      const body = formBodies.find((b) => b.id === activeFormBodyId) ?? formBodies[0];
      if (!activeFormBodyId) setActiveFormBody(body.id);
      if (body.faces.length > 0 && !formSelection) {
        setFormSelection({ bodyId: body.id, type: 'face', ids: [body.faces[0].id] });
      } else {
        setFormSelection(null);
      }
    }
  }, [activeTool, formBodies, activeFormBodyId, formSelection, addFormBody, setActiveFormBody, setFormSelection, setStatusMessage]);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('click', handleCanvasClick);
    return () => canvas.removeEventListener('click', handleCanvasClick);
  }, [gl, handleCanvasClick]);

  // FormInteraction is purely interactive — renders no 3D geometry itself
  // (FormRenderer, which visualises the cage, is a sibling component)
  return null;
}
