import type { Body, Component, ConstructionGeometry, Feature, FeatureGroup, Joint, Sketch } from "../../../../types/cad";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import {
  deserializeFeature,
  deserializeSketch,
  mergeActiveSketchForPersistence,
  serializeFeature,
  shouldPersistActiveSketch,
} from "../../persistence";
import { useComponentStore } from "../../../componentStore";
import { createRootComponent, defaultComponentMaterial } from "../../../component/defaults";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import { clearFeatureEvaluationCache } from "../../../../engine/occ/featureEvaluator";
import { bodyGeometryCache, bodyIdGeometryCache } from "../../../meshRegistry";
import { detachTessellationFromMesh } from "../../../../engine/occ/picking";
import * as THREE from "three";

type SerializableComponent = Omit<Component, "transform"> & { transform: number[] };
type SerializableBody = Omit<Body, "mesh"> & { mesh: null };
type SerializableJoint = Omit<Joint, "origin" | "axis"> & {
  origin: { x: number; y: number; z: number } | number[];
  axis?: { x: number; y: number; z: number } | number[];
};
type SerializableVector3 = { x: number; y: number; z: number } | number[];
type SerializableConstructionGeometry = Omit<
  ConstructionGeometry,
  "planeNormal" | "planeOrigin" | "axisDirection" | "axisOrigin" | "point"
> & {
  planeNormal?: SerializableVector3;
  planeOrigin?: SerializableVector3;
  axisDirection?: SerializableVector3;
  axisOrigin?: SerializableVector3;
  point?: SerializableVector3;
};
type SerializableSketch = Omit<Sketch, "planeNormal" | "planeOrigin"> & {
  planeNormal: [number, number, number] | null;
  planeOrigin: [number, number, number] | null;
};

type DesignDocumentSnapshot = {
  features: Feature[];
  sketches: SerializableSketch[];
  activeSketch?: SerializableSketch | null;
  featureGroups?: FeatureGroup[];
  historyEnabled?: boolean;
  designConfigurations?: CADState["designConfigurations"];
  activeDesignConfigurationId?: string;
  parameters?: CADState["parameters"];
  constructionPlanes?: CADState["constructionPlanes"];
  constructionAxes?: CADState["constructionAxes"];
  constructionPoints?: CADState["constructionPoints"];
  jointOrigins?: CADState["jointOrigins"];
  contactSets?: CADState["contactSets"];
  selectionSets?: CADState["selectionSets"];
  canvasReferences?: CADState["canvasReferences"];
  formBodies?: CADState["formBodies"];
  frozenFormVertices?: CADState["frozenFormVertices"];
  units?: CADState["units"];
};

type ComponentDocumentSnapshot = {
  rootComponentId: string;
  activeComponentId: string | null;
  selectedBodyId: string | null;
  components: Record<string, SerializableComponent>;
  bodies: Record<string, SerializableBody>;
  constructions?: Record<string, SerializableConstructionGeometry>;
  joints?: Record<string, SerializableJoint>;
  rigidGroups?: ReturnType<typeof useComponentStore.getState>["rigidGroups"];
  motionLinks?: ReturnType<typeof useComponentStore.getState>["motionLinks"];
  animationTracks?: ReturnType<typeof useComponentStore.getState>["animationTracks"];
  animationDuration?: number;
  animationLoop?: boolean;
  occurrences?: Record<
    string,
    Omit<ReturnType<typeof useComponentStore.getState>["occurrences"][string], "transform"> & { transform: number[] }
  >;
  definitions?: ReturnType<typeof useComponentStore.getState>["definitions"];
  componentConstraints?: ReturnType<typeof useComponentStore.getState>["componentConstraints"];
  explodedOffsets?: Record<string, { x: number; y: number; z: number } | number[]>;
};

type DesignFileSnapshot = {
  version: 2;
  document: DesignDocumentSnapshot;
  componentStore: ComponentDocumentSnapshot;
};

const BASE_DESIGN_CONFIGURATION_ID = "default";

const createDefaultDesignConfigurations = (): CADState["designConfigurations"] => [{
  id: BASE_DESIGN_CONFIGURATION_ID,
  name: "Default",
  featureSuppression: {},
  parametricParameters: {},
  updatedAt: Date.now(),
}];

