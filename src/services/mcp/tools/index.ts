import { useCADStore } from '../../../store/cadStore';
import { useAiAssistantStore } from '../../../store/aiAssistantStore';
import { usePrinterStore } from '../../../store/printerStore';
import { useSlicerStore } from '../../../store/slicerStore';
import { useVisionStore } from '../../../store/visionStore';
import { computeSliceStats, detectPrintIssues } from '../../../components/slicer/workspace/preview/sliceStats';
import { getDuetPrefs } from '../../../utils/duetPrefs';
import {
  captureVisionFrame,
  classifyPrintFrame,
  summarizePrinterModel,
  type VisionFrameSample,
  type VisionFailureSettings,
} from '../../vision/failureDetector';
import { diagnosePrint } from '../../vision/printDiagnostics';
import { analyzeTuningTower, type TuningWizardKind } from '../../vision/tuningWizards';
import type { SketchEntity, SketchPoint } from '../../../types/cad/sketch';
import type { Feature } from '../../../types/cad/feature';
import type { SketchPlane } from '../../../types/cad/core';
import type { PreviewColorMode } from '../../../types/slicer-preview.types';

// Each handler receives the tool args and returns a JSON-serialisable result.
// Errors are thrown as plain Error objects; the bridge catches and forwards them.

export type ToolArgs = Record<string, unknown>;
export type ToolHandler = (args: ToolArgs) => Promise<unknown>;

// ── Helpers ────────────────────────────────────────────────────────────────

function store() { return useCADStore.getState(); }

function featureSummary(f: Feature) {
  const bbox = f.mesh ? (() => {
    try {
      f.mesh.geometry.computeBoundingBox();
      const box = f.mesh.geometry.boundingBox;
      return box
        ? { min: box.min.toArray(), max: box.max.toArray() }
        : null;
    } catch { return null; }
  })() : null;
  return {
    id: f.id,
    name: f.name,
    kind: f.type,
    bodyKind: f.bodyKind ?? 'solid',
    visible: f.visible,
    suppressed: f.suppressed,
    sketchId: f.sketchId ?? null,
    bbox,
  };
}

function makeid(): string { return crypto.randomUUID(); }

function pt(x: number, y: number, z = 0): SketchPoint {
  return { id: makeid(), x, y, z };
}

// ── Document / scene ───────────────────────────────────────────────────────

const list_objects: ToolHandler = async () => {
  return store().features.map(featureSummary);
};

const get_object_properties: ToolHandler = async ({ id }) => {
  const f = store().features.find((feat) => feat.id === id);
  if (!f) throw new Error(`Feature ${String(id)} not found.`);
  const { mesh: _mesh, ...rest } = f;
  const hasMesh = !!_mesh;
  let bbox = null;
  if (_mesh) {
    try {
      _mesh.geometry.computeBoundingBox();
      const box = _mesh.geometry.boundingBox;
      if (box) bbox = { min: box.min.toArray(), max: box.max.toArray() };
    } catch { /* no bbox */ }
  }
  return { ...rest, hasMesh, bbox };
};

const select_objects: ToolHandler = async ({ ids }) => {
  const featureIds = ids as string[];
  store().setSelectedFeatureId(featureIds[0] ?? null);
  return { selected: featureIds };
};

const snapshot_view: ToolHandler = async () => {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas');
  if (!canvas) throw new Error('No viewport canvas found.');
  const dataUrl = canvas.toDataURL('image/png');
  return { dataUrl };
};

// ── Primitives ─────────────────────────────────────────────────────────────

const create_box: ToolHandler = async ({ x, y, z, px = 0, py = 0, pz = 0 }) => {
  store().addPrimitive('box', {
    width: x as number, height: z as number, depth: y as number,
    x: px as number, y: py as number, z: pz as number,
  });
  const f = store().features.at(-1)!;
  return { created: f.id, name: f.name };
};

const create_cylinder: ToolHandler = async ({ radius, height, px = 0, py = 0, pz = 0 }) => {
  store().addPrimitive('cylinder', {
    radius: radius as number, radiusTop: radius as number,
    height: height as number,
    x: px as number, y: py as number, z: pz as number,
  });
  const f = store().features.at(-1)!;
  return { created: f.id, name: f.name };
};

const create_sphere: ToolHandler = async ({ radius, px = 0, py = 0, pz = 0 }) => {
  store().addPrimitive('sphere', {
    radius: radius as number,
    x: px as number, y: py as number, z: pz as number,
  });
  const f = store().features.at(-1)!;
  return { created: f.id, name: f.name };
};

const create_cone: ToolHandler = async ({ r1, r2, height, px = 0, py = 0, pz = 0 }) => {
  // Cindr3D's cylinder primitive accepts radiusTop/radiusBottom for cones
  store().addPrimitive('cylinder', {
    radius: r1 as number,
    radiusTop: r2 as number,
    height: height as number,
    x: px as number, y: py as number, z: pz as number,
  });
  const f = store().features.at(-1)!;
  return { created: f.id, name: f.name };
};

// ── Sketches ───────────────────────────────────────────────────────────────

const start_sketch: ToolHandler = async ({ plane }) => {
  const validPlanes: SketchPlane[] = ['XY', 'XZ', 'YZ'];
  const p = String(plane).toUpperCase() as SketchPlane;
  if (!validPlanes.includes(p)) throw new Error(`Invalid plane "${plane}". Use XY, XZ, or YZ.`);
  store().startSketch(p);
  const s = store().activeSketch;
  return { sketchId: s?.id ?? null, plane: p };
};

const sketch_rect: ToolHandler = async ({ x, y, w, h, centered = false }) => {
  const cx = centered ? (x as number) - (w as number) / 2 : (x as number);
  const cy = centered ? (y as number) - (h as number) / 2 : (y as number);
  const rx = cx, ry = cy, rw = w as number, rh = h as number;
  const entity: SketchEntity = {
    id: makeid(),
    type: 'rectangle',
    points: [
      pt(rx, ry), pt(rx + rw, ry), pt(rx + rw, ry + rh), pt(rx, ry + rh),
    ],
    closed: true,
  };
  store().addSketchEntity(entity);
  return { entityId: entity.id };
};

const sketch_circle: ToolHandler = async ({ cx, cy, radius }) => {
  const entity: SketchEntity = {
    id: makeid(),
    type: 'circle',
    cx: cx as number,
    cy: cy as number,
    radius: radius as number,
    points: [pt(cx as number, cy as number)],
    closed: true,
  };
  store().addSketchEntity(entity);
  return { entityId: entity.id };
};

const sketch_polygon: ToolHandler = async ({ points }) => {
  const pts = (points as [number, number][]).map(([px, py]) => pt(px, py));
  const entity: SketchEntity = {
    id: makeid(),
    type: 'polygon',
    points: pts,
    closed: true,
  };
  store().addSketchEntity(entity);
  return { entityId: entity.id };
};

const sketch_dimension: ToolHandler = async ({ entityId, value }) => {
  store().addSketchConstraint({
    id: makeid(),
    type: 'equal',
    entityIds: [entityId as string],
    value: value as number,
  });
  return { ok: true };
};

