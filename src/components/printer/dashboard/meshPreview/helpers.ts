import * as THREE from 'three';
import type { PlateObject } from '../../../../types/slicer';
import type { PreviewColorMode } from '../../../../types/slicer-preview.types';

export const NOZZLE_CROSSHAIR_POSITIONS = new Float32Array([-5, 0, 0, 5, 0, 0, 0, -5, 0, 0, 5, 0]);

export interface ContextMenuState {
  objectId: string;
  /** Screen coords relative to the panel root. */
  x: number;
  y: number;
}

export type HoverState = ContextMenuState;

export type PreviewViewPreset = 'iso' | 'top' | 'front' | 'side' | 'fit';
export type DashboardPreviewColorMode = PreviewColorMode | 'object';

export const DEFAULT_VIEW_PRESET: PreviewViewPreset = 'iso';
export const DEFAULT_COLOR_MODE: DashboardPreviewColorMode = 'type';

export interface PreviewBounds {
  center: THREE.Vector3;
  size: THREE.Vector3;
  radius: number;
}

export interface ObjectStatus {
  label: string;
  color: string;
}

export function objectMatrix(obj: PlateObject): THREE.Matrix4 {
  const pos = new THREE.Vector3(obj.position.x, obj.position.y, obj.position.z);
  const rot = new THREE.Euler(
    THREE.MathUtils.degToRad(obj.rotation.x),
    THREE.MathUtils.degToRad(obj.rotation.y),
    THREE.MathUtils.degToRad(obj.rotation.z),
  );
  const scl = new THREE.Vector3(
    (obj.mirrorX ? -1 : 1) * obj.scale.x,
    (obj.mirrorY ? -1 : 1) * obj.scale.y,
    (obj.mirrorZ ? -1 : 1) * obj.scale.z,
  );
  return new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(rot), scl);
}

export function isPreviewViewPreset(value: string | null): value is PreviewViewPreset {
  return value === 'top' || value === 'front' || value === 'side' || value === 'fit' || value === 'iso';
}

export function isDashboardPreviewColorMode(value: string | null): value is DashboardPreviewColorMode {
  return value === 'speed'
    || value === 'flow'
    || value === 'width'
    || value === 'layer-time'
    || value === 'wall-quality'
    || value === 'seam'
    || value === 'object'
    || value === 'type';
}

export function readStoredPreviewSettings(storageKey: string): {
  view: PreviewViewPreset;
  color: DashboardPreviewColorMode;
} {
  try {
    const savedView = window.localStorage.getItem(`${storageKey}:view`);
    const savedColor = window.localStorage.getItem(`${storageKey}:color`);
    return {
      view: isPreviewViewPreset(savedView) ? savedView : DEFAULT_VIEW_PRESET,
      color: isDashboardPreviewColorMode(savedColor) ? savedColor : DEFAULT_COLOR_MODE,
    };
  } catch {
    return { view: DEFAULT_VIEW_PRESET, color: DEFAULT_COLOR_MODE };
  }
}

export function computePreviewBounds(objects: PlateObject[], buildVolume: { x: number; y: number; z: number }): PreviewBounds {
  const box = new THREE.Box3();
  const scratch = new THREE.Vector3();
  let hasObjectBounds = false;

  for (const obj of objects) {
    if (obj.hidden) continue;
    const { min, max } = obj.boundingBox;
    const matrix = objectMatrix(obj);
    const corners = [
      [min.x, min.y, min.z], [max.x, min.y, min.z],
      [min.x, max.y, min.z], [max.x, max.y, min.z],
      [min.x, min.y, max.z], [max.x, min.y, max.z],
      [min.x, max.y, max.z], [max.x, max.y, max.z],
    ] as const;
    for (const [x, y, z] of corners) {
      scratch.set(x, y, z).applyMatrix4(matrix);
      box.expandByPoint(scratch);
      hasObjectBounds = true;
    }
  }

  if (!hasObjectBounds) {
    box.set(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(buildVolume.x, buildVolume.y, Math.max(1, buildVolume.z * 0.12)),
    );
  }

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    center,
    size,
    radius: Math.max(40, size.length() * 0.5, buildVolume.x * 0.45, buildVolume.y * 0.45),
  };
}

export function objectWorldCenter(obj: PlateObject): THREE.Vector3 {
  const { min, max } = obj.boundingBox;
  return new THREE.Vector3(
    (min.x + max.x) / 2,
    (min.y + max.y) / 2,
    max.z + 4,
  ).applyMatrix4(objectMatrix(obj));
}

export function objectApproxFilament(sliceWeightG: number | undefined, objectCount: number): string {
  if (!sliceWeightG || objectCount <= 0) return 'material --';
  return `material ~${(sliceWeightG / objectCount).toFixed(1)}g`;
}

export function axisPosition(model: { move?: { axes?: Array<{ letter: string; userPosition?: number; machinePosition?: number }> } }): { x: number; y: number; z: number } | null {
  const axis = (letter: string) => model.move?.axes?.find((candidate) => candidate.letter.toUpperCase() === letter);
  const x = axis('X')?.userPosition ?? axis('X')?.machinePosition;
  const y = axis('Y')?.userPosition ?? axis('Y')?.machinePosition;
  const z = axis('Z')?.userPosition ?? axis('Z')?.machinePosition;
  return typeof x === 'number' && typeof y === 'number' && typeof z === 'number' ? { x, y, z } : null;
}

export function clampLayerIndex(layer: number, totalLayers: number): number {
  return Math.max(0, Math.min(Math.max(0, totalLayers - 1), layer));
}

export function colorModeForPreview(mode: DashboardPreviewColorMode): PreviewColorMode {
  return mode === 'object' ? 'type' : mode;
}

export function previewCameraPose(view: PreviewViewPreset, bounds: PreviewBounds, buildVolume: { x: number; y: number; z: number }) {
  const target = bounds.center.clone();
  target.z = Math.max(target.z, Math.min(buildVolume.z * 0.25, bounds.size.z * 0.5));
  const distance = Math.max(bounds.radius * (view === 'fit' ? 2.1 : 2.45), buildVolume.z * 0.75, 160);
  const lift = Math.max(bounds.size.z * 0.65, buildVolume.z * 0.3, 55);

  if (view === 'top') {
    return { position: new THREE.Vector3(target.x, target.y, target.z + distance), target, up: new THREE.Vector3(0, 1, 0) };
  }
  if (view === 'front') {
    return { position: new THREE.Vector3(target.x, target.y - distance, target.z + lift), target, up: new THREE.Vector3(0, 0, 1) };
  }
  if (view === 'side') {
    return { position: new THREE.Vector3(target.x + distance, target.y, target.z + lift), target, up: new THREE.Vector3(0, 0, 1) };
  }
  return { position: new THREE.Vector3(target.x + distance * 0.8, target.y - distance * 0.75, target.z + distance * 0.65), target, up: new THREE.Vector3(0, 0, 1) };
}