const disposeFeatureObjectGeometry = (mesh: Feature["mesh"] | undefined) => {
  if (!mesh) return;
  const disposeMaterial = (
    material: THREE.Material | THREE.Material[] | null | undefined,
  ) => {
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const entry of materials) {
      if (entry.userData?.shared) continue;
      entry.dispose();
    }
  };
  const disposeObject = (object: THREE.Object3D) => {
    const maybeRenderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    maybeRenderable.geometry?.dispose();
    disposeMaterial(maybeRenderable.material);
    if (object instanceof THREE.Mesh) detachTessellationFromMesh(object);
  };
  (mesh as unknown as THREE.Object3D).traverse(disposeObject);
};

const clearDocumentRuntimeCaches = () => {
  for (const geo of bodyGeometryCache.values()) geo.dispose();
  bodyGeometryCache.clear();
  for (const geo of bodyIdGeometryCache.values()) geo.dispose();
  bodyIdGeometryCache.clear();
  globalBRepBodyRegistry.clear();
  clearFeatureEvaluationCache();
};

const serializeSketchForDesignFile = (sketch: Sketch): SerializableSketch => ({
  ...sketch,
  planeNormal: sketch.planeNormal
    ? [sketch.planeNormal.x, sketch.planeNormal.y, sketch.planeNormal.z] as [number, number, number]
    : null,
  planeOrigin: sketch.planeOrigin
    ? [sketch.planeOrigin.x, sketch.planeOrigin.y, sketch.planeOrigin.z] as [number, number, number]
    : null,
});

const serializeVector = (value: unknown): SerializableVector3 | undefined => {
  if (value instanceof THREE.Vector3) return { x: value.x, y: value.y, z: value.z };
  if (Array.isArray(value)) return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  if (value && typeof value === "object") {
    const vector = value as { x?: number; y?: number; z?: number };
    return { x: Number(vector.x) || 0, y: Number(vector.y) || 0, z: Number(vector.z) || 0 };
  }
  return undefined;
};

const serializeConstructionGeometry = (
  construction: ConstructionGeometry,
): SerializableConstructionGeometry => ({
  ...construction,
  planeNormal: serializeVector(construction.planeNormal),
  planeOrigin: serializeVector(construction.planeOrigin),
  axisDirection: serializeVector(construction.axisDirection),
  axisOrigin: serializeVector(construction.axisOrigin),
  point: serializeVector(construction.point),
});

const serializeComponentDocumentSnapshot = (): ComponentDocumentSnapshot => {
  const componentState = useComponentStore.getState();
  return {
    rootComponentId: componentState.rootComponentId,
    activeComponentId: componentState.activeComponentId,
    selectedBodyId: componentState.selectedBodyId,
    components: Object.fromEntries(
      Object.entries(componentState.components).map(([id, component]) => [
        id,
        {
          ...component,
          transform: component.transform instanceof THREE.Matrix4
            ? component.transform.toArray()
            : component.transform,
        },
      ]),
    ) as Record<string, SerializableComponent>,
    bodies: Object.fromEntries(
      Object.entries(componentState.bodies).map(([id, body]) => [
        id,
        { ...body, mesh: null },
      ]),
    ) as Record<string, SerializableBody>,
    constructions: Object.fromEntries(
      Object.entries(componentState.constructions).map(([id, construction]) => [
        id,
        serializeConstructionGeometry(construction),
      ]),
    ) as Record<string, SerializableConstructionGeometry>,
    joints: Object.fromEntries(
      Object.entries(componentState.joints).map(([id, joint]) => [
        id,
        {
          ...joint,
          origin: joint.origin instanceof THREE.Vector3
            ? { x: joint.origin.x, y: joint.origin.y, z: joint.origin.z }
            : joint.origin,
          axis: joint.axis instanceof THREE.Vector3
            ? { x: joint.axis.x, y: joint.axis.y, z: joint.axis.z }
            : joint.axis,
        },
      ]),
    ) as Record<string, SerializableJoint>,
    rigidGroups: componentState.rigidGroups,
    motionLinks: componentState.motionLinks,
    animationTracks: componentState.animationTracks,
    animationDuration: componentState.animationDuration,
    animationLoop: componentState.animationLoop,
    occurrences: Object.fromEntries(
      Object.entries(componentState.occurrences).map(([id, occurrence]) => [
        id,
        {
          ...occurrence,
          transform: occurrence.transform instanceof THREE.Matrix4
            ? occurrence.transform.toArray()
            : occurrence.transform,
        },
      ]),
    ) as ComponentDocumentSnapshot["occurrences"],
    definitions: componentState.definitions,
    componentConstraints: componentState.componentConstraints,
    explodedOffsets: Object.fromEntries(
      Object.entries(componentState.explodedOffsets).map(([id, value]) => [
        id,
        value instanceof THREE.Vector3
          ? { x: value.x, y: value.y, z: value.z }
          : value,
      ]),
    ),
  };
};