const finish_sketch: ToolHandler = async () => {
  const s = store().activeSketch;
  const id = s?.id ?? null;
  store().finishSketch();
  return { sketchId: id };
};

// ── Features ───────────────────────────────────────────────────────────────

const extrude_sketch: ToolHandler = async ({ sketchId, depth, direction = 'one-side', operation = 'new-body' }) => {
  const s = store();
  const dirMap: Record<string, 'positive' | 'symmetric' | 'two-sides'> = {
    'one-side': 'positive',
    positive: 'positive',
    symmetric: 'symmetric',
    'two-sides': 'two-sides',
  };
  s.setExtrudeSelectedSketchId(sketchId as string);
  s.setExtrudeDistance(depth as number);
  s.setExtrudeDirection(dirMap[direction as string] ?? 'positive');
  s.setExtrudeOperation((operation as 'new-body' | 'join' | 'cut' | 'intersect') ?? 'new-body');
  s.commitExtrude();
  const f = s.features.at(-1)!;
  return { created: f.id, name: f.name };
};

const revolve_sketch: ToolHandler = async ({ sketchId, axis, angle = 360 }) => {
  const s = store();
  const validAxes = ['X', 'Y', 'Z'];
  const a = String(axis).toUpperCase();
  if (!validAxes.includes(a)) throw new Error(`Invalid axis "${axis}". Use X, Y, or Z.`);
  s.setRevolveSelectedSketchId(sketchId as string);
  s.setRevolveAngle(angle as number);
  s.setRevolveAxis(a as 'X' | 'Y' | 'Z');
  s.commitRevolve();
  const f = s.features.at(-1)!;
  return { created: f.id, name: f.name };
};

const fillet_edges: ToolHandler = async ({ objectId, edgeIds, radius }) => {
  const edgeIdsStr = (edgeIds as string[]).join(',');
  const feature: Feature = {
    id: makeid(),
    name: `Fillet (r=${radius})`,
    type: 'fillet',
    params: { objectId, radius, edgeIds: edgeIdsStr },
    visible: true,
    suppressed: false,
    timestamp: Date.now(),
  };
  store().addFeature(feature);
  return { created: feature.id };
};

const chamfer_edges: ToolHandler = async ({ objectId, edgeIds, distance }) => {
  const edgeIdsStr = (edgeIds as string[]).join(',');
  const feature: Feature = {
    id: makeid(),
    name: `Chamfer (d=${distance})`,
    type: 'chamfer',
    params: { objectId, distance, edgeIds: edgeIdsStr },
    visible: true,
    suppressed: false,
    timestamp: Date.now(),
  };
  store().addFeature(feature);
  return { created: feature.id };
};

const hole: ToolHandler = async ({ objectId, x, y, z, diameter, depth, throughAll = false }) => {
  const feature: Feature = {
    id: makeid(),
    name: `Hole (d=${diameter})`,
    type: 'hole',
    params: { objectId, x, y, z, diameter, depth, throughAll },
    visible: true,
    suppressed: false,
    timestamp: Date.now(),
  };
  store().addFeature(feature);
  return { created: feature.id };
};

// ── Booleans + transforms ──────────────────────────────────────────────────

const boolean_union: ToolHandler = async ({ targetId, toolId }) => {
  store().commitCombine(targetId as string, toolId as string, 'join', false);
  return { ok: true, target: targetId };
};

const boolean_subtract: ToolHandler = async ({ targetId, toolId }) => {
  store().commitCombine(targetId as string, toolId as string, 'cut', false);
  return { ok: true, target: targetId };
};

const boolean_intersect: ToolHandler = async ({ targetId, toolId }) => {
  store().commitCombine(targetId as string, toolId as string, 'intersect', false);
  return { ok: true, target: targetId };
};

const transform: ToolHandler = async ({ id, tx = 0, ty = 0, tz = 0, sx = 1, sy = 1, sz = 1 }) => {
  const s = store();
  const f = s.features.find((feat) => feat.id === id);
  if (!f) throw new Error(`Feature ${String(id)} not found.`);
  if (!f.mesh) throw new Error(`Feature ${String(id)} has no mesh to transform.`);
  s.pushUndo();
  f.mesh.position.x += tx as number;
  f.mesh.position.y += ty as number;
  f.mesh.position.z += tz as number;
  f.mesh.scale.x *= sx as number;
  f.mesh.scale.y *= sy as number;
  f.mesh.scale.z *= sz as number;
  // Trigger re-render via a no-op features update
  s.updateFeatureParams(id as string, { ...f.params });
  return { ok: true };
};

const mirror: ToolHandler = async ({ id, plane }) => {
  const validPlanes = ['XY', 'XZ', 'YZ'];
  const p = String(plane).toUpperCase();
  if (!validPlanes.includes(p)) throw new Error(`Invalid plane "${plane}". Use XY, XZ, or YZ.`);
  store().commitMirrorFeature(id as string, p as 'XY' | 'XZ' | 'YZ');
  return { ok: true };
};

const linear_pattern: ToolHandler = async ({ id, axis, count, spacing }) => {
  const axisMap: Record<string, [number, number, number]> = {
    X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1],
  };
  const [dx, dy, dz] = axisMap[String(axis).toUpperCase()] ?? [1, 0, 0];
  store().commitLinearPattern(id as string, {
    dirX: dx, dirY: dy, dirZ: dz,
    spacing: spacing as number,
    count: count as number,
  });
  return { ok: true };
};

const circular_pattern: ToolHandler = async ({ id, axis, count, totalAngle = 360 }) => {
  const axisMap: Record<string, [number, number, number]> = {
    X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1],
  };
  const [ax, ay, az] = axisMap[String(axis).toUpperCase()] ?? [0, 0, 1];
  store().commitCircularPattern(id as string, {
    axisX: ax, axisY: ay, axisZ: az,
    originX: 0, originY: 0, originZ: 0,
    count: count as number,
    totalAngle: totalAngle as number,
  });
  return { ok: true };
};

// ── Export / save ──────────────────────────────────────────────────────────

const save_session: ToolHandler = async () => {
  store().saveToFile();
  return { ok: true };
};

const export_stl: ToolHandler = async ({ ids }) => {
  store().setShowExportDialog(true);
  return { ok: true, selectedIds: ids ?? [], note: 'Export dialog opened in Cindr3D — choose STL and confirm.' };
};

const export_step: ToolHandler = async ({ ids }) => {
  store().setShowExportDialog(true);
  return { ok: true, selectedIds: ids ?? [], note: 'Export dialog opened in Cindr3D — choose STEP and confirm.' };
};

const export_gcode: ToolHandler = async ({ profileId }) => {
  store().setWorkspaceMode('prepare');
  return { ok: true, profileId: profileId ?? null, note: 'Switched to slicer workspace. Slice and export G-code from there.' };
};

// ── Resources ──────────────────────────────────────────────────────────────

const resource_document_summary: ToolHandler = async () => {
  const s = store();
  return {
    featureCount: s.features.length,
    sketchCount: s.sketches.length,
    units: s.units,
    workspaceMode: s.workspaceMode,
  };
};

const resource_document_objects: ToolHandler = async () => {
  return store().features.map(featureSummary);
};

