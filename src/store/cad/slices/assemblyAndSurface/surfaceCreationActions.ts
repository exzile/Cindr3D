import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { getOccSync } from '../../../../engine/occ/loader';
import { occFillSurfaceWithInstance, type OccFillEdge, type FillContinuity } from '../../../../engine/occ/ops/fillSurface';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';

const SURFACE_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0x8899aa,
  metalness: 0.3,
  roughness: 0.4,
  side: THREE.DoubleSide,
});
SURFACE_MATERIAL.userData['shared'] = true;

function configureSurfaceMesh(geom: THREE.BufferGeometry) {
  const mesh = new THREE.Mesh(geom, SURFACE_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createSurfaceCreationActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    showFillDialog: false,
    fillBoundaryEdgeIds: [],
    fillBoundaryEdgeData: [],
    openFillDialog: () =>
      set({ activeDialog: 'fill', showFillDialog: true, fillBoundaryEdgeIds: [], fillBoundaryEdgeData: [] }),
    addFillBoundaryEdge: (id, a, b) =>
      set((s) => {
        if (s.fillBoundaryEdgeIds.includes(id)) return s;
        return {
          fillBoundaryEdgeIds: [...s.fillBoundaryEdgeIds, id],
          fillBoundaryEdgeData: a && b ? [...s.fillBoundaryEdgeData, { id, a, b }] : s.fillBoundaryEdgeData,
        };
      }),
    closeFillDialog: () =>
      set({ activeDialog: null, showFillDialog: false, fillBoundaryEdgeIds: [], fillBoundaryEdgeData: [] }),
    commitFill: (params) => {
      get().pushUndo();
      const { features, fillBoundaryEdgeData } = get();
      const n = features.filter((f) => f.params?.featureKind === 'fill').length + 1;
      const TOL = 1e-4;
      const eq = (p: [number, number, number], q: [number, number, number]) =>
        Math.abs(p[0] - q[0]) < TOL && Math.abs(p[1] - q[1]) < TOL && Math.abs(p[2] - q[2]) < TOL;
      const buildLoop = (edges: Array<{ id: string; a: [number, number, number]; b: [number, number, number] }>) => {
        if (edges.length === 0) return [] as THREE.Vector3[];
        const remaining = [...edges];
        const first = remaining.shift()!;
        const chain: [number, number, number][] = [first.a, first.b];
        while (remaining.length > 0) {
          const tail = chain[chain.length - 1];
          const idx = remaining.findIndex((e) => eq(e.a, tail) || eq(e.b, tail));
          if (idx < 0) break;
          const next = remaining.splice(idx, 1)[0];
          chain.push(eq(next.a, tail) ? next.b : next.a);
        }
        return chain.map(([x, y, z]) => new THREE.Vector3(x, y, z));
      };

      const loop = buildLoop(fillBoundaryEdgeData);
      const fallbackLoop = [
        new THREE.Vector3(-5, 0, -5),
        new THREE.Vector3(5, 0, -5),
        new THREE.Vector3(5, 0, 5),
        new THREE.Vector3(-5, 0, 5),
      ];
      const boundaryLoop = loop.length >= 3 ? loop : fallbackLoop;

      // Build per-edge OCC constraints (used by BRepOffsetAPI_MakeFilling for G1/G2).
      const continuityPerEdge: FillContinuity[] = params.continuityPerEdge.length > 0
        ? params.continuityPerEdge
        : (['G0'] as FillContinuity[]);

      // Try OCC BRep face first (planar → MakeFace; non-planar → MakeFilling).
      const featureId = crypto.randomUUID();
      let mesh: THREE.Mesh | undefined;
      const occ = getOccSync();
      if (occ) {
        try {
          // MakeFilling currently consumes continuity order only. True adjacent-face
          // constraints need a future API that passes OCC edge/face pairs explicitly.
          const edgeConstraints: OccFillEdge[] = fillBoundaryEdgeData.map((_, i) => {
            const continuity = continuityPerEdge[i] ?? 'G0';
            return { continuity };
          });

          const body = occFillSurfaceWithInstance(occ.oc, boundaryLoop, {
            sourceFeatureId: featureId,
            edgeConstraints: edgeConstraints.length > 0 ? edgeConstraints : undefined,
          });
          if (body) mesh = createRegisteredOccMesh(occ.oc, body, BODY_MATERIAL, featureId);
        } catch (err) {
          console.warn('[commitFill] OCC fill failed, using THREE fallback:', err);
        }
      }
      if (!mesh) {
        const continuity = params.continuityPerEdge;
        const geom = GeometryEngine.fillSurface([boundaryLoop], continuity.length > 0 ? continuity : ['G0']);
        mesh = configureSurfaceMesh(geom);
      }

      const feature: Feature = {
        id: featureId,
        name: `Fill ${n}`,
        type: 'thicken',
        params: {
          featureKind: 'fill',
          boundaryEdgeCount: params.boundaryEdgeCount,
          continuityPerEdge: params.continuityPerEdge,
          operation: params.operation,
        },
        mesh,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: 'surface',
      };
      get().addFeature(feature);
      set({ activeDialog: null, showFillDialog: false, fillBoundaryEdgeIds: [], fillBoundaryEdgeData: [] });
      get().setStatusMessage(`Fill ${n} created`);
    },

    showOffsetCurveDialog: false,
    openOffsetCurveDialog: () => set({ activeDialog: 'offset-curve', showOffsetCurveDialog: true }),
    closeOffsetCurveDialog: () => set({ activeDialog: null, showOffsetCurveDialog: false }),
    commitOffsetCurve: (params) => {
      const { sketches, features } = get();
      const n = features.filter((f) => f.params?.featureKind === 'offset-curve').length + 1;
      let geom: THREE.BufferGeometry;
      const sketch = params.sketchId ? sketches.find((s) => s.id === params.sketchId) : null;
      if (sketch && sketch.entities.length > 0) {
        // Collect all entity points across all entities in order
        const pts = sketch.entities.flatMap((e) => e.points.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
        const normal = sketch.planeNormal.clone().normalize();
        const dir = params.direction === 'flip' ? normal.clone().negate() : normal;
        geom = GeometryEngine.offsetCurveToSurface(pts, params.distance, dir);
      } else {
        geom = GeometryEngine.offsetCurveToSurface(
          [new THREE.Vector3(-5, 0, 0), new THREE.Vector3(5, 0, 0)],
          params.distance,
          new THREE.Vector3(0, 1, 0),
        );
      }

      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Offset Curve ${n}`,
        type: 'sweep',
        sketchId: params.sketchId ?? undefined,
        params: { featureKind: 'offset-curve', distance: params.distance, direction: params.direction },
        mesh: configureSurfaceMesh(geom),
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: 'surface',
      };
      get().addFeature(feature);
      set({ activeDialog: null, showOffsetCurveDialog: false });
      get().setStatusMessage(`Offset Curve ${n} created`);
    },

    showSurfaceMergeDialog: false,
    surfaceMergeFace1Id: null,
    surfaceMergeFace2Id: null,
    openSurfaceMergeDialog: () =>
      set({
        activeDialog: 'surface-merge',
        showSurfaceMergeDialog: true,
        surfaceMergeFace1Id: null,
        surfaceMergeFace2Id: null,
      }),
    setSurfaceMergeFace1: (id) => set({ surfaceMergeFace1Id: id }),
    setSurfaceMergeFace2: (id) => set({ surfaceMergeFace2Id: id }),
    closeSurfaceMergeDialog: () =>
      set({
        activeDialog: null,
        showSurfaceMergeDialog: false,
        surfaceMergeFace1Id: null,
        surfaceMergeFace2Id: null,
      }),
    commitSurfaceMerge: (params) => {
      const { features } = get();
      const n = features.filter((f) => f.params?.featureKind === 'surface-merge').length + 1;
      const findMeshByFaceId = (faceId: string) => {
        for (const f of features) {
          if (f.mesh && (f.mesh as THREE.Object3D).userData?.faceId === faceId) return f.mesh as THREE.Mesh;
        }
        return null;
      };

      const meshA = params.face1Id ? findMeshByFaceId(params.face1Id) : null;
      const meshB = params.face2Id ? findMeshByFaceId(params.face2Id) : null;
      const mesh = meshA && meshB ? configureSurfaceMesh(GeometryEngine.mergeSurfaces(meshA, meshB)) : undefined;

      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Surface Merge ${n}`,
        type: 'thicken',
        params: { featureKind: 'surface-merge', face1Id: params.face1Id ?? '', face2Id: params.face2Id ?? '' },
        mesh,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: 'surface',
      };
      get().addFeature(feature);
      set({
        activeDialog: null,
        showSurfaceMergeDialog: false,
        surfaceMergeFace1Id: null,
        surfaceMergeFace2Id: null,
      });
      get().setStatusMessage(`Surface Merge ${n} created`);
    },

    showSurfacePrimitivesDialog: false,
    openSurfacePrimitivesDialog: () => set({ activeDialog: 'surface-primitives', showSurfacePrimitivesDialog: true }),
    closeSurfacePrimitivesDialog: () => set({ activeDialog: null, showSurfacePrimitivesDialog: false }),
    commitSurfacePrimitive: (params) => {
      const { features } = get();
      const n = features.filter((f) => f.params?.featureKind === 'surface-primitive').length + 1;
      const geom = GeometryEngine.createSurfacePrimitive(params.type, {
        width: params.width ?? 10,
        height: params.height ?? 10,
        depth: params.depth ?? 10,
        radius: params.radius ?? 5,
        height2: params.height2 ?? 10,
        tube: params.tube ?? 2,
      });
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Surface ${params.type.charAt(0).toUpperCase() + params.type.slice(1)} ${n}`,
        type: 'primitive',
        params: { featureKind: 'surface-primitive', ...params },
        mesh: configureSurfaceMesh(geom),
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: 'surface',
      };
      get().addFeature(feature);
      set({ activeDialog: null, showSurfacePrimitivesDialog: false });
      get().setStatusMessage(`Surface ${params.type} primitive created`);
    },
  };
}