const vectorFromSerializable = (value: unknown): THREE.Vector3 => {
  if (value instanceof THREE.Vector3) return value;
  if (Array.isArray(value)) {
    return new THREE.Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
  }
  if (value && typeof value === "object") {
    const vector = value as { x?: number; y?: number; z?: number };
    return new THREE.Vector3(Number(vector.x) || 0, Number(vector.y) || 0, Number(vector.z) || 0);
  }
  return new THREE.Vector3();
};

const matrixFromSerializable = (value: unknown): THREE.Matrix4 => (
  Array.isArray(value) && value.length === 16
    ? new THREE.Matrix4().fromArray(value.map((entry) => Number(entry) || 0))
    : new THREE.Matrix4()
);

const restoreConstructionGeometry = (
  construction: SerializableConstructionGeometry,
): ConstructionGeometry => ({
  ...construction,
  planeNormal: construction.planeNormal ? vectorFromSerializable(construction.planeNormal) : undefined,
  planeOrigin: construction.planeOrigin ? vectorFromSerializable(construction.planeOrigin) : undefined,
  axisDirection: construction.axisDirection ? vectorFromSerializable(construction.axisDirection) : undefined,
  axisOrigin: construction.axisOrigin ? vectorFromSerializable(construction.axisOrigin) : undefined,
  point: construction.point ? vectorFromSerializable(construction.point) : undefined,
});

const restoreComponentDocumentSnapshot = (
  snapshot: ComponentDocumentSnapshot,
): void => {
  const components = Object.fromEntries(
    Object.entries(snapshot.components).map(([id, component]) => [
      id,
      {
        ...component,
        transform: matrixFromSerializable(component.transform),
      },
    ]),
  ) as ReturnType<typeof useComponentStore.getState>["components"];
  const occurrences = Object.fromEntries(
    Object.entries(snapshot.occurrences ?? {}).map(([id, occurrence]) => [
      id,
      {
        ...occurrence,
        transform: matrixFromSerializable(occurrence.transform),
      },
    ]),
  ) as ReturnType<typeof useComponentStore.getState>["occurrences"];
  const joints = Object.fromEntries(
    Object.entries(snapshot.joints ?? {}).map(([id, joint]) => [
      id,
      {
        ...joint,
        origin: vectorFromSerializable(joint.origin),
        axis: joint.axis ? vectorFromSerializable(joint.axis) : undefined,
      },
    ]),
  ) as ReturnType<typeof useComponentStore.getState>["joints"];
  const explodedOffsets = Object.fromEntries(
    Object.entries(snapshot.explodedOffsets ?? {}).map(([id, value]) => [
      id,
      vectorFromSerializable(value),
    ]),
  );
  const constructions = Object.fromEntries(
    Object.entries(snapshot.constructions ?? {}).map(([id, construction]) => [
      id,
      restoreConstructionGeometry(construction),
    ]),
  ) as ReturnType<typeof useComponentStore.getState>["constructions"];

  useComponentStore.setState({
    rootComponentId: snapshot.rootComponentId,
    activeComponentId: snapshot.activeComponentId ?? snapshot.rootComponentId,
    selectedBodyId: snapshot.selectedBodyId ?? null,
    components,
    bodies: Object.fromEntries(
      Object.entries(snapshot.bodies).map(([id, body]) => [id, { ...body, mesh: null }]),
    ) as ReturnType<typeof useComponentStore.getState>["bodies"],
    constructions,
    joints,
    rigidGroups: snapshot.rigidGroups ?? [],
    motionLinks: snapshot.motionLinks ?? [],
    animationTracks: snapshot.animationTracks ?? [],
    animationDuration: snapshot.animationDuration ?? useComponentStore.getState().animationDuration,
    animationLoop: snapshot.animationLoop ?? useComponentStore.getState().animationLoop,
    occurrences,
    definitions: snapshot.definitions ?? {},
    componentConstraints: snapshot.componentConstraints ?? [],
    explodedOffsets,
    expandedIds: new Set([snapshot.rootComponentId]),
  });
};