const resource_feature_tree: ToolHandler = async (args) => {
  const id = args.id as string;
  const s = store();
  const feature = s.features.find((f) => f.id === id);
  if (!feature) throw new Error(`Feature not found: ${id}`);

  const bbox = feature.mesh ? (() => {
    try {
      feature.mesh!.geometry.computeBoundingBox();
      const box = feature.mesh!.geometry.boundingBox;
      return box ? { min: box.min.toArray(), max: box.max.toArray() } : null;
    } catch { return null; }
  })() : null;

  const sketch = feature.sketchId ? s.sketches.find((sk) => sk.id === feature.sketchId) ?? null : null;

  return {
    id: feature.id,
    name: feature.name,
    type: feature.type,
    bodyKind: feature.bodyKind ?? 'solid',
    visible: feature.visible,
    suppressed: feature.suppressed,
    timestamp: feature.timestamp,
    groupId: feature.groupId ?? null,
    params: feature.params,
    faceIds: {
      start: feature.startFaceIds ?? [],
      end: feature.endFaceIds ?? [],
      side: feature.sideFaceIds ?? [],
    },
    bbox,
    sketch: sketch ? {
      id: sketch.id,
      name: sketch.name,
      plane: sketch.plane,
      fullyConstrained: sketch.fullyConstrained,
      entityCount: sketch.entities.length,
      entities: sketch.entities.map((e) => ({
        id: e.id,
        type: e.type,
        radius: e.radius ?? null,
        sides: e.sides ?? null,
        closed: e.closed ?? false,
        isConstruction: e.isConstruction ?? false,
        points: e.points.map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z })),
      })),
      dimensionCount: sketch.dimensions.length,
      dimensions: sketch.dimensions.map((d) => ({
        id: d.id,
        type: d.type,
        value: d.value,
        entityIds: d.entityIds,
      })),
    } : null,
  };
};

// ── Slicer ─────────────────────────────────────────────────────────────────

function slicerStore() { return useSlicerStore.getState(); }

const slicer_get_settings: ToolHandler = async () => {
  const ss = slicerStore();
  const print = ss.getActivePrintProfile();
  const printer = ss.getActivePrinterProfile();
  const material = ss.getActiveMaterialProfile();
  return {
    activePrintProfile: { id: print.id, name: print.name },
    activePrinterProfile: { id: printer.id, name: printer.name },
    activeMaterialProfile: { id: material.id, name: material.name },
    settings: print,
  };
};

const slicer_set_setting: ToolHandler = async (args) => {
  const key = args.key as string;
  const value = args.value;
  const ss = slicerStore();
  const print = ss.getActivePrintProfile();
  if (!(key in print)) throw new Error(`Unknown print profile setting: "${key}"`);
  ss.updatePrintProfile(print.id, { [key]: value } as Partial<typeof print>);
  return { ok: true, key, value };
};

const slicer_list_profiles: ToolHandler = async () => {
  const ss = slicerStore();
  return {
    printerProfiles: ss.printerProfiles.map((p) => ({ id: p.id, name: p.name, active: p.id === ss.activePrinterProfileId })),
    materialProfiles: ss.materialProfiles.map((m) => ({ id: m.id, name: m.name, active: m.id === ss.activeMaterialProfileId })),
    printProfiles: ss.printProfiles.map((p) => ({ id: p.id, name: p.name, active: p.id === ss.activePrintProfileId })),
  };
};

const slicer_set_active_profile: ToolHandler = async (args) => {
  const kind = args.kind as string;
  const id = args.id as string;
  const ss = slicerStore();
  if (kind === 'print') {
    if (!ss.printProfiles.find((p) => p.id === id)) throw new Error(`Print profile not found: ${id}`);
    ss.setActivePrintProfile(id);
  } else if (kind === 'printer') {
    if (!ss.printerProfiles.find((p) => p.id === id)) throw new Error(`Printer profile not found: ${id}`);
    ss.setActivePrinterProfile(id);
  } else if (kind === 'material') {
    if (!ss.materialProfiles.find((m) => m.id === id)) throw new Error(`Material profile not found: ${id}`);
    ss.setActiveMaterialProfile(id);
  } else {
    throw new Error(`kind must be "print", "printer", or "material"`);
  }
  return { ok: true, kind, id };
};

const slicer_list_plate_objects: ToolHandler = async () => {
  return slicerStore().plateObjects.map((o) => ({
    id: o.id,
    name: o.name,
    featureId: o.featureId,
    position: o.position,
    rotation: o.rotation,
    scale: o.scale,
  }));
};

const slicer_start_slice: ToolHandler = async () => {
  const ss = slicerStore();
  if (ss.plateObjects.length === 0) throw new Error('No objects on the build plate.');
  ss.startSlice();
  return { ok: true, note: 'Slicing started. Use slicer_get_status to poll for completion.' };
};

const slicer_get_status: ToolHandler = async () => {
  const ss = slicerStore();
  const { sliceProgress, sliceResult } = ss;
  if (sliceResult) {
    return {
      state: 'done',
      layerCount: sliceResult.layerCount,
      printTime: sliceResult.printTime,
      filamentUsed: sliceResult.filamentUsed,
      filamentWeight: sliceResult.filamentWeight,
      filamentCost: sliceResult.filamentCost,
    };
  }
  return {
    state: sliceProgress.stage,
    progress: sliceProgress.percent,
    message: sliceProgress.message ?? null,
  };
};

// ── Slicer: printer + material settings ────────────────────────────────────

const slicer_get_printer_settings: ToolHandler = async () => {
  const ss = slicerStore();
  const p = ss.getActivePrinterProfile();
  const { id, name, buildVolume, nozzleDiameter, filamentDiameter, hasHeatedBed, gcodeFlavorType, maxNozzleTemp, maxBedTemp, maxSpeed, originCenter } = p;
  return { id, name, buildVolume, nozzleDiameter, filamentDiameter, hasHeatedBed, gcodeFlavorType, maxNozzleTemp, maxBedTemp, maxSpeed, originCenter };
};

const slicer_set_printer_setting: ToolHandler = async (args) => {
  const key = args.key as string;
  const value = args.value;
  const ss = slicerStore();
  const printer = ss.getActivePrinterProfile();
  if (!(key in printer)) throw new Error(`Unknown printer profile setting: "${key}"`);
  ss.updatePrinterProfile(printer.id, { [key]: value } as Partial<typeof printer>);
  return { ok: true, key, value };
};

const slicer_get_material_settings: ToolHandler = async () => {
  const ss = slicerStore();
  const m = ss.getActiveMaterialProfile();
  const { id, name, type, nozzleTemp, nozzleTempFirstLayer, bedTemp, bedTempFirstLayer, fanSpeedMin, fanSpeedMax, retractionDistance, retractionSpeed, retractionZHop, flowRate, density, costPerKg } = m;
  return { id, name, type, nozzleTemp, nozzleTempFirstLayer, bedTemp, bedTempFirstLayer, fanSpeedMin, fanSpeedMax, retractionDistance, retractionSpeed, retractionZHop, flowRate, density, costPerKg };
};

