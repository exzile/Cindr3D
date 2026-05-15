/**
 * OverConstraintInterception.test.ts — store-level wiring for the Fusion-style
 * over-constraint interception flow (CAVEAT 2).
 *
 * The pure predicate `wouldOverConstrain` is covered by
 * OverConstraintCheck.test.ts. THIS file covers the *wiring* through the real
 * cad-store actions — that a genuinely over-constraining EDIT raises the
 * `pendingOverConstraint` prompt and does NOT mutate, that resolving it as a
 * driven dimension persists an annotation-only driven dim, and that cancelling
 * reverts (nothing persisted). It also regression-guards that a normal,
 * non-over-constraining edit applies the value with no prompt.
 *
 * WHAT IS COVERED (real store actions, no fakery):
 *   - commitSketchDimEdit on a value that over-constrains ⇒ pendingOverConstraint
 *     set, the edited dimension's value/geometry NOT mutated.
 *   - resolveOverConstraintAsDriven() ⇒ that dimension becomes driven:true
 *     (annotation-only, value kept), pendingOverConstraint cleared.
 *   - cancelOverConstraint() ⇒ no prompt, original value still in the sketch,
 *     nothing persisted as the new value.
 *   - commitSketchDimEdit on a non-over-constraining value ⇒ NO prompt, value
 *     applied normally (regression guard).
 *
 * WHAT IS NOT COVERED HERE (stated honestly):
 *   - The ADD path (`commitDimension`) is a module-internal function inside the
 *     dimension hook (useSketchDimensionTool.ts), not reachable from a unit
 *     test. It routes through the SAME shared `interceptOverConstraint` helper
 *     and the SAME `wouldOverConstrain` predicate as the edit path, so the
 *     store-level wiring proven here is the same code; only the entry call
 *     site differs. The add-path entry itself is left to live QA.
 *   - The visual/interactive feel of the OverConstraintDialog modal, and the
 *     subjective false-positive feel on near-singular sketches in live use,
 *     cannot be asserted by an automated test and remain open for human
 *     click-through. (A deterministic false-positive *bound* lives in
 *     OverConstraintCheck.test.ts case (j).)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Sketch, SketchDimension, SketchEntity } from '../types/cad';

const SKETCH_ID = 'over-constraint-interception-sketch';

// XY-plane sketch fixture, identical projection behavior to the one used by
// OverConstraintCheck.test.ts so prediction == reality holds in the store too.
const mkSketch = (
  entities: SketchEntity[],
  dimensions: SketchDimension[] = [],
): Sketch => ({
  id: SKETCH_ID,
  name: 'Over-constraint interception sketch',
  plane: 'XY',
  planeNormal: new THREE.Vector3(0, 1, 0),
  planeOrigin: new THREE.Vector3(0, 0, 0),
  entities,
  constraints: [],
  dimensions,
  fullyConstrained: false,
});

const line = (id: string, x0: number, x1: number): SketchEntity => ({
  id,
  type: 'line',
  points: [
    { id: `${id}-p0`, x: x0, y: 0, z: 0 },
    { id: `${id}-p1`, x: x1, y: 0, z: 0 },
  ],
});

const alignedDim = (
  id: string,
  entityId: string,
  value: number,
  driven = false,
): SketchDimension => ({
  id,
  type: 'aligned',
  entityIds: [entityId],
  value,
  position: { x: 0, y: 4 },
  driven,
});

describe('over-constraint interception (store wiring)', () => {
  beforeEach(async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
      clear: () => { storage.clear(); },
    });

    const { useCADStore } = await import('../store/cadStore');
    useCADStore.setState({
      sketches: [],
      activeSketch: null,
      undoStack: [],
      redoStack: [],
      statusMessage: '',
      pendingOverConstraint: null,
      pendingNewDimensionId: null,
      pendingDimensionEntityIds: [],
      dimensionPreview: null,
      sketchDimEditId: null,
      sketchDimEditValue: '',
      sketchDimEditIsNew: false,
      sketchComputeDeferred: false,
    });
  });

  /** Load a sketch with an existing pinning dim + an editable dim into the store. */
  async function loadSketch(dims: SketchDimension[]) {
    const { useCADStore } = await import('../store/cadStore');
    const sketch = mkSketch([line('line-a', 0, 14)], dims);
    useCADStore.setState({ sketches: [sketch], activeSketch: sketch });
    return useCADStore;
  }

  it('over-constraining EDIT raises the prompt and does NOT mutate the dimension', async () => {
    // line-a is pinned to length 10 by a driving aligned dim. We then edit a
    // SECOND driving aligned dim on the same line to 25 — the two driving
    // dims conflict (a line has one length DOF) ⇒ over-constrains.
    const store = await loadSketch([
      alignedDim('pin', 'line-a', 10),
      alignedDim('edit-me', 'line-a', 12),
    ]);

    store.getState().openSketchDimEdit('edit-me', '12', false);
    store.getState().commitSketchDimEdit('25');

    const state = store.getState();
    expect(state.pendingOverConstraint).not.toBeNull();
    expect(state.pendingOverConstraint?.mode).toBe('edit');
    expect(state.pendingOverConstraint?.previousValue).toBe(12);
    expect(state.pendingOverConstraint?.dimension.id).toBe('edit-me');
    expect(state.pendingOverConstraint?.dimension.value).toBe(25);

    // Critical: the dimension's persisted value is UNCHANGED (interception
    // happens BEFORE any mutation), and it is still a driving dimension.
    const persisted = state.activeSketch?.dimensions.find((d) => d.id === 'edit-me');
    expect(persisted?.value).toBe(12);
    expect(persisted?.driven).toBe(false);
    // The editor overlay was dismissed when the prompt was raised.
    expect(state.sketchDimEditId).toBeNull();
  });

  it('resolveOverConstraintAsDriven() makes the dimension driven (annotation-only) and clears the prompt', async () => {
    const store = await loadSketch([
      alignedDim('pin', 'line-a', 10),
      alignedDim('edit-me', 'line-a', 12),
    ]);
    store.getState().openSketchDimEdit('edit-me', '12', false);
    store.getState().commitSketchDimEdit('25');
    expect(store.getState().pendingOverConstraint).not.toBeNull();

    store.getState().resolveOverConstraintAsDriven();

    const state = store.getState();
    expect(state.pendingOverConstraint).toBeNull();
    const resolved = state.activeSketch?.dimensions.find((d) => d.id === 'edit-me');
    // Driven (reference) — keeps the NEW value as an annotation, never reaches
    // the solver so it cannot over-constrain.
    expect(resolved?.driven).toBe(true);
    expect(resolved?.value).toBe(25);
    // Still exactly two dimensions: edit-path replaces the entry in place
    // (it does not append a duplicate).
    expect(state.activeSketch?.dimensions).toHaveLength(2);
    // Mirrored into the sketches[] collection too.
    const inCollection = state.sketches[0]?.dimensions.find((d) => d.id === 'edit-me');
    expect(inCollection?.driven).toBe(true);
    expect(inCollection?.value).toBe(25);
  });

  it('cancelOverConstraint() reverts — nothing persisted, prompt cleared', async () => {
    const store = await loadSketch([
      alignedDim('pin', 'line-a', 10),
      alignedDim('edit-me', 'line-a', 12),
    ]);
    store.getState().openSketchDimEdit('edit-me', '12', false);
    store.getState().commitSketchDimEdit('25');
    expect(store.getState().pendingOverConstraint).not.toBeNull();

    store.getState().cancelOverConstraint();

    const state = store.getState();
    expect(state.pendingOverConstraint).toBeNull();
    const reverted = state.activeSketch?.dimensions.find((d) => d.id === 'edit-me');
    // Interception happened before mutation, so the original value stands and
    // the dimension is still a driving (non-driven) dimension. The 25 was
    // never persisted anywhere.
    expect(reverted?.value).toBe(12);
    expect(reverted?.driven).toBe(false);
    expect(state.activeSketch?.dimensions).toHaveLength(2);
    expect(
      state.activeSketch?.dimensions.some((d) => d.value === 25),
    ).toBe(false);
  });

  it('a non-over-constraining EDIT applies the value with NO prompt (regression guard)', async () => {
    // Only ONE driving dimension on the line — editing it to a new value is
    // perfectly solvable, so no prompt and the value is applied normally.
    const store = await loadSketch([alignedDim('edit-me', 'line-a', 12)]);

    store.getState().openSketchDimEdit('edit-me', '12', false);
    store.getState().commitSketchDimEdit('20');

    const state = store.getState();
    expect(state.pendingOverConstraint).toBeNull();
    const applied = state.activeSketch?.dimensions.find((d) => d.id === 'edit-me');
    expect(applied?.value).toBe(20);
    expect(applied?.driven).toBe(false);
    expect(state.sketchDimEditId).toBeNull();
  });
});