const resetComponentDocumentForFeatures = (features: Feature[]): void => {
  const rootComponentId = crypto.randomUUID();
  const root: Component = createRootComponent(rootComponentId);
  const bodies: Record<string, Body> = {};
  root.bodyIds = [];
  for (const feature of features) {
    if (!feature.bodyId || feature.suppressed) continue;
    if (bodies[feature.bodyId]) {
      if (!bodies[feature.bodyId].featureIds.includes(feature.id)) bodies[feature.bodyId].featureIds.push(feature.id);
      continue;
    }
    bodies[feature.bodyId] = {
      id: feature.bodyId,
      name: feature.name || `Body ${root.bodyIds.length + 1}`,
      componentId: rootComponentId,
      mesh: null,
      visible: feature.visible !== false,
      material: defaultComponentMaterial,
      featureIds: [feature.id],
      bodyKind: feature.bodyKind === "mesh" ? "mesh" : "brep",
    };
    root.bodyIds.push(feature.bodyId);
  }

  useComponentStore.setState({
    rootComponentId,
    activeComponentId: rootComponentId,
    selectedBodyId: null,
    components: { [rootComponentId]: root },
    bodies,
    constructions: {},
    joints: {},
    componentConstraints: [],
    rigidGroups: [],
    motionLinks: [],
    animationTracks: [],
    occurrences: {},
    definitions: {},
    explodedOffsets: {},
    expandedIds: new Set([rootComponentId]),
  });
};

const createDocumentTransientReset = (): Partial<CADState> => ({
  activeTool: "select",
  activeDialog: null,
  dialogPayload: null,
  selectedEntityIds: [],
  selectedFeatureId: null,
  editingFeatureId: null,
  sketchPlaneSelecting: false,
  rollbackIndex: -1,
  baseFeatureActive: false,

  selectionMode: "normal",
  windowSelecting: false,
  windowSelectStart: null,
  windowSelectEnd: null,
  lassoSelecting: false,
  lassoPoints: [],

  constraintSelection: [],
  constraintSurfacePlane: null,
  pendingDimensionEntityIds: [],
  dimensionHoverEntityId: null,
  dimensionPreview: null,
  pendingNewDimensionId: null,
  sketchDimEditId: null,
  sketchDimEditIsNew: false,
  sketchDimEditValue: "",
  sketchDimEditTypeahead: [],
  pendingOverConstraint: null,
  editingSplineEntityId: null,
  hoveredSplinePointIndex: null,
  draggingSplinePointIndex: null,
  sketchEditingArcId: null,
  sketch3DActivePlane: null,

  activeFormBodyId: null,
  formSelection: null,

  extrudeSelectedSketchId: null,
  extrudeSelectedSketchIds: [],
  extrudeStartEntityId: null,
  extrudeStartFaceNormal: null,
  extrudeStartFaceCentroid: null,
  extrudeToEntityFaceId: null,
  extrudeToEntityFaceNormal: null,
  extrudeToEntityFaceCentroid: null,
  extrudeParticipantBodyIds: [],
  extrudeConfinedFaceIds: [],
  extrudeCreationOccurrence: null,
  extrudeTargetBaseFeature: null,
  revolveSelectedSketchId: null,
  revolveFaceBoundary: null,
  revolveFaceNormal: null,
  sweepProfileSketchId: null,
  sweepPathSketchId: null,
  sweepGuideRailId: null,
  loftProfileSketchIds: [],
  loftRailSketchId: null,
  patchSelectedSketchId: null,
  ruledSketchAId: null,
  ruledSketchBId: null,
  ruledAlignmentMode: 'direction',
  ruledAlignmentDistance: 0,
  ribSelectedSketchId: null,

  filletEdgeIds: [],
  chamferEdgeIds: [],
  filletFullRoundCenterFaceId: null,
  filletFullRoundCenterOccBodyId: null,
  filletFullRoundCenterOccFaceId: null,
  filletFullRoundSide1FaceId: null,
  filletFullRoundSide1OccFaceId: null,
  filletFullRoundSide2FaceId: null,
  filletFullRoundSide2OccFaceId: null,
  filletFullRoundPickSlot: null,
  measurePoints: [],
  alignPickStage: "idle",
  alignSource: null,
  alignTarget: null,

  replaceFaceSourceId: null,
  replaceFaceTargetId: null,
  decalFaceId: null,
  decalFaceNormal: null,
  decalFaceCentroid: null,
  attachedCanvasId: null,
  lipGrooveEdgeId: null,
  snapFitFaceId: null,
  splitFaceId: null,
  holeFaceId: null,
  holeFaceNormal: null,
  holeFaceCentroid: null,
  shellRemoveFaceIds: [],
  shellRemoveFaceData: {},
  shellFaceThicknesses: {},
  draftPartingFaceId: null,
  draftPartingOccBodyId: null,
  draftPartingOccFaceId: null,
  draftPartingFaceNormal: null,
  draftPartingFaceCentroid: null,
  draftPullFaceId: null,
  draftPullOccBodyId: null,
  draftPullOccFaceId: null,
  draftPullFaceNormal: null,
  draftPullFaceCentroid: null,
  draftPullFacePickActive: false,
  offsetFaceId: null,
  offsetOccBodyId: null,
  offsetOccFaceId: null,
  offsetFaceNormal: null,
  offsetFaceCentroid: null,
  removeFaceFaceId: null,
  removeFaceFaceNormal: null,
  removeFaceFaceCentroid: null,
  exportBodyId: null,
  exportBodyFormat: null,
  directEditFaceId: null,
  textureExtrudeFaceId: null,

  activeAnalysis: null,
  showFillDialog: false,
  fillBoundaryEdgeIds: [],
  fillBoundaryEdgeData: [],
  showOffsetCurveDialog: false,
  showSurfaceMergeDialog: false,
  surfaceMergeFace1Id: null,
  surfaceMergeFace2Id: null,
  showDeleteFaceDialog: false,
  deleteFaceIds: [],
  deleteFacePicks: [],
  showSurfacePrimitivesDialog: false,
  showExportDialog: false,
  showJointOriginDialog: false,
  jointOriginPickedPoint: null,
  jointDialogPickedOrigin: null,
  jointDialogPickMode: false,
  showInterferenceDialog: false,
  interferenceResults: [],
  showMirrorComponentDialog: false,
  showDuplicateWithJointsDialog: false,
  duplicateWithJointsTargetId: null,
  showBOMDialog: false,
  showContactSetsDialog: false,
  showInsertComponentDialog: false,
});