const slicer_set_material_setting: ToolHandler = async (args) => {
  const key = args.key as string;
  const value = args.value;
  const ss = slicerStore();
  const material = ss.getActiveMaterialProfile();
  if (!(key in material)) throw new Error(`Unknown material profile setting: "${key}"`);
  ss.updateMaterialProfile(material.id, { [key]: value } as Partial<typeof material>);
  return { ok: true, key, value };
};

// ── Slicer: plate object transforms ────────────────────────────────────────

const slicer_transform_plate_object: ToolHandler = async (args) => {
  const id = args.id as string;
  const ss = slicerStore();
  const obj = ss.plateObjects.find((o) => o.id === id);
  if (!obj) throw new Error(`Plate object not found: ${id}`);
  const updates: Record<string, unknown> = {};
  if (args.x !== undefined || args.y !== undefined || args.z !== undefined) {
    updates.position = { ...obj.position, ...(args.x !== undefined ? { x: args.x } : {}), ...(args.y !== undefined ? { y: args.y } : {}), ...(args.z !== undefined ? { z: args.z } : {}) };
  }
  if (args.rotX !== undefined || args.rotY !== undefined || args.rotZ !== undefined) {
    updates.rotation = { ...obj.rotation, ...(args.rotX !== undefined ? { x: args.rotX } : {}), ...(args.rotY !== undefined ? { y: args.rotY } : {}), ...(args.rotZ !== undefined ? { z: args.rotZ } : {}) };
  }
  if (args.scaleX !== undefined || args.scaleY !== undefined || args.scaleZ !== undefined) {
    updates.scale = { ...obj.scale, ...(args.scaleX !== undefined ? { x: args.scaleX } : {}), ...(args.scaleY !== undefined ? { y: args.scaleY } : {}), ...(args.scaleZ !== undefined ? { z: args.scaleZ } : {}) };
  }
  if (Object.keys(updates).length === 0) throw new Error('Provide at least one of: x/y/z, rotX/rotY/rotZ, scaleX/scaleY/scaleZ');
  ss.pushPlateHistory();
  ss.updatePlateObject(id, updates as Parameters<typeof ss.updatePlateObject>[1]);
  return { ok: true, id, updates };
};

const slicer_auto_orient_object: ToolHandler = async (args) => {
  const id = args.id as string;
  const ss = slicerStore();
  if (!ss.plateObjects.find((o) => o.id === id)) throw new Error(`Plate object not found: ${id}`);
  ss.autoOrientPlateObject(id);
  return { ok: true };
};

const slicer_drop_to_bed: ToolHandler = async (args) => {
  const id = args.id as string;
  const ss = slicerStore();
  if (!ss.plateObjects.find((o) => o.id === id)) throw new Error(`Plate object not found: ${id}`);
  ss.dropToBedPlateObject(id);
  return { ok: true };
};

const slicer_center_object: ToolHandler = async (args) => {
  const id = args.id as string;
  const ss = slicerStore();
  if (!ss.plateObjects.find((o) => o.id === id)) throw new Error(`Plate object not found: ${id}`);
  ss.centerPlateObject(id);
  return { ok: true };
};

const slicer_scale_to_height: ToolHandler = async (args) => {
  const id = args.id as string;
  const targetHeight = args.targetHeight as number;
  const ss = slicerStore();
  if (!ss.plateObjects.find((o) => o.id === id)) throw new Error(`Plate object not found: ${id}`);
  ss.scaleToHeight(id, targetHeight);
  return { ok: true, id, targetHeight };
};

const slicer_auto_arrange: ToolHandler = async () => {
  slicerStore().autoArrange();
  return { ok: true };
};

const slicer_remove_plate_object: ToolHandler = async (args) => {
  const id = args.id as string;
  const ss = slicerStore();
  if (!ss.plateObjects.find((o) => o.id === id)) throw new Error(`Plate object not found: ${id}`);
  ss.removeFromPlate(id);
  return { ok: true };
};

const slicer_set_per_object_setting: ToolHandler = async (args) => {
  const id = args.id as string;
  const key = args.key as string;
  const value = args.value;
  const ss = slicerStore();
  const obj = ss.plateObjects.find((o) => o.id === id);
  if (!obj) throw new Error(`Plate object not found: ${id}`);
  const current = obj.perObjectSettings ?? {};
  ss.updatePlateObject(id, { perObjectSettings: { ...current, [key]: value } });
  return { ok: true, id, key, value };
};

const slicer_run_printability_check: ToolHandler = async () => {
  slicerStore().runPrintabilityCheck();
  return { ok: true, note: 'Printability check triggered. Results update asynchronously in the slicer panel.' };
};

const slicer_download_gcode: ToolHandler = async () => {
  const ss = slicerStore();
  if (!ss.sliceResult) throw new Error('No slice result available — run slicer_start_slice first.');
  ss.downloadGCode();
  return { ok: true };
};

// ── Camera ────────────────────────────────────────────────────────────────────

const slicer_set_camera_preset: ToolHandler = async (args) => {
  const preset = args.preset as string;
  window.dispatchEvent(new CustomEvent('slicer:set-camera-preset', { detail: preset }));
  return { ok: true, preset };
};

const slicer_fit_to_plate: ToolHandler = async () => {
  window.dispatchEvent(new CustomEvent('slicer:fit-camera'));
  return { ok: true };
};

const slicer_focus_object: ToolHandler = async (args) => {
  const id = args.id as string;
  const obj = slicerStore().plateObjects.find((o) => o.id === id);
  if (!obj) throw new Error(`Plate object not found: ${id}`);
  window.dispatchEvent(new CustomEvent('slicer:focus-object', { detail: { id } }));
  return { ok: true, id };
};

// ── Preview / layer control ───────────────────────────────────────────────────

const slicer_set_preview_mode: ToolHandler = async (args) => {
  const mode = args.mode as 'model' | 'preview';
  slicerStore().setPreviewMode(mode);
  return { ok: true, mode };
};

const slicer_set_preview_layer: ToolHandler = async (args) => {
  const ss = slicerStore();
  const layer = Math.max(0, Math.min(Math.round(args.layer as number), ss.previewLayerMax));
  ss.setPreviewLayer(layer);
  return { ok: true, layer };
};

const slicer_set_preview_layer_range: ToolHandler = async (args) => {
  const ss = slicerStore();
  const start = Math.max(0, Math.round(args.start as number));
  const end = Math.min(Math.round(args.end as number), ss.previewLayerMax);
  ss.setPreviewLayerRange(start, end);
  return { ok: true, start, end };
};

// ── Plate history ─────────────────────────────────────────────────────────────

const slicer_undo: ToolHandler = async () => {
  slicerStore().undoPlate();
  return { ok: true };
};

const slicer_redo: ToolHandler = async () => {
  slicerStore().redoPlate();
  return { ok: true };
};

const slicer_duplicate_plate_object: ToolHandler = async (args) => {
  const id = args.id as string;
  const ss = slicerStore();
  if (!ss.plateObjects.find((o) => o.id === id)) throw new Error(`Plate object not found: ${id}`);
  ss.duplicatePlateObject(id);
  return { ok: true, originalId: id };
};

// ── Selection ─────────────────────────────────────────────────────────────────

