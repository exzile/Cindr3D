import * as THREE from 'three';
import type { Feature } from '../../../../../types/cad';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import { useComponentStore } from '../../../../componentStore';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { errorMessage } from '../../../../../utils/errorHandling';
import { getOccSync } from '../../../../../engine/occ/loader';
import { occSphereWithInstance } from '../../../../../engine/occ/ops/sphere';
import { occTorusWithInstance } from '../../../../../engine/occ/ops/torus';
import { occBoxWithInstance } from '../../../../../engine/occ/ops/box';
import { occCylinderWithInstance } from '../../../../../engine/occ/ops/cylinder';
import { occCoilWithInstance } from '../../../../../engine/occ/ops/helix';
import { createRegisteredOccMesh } from '../../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL, FASTENER_MATERIAL } from '../../../../../components/viewport/scene/bodyMaterial';
import { globalBRepBodyRegistry } from '../../../../../engine/occ/globalRegistry';
import {
  placeToolFeatureAsync,
  disposeUnplacedToolMesh,
  toolPlacementFailedMessage,
  type BodyBooleanOp,
} from '../bodyBoolean';

/** World placement matrix (translation + XYZ-Euler rotation) from primitive params. */
function composePlacement(params: Record<string, number | string>): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3((params.x as number) || 0, (params.y as number) || 0, (params.z as number) || 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad((params.rx as number) || 0),
      THREE.MathUtils.degToRad((params.ry as number) || 0),
      THREE.MathUtils.degToRad((params.rz as number) || 0),
    )),
    new THREE.Vector3(1, 1, 1),
  );
}

/**
 * Build an OCC-backed, world-placed mesh for a box/cylinder so it can serve as a
 * boolean tool body (sphere/torus already build theirs at add-time). The bake-in
 * transforms mirror PrimitiveBodies.buildPrimitiveSpec so the tool body sits
 * exactly where the primitive would render. Returns null for tapered cylinders
 * (BRepPrimAPI_MakeCylinder has no taper — those can't be OCC-booleaned).
 */
function buildPlacedBoxOrCylinderMesh(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  kind: 'box' | 'cylinder',
  params: Record<string, number | string>,
  featureId: string,
): THREE.Mesh | null {
  const place = composePlacement(params);
  if (kind === 'box') {
    const w = (params.width as number) || 20;
    const h = (params.height as number) || 20;
    const d = (params.depth as number) || 20;
    const transform = place.multiply(new THREE.Matrix4().makeTranslation(-w / 2, -h / 2, -d / 2));
    const body = occBoxWithInstance(oc, w, h, d, { transform, sourceFeatureId: featureId });
    return createRegisteredOccMesh(oc, body, BODY_MATERIAL, featureId);
  }
  const radius = (params.radius as number) || 10;
  const radiusTop = (params.radiusTop as number) ?? radius;
  const height = (params.height as number) || 20;
  if (Math.abs(radius - radiusTop) > 1e-6) return null; // tapered cylinder: no OCC boolean
  const local = new THREE.Matrix4().makeTranslation(0, -height / 2, 0)
    .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  const transform = place.multiply(local);
  const body = occCylinderWithInstance(oc, radius, height, { transform, sourceFeatureId: featureId });
  return createRegisteredOccMesh(oc, body, BODY_MATERIAL, featureId);
}

