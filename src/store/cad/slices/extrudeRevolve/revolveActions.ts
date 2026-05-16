import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { errorMessage } from '../../../../utils/errorHandling';
import { REVOLVE_DEFAULTS } from '../../defaults';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

/**
 * Resolve the world-space axis vector for a revolve exactly the way
 * RevolveItem (the renderer) does: an explicit centerline direction wins,
 * otherwise the named X/Y/Z axis (default Y).
 */
function resolveRevolveAxisVec(
  axisKey: string,
  axisDirection: [number, number, number] | undefined,
): THREE.Vector3 {
  if (axisDirection) {
    return new THREE.Vector3(axisDirection[0], axisDirection[1], axisDirection[2]);
  }
  if (axisKey === 'X') return new THREE.Vector3(1, 0, 0);
  if (axisKey === 'Z') return new THREE.Vector3(0, 0, 1);
  return new THREE.Vector3(0, 1, 0);
}

/**
 * Pick the body to boolean a revolve against: the most recent active,
 * visible SOLID feature that already carries a real THREE.Mesh (excluding
 * the revolve being committed and any surface body). Mirrors commitCombine's
 * "target has a mesh" requirement — extrude bodies live only in the R3F
 * scene (no feature.mesh) so they are not eligible single-shot targets here.
 */
function pickRevolveTarget(features: Feature[]): Feature | undefined {
  let best: Feature | undefined;
  for (const f of features) {
    if (f.type === 'revolve') continue;
    if (!f.visible || f.suppressed) continue;
    if (f.bodyKind === 'surface') continue;
    if (!(f.mesh instanceof THREE.Mesh)) continue;
    if (!best || f.timestamp >= best.timestamp) best = f;
  }
  return best;
}

/**
 * Run the requested boolean (join/cut/intersect) between the target body
 * mesh and the freshly-built revolve mesh, returning a new pickable solid
 * mesh. Wrapped in try/catch like commitCombine — CSG can throw on
 * degenerate / non-manifold input; on failure we return null so the caller
 * can fall back to new-body behaviour without corrupting state.
 */