const slicer_select_plate_object: ToolHandler = async (args) => {
  const id = args.id as string;
  slicerStore().selectPlateObject(id === 'null' ? null : id);
  return { ok: true, selectedId: id === 'null' ? null : id };
};

const slicer_clear_selection: ToolHandler = async () => {
  slicerStore().clearPlateSelection();
  return { ok: true };
};

const slicer_get_selection: ToolHandler = async () => {
  const ss = slicerStore();
  return { selectedIds: ss.getSelectedIds() };
};

const slicer_duplicate_selected: ToolHandler = async () => {
  slicerStore().duplicateSelectedPlateObjects();
  return { ok: true };
};

// ── Object properties ─────────────────────────────────────────────────────────

const slicer_set_object_locked: ToolHandler = async (args) => {
  const id = args.id as string;
  const locked = String(args.locked) === 'true';
  const ss = slicerStore();
  if (!ss.plateObjects.find((o) => o.id === id)) throw new Error(`Plate object not found: ${id}`);
  ss.pushPlateHistory();
  ss.updatePlateObject(id, { locked });
  return { ok: true, id, locked };
};

const slicer_set_object_hidden: ToolHandler = async (args) => {
  const id = args.id as string;
  const hidden = String(args.hidden) === 'true';
  const ss = slicerStore();
  if (!ss.plateObjects.find((o) => o.id === id)) throw new Error(`Plate object not found: ${id}`);
  ss.pushPlateHistory();
  ss.updatePlateObject(id, { hidden });
  return { ok: true, id, hidden };
};

const slicer_set_object_color: ToolHandler = async (args) => {
  const id = args.id as string;
  const color = (args.color as string) || undefined;
  const ss = slicerStore();
  if (!ss.plateObjects.find((o) => o.id === id)) throw new Error(`Plate object not found: ${id}`);
  ss.updatePlateObject(id, { color });
  return { ok: true, id, color: color ?? null };
};

// ── Plate operations ──────────────────────────────────────────────────────────

const slicer_clear_plate: ToolHandler = async () => {
  slicerStore().clearPlate();
  return { ok: true };
};

const slicer_resolve_overlaps: ToolHandler = async (args) => {
  const id = args.id as string;
  const ss = slicerStore();
  if (!ss.plateObjects.find((o) => o.id === id)) throw new Error(`Plate object not found: ${id}`);
  ss.resolveOverlapForObject(id);
  return { ok: true, id };
};

// ── Geometry tools ────────────────────────────────────────────────────────────

const slicer_hollow_object: ToolHandler = async (args) => {
  const id = args.id as string;
  const wallThickness = args.wallThickness as number;
  const ss = slicerStore();
  if (!ss.plateObjects.find((o) => o.id === id)) throw new Error(`Plate object not found: ${id}`);
  await ss.hollowPlateObject(id, wallThickness);
  return { ok: true, id, wallThickness };
};

const slicer_cut_object_by_plane: ToolHandler = async (args) => {
  const id = args.id as string;
  const ss = slicerStore();
  if (!ss.plateObjects.find((o) => o.id === id)) throw new Error(`Plate object not found: ${id}`);

  let point: { x: number; y: number; z: number };
  let normal: { x: number; y: number; z: number };

  if (args.axis) {
    const offset = (args.offset as number) ?? 0;
    switch (String(args.axis).toUpperCase()) {
      case 'X': point = { x: offset, y: 0, z: 0 }; normal = { x: 1, y: 0, z: 0 }; break;
      case 'Y': point = { x: 0, y: offset, z: 0 }; normal = { x: 0, y: 1, z: 0 }; break;
      default:  point = { x: 0, y: 0, z: offset }; normal = { x: 0, y: 0, z: 1 }; break;
    }
  } else {
    point = { x: (args.pointX as number) ?? 0, y: (args.pointY as number) ?? 0, z: (args.pointZ as number) ?? 0 };
    normal = { x: (args.normalX as number) ?? 0, y: (args.normalY as number) ?? 0, z: (args.normalZ as number) ?? 1 };
  }

  await ss.cutPlateObjectByPlane(id, point, normal);
  return { ok: true, id, point, normal };
};

// ── Preview visualization ─────────────────────────────────────────────────────

const slicer_set_preview_color_mode: ToolHandler = async (args) => {
  const mode = args.mode as PreviewColorMode;
  slicerStore().setPreviewColorMode(mode);
  return { ok: true, mode };
};

const slicer_set_preview_render_mode: ToolHandler = async (args) => {
  const mode = args.mode as 'solid' | 'wireframe';
  slicerStore().setPreviewRenderMode(mode);
  return { ok: true, mode };
};

const slicer_set_preview_show_travel: ToolHandler = async (args) => {
  const show = String(args.show) === 'true';
  slicerStore().setPreviewShowTravel(show);
  return { ok: true, show };
};

const slicer_set_preview_show_retractions: ToolHandler = async (args) => {
  const show = String(args.show) === 'true';
  slicerStore().setPreviewShowRetractions(show);
  return { ok: true, show };
};

const slicer_toggle_preview_feature_type: ToolHandler = async (args) => {
  const type = args.type as string;
  slicerStore().togglePreviewType(type);
  const hidden = slicerStore().previewHiddenTypes;
  return { ok: true, type, nowHidden: hidden.includes(type) };
};

const slicer_set_section_plane: ToolHandler = async (args) => {
  const enabled = String(args.enabled) === 'true';
  const ss = slicerStore();
  ss.setPreviewSectionEnabled(enabled);
  if (args.z !== undefined) ss.setPreviewSectionZ(args.z as number);
  return { ok: true, enabled, z: ss.previewSectionZ };
};

// ── Nozzle simulation ─────────────────────────────────────────────────────────

const slicer_set_sim_enabled: ToolHandler = async (args) => {
  const enabled = String(args.enabled) === 'true';
  slicerStore().setPreviewSimEnabled(enabled);
  return { ok: true, enabled };
};

const slicer_set_sim_playing: ToolHandler = async (args) => {
  const playing = String(args.playing) === 'true';
  slicerStore().setPreviewSimPlaying(playing);
  return { ok: true, playing };
};

const slicer_set_sim_time: ToolHandler = async (args) => {
  const ss = slicerStore();
  const totalTime = ss.sliceResult?.printTime ?? 0;
  const time = Math.max(0, Math.min(args.time as number, totalTime));
  ss.setPreviewSimTime(time);
  return { ok: true, time };
};

const slicer_set_sim_speed: ToolHandler = async (args) => {
  slicerStore().setPreviewSimSpeed(args.speed as number);
  return { ok: true, speed: args.speed };
};

// ── Analytics ─────────────────────────────────────────────────────────────────