export function createPrimitiveFeatureActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  addPrimitive: async (kind, params) => {
    const label =
      kind === 'box' ? 'Box' :
      kind === 'cylinder' ? 'Cylinder' :
      kind === 'sphere' ? 'Sphere' :
      kind === 'coil' ? 'Coil' :
      'Torus';

    const operation = (params.operation as string) || 'new-body';
    const needsBoolean = operation === 'join' || operation === 'cut' || operation === 'intersect';

    const featureId = crypto.randomUUID();

    // For coil we pre-build the mesh so PrimitiveBodies doesn't need to handle it
    let mesh: Feature['mesh'] | undefined;
    if (kind === 'coil') {
      const outerRadius = (params.outerRadius as number) || 15;
      const wireRadius  = (params.wireRadius  as number) || 2;
      const pitch       = (params.pitch       as number) || 10;
      const turns       = (params.turns       as number) || 5;

      // ── OCC-15.5: Try OCC helical sweep ──────────────────────────────────
      const occ = getOccSync();
      if (occ) {
        try {
          const body = occCoilWithInstance(occ.oc, outerRadius, wireRadius, pitch, turns, {
            sourceFeatureId: featureId,
          });
          const m = createRegisteredOccMesh(occ.oc, body, BODY_MATERIAL, featureId);
          m.castShadow = true;
          m.receiveShadow = true;
          mesh = m;
        } catch (err) {
          console.warn(`[addPrimitive coil] OCC path failed (${errorMessage(err, 'unknown')}), falling back to mesh`);
        }
      }

      // ── THREE mesh fallback ───────────────────────────────────────────────
      if (!mesh) {
        const geom = GeometryEngine.coilGeometry(outerRadius, wireRadius, pitch, turns);
        const m = new THREE.Mesh(geom, BODY_MATERIAL);
        m.castShadow = true;
        m.receiveShadow = true;
        mesh = m;
      }
    }
    if (kind === 'sphere' || kind === 'torus') {
      const occ = getOccSync();
      if (!occ) {
        set({ statusMessage: `${label}: OCC kernel is still loading; try again in a moment` });
        return;
      }
      try {
        const transform = new THREE.Matrix4().compose(
          new THREE.Vector3(
            (params.x as number) || 0,
            (params.y as number) || 0,
            (params.z as number) || 0,
          ),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              THREE.MathUtils.degToRad((params.rx as number) || 0),
              THREE.MathUtils.degToRad((params.ry as number) || 0),
              THREE.MathUtils.degToRad((params.rz as number) || 0),
            ),
          ),
          new THREE.Vector3(1, 1, 1),
        );
        const body = kind === 'sphere'
          ? occSphereWithInstance(occ.oc, (params.radius as number) || 10, {
              sourceFeatureId: featureId,
              transform,
            })
          : occTorusWithInstance(
              occ.oc,
              (params.radius as number) || 15,
              (params.tubeRadius as number) || 3,
              { sourceFeatureId: featureId, transform },
            );
        mesh = createRegisteredOccMesh(occ.oc, body, BODY_MATERIAL, featureId);
      } catch (err) {
        set({
          statusMessage: `${label}: OCC body creation failed (${errorMessage(err, 'unknown OCC error')})`,
        });
        return;
      }
    }

    // Boolean operations need an OCC-backed tool body up front. Sphere/torus
    // already built theirs above; build box/cylinder here.
    if (needsBoolean && (kind === 'box' || kind === 'cylinder')) {
      const occ = getOccSync();
      if (!occ) {
        set({ statusMessage: `${label}: OCC kernel is still loading; try again in a moment` });
        return;
      }
      try {
        const placed = buildPlacedBoxOrCylinderMesh(occ.oc, kind, params, featureId);
        if (!placed) {
          set({ statusMessage: `${label}: tapered cylinders can't ${operation} — use New Body` });
          return;
        }
        placed.castShadow = true;
        placed.receiveShadow = true;
        mesh = placed;
      } catch (err) {
        set({ statusMessage: `${label}: OCC body creation failed (${errorMessage(err, 'unknown OCC error')})` });
        return;
      }
    }

    // new-component: create a fresh component and drop the primitive into it.
    let componentId: string | undefined;
    if (operation === 'new-component') {
      const componentStore = useComponentStore.getState();
      const parentId = componentStore.activeComponentId ?? componentStore.rootComponentId;
      componentId = componentStore.addComponent(parentId, `${label} Component`);
    }

    const count = get().features.filter((f) => f.type === 'primitive').length + 1;
    const feature: Feature = {
      id: featureId,
      name: `${label} ${count}`,
      type: 'primitive',
      params: { kind, ...params },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      ...(mesh ? { mesh } : {}),
      ...(componentId ? { componentId } : {}),
    };

    // Join/Cut/Intersect: run the OCC boolean against the most-recent solid body.
    if (needsBoolean && mesh instanceof THREE.Mesh) {
      const result = await placeToolFeatureAsync(get(), feature, operation as BodyBooleanOp);
      if (!result.ok) {
        disposeUnplacedToolMesh(mesh);
        set({ statusMessage: toolPlacementFailedMessage(label, result.note) });
        return;
      }
      get().pushUndo();
      set({
        features: result.features,
        designConfigurations: result.designConfigurations,
        statusMessage: `${label} ${operation}${result.note}`,
      });
      return;
    }

    set((state) => ({
      features: [...state.features, feature],
      statusMessage: operation === 'new-component'
        ? `${label} added to new component`
        : `${label} added`,
    }));
  },

  updatePrimitiveParams: (featureId, newParams) => {
    const { features } = get();
    const existing = features.find((f) => f.id === featureId && f.type === 'primitive');
    if (!existing) return;
    get().pushUndo();
    // Dispose any pre-built OCC mesh (sphere/torus) so PrimitiveBodies rebuilds from new params
    const oldMesh = existing.mesh;
    if (oldMesh) {
      const oldBodyId = (oldMesh as THREE.Mesh).userData?.['brepBodyId'] as string | undefined;
      if (oldBodyId) globalBRepBodyRegistry.delete(oldBodyId);
      if (oldMesh instanceof THREE.Mesh) oldMesh.geometry?.dispose();
    }
    set({
      features: features.map((f) =>
        f.id === featureId ? { ...f, params: { ...f.params, ...newParams }, mesh: undefined } : f,
      ),
      statusMessage: 'Primitive updated',
    });
  },

  primitivePreviewParams: null,
  setPrimitivePreview: (spec) => set({ primitivePreviewParams: spec }),

  insertFastener: (params) => {
    get().pushUndo();
    const { features, units } = get();
    const componentStore = useComponentStore.getState();
    const { rootComponentId } = componentStore;
    const scale = units === 'in' ? 1 / 25.4 : 1;
    const d = params.diameter * scale;
    const hd = params.headDiameter * scale;
    const hh = params.headHeight * scale;
    const len = params.length * scale;

    const group = new THREE.Group();

    const isNut = params.type === 'hex-nut';
    const isWasher = params.type === 'washer';

    if (!isNut && !isWasher) {
      const shankGeo = new THREE.CylinderGeometry(d / 2, d / 2, len, 16);
      const shankMesh = new THREE.Mesh(shankGeo, FASTENER_MATERIAL);
      shankMesh.position.y = -len / 2;
      group.add(shankMesh);
    }

    const headSegs = (params.type === 'hex-bolt' || params.type === 'hex-nut') ? 6 : 16;
    const headGeo = new THREE.CylinderGeometry(hd / 2, hd / 2, hh, headSegs);
    const headMesh = new THREE.Mesh(headGeo, FASTENER_MATERIAL);

    if (isNut || isWasher) {
      headMesh.position.y = 0;
    } else if (params.type === 'flat-head') {
      headMesh.position.y = -hh / 2;
    } else {
      headMesh.position.y = hh / 2;
    }
    group.add(headMesh);

    group.position.set(params.x * scale, params.y * scale, params.z * scale);

    const featureId = crypto.randomUUID();
    const bodyId = componentStore.addBody(rootComponentId, `${params.size} ${params.type}`);
    if (bodyId) {
      componentStore.addFeatureToBody(bodyId, featureId);
    }
    const feature: Feature = {
      id: featureId,
      name: `${params.size} ${params.type.replace(/-/g, ' ')}`,
      type: 'fastener',
      params: { ...params } as unknown as Record<string, number | string | boolean | number[]>,
      mesh: group,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'brep',
    };
    set({ features: [...features, feature], statusMessage: `${params.size} ${params.type} inserted` });
  },
  };
}