function applyRevolveBoolean(
  targetMesh: THREE.Mesh,
  revolveMesh: THREE.Mesh,
  operation: 'join' | 'cut' | 'intersect',
): THREE.Mesh | null {
  try {
    const targetGeom = GeometryEngine.bakeMeshWorldGeometry(targetMesh);
    const toolGeom = GeometryEngine.bakeMeshWorldGeometry(revolveMesh);
    let resultGeom: THREE.BufferGeometry;
    if (operation === 'join') {
      resultGeom = GeometryEngine.csgUnion(targetGeom, toolGeom);
    } else if (operation === 'cut') {
      resultGeom = GeometryEngine.csgSubtract(targetGeom, toolGeom);
    } else {
      resultGeom = GeometryEngine.csgIntersect(targetGeom, toolGeom);
    }
    targetGeom.dispose();
    toolGeom.dispose();
    const mesh = new THREE.Mesh(resultGeom, targetMesh.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  } catch (err) {
    void errorMessage(err, 'unknown CSG error');
    return null;
  }
}

/**
 * Mirror of commitCombine's designConfigurations sync: record the
 * suppression flags of the freshly-built revolve feature and the consumed
 * target into the active configuration so they survive a config switch.
 */
function syncRevolveConfigurationSuppression(
  state: CADState,
  entries: Record<string, boolean>,
): CADState['designConfigurations'] {
  const updatedAt = Date.now();
  return state.designConfigurations.map((configuration) =>
    configuration.id === state.activeDesignConfigurationId
      ? {
          ...configuration,
          featureSuppression: { ...configuration.featureSuppression, ...entries },
          updatedAt,
        }
      : configuration,
  );
}

export function createRevolveActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Revolve tool Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  ...REVOLVE_DEFAULTS,
  setRevolveSelectedSketchId: (id) => set({ revolveSelectedSketchId: id }),
  setRevolveAxis: (a) => set({ revolveAxis: a }),
  setRevolveAngle: (angle) => set({ revolveAngle: angle }),
  // D70 direction modes
  setRevolveDirection: (d) => set({ revolveDirection: d }),
  setRevolveAngle2: (a) => set({ revolveAngle2: a }),
  // D103 body kind
  setRevolveBodyKind: (k) => set({ revolveBodyKind: k }),
  setRevolveOperation: (op) => set({ revolveOperation: op }),
  // CORR-10
  setRevolveIsProjectAxis: (v) => set({ revolveIsProjectAxis: v }),
  // Face mode
  setRevolveProfileMode: (m) => set({ revolveProfileMode: m }),
  clearRevolveFace: () => set({ revolveFaceBoundary: null, revolveFaceNormal: null }),
  startRevolveFromFace: (boundary, normal) => {
    if (boundary.length < 3) return;
    const flat = boundary.flatMap((v) => [v.x, v.y, v.z]);
    set({
      revolveFaceBoundary: flat,
      revolveFaceNormal: [normal.x, normal.y, normal.z],
      statusMessage: 'Face selected Ã¢â‚¬â€ set axis and angle, then click OK',
    });
  },
  startRevolveTool: () => {
    set({
      activeTool: 'revolve',
      ...REVOLVE_DEFAULTS,
      statusMessage: 'Revolve Ã¢â‚¬â€ pick a sketch profile or use Face mode',
    });
  },
  cancelRevolveTool: () => {
    set({
      activeTool: 'select',
      ...REVOLVE_DEFAULTS,
      statusMessage: 'Revolve cancelled',
    });
  },
  commitRevolve: () => {
    const { revolveProfileMode, revolveSelectedSketchId, revolveFaceBoundary, revolveAxis, revolveAngle, revolveDirection, revolveAngle2, revolveBodyKind, revolveOperation, revolveIsProjectAxis, sketches, features, units } = get();

    // Ã¢â€â‚¬Ã¢â€â‚¬ Face mode Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    if (revolveProfileMode === 'face') {
      if (!revolveFaceBoundary || revolveFaceBoundary.length < 9) {
        set({ statusMessage: 'Click a face in the viewport first' });
        return;
      }
      const primaryAngle = revolveDirection === 'symmetric' ? revolveAngle / 2 : revolveAngle;
      if (Math.abs(primaryAngle) < 0.5) {
        set({ statusMessage: 'Angle must be greater than 0' });
        return;
      }
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `${revolveBodyKind === 'surface' ? 'Surface ' : ''}Revolve ${features.filter((f) => f.type === 'revolve').length + 1}`,
        type: 'revolve',
        params: {
          angle: revolveAngle,
          axis: revolveAxis,
          direction: revolveDirection,
          angle2: revolveAngle2,
          faceRevolve: true,
          faceBoundary: revolveFaceBoundary,
          isProjectAxis: revolveIsProjectAxis,
          operation: revolveOperation,
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: revolveBodyKind === 'surface' ? 'surface' : 'solid',
      };
      const angleDesc = revolveDirection === 'symmetric' ? `Ã‚Â±${revolveAngle / 2}Ã‚Â°` : `${revolveAngle}Ã‚Â°`;

      // Ã¢â€â‚¬Ã¢â€â‚¬ Boolean operation (join / cut / intersect) Ã¢â€â‚¬Ã¢â€â‚¬
      // For non-new-body ops, bake the revolve mesh NOW (same math as
      // RevolveItem) and CSG it against the chosen target body, storing the
      // result on feature.mesh so the stored-mesh render path handles it.
      let faceFallbackNote = '';
      if (revolveOperation && revolveOperation !== 'new-body' && revolveBodyKind !== 'surface') {
        const target = pickRevolveTarget(features);
        if (target) {
          const { phiStart, sweep } = GeometryEngine.resolveRevolveSweep(revolveAngle, revolveAngle2, revolveDirection);
          const axisVec = resolveRevolveAxisVec(revolveAxis as string, undefined);
          const boundary: THREE.Vector3[] = [];
          for (let i = 0; i < revolveFaceBoundary.length; i += 3) {
            boundary.push(new THREE.Vector3(revolveFaceBoundary[i], revolveFaceBoundary[i + 1], revolveFaceBoundary[i + 2]));
          }
          const revolveMesh = GeometryEngine.revolveFaceBoundary(boundary, axisVec, sweep, false, phiStart);
          if (revolveMesh) {
            const result = applyRevolveBoolean(target.mesh as THREE.Mesh, revolveMesh, revolveOperation);
            revolveMesh.geometry.dispose();
            if (result) {
              feature.mesh = result;
              feature.bodyKind = 'solid';
              feature.params.targetFeatureId = target.id;
              get().pushUndo();
              set((state) => {
                const updated = state.features.map((f) =>
                  f.id === target.id ? { ...f, suppressed: true, visible: false } : f,
                );
                return {
                  features: [...updated, feature],
                  designConfigurations: syncRevolveConfigurationSuppression(state, {
                    [feature.id]: false,
                    [target.id]: true,
                  }),
                  activeTool: 'select',
                  ...REVOLVE_DEFAULTS,
                  statusMessage: `Revolve ${revolveOperation} with ${target.name} (${units})`,
                };
              });
              return;
            }
            // CSG failed Ã¢â‚¬â€ fall through to new-body behaviour with a note.
            faceFallbackNote = ` (${revolveOperation} failed Ã¢â‚¬â€ kept as new body)`;
          }
        } else {
          faceFallbackNote = ` (no solid body to ${revolveOperation} Ã¢â‚¬â€ kept as new body)`;
        }
      }

      get().pushUndo();
      set({
        features: [...features, feature],
        activeTool: 'select',
        ...REVOLVE_DEFAULTS,
        statusMessage: `Revolved face by ${angleDesc} around ${revolveAxis} (${units})${faceFallbackNote}`,
      });
      return;
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Sketch mode Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    if (!revolveSelectedSketchId) {
      set({ statusMessage: 'No profile selected for revolve' });
      return;
    }
    const sketch = sketches.find((s) => s.id === revolveSelectedSketchId);
    if (!sketch) {
      set({ statusMessage: 'Selected profile not found' });
      return;
    }
    // For symmetric, each side gets angle/2; for two-sides, side1=revolveAngle, side2=revolveAngle2.
    // The stored angle is always the primary (or full) angle Ã¢â‚¬â€ the renderer uses revolveDirection.
    const primaryAngle = revolveDirection === 'symmetric' ? revolveAngle / 2 : revolveAngle;
    if (Math.abs(primaryAngle) < 0.5) {
      set({ statusMessage: 'Angle must be greater than 0' });
      return;
    }
    // S5: if centerline axis, find centerline entity in sketch and extract axis
    let resolvedAxisKey = revolveAxis as string;
    let centerlineAxisDirection: [number, number, number] | undefined;
    let centerlineAxisOrigin: [number, number, number] | undefined;
    if (revolveAxis === 'centerline') {
      const clEntity = sketch.entities.find((e) => e.type === 'centerline' && e.points.length >= 2);
      if (!clEntity) {
        set({ statusMessage: 'Spun Profile: no centerline found in sketch Ã¢â‚¬â€ add a centerline entity first' });
        return;
      }
      const p0 = clEntity.points[0];
      const p1 = clEntity.points[clEntity.points.length - 1];
      const dir = new THREE.Vector3(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z).normalize();
      centerlineAxisDirection = [dir.x, dir.y, dir.z];
      centerlineAxisOrigin = [p0.x, p0.y, p0.z];
      // Map to nearest standard axis for LatheGeometry orientation fallback
      const ax = Math.abs(dir.x), ay = Math.abs(dir.y), az = Math.abs(dir.z);
      resolvedAxisKey = ax >= ay && ax >= az ? 'X' : ay >= ax && ay >= az ? 'Y' : 'Z';
    }
    get().pushUndo();
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `${revolveBodyKind === 'surface' ? 'Surface ' : ''}Revolve ${features.filter((f) => f.type === 'revolve').length + 1}`,
      type: 'revolve',
      sketchId: revolveSelectedSketchId,
      params: {
        angle: revolveAngle,
        axis: resolvedAxisKey,
        ...(centerlineAxisDirection ? { useCenterline: true, axisDirection: centerlineAxisDirection, axisOrigin: centerlineAxisOrigin } : {}),
        direction: revolveDirection,
        angle2: revolveAngle2,
        isProjectAxis: revolveIsProjectAxis,
        operation: revolveOperation,
      },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: revolveBodyKind === 'surface' ? 'surface' : 'solid',
    };
    const angleDesc = revolveDirection === 'symmetric'
      ? `Ã‚Â±${revolveAngle / 2}Ã‚Â°`
      : revolveDirection === 'two-sides'
        ? `${revolveAngle}Ã‚Â°/${revolveAngle2}Ã‚Â°`
        : `${revolveAngle}Ã‚Â°`;

    // Ã¢â€â‚¬Ã¢â€â‚¬ Boolean operation (join / cut / intersect) Ã¢â€â‚¬Ã¢â€â‚¬
    // Bake the revolve mesh NOW with the SAME math RevolveItem uses, CSG it
    // against the chosen target body, and store the result on feature.mesh
    // (the stored-mesh render path then draws it; RevolveItem is skipped via
    // the !f.mesh guard in ExtrudedBodies). new-body falls through unchanged.
    let sketchFallbackNote = '';
    if (revolveOperation && revolveOperation !== 'new-body' && revolveBodyKind !== 'surface') {
      const target = pickRevolveTarget(features);
      if (target) {
        const { phiStart, sweep } = GeometryEngine.resolveRevolveSweep(revolveAngle, revolveAngle2, revolveDirection);
        const axisVec = resolveRevolveAxisVec(resolvedAxisKey, centerlineAxisDirection);
        const revolveMesh = GeometryEngine.revolveSketch(sketch, sweep, axisVec, phiStart);
        if (revolveMesh) {
          const result = applyRevolveBoolean(target.mesh as THREE.Mesh, revolveMesh, revolveOperation);
          revolveMesh.geometry.dispose();
          if (result) {
            feature.mesh = result;
            feature.bodyKind = 'solid';
            feature.params.targetFeatureId = target.id;
            set((state) => {
              const updated = state.features.map((f) =>
                f.id === target.id ? { ...f, suppressed: true, visible: false } : f,
              );
              return {
                features: [...updated, feature],
                designConfigurations: syncRevolveConfigurationSuppression(state, {
                  [feature.id]: false,
                  [target.id]: true,
                }),
                activeTool: 'select',
                ...REVOLVE_DEFAULTS,
                statusMessage: `Revolve ${revolveOperation} with ${target.name} (${units})`,
              };
            });
            return;
          }
          sketchFallbackNote = ` (${revolveOperation} failed Ã¢â‚¬â€ kept as new body)`;
        }
      } else {
        sketchFallbackNote = ` (no solid body to ${revolveOperation} Ã¢â‚¬â€ kept as new body)`;
      }
    }

    set({
      features: [...features, feature],
      activeTool: 'select',
      ...REVOLVE_DEFAULTS,
      statusMessage: `Revolved ${sketch.name} by ${angleDesc} around ${revolveAxis === 'centerline' ? 'sketch centerline' : revolveAxis} (${units})${sketchFallbackNote}`,
    });
  },
  };
}