const slicer_get_slice_stats: ToolHandler = async () => {
  const ss = slicerStore();
  if (!ss.sliceResult) throw new Error('No slice result — run slicer_start_slice first.');
  const mat = ss.getActiveMaterialProfile();
  const printer = ss.getActivePrinterProfile();
  const stats = computeSliceStats(ss.sliceResult, {
    diameterMm: printer.filamentDiameter ?? 1.75,
    densityGPerCm3: mat.density ?? 1.24,
    costPerKg: mat.costPerKg,
  });
  const issues = detectPrintIssues(ss.sliceResult, stats);
  return {
    byFeature: stats.byFeature,
    totalFilamentMm: stats.totalFilamentMm,
    totalFilamentG: stats.totalFilamentG,
    totalPrintTimeSec: stats.totalPrintTimeSec,
    estimatedCostUsd: stats.estimatedCostUsd,
    issues: issues.map((i) => ({ kind: i.kind, severity: i.severity, layerIndex: i.layerIndex, z: i.z, message: i.message })),
  };
};

// ── Physical printer machine control ─────────────────────────────────────────

function printerStore() { return usePrinterStore.getState(); }

const printer_list_printers: ToolHandler = async () => {
  const ps = printerStore();
  return {
    activePrinterId: ps.activePrinterId,
    printers: ps.printers.map((printer) => ({
      id: printer.id,
      name: printer.name,
      active: printer.id === ps.activePrinterId,
      configured: Boolean(printer.config.hostname),
    })),
  };
};

const printer_select_printer: ToolHandler = async (args) => {
  const id = String(args.id ?? '');
  const ps = printerStore();
  const printer = ps.printers.find((candidate) => candidate.id === id);
  if (!printer) throw new Error(`Printer not found: ${id}`);
  await ps.selectPrinter(id);
  return { ok: true, id, name: printer.name };
};

function requireConnected() {
  if (!printerStore().connected) throw new Error('Printer is not connected — call printer_connect first.');
}

const printer_get_status: ToolHandler = async () => {
  const ps = printerStore();
  const m = ps.model;
  const heat = m.heat;
  const heaters = heat?.heaters ?? [];
  const bedIdxs = heat?.bedHeaters ?? [];
  const chamberIdxs = heat?.chamberHeaters ?? [];

  const fmtHeater = (i: number) => {
    const h = heaters[i];
    return h ? { current: h.current, active: h.active, standby: h.standby, state: h.state } : null;
  };

  return {
    connected: ps.connected,
    connecting: ps.connecting,
    machineStatus: m.state?.status ?? 'unknown',
    currentTool: m.state?.currentTool ?? -1,
    upTime: m.state?.upTime ?? 0,
    temperatures: {
      bed: bedIdxs.map(fmtHeater).filter(Boolean),
      chamber: chamberIdxs.map(fmtHeater).filter(Boolean),
      tools: (m.tools ?? []).map((t) => ({
        number: t.number,
        name: t.name,
        heaters: t.heaters.map(fmtHeater).filter(Boolean),
      })),
    },
    fans: (m.fans ?? []).map((f, i) => ({ index: i, name: f.name, actual: f.actualValue, requested: f.requestedValue })),
    axes: (m.move?.axes ?? []).filter((a) => a.visible).map((a) => ({ letter: a.letter, position: a.machinePosition, homed: a.homed })),
    speedFactor: m.move?.speedFactor ?? 1,
    extruders: (m.move?.extruders ?? []).map((e, i) => ({ index: i, factor: e.factor, filament: e.filament })),
    job: m.job?.file?.fileName ? {
      fileName: m.job.file.fileName,
      duration: m.job.duration,
      layer: m.job.layer,
      totalLayers: m.job.file.numLayers,
      timesLeft: m.job.timesLeft,
    } : null,
  };
};

const printer_connect: ToolHandler = async () => {
  await printerStore().connect();
  return { ok: true };
};

const printer_disconnect: ToolHandler = async () => {
  await printerStore().disconnect(true);
  return { ok: true };
};

const printer_send_gcode: ToolHandler = async (args) => {
  requireConnected();
  await printerStore().sendGCode(args.code as string);
  return { ok: true, code: args.code };
};

const printer_set_tool_temp: ToolHandler = async (args) => {
  requireConnected();
  const tool = args.tool as number;
  const heater = args.heater as number;
  const temp = args.temp as number;
  await printerStore().setToolTemp(tool, heater, temp);
  if (args.standby !== undefined) {
    await printerStore().sendGCode(`G10 P${tool} R${args.standby as number}`);
  }
  return { ok: true, tool, heater, temp };
};

const printer_set_bed_temp: ToolHandler = async (args) => {
  requireConnected();
  await printerStore().setBedTemp(args.temp as number);
  return { ok: true, temp: args.temp };
};

const printer_set_chamber_temp: ToolHandler = async (args) => {
  requireConnected();
  await printerStore().setChamberTemp(args.temp as number);
  return { ok: true, temp: args.temp };
};

const printer_home_axes: ToolHandler = async (args) => {
  requireConnected();
  const axes = args.axes as string[] | undefined;
  await printerStore().homeAxes(axes?.length ? axes : undefined);
  return { ok: true, axes: axes ?? 'all' };
};

const printer_move_axis: ToolHandler = async (args) => {
  requireConnected();
  await printerStore().moveAxis(args.axis as string, args.distance as number);
  return { ok: true, axis: args.axis, distance: args.distance };
};

const printer_extrude: ToolHandler = async (args) => {
  requireConnected();
  await printerStore().extrude(args.amount as number, args.feedrate as number);
  return { ok: true, amount: args.amount, feedrate: args.feedrate };
};

const printer_set_baby_step: ToolHandler = async (args) => {
  requireConnected();
  await printerStore().setBabyStep(args.offset as number);
  return { ok: true, offset: args.offset };
};

const printer_set_speed_factor: ToolHandler = async (args) => {
  requireConnected();
  await printerStore().setSpeedFactor(args.percent as number);
  return { ok: true, percent: args.percent };
};

const printer_set_flow_factor: ToolHandler = async (args) => {
  requireConnected();
  const extruder = args.extruder as number;
  const percent = args.percent as number;
  if (extruder < 0) {
    await printerStore().setGlobalFlowFactor(percent);
  } else {
    await printerStore().setExtrusionFactor(extruder, percent);
  }
  return { ok: true, extruder, percent };
};

const printer_set_fan_speed: ToolHandler = async (args) => {
  requireConnected();
  await printerStore().setFanSpeed(args.fan as number, args.speed as number);
  return { ok: true, fan: args.fan, speed: args.speed };
};

const printer_start_print: ToolHandler = async (args) => {
  requireConnected();
  await printerStore().startPrint(args.filename as string);
  return { ok: true, filename: args.filename };
};

const printer_pause_print: ToolHandler = async () => {
  requireConnected();
  await printerStore().pausePrint();
  return { ok: true };
};

const printer_resume_print: ToolHandler = async () => {
  requireConnected();
  await printerStore().resumePrint();
  return { ok: true };
};

const printer_cancel_print: ToolHandler = async () => {
  requireConnected();
  await printerStore().cancelPrint();
  return { ok: true };
};

const printer_emergency_stop: ToolHandler = async () => {
  await printerStore().emergencyStop();
  return { ok: true };
};

const printer_list_files: ToolHandler = async (args) => {
  requireConnected();
  const dir = (args.directory as string | undefined) || '0:/gcodes';
  await printerStore().navigateToDirectory(dir);
  return { directory: dir, files: printerStore().files };
};

const printer_delete_file: ToolHandler = async (args) => {
  requireConnected();
  await printerStore().deleteFile(args.path as string);
  return { ok: true, path: args.path };
};