export function createDocumentActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    // ── UTL2 — Save / Load ───────────────────────────────────────────────────
    newDocument: () => {
      // Dispose stored feature meshes before clearing state.
      for (const f of get().features) disposeFeatureObjectGeometry(f.mesh);
      // Dispose all OCC WASM bodies and clear the evaluator cache so none
      // of the prior document's shapes linger on the C++ heap.
      clearDocumentRuntimeCaches();
      resetComponentDocumentForFeatures([]);
      set({
        // Geometry content
        features: [],
        sketches: [],
        featureGroups: [],
        designConfigurations: createDefaultDesignConfigurations(),
        activeDesignConfigurationId: BASE_DESIGN_CONFIGURATION_ID,
        constructionPlanes: [],
        constructionAxes: [],
        constructionPoints: [],
        jointOrigins: [],
        contactSets: [],
        selectionSets: [],
        canvasReferences: [],
        parameters: [],
        formBodies: [],
        activeFormBodyId: null,
        formSelection: null,
        frozenFormVertices: [],
        // History
        undoStack: [],
        redoStack: [],
        ...createDocumentTransientReset(),
        activeSketch: null,
        statusMessage: "New document",
      });
    },

    getDesignJSON: () => {
      const state = get();
      const activeSketch = shouldPersistActiveSketch(state.activeSketch) ? state.activeSketch : null;
      const sketches = mergeActiveSketchForPersistence(state.sketches, activeSketch);
      const documentSnapshot: DesignDocumentSnapshot = {
        features: state.features.map((f) => serializeFeature(f)),
        sketches: sketches.map(serializeSketchForDesignFile),
        activeSketch: activeSketch ? serializeSketchForDesignFile(activeSketch) : null,
        featureGroups: state.featureGroups,
        historyEnabled: state.historyEnabled,
        designConfigurations: state.designConfigurations,
        activeDesignConfigurationId: state.activeDesignConfigurationId,
        parameters: state.parameters,
        constructionPlanes: state.constructionPlanes,
        constructionAxes: state.constructionAxes,
        constructionPoints: state.constructionPoints,
        jointOrigins: state.jointOrigins,
        contactSets: state.contactSets,
        selectionSets: state.selectionSets,
        canvasReferences: state.canvasReferences,
        formBodies: state.formBodies,
        frozenFormVertices: state.frozenFormVertices,
        units: state.units,
      };
      const saveObj: DesignFileSnapshot = {
        version: 2,
        document: documentSnapshot,
        componentStore: serializeComponentDocumentSnapshot(),
      };
      return JSON.stringify(saveObj, null, 2);
    },

    saveToFile: (filename = "design.dznd") => {
      const json = get().getDesignJSON();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = filename.endsWith(".dznd")
        ? filename
        : `${filename}.dznd`;
      a.download = safeName;
      a.click();
      URL.revokeObjectURL(url);
      get().setStatusMessage(`Design saved: ${safeName}`);
    },

    loadFromFile: (json: string) => {
      try {
        const parsed = JSON.parse(json) as DesignFileSnapshot;
        if (!parsed || parsed.version !== 2 || !parsed.document || !parsed.componentStore) {
          throw new Error("Invalid snapshot: unsupported design file schema");
        }
        const documentSnapshot = parsed.document;
        if (!Array.isArray(documentSnapshot.features)) {
          throw new Error("Invalid snapshot: missing features array");
        }
        if (!Array.isArray(documentSnapshot.sketches)) {
          throw new Error("Invalid snapshot: missing sketches array");
        }
        if (
          !parsed.componentStore.rootComponentId ||
          !parsed.componentStore.components ||
          !parsed.componentStore.bodies
        ) {
          throw new Error("Invalid snapshot: missing component store data");
        }
        const nextFeatures = documentSnapshot.features.map((f) => deserializeFeature(f));
        const nextSketches = documentSnapshot.sketches.map((s) =>
          deserializeSketch(s as unknown as Sketch),
        );
        const nextActiveSketch = documentSnapshot.activeSketch
          ? deserializeSketch(documentSnapshot.activeSketch as unknown as Sketch)
          : null;
        const designConfigurations = documentSnapshot.designConfigurations?.length
          ? documentSnapshot.designConfigurations
          : createDefaultDesignConfigurations();
        const activeDesignConfigurationId =
          documentSnapshot.activeDesignConfigurationId &&
          designConfigurations.some((config) => config.id === documentSnapshot.activeDesignConfigurationId)
            ? documentSnapshot.activeDesignConfigurationId
            : designConfigurations[0]?.id ?? BASE_DESIGN_CONFIGURATION_ID;

        // Dispose the current runtime state only after the new file validates.
        for (const f of get().features) disposeFeatureObjectGeometry(f.mesh);
        clearDocumentRuntimeCaches();
        restoreComponentDocumentSnapshot(parsed.componentStore);

        set({
          features: nextFeatures,
          sketches: nextSketches,
          activeSketch: nextActiveSketch,
          featureGroups: documentSnapshot.featureGroups ?? [],
          historyEnabled: documentSnapshot.historyEnabled ?? true,
          designConfigurations,
          activeDesignConfigurationId,
          parameters: documentSnapshot.parameters ?? [],
          constructionPlanes: documentSnapshot.constructionPlanes ?? [],
          constructionAxes: documentSnapshot.constructionAxes ?? [],
          constructionPoints: documentSnapshot.constructionPoints ?? [],
          jointOrigins: documentSnapshot.jointOrigins ?? [],
          contactSets: documentSnapshot.contactSets ?? [],
          selectionSets: documentSnapshot.selectionSets ?? [],
          canvasReferences: documentSnapshot.canvasReferences ?? [],
          formBodies: documentSnapshot.formBodies ?? [],
          activeFormBodyId: null,
          formSelection: null,
          frozenFormVertices: documentSnapshot.frozenFormVertices ?? [],
          units: documentSnapshot.units ?? "mm",
          undoStack: [],
          redoStack: [],
          ...createDocumentTransientReset(),
          statusMessage: "Design loaded from file",
        });
      } catch {
        get().setStatusMessage("Load failed: invalid file format");
      }
    },
  };
}
