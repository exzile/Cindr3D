import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import {
  pickMostRecentSolidTarget,
  syncConfigurationSuppression,
} from '../featureManagement/bodyBoolean';
import { REVOLVE_DEFAULTS } from '../../defaults';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { getOccSync } from '../../../../engine/occ/loader';
import { createOccPlaneFrame, createOccPlaneFrameFromSketch } from '../../../../engine/occ/plane';
import { occRevolveWithInstance } from '../../../../engine/occ/ops/revolve';
import { performOccBooleanWithInstance, type OccBooleanOperation } from '../../../../engine/occ/ops/booleanCore';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { errorMessage } from '../../../../utils/errorHandling';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { useComponentStore } from '../../../componentStore';
import {
  makeFaceBoundarySketchProfile,
  makeRevolveSketchProfileFromShape,
  resolveRevolveAngles,
  resolveRevolveAxisVec,
  revolveAxisOriginVector,
} from './revolveHelpers';

export function createRevolveActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
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
  setRevolveIsProjectAxis: (v) => set({ revolveIsProjectAxis: v }),
  // SURF-CREATE-7: to-object extent
  setRevolveExtentType: (t) => set({ revolveExtentType: t }),
  setRevolveToEntityFace: (centroid, normal) => set({ revolveToEntityFaceCentroid: centroid, revolveToEntityFaceNormal: normal, revolveExtentType: 'to-object' }),
  clearRevolveToEntityFace: () => set({ revolveToEntityFaceCentroid: null, revolveToEntityFaceNormal: null, revolveExtentType: 'angle' }),
  // Face mode
  setRevolveProfileMode: (m) => set({ revolveProfileMode: m }),
  clearRevolveFace: () => set({ revolveFaceBoundary: null, revolveFaceNormal: null }),
  startRevolveFromFace: (boundary, normal) => {
    if (boundary.length < 3) return;
    const flat = boundary.flatMap((v) => [v.x, v.y, v.z]);
    set({
      revolveFaceBoundary: flat,
      revolveFaceNormal: [normal.x, normal.y, normal.z],
      statusMessage: 'Face selected - set axis and angle, then click OK',
    });
  },
  startRevolveTool: () => {
    set({
      activeTool: 'revolve',
      ...REVOLVE_DEFAULTS,
      statusMessage: 'Revolve - pick a sketch profile or use Face mode',
    });
  },
  cancelRevolveTool: () => {
    set({
      activeTool: 'select',
      ...REVOLVE_DEFAULTS,
      statusMessage: 'Revolve cancelled',
    });
  },
  commitRevolve: async () => {
    const { revolveProfileMode, revolveSelectedSketchId, revolveFaceBoundary, revolveFaceNormal, revolveAxis, revolveAngle, revolveDirection, revolveAngle2, revolveBodyKind, revolveOperation, revolveIsProjectAxis, revolveExtentType, revolveToEntityFaceCentroid, sketches, features, units } = get();

    // Compute to-object angle if extent type is 'to-object' (sketch mode only)
    let effectiveRevolveAngle = revolveAngle;
    if (revolveExtentType === 'to-object' && revolveToEntityFaceCentroid && revolveProfileMode !== 'face') {
      const axisKey = revolveAxis === 'centerline' ? 'Y' : revolveAxis;
      const [cx, cy, cz] = revolveToEntityFaceCentroid;
      // Project centroid onto the plane perpendicular to the revolve axis
      // and compute the angle from the profile's reference direction
      let angleRad: number;
      if (axisKey === 'Y') {
        angleRad = Math.atan2(cz, cx);
      } else if (axisKey === 'X') {
        angleRad = Math.atan2(cy, cz);
      } else {
        angleRad = Math.atan2(cy, cx);
      }
      // Ensure positive and convert to degrees
      const angleDeg = ((angleRad * 180) / Math.PI + 360) % 360;
      effectiveRevolveAngle = angleDeg < 0.5 ? 360 : angleDeg;
    }

    if (revolveProfileMode === 'face') {
      if (!revolveFaceBoundary || revolveFaceBoundary.length < 9) {
        set({ statusMessage: 'Click a face in the viewport first' });
        return;
      }
      const revolveAngles = resolveRevolveAngles(revolveDirection, revolveAngle, revolveAngle2);
      const primaryAngle = revolveAngles.primaryAngleDeg;
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
      const angleDesc = revolveDirection === 'symmetric' ? `±${revolveAngle / 2}°` : `${revolveAngle}°`;

      const faceFallbackNote = '';
      if (revolveOperation && revolveOperation !== 'new-body' && revolveOperation !== 'new-component' && revolveBodyKind !== 'surface') {
        // ── OCC face revolve boolean path ──
        const target = pickMostRecentSolidTarget(features, { excludeType: 'revolve' });
        if (!target) {
          set({ statusMessage: `Face revolve ${revolveOperation} requires a target body` });
          return;
        }
        const targetBrepBodyId = target.mesh instanceof THREE.Mesh
          ? (target.mesh.userData['brepBodyId'] as string | undefined)
          : undefined;
        const targetBRepBody = targetBrepBodyId ? globalBRepBodyRegistry.get(targetBrepBodyId) : undefined;
        if (!targetBRepBody) {
          set({ statusMessage: `Face revolve ${revolveOperation} requires an OCC-backed target body` });
          return;
        }
        const occ = getOccSync();
        if (!occ) {
          set({ statusMessage: 'Face revolve requires OCC to be loaded' });
          return;
        }
        try {
          // Reconstruct boundary vertices from flat array [x,y,z,x,y,z,...]
          const pts3d: THREE.Vector3[] = [];
          for (let i = 0; i + 2 < revolveFaceBoundary.length; i += 3) {
            pts3d.push(new THREE.Vector3(revolveFaceBoundary[i], revolveFaceBoundary[i + 1], revolveFaceBoundary[i + 2]));
          }

          // Build a plane frame from face centroid + stored normal
          const centroid = pts3d.reduce((acc, p) => acc.clone().add(p), new THREE.Vector3()).divideScalar(pts3d.length);
          const normalVec = revolveFaceNormal
            ? new THREE.Vector3(revolveFaceNormal[0], revolveFaceNormal[1], revolveFaceNormal[2])
            : new THREE.Vector3(0, 1, 0);
          const frame = createOccPlaneFrame(centroid, normalVec);

          const sketchProfile = makeFaceBoundarySketchProfile(pts3d, frame);
          const axisVec = resolveRevolveAxisVec(
            revolveAxis === 'centerline' ? 'Y' : revolveAxis as string,
            undefined,
          );
          const axisOriginVec = new THREE.Vector3(0, 0, 0);

          const toolBody = occRevolveWithInstance(
            occ.oc, sketchProfile,
            { origin: axisOriginVec, direction: axisVec },
            revolveAngles.primaryAngleRad,
            frame,
            { id: feature.id + '_tool', side2AngleRad: revolveAngles.side2AngleRad },
          );
          if (!toolBody) {
            set({ statusMessage: `Face revolve ${revolveOperation}: OCC revolve returned no body` });
            return;
          }

          const boolOp: OccBooleanOperation =
            revolveOperation === 'cut' ? 'subtract' :
            revolveOperation === 'intersect' ? 'intersect' : 'union';
          let resultBody;
          try {
            resultBody = performOccBooleanWithInstance(
              occ.oc, boolOp, targetBRepBody, toolBody,
              { id: feature.id, sourceFeatureId: feature.id },
            );
          } finally {
            toolBody.dispose();
          }

          if (!resultBody) {
            set({ statusMessage: `Face revolve ${revolveOperation}: OCC boolean returned no result` });
            return;
          }

          feature.mesh = createRegisteredOccMesh(occ.oc, resultBody, BODY_MATERIAL, feature.id);
          feature.bodyKind = 'solid';
          feature.params.targetFeatureId = target.id;
          feature.bodyId = target.bodyId;
          feature.componentId = target.componentId;
          const state = get();
          const updated = state.features.map((f) =>
            f.id === target.id ? { ...f, suppressed: true, visible: false } : f,
          );
          const angleDesc2 = revolveDirection === 'symmetric'
            ? `±${revolveAngle / 2}°`
            : `${revolveAngle}°`;
          set({
            features: [...updated, feature],
            designConfigurations: syncConfigurationSuppression(state, {
              [feature.id]: false,
              [target.id]: true,
            }),
            activeTool: 'select',
            ...REVOLVE_DEFAULTS,
            statusMessage: `Face revolve ${revolveOperation} with ${target.name} by ${angleDesc2} (${units})`,
          });
          return;
        } catch (err) {
          console.warn(`[commitRevolve] OCC face boolean path failed (${errorMessage(err, 'unknown')})`);
          set({ statusMessage: `Face revolve ${revolveOperation} failed in OCC: ${errorMessage(err, 'unknown')}` });
          return;
        }
      }

      get().pushUndo();
      set({
        features: [...features, feature],
        activeTool: 'select',
        ...REVOLVE_DEFAULTS,
        statusMessage: `Revolved face by ${angleDesc} around ${revolveAxis} (${units})${faceFallbackNote}`,
      });
      registerRevolveBody(feature, revolveOperation, revolveBodyKind, undefined);
      return;
    }

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
    // The stored angle is always the primary (or full) angle - the renderer uses revolveDirection.
    const sketchRevolveAngles = resolveRevolveAngles(revolveDirection, effectiveRevolveAngle, revolveAngle2);
    const primaryAngle = sketchRevolveAngles.primaryAngleDeg;
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
        set({ statusMessage: 'Spun Profile: no centerline found in sketch - add a centerline entity first' });
        return;
      }
      const p0 = clEntity.points[0];
      const p1 = clEntity.points[clEntity.points.length - 1];
      const dir = new THREE.Vector3(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z).normalize();
      centerlineAxisDirection = [dir.x, dir.y, dir.z];
      centerlineAxisOrigin = [p0.x, p0.y, p0.z];
      // Map to nearest standard axis for profile orientation metadata
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
      ? `±${revolveAngle / 2}°`
      : revolveDirection === 'two-sides'
        ? `${revolveAngle}°/${revolveAngle2}°`
        : `${revolveAngle}°`;

    // -- Boolean operation (join / cut / intersect) --
    // For non-new-body ops, run an OCC boolean against the chosen target body
    // and store the result on feature.mesh so the stored-mesh render path draws it.
    // new-body falls through unchanged.
    const sketchFallbackNote = '';
    if (revolveOperation && revolveOperation !== 'new-body' && revolveOperation !== 'new-component' && revolveBodyKind !== 'surface') {
      const target = pickMostRecentSolidTarget(features, { excludeType: 'revolve' });
      if (target) {
        // Revolve axis
        const axisVec = resolveRevolveAxisVec(resolvedAxisKey, centerlineAxisDirection);

        // ── OCC boolean path: used when the target was produced by the OCC pipeline ──
        const targetBrepBodyId = target.mesh instanceof THREE.Mesh
          ? (target.mesh.userData['brepBodyId'] as string | undefined)
          : undefined;
        const targetBRepBody = targetBrepBodyId ? globalBRepBodyRegistry.get(targetBrepBodyId) : undefined;
        if (targetBRepBody) {
          const occ = getOccSync();
          if (occ) {
            try {
              const shapes = GeometryEngine.sketchToProfileShapesFlat(sketch);
              const firstShape = shapes[0];
              if (firstShape) {
                const sketchProfile = makeRevolveSketchProfileFromShape(firstShape);
                const frame = createOccPlaneFrameFromSketch(sketch);
                const axisOriginVec = revolveAxisOriginVector(centerlineAxisOrigin);

                const toolBody = occRevolveWithInstance(
                  occ.oc, sketchProfile,
                  { origin: axisOriginVec, direction: axisVec },
                  sketchRevolveAngles.primaryAngleRad,
                  frame,
                  { id: feature.id + '_tool', side2AngleRad: sketchRevolveAngles.side2AngleRad },
                );

                const boolOp: OccBooleanOperation =
                  revolveOperation === 'cut' ? 'subtract' :
                  revolveOperation === 'intersect' ? 'intersect' : 'union';

                let resultBody;
                try {
                  resultBody = performOccBooleanWithInstance(
                    occ.oc, boolOp, targetBRepBody, toolBody,
                    { id: feature.id, sourceFeatureId: feature.id },
                  );
                } finally {
                  toolBody.dispose();
                }

                if (resultBody) {
                  feature.mesh = createRegisteredOccMesh(occ.oc, resultBody, BODY_MATERIAL, feature.id);
                  feature.bodyKind = 'solid';
                  feature.params.targetFeatureId = target.id;
                  feature.bodyId = target.bodyId;
                  feature.componentId = target.componentId;
                  const state = get();
                  const updated = state.features.map((f) =>
                    f.id === target.id ? { ...f, suppressed: true, visible: false } : f,
                  );
                  set({
                    features: [...updated, feature],
                    designConfigurations: syncConfigurationSuppression(state, {
                      [feature.id]: false,
                      [target.id]: true,
                    }),
                    activeTool: 'select',
                    ...REVOLVE_DEFAULTS,
                    statusMessage: `Revolve ${revolveOperation} with ${target.name} (${units})`,
                  });
                  return;
                }
              }
            } catch (err) {
              console.warn(`[commitRevolve] OCC boolean path failed (${errorMessage(err, 'unknown')})`);
            }
          }
        }

        if (!feature.mesh) {
          set({ statusMessage: `Revolve ${revolveOperation} requires an OCC-backed target body` });
          return;
        }
      } else {
        set({ statusMessage: `Revolve ${revolveOperation} requires a target body` });
        return;
      }
    }

    // OCC new-body path: build an exact BRep revolve (solid or open-shell surface).
    if (
      (revolveBodyKind === 'solid' || revolveBodyKind === 'surface') &&
      (!revolveOperation || revolveOperation === 'new-body')
    ) {
      const isSurface = revolveBodyKind === 'surface';
      const occ = getOccSync();
      if (!occ && !isSurface) {
        set({ statusMessage: 'Revolve requires OCC to be loaded' });
        return;
      }
      if (occ) {
        try {
          const shapes = GeometryEngine.sketchToProfileShapesFlat(sketch);
          const firstShape = shapes[0];
          if (firstShape) {
            const sketchProfile = makeRevolveSketchProfileFromShape(firstShape);
            const frame = createOccPlaneFrameFromSketch(sketch);
            const axisVec = resolveRevolveAxisVec(resolvedAxisKey, centerlineAxisDirection);
            const axisOriginVec = revolveAxisOriginVector(centerlineAxisOrigin);

            const occBody = occRevolveWithInstance(
              occ.oc,
              sketchProfile,
              { origin: axisOriginVec, direction: axisVec },
              sketchRevolveAngles.primaryAngleRad,
              frame,
              {
                id: feature.id,
                sourceFeatureId: feature.id,
                side2AngleRad: sketchRevolveAngles.side2AngleRad,
                surface: isSurface,
              },
            );

            feature.mesh = createRegisteredOccMesh(occ.oc, occBody, BODY_MATERIAL, feature.id);
          }
        } catch (err) {
          const message = errorMessage(err, 'unknown');
          console.warn(`[commitRevolve] OCC path failed (${message})`);
          if (!isSurface) {
            set({ statusMessage: `Revolve failed in OCC: ${message}` });
            return;
          }
          // Surface revolve: fall back to THREE mesh so the feature is visible
          const axisVec = resolveRevolveAxisVec(resolvedAxisKey, centerlineAxisDirection);
          feature.mesh = GeometryEngine.revolveSketch(sketch, sketchRevolveAngles.primaryAngleRad, axisVec) ?? undefined;
          set({ statusMessage: `Surface Revolve: OCC failed (${message}), using mesh fallback` });
        }
      }
    }

    set({
      features: [...features, feature],
      activeTool: 'select',
      ...REVOLVE_DEFAULTS,
      statusMessage: `Revolved ${sketch.name} by ${angleDesc} around ${revolveAxis === 'centerline' ? 'sketch centerline' : revolveAxis} (${units})${sketchFallbackNote}`,
    });
    registerRevolveBody(feature, revolveOperation, revolveBodyKind, sketch.componentId);
  },
  };
}

/** Register a browser body for a new-body / new-component revolve so it appears
 *  under "Bodies" (revolve sets features directly rather than via placeToolFeatureAsync). */
function registerRevolveBody(
  feature: Feature,
  operation: string | undefined,
  bodyKind: 'solid' | 'surface',
  sketchComponentId: string | undefined,
): void {
  if (operation && operation !== 'new-body' && operation !== 'new-component') return;
  if (!feature.mesh) return;
  const cs = useComponentStore.getState();
  let componentId = sketchComponentId ?? cs.activeComponentId ?? cs.rootComponentId;
  if (operation === 'new-component') {
    const parentId = cs.activeComponentId ?? cs.rootComponentId;
    componentId = cs.addComponent(parentId, `Component ${Object.keys(cs.components ?? {}).length + 1}`);
  }
  const bodyCount = Object.keys(cs.bodies).length + 1;
  const bodyId = cs.addBody(componentId, `${bodyKind === 'surface' ? 'Surface' : 'Body'} ${bodyCount}`);
  if (bodyId) {
    cs.addFeatureToBody(bodyId, feature.id);
    cs.setBodyMesh(bodyId, feature.mesh as THREE.Mesh);
  }
}