const printer_list_macros: ToolHandler = async () => {
  requireConnected();
  await printerStore().refreshMacros();
  return { macros: printerStore().macros };
};

const printer_run_macro: ToolHandler = async (args) => {
  requireConnected();
  await printerStore().runMacro(args.filename as string);
  return { ok: true, filename: args.filename };
};

const printer_load_filament: ToolHandler = async (args) => {
  requireConnected();
  await printerStore().loadFilament(args.tool as number, args.name as string);
  return { ok: true, tool: args.tool, name: args.name };
};

const printer_unload_filament: ToolHandler = async (args) => {
  requireConnected();
  await printerStore().unloadFilament(args.tool as number);
  return { ok: true, tool: args.tool };
};

// ── Vision / AI print monitoring ─────────────────────────────────────────────

function boolArg(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

function numArg(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function activePrinterName() {
  const ps = printerStore();
  return ps.printers.find((printer) => printer.id === ps.activePrinterId)?.name ?? 'Active printer';
}

function currentVisionGeometryContext() {
  const ss = slicerStore();
  const base = {
    plateObjects: ss.plateObjects.map((object) => ({
      id: object.id,
      name: object.name,
      position: object.position,
      rotation: object.rotation,
      scale: object.scale,
    })),
    sliceProgress: ss.sliceProgress,
  };
  if (!ss.sliceResult) return base;
  const material = ss.getActiveMaterialProfile();
  const printer = ss.getActivePrinterProfile();
  const stats = computeSliceStats(ss.sliceResult, {
    diameterMm: printer.filamentDiameter ?? 1.75,
    densityGPerCm3: material.density ?? 1.24,
    costPerKg: material.costPerKg,
  });
  return {
    ...base,
    slice: {
      layerCount: ss.sliceResult.layerCount,
      printTime: ss.sliceResult.printTime,
      filamentUsed: ss.sliceResult.filamentUsed,
      stats,
    },
  };
}

function notifyVisionFailure(summary: string): void {
  window.dispatchEvent(new CustomEvent('vision:failure-detected', { detail: { summary } }));
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification('Cindr3D vision alert', { body: summary });
  } catch {
    // Notification availability varies by browser and context.
  }
}

function currentExpectedLayerTimeSec(): number | undefined {
  const ss = slicerStore();
  const firmwareLayer = printerStore().model.job?.layer;
  const layer = firmwareLayer === undefined ? ss.previewLayer : Math.max(0, firmwareLayer - 1);
  const layers = ss.sliceResult?.layers as unknown;
  if (!Array.isArray(layers)) return undefined;
  const record = layers[layer] as Record<string, unknown> | undefined;
  const duration = record?.duration ?? record?.time ?? record?.layerTime;
  return typeof duration === 'number' ? duration : undefined;
}

function currentMotorCurrents() {
  const model = printerStore().model as Record<string, unknown>;
  const move = model.move as Record<string, unknown> | undefined;
  return move?.currentMove ?? move?.drives ?? move?.axes;
}

function recordVisionFrame(frame: VisionFrameSample): void {
  const ps = printerStore();
  useVisionStore.getState().recordFrame({
    id: crypto.randomUUID(),
    printerId: ps.activePrinterId,
    printerName: activePrinterName(),
    createdAt: Date.now(),
    frame,
  });
}

const vision_check_print: ToolHandler = async (args) => {
  const ai = useAiAssistantStore.getState();
  const ps = printerStore();
  const vision = useVisionStore.getState();
  const persistedSettings = vision.failureSettings;
  const settings: VisionFailureSettings = {
    sampleIntervalSec: numArg(args.sampleIntervalSec, persistedSettings.sampleIntervalSec),
    confidenceThreshold: numArg(args.confidenceThreshold, persistedSettings.confidenceThreshold),
    autoPauseEnabled: boolArg(args.autoPauseEnabled, persistedSettings.autoPauseEnabled),
    requireUserConfirmation: boolArg(args.requireUserConfirmation, persistedSettings.requireUserConfirmation),
  };
  if (boolArg(args.saveSettings, false)) vision.updateFailureSettings(settings);

  const frame = await captureVisionFrame(getDuetPrefs(), {
    cameraId: typeof args.cameraId === 'string' ? args.cameraId : undefined,
    fallbackUrl: typeof args.fallbackUrl === 'string' ? args.fallbackUrl : undefined,
  });
  recordVisionFrame(frame);
  const result = await classifyPrintFrame({
    frame,
    settings,
    provider: { provider: ai.provider, model: ai.model, apiKey: ai.apiKey },
    context: {
      printer: summarizePrinterModel(ps.activePrinterId, activePrinterName(), ps.model),
      geometry: currentVisionGeometryContext(),
      recentNotes: typeof args.notes === 'string' ? [args.notes] : undefined,
    },
  });
  vision.recordCheck({
    id: crypto.randomUUID(),
    printerId: ps.activePrinterId,
    printerName: activePrinterName(),
    cameraId: frame.cameraId,
    cameraLabel: frame.cameraLabel,
    createdAt: Date.now(),
    result,
  });

  const action = {
    pauseAttempted: false,
    pauseSent: false,
    blockedByConfirmation: result.requiresConfirmation,
  };
  if (result.shouldPause) {
    notifyVisionFailure(result.summary);
    if (!result.requiresConfirmation || boolArg(args.confirmAutoAction, false)) {
      requireConnected();
      action.pauseAttempted = true;
      await ps.pausePrint();
      action.pauseSent = true;
      action.blockedByConfirmation = false;
    }
  }

  return {
    frame: {
      cameraId: frame.cameraId,
      cameraLabel: frame.cameraLabel,
      capturedAt: frame.capturedAt,
      mimeType: frame.mimeType,
      size: frame.size,
    },
    result,
    settings,
    action,
  };
};

const diagnose_print: ToolHandler = async (args) => {
  const ai = useAiAssistantStore.getState();
  const ps = printerStore();
  const vision = useVisionStore.getState();
  const frameCount = Math.max(1, Math.min(5, Math.round(numArg(args.frameCount, 3))));
  const cameraId = typeof args.cameraId === 'string' ? args.cameraId : undefined;
  const recentFrames = vision.recentFrames
    .filter((record) => record.printerId === ps.activePrinterId && (!cameraId || record.frame.cameraId === cameraId))
    .slice(0, Math.max(0, frameCount - 1))
    .map((record) => record.frame);
  const freshFrame = await captureVisionFrame(getDuetPrefs(), {
    cameraId,
    fallbackUrl: typeof args.fallbackUrl === 'string' ? args.fallbackUrl : undefined,
  });
  recordVisionFrame(freshFrame);

  const printer = summarizePrinterModel(ps.activePrinterId, activePrinterName(), ps.model);
  const expectedLayerTimeSec = currentExpectedLayerTimeSec();
  const result = await diagnosePrint({
    provider: { provider: ai.provider, model: ai.model, apiKey: ai.apiKey },
    frames: [freshFrame, ...recentFrames].slice(0, frameCount),
    telemetry: {
      printer,
      motorCurrents: currentMotorCurrents(),
      filamentSensorState: printer.filamentMonitorStatus,
      expectedLayerTimeSec,
      actualLayerTimeSec: printer.layerTimeSec,
      slicerLayerDeltaSec: expectedLayerTimeSec !== undefined && printer.layerTimeSec !== undefined
        ? printer.layerTimeSec - expectedLayerTimeSec
        : undefined,
      geometry: currentVisionGeometryContext(),
      recentFailureChecks: vision.recentChecks
        .filter((record) => record.printerId === ps.activePrinterId)
        .slice(0, 5)
        .map((record) => ({
          category: record.result.category,
          confidence: record.result.confidence,
          severity: record.result.severity,
          summary: record.result.summary,
          createdAt: record.createdAt,
        })),
      operatorNotes: typeof args.notes === 'string' ? [args.notes] : undefined,
    },
  });
  vision.recordDiagnosis({
    id: crypto.randomUUID(),
    printerId: ps.activePrinterId,
    printerName: activePrinterName(),
    createdAt: Date.now(),
    result,
  });

  return {
    result,
    framesUsed: [freshFrame, ...recentFrames].slice(0, frameCount).map((frame) => ({
      cameraId: frame.cameraId,
      cameraLabel: frame.cameraLabel,
      capturedAt: frame.capturedAt,
      mimeType: frame.mimeType,
      size: frame.size,
    })),
  };
};

const tuning_analyze_tower: ToolHandler = async (args) => {
  const ai = useAiAssistantStore.getState();
  const ps = printerStore();
  const vision = useVisionStore.getState();
  const kind = String(args.kind ?? 'pressure-advance') as TuningWizardKind;
  const frameCount = Math.max(1, Math.min(5, Math.round(numArg(args.frameCount, 3))));
  const cameraId = typeof args.cameraId === 'string' ? args.cameraId : undefined;
  const recentFrames = vision.recentFrames
    .filter((record) => record.printerId === ps.activePrinterId && (!cameraId || record.frame.cameraId === cameraId))
    .slice(0, Math.max(0, frameCount - 1))
    .map((record) => record.frame);
  const freshFrame = await captureVisionFrame(getDuetPrefs(), {
    cameraId,
    fallbackUrl: typeof args.fallbackUrl === 'string' ? args.fallbackUrl : undefined,
  });
  recordVisionFrame(freshFrame);

  const recommendation = await analyzeTuningTower({
    provider: { provider: ai.provider, model: ai.model, apiKey: ai.apiKey },
    frames: [freshFrame, ...recentFrames].slice(0, frameCount),
    context: {
      kind,
      printer: summarizePrinterModel(ps.activePrinterId, activePrinterName(), ps.model),
      startValue: args.startValue === undefined ? undefined : numArg(args.startValue, 0),
      stepPerMm: args.stepPerMm === undefined ? undefined : numArg(args.stepPerMm, 0.005),
      towerHeightMm: args.towerHeightMm === undefined ? undefined : numArg(args.towerHeightMm, 0),
      axis: args.axis === 'X' || args.axis === 'Y' ? args.axis : undefined,
      material: slicerStore().getActiveMaterialProfile(),
      operatorNotes: typeof args.notes === 'string' ? [args.notes] : undefined,
    },
  });

  return {
    recommendation,
    framesUsed: [freshFrame, ...recentFrames].slice(0, frameCount).map((frame) => ({
      cameraId: frame.cameraId,
      cameraLabel: frame.cameraLabel,
      capturedAt: frame.capturedAt,
      mimeType: frame.mimeType,
      size: frame.size,
    })),
  };
};

const resource_active_printer: ToolHandler = async () => {
  try {
    const ps = usePrinterStore.getState();
    const printerState = ps as unknown as Record<string, unknown>;
    const printer = printerState.activePrinter ?? printerState.selectedPrinter ?? null;
    return { printer };
  } catch {
    return { printer: null };
  }
};

// ── Registry ───────────────────────────────────────────────────────────────

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  list_objects,
  get_object_properties,
  select_objects,
  snapshot_view,
  create_box,
  create_cylinder,
  create_sphere,
  create_cone,
  start_sketch,
  sketch_rect,
  sketch_circle,
  sketch_polygon,
  sketch_dimension,
  finish_sketch,
  extrude_sketch,
  revolve_sketch,
  fillet_edges,
  chamfer_edges,
  hole,
  boolean_union,
  boolean_subtract,
  boolean_intersect,
  transform,
  mirror,
  linear_pattern,
  circular_pattern,
  save_session,
  export_stl,
  export_step,
  export_gcode,
  resource_document_summary,
  resource_document_objects,
  resource_active_printer,
  resource_feature_tree,
  slicer_get_settings,
  slicer_set_setting,
  slicer_list_profiles,
  slicer_set_active_profile,
  slicer_list_plate_objects,
  slicer_start_slice,
  slicer_get_status,
  slicer_get_printer_settings,
  slicer_set_printer_setting,
  slicer_get_material_settings,
  slicer_set_material_setting,
  slicer_transform_plate_object,
  slicer_auto_orient_object,
  slicer_drop_to_bed,
  slicer_center_object,
  slicer_scale_to_height,
  slicer_auto_arrange,
  slicer_remove_plate_object,
  slicer_set_per_object_setting,
  slicer_run_printability_check,
  slicer_download_gcode,
  slicer_set_camera_preset,
  slicer_fit_to_plate,
  slicer_focus_object,
  slicer_set_preview_mode,
  slicer_set_preview_layer,
  slicer_set_preview_layer_range,
  slicer_undo,
  slicer_redo,
  slicer_duplicate_plate_object,
  slicer_select_plate_object,
  slicer_clear_selection,
  slicer_get_selection,
  slicer_duplicate_selected,
  slicer_set_object_locked,
  slicer_set_object_hidden,
  slicer_set_object_color,
  slicer_clear_plate,
  slicer_resolve_overlaps,
  slicer_hollow_object,
  slicer_cut_object_by_plane,
  slicer_set_preview_color_mode,
  slicer_set_preview_render_mode,
  slicer_set_preview_show_travel,
  slicer_set_preview_show_retractions,
  slicer_toggle_preview_feature_type,
  slicer_set_section_plane,
  slicer_set_sim_enabled,
  slicer_set_sim_playing,
  slicer_set_sim_time,
  slicer_set_sim_speed,
  slicer_get_slice_stats,
  printer_list_printers,
  printer_select_printer,
  printer_get_status,
  printer_connect,
  printer_disconnect,
  printer_send_gcode,
  printer_set_tool_temp,
  printer_set_bed_temp,
  printer_set_chamber_temp,
  printer_home_axes,
  printer_move_axis,
  printer_extrude,
  printer_set_baby_step,
  printer_set_speed_factor,
  printer_set_flow_factor,
  printer_set_fan_speed,
  printer_start_print,
  printer_pause_print,
  printer_resume_print,
  printer_cancel_print,
  printer_emergency_stop,
  printer_list_files,
  printer_delete_file,
  printer_list_macros,
  printer_run_macro,
  printer_load_filament,
  printer_unload_filament,
  vision_check_print,
  diagnose_print,
  tuning_analyze_tower,
};
