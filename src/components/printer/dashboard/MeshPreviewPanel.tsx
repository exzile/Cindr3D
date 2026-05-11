/**
 * MeshPreviewPanel — dashboard 3D preview of the active print.
 *
 * Shows the build plate, plate-object silhouettes, and the G-code toolpath
 * wireframe up to the layer currently being printed. Right-click an object
 * to open a context menu with stats and a per-object cancel button.
 *
 * Reuses BuildPlateGrid / BuildVolumeWireframe from the slicer scene plus
 * InlineGCodeWirePreview for the toolpath rendering — no slicing happens here.
 *
 * Current-layer source by firmware (all live, 1-based at the source,
 * converted to a 0-based index here for InlineGCodeWirePreview):
 *   Duet     → model.job.layer (RRF object model)
 *   Klipper  → useKlipperPrintStatus() (Moonraker print_stats / display_status,
 *              polled at 3 s); prefers explicit current_layer, otherwise
 *              estimates from display progress.
 *   Marlin   → model.job.layer populated by DuetService.handleSerialLine
 *              parsing M73 P/Q/R/S and "echo:Layer N/M" off the WebSerial
 *              line stream.
 *   Other    → falls back to slicerStore.previewLayer; if nothing, shows
 *              all layers.
 */
import { useState, useRef, useMemo, useCallback, useEffect, type ElementRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls, Text } from '@react-three/drei';
import {
  ArrowRight,
  ArrowUp,
  Box,
  Clock,
  Eye,
  Layers,
  Maximize2,
  Palette,
  Rotate3D,
  Ruler,
  Square,
  XCircle,
} from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { useSlicerStore } from '../../../store/slicerStore';
import { parseM486Labels } from '../../../services/gcode/m486Labels';
import { findMatchingObject, matchObjectNames } from '../../../services/gcode/objectNameMatch';
import { layerFromPercent } from '../../../services/gcode/marlinProgressParser';
import { useKlipperPrintStatus } from '../hooks/useKlipperPrintStatus';
import { computeSliceStats, detectPrintIssues } from '../../slicer/workspace/preview/sliceStats';
import { RiskMarkers } from '../../slicer/workspace/preview/RiskMarkers';
import { PrintSpaceLights } from '../../canvas/PrintSpaceLights';
import { BuildVolumeScene } from '../../canvas/BuildVolumeScene';
import { LayeredGCodePreview } from '../../canvas/LayeredGCodePreview';
import { panelStyle, sectionTitleStyle as labelStyle } from '../../../utils/printerPanelStyles';
import { colors as COLORS } from '../../../utils/theme';
import { formatDurationWords } from '../../../utils/printerFormat';
import type { PlateObject } from '../../../types/slicer';
import type { PreviewColorMode } from '../../../types/slicer-preview.types';

const NOZZLE_CROSSHAIR_POSITIONS = new Float32Array([-5, 0, 0, 5, 0, 0, 0, -5, 0, 0, 5, 0]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function objectMatrix(obj: PlateObject): THREE.Matrix4 {
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

interface ContextMenuState {
  objectId: string;
  /** Screen coords relative to the panel root. */
  x: number;
  y: number;
}

type HoverState = ContextMenuState;

type PreviewViewPreset = 'iso' | 'top' | 'front' | 'side' | 'fit';
type DashboardPreviewColorMode = PreviewColorMode | 'object';

const DEFAULT_VIEW_PRESET: PreviewViewPreset = 'iso';
const DEFAULT_COLOR_MODE: DashboardPreviewColorMode = 'type';

interface PreviewBounds {
  center: THREE.Vector3;
  size: THREE.Vector3;
  radius: number;
}

interface ObjectStatus {
  label: string;
  color: string;
}

function isPreviewViewPreset(value: string | null): value is PreviewViewPreset {
  return value === 'top' || value === 'front' || value === 'side' || value === 'fit' || value === 'iso';
}

function isDashboardPreviewColorMode(value: string | null): value is DashboardPreviewColorMode {
  return value === 'speed'
    || value === 'flow'
    || value === 'width'
    || value === 'layer-time'
    || value === 'wall-quality'
    || value === 'seam'
    || value === 'object'
    || value === 'type';
}

function readStoredPreviewSettings(storageKey: string): {
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

function computePreviewBounds(objects: PlateObject[], buildVolume: { x: number; y: number; z: number }): PreviewBounds {
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

function objectWorldCenter(obj: PlateObject): THREE.Vector3 {
  const { min, max } = obj.boundingBox;
  return new THREE.Vector3(
    (min.x + max.x) / 2,
    (min.y + max.y) / 2,
    max.z + 4,
  ).applyMatrix4(objectMatrix(obj));
}

function objectApproxFilament(sliceWeightG: number | undefined, objectCount: number): string {
  if (!sliceWeightG || objectCount <= 0) return 'material --';
  return `material ~${(sliceWeightG / objectCount).toFixed(1)}g`;
}

function axisPosition(model: { move?: { axes?: Array<{ letter: string; userPosition?: number; machinePosition?: number }> } }): { x: number; y: number; z: number } | null {
  const axis = (letter: string) => model.move?.axes?.find((candidate) => candidate.letter.toUpperCase() === letter);
  const x = axis('X')?.userPosition ?? axis('X')?.machinePosition;
  const y = axis('Y')?.userPosition ?? axis('Y')?.machinePosition;
  const z = axis('Z')?.userPosition ?? axis('Z')?.machinePosition;
  return typeof x === 'number' && typeof y === 'number' && typeof z === 'number' ? { x, y, z } : null;
}

function clampLayerIndex(layer: number, totalLayers: number): number {
  return Math.max(0, Math.min(Math.max(0, totalLayers - 1), layer));
}

function colorModeForPreview(mode: DashboardPreviewColorMode): PreviewColorMode {
  return mode === 'object' ? 'type' : mode;
}

function previewCameraPose(view: PreviewViewPreset, bounds: PreviewBounds, buildVolume: { x: number; y: number; z: number }) {
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

function PreviewCameraControls({
  buildVolume,
  bounds,
  revision,
  view,
}: {
  buildVolume: { x: number; y: number; z: number };
  bounds: PreviewBounds;
  revision: number;
  view: PreviewViewPreset;
}) {
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null);
  const { camera, invalidate } = useThree();

  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    const pose = previewCameraPose(view, bounds, buildVolume);
    camera.position.copy(pose.position);
    camera.up.copy(pose.up);
    camera.near = 0.5;
    camera.far = Math.max(buildVolume.x, buildVolume.y, buildVolume.z, bounds.radius) * 12;
    camera.lookAt(pose.target);
    camera.updateProjectionMatrix();
    controlsRef.current?.target.copy(pose.target);
    controlsRef.current?.update();
    invalidate();
  }, [bounds, buildVolume, camera, invalidate, revision, view]);
  /* eslint-enable react-hooks/immutability */

  return (
    <OrbitControls
      ref={controlsRef}
      target={[bounds.center.x, bounds.center.y, bounds.center.z]}
      enableDamping
      dampingFactor={0.12}
      minDistance={Math.max(buildVolume.x, buildVolume.y) * 0.25}
      maxDistance={Math.max(buildVolume.x, buildVolume.y, buildVolume.z) * 5}
    />
  );
}

// ── Object silhouette + wireframe mesh ────────────────────────────────────────

function ObjectSilhouette({
  obj,
  isCurrent,
  isCancelled,
  colorMode,
  onContextMenu,
  onHover,
  onHoverEnd,
}: {
  obj: PlateObject;
  isCurrent: boolean;
  isCancelled: boolean;
  colorMode: DashboardPreviewColorMode;
  onContextMenu: (e: ThreeEvent<MouseEvent>) => void;
  onHover: (e: ThreeEvent<PointerEvent>) => void;
  onHoverEnd: () => void;
}) {
  const matrix = useMemo(() => objectMatrix(obj), [obj]);
  // Reuse the geometry as-is; PlateObject geometry is already in model-local space.
  const geometry = obj.geometry as THREE.BufferGeometry | undefined;
  if (!geometry) return null;

  const baseColor = isCancelled ? '#ef4444' : isCurrent ? '#44aaff' : colorMode === 'object' ? (obj.color ?? '#7a89ff') : '#7a89ff';
  const opacity = isCancelled ? 0.08 : isCurrent ? 0.2 : colorMode === 'object' ? 0.18 : 0.1;
  const edgeOpacity = isCancelled ? 0.5 : isCurrent ? 1 : 0.7;

  return (
    <group matrixAutoUpdate={false} matrix={matrix}>
      <mesh
        geometry={geometry}
        onContextMenu={(e) => { e.stopPropagation(); onContextMenu(e); }}
        onPointerMove={(e) => { e.stopPropagation(); onHover(e); }}
        onPointerOut={onHoverEnd}
      >
        <meshBasicMaterial
          color={baseColor}
          transparent
          opacity={opacity}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Silhouette edges — visible regardless of solid material */}
      <lineSegments>
        <edgesGeometry args={[geometry, 25]} />
        <lineBasicMaterial color={baseColor} transparent opacity={edgeOpacity} linewidth={1} />
      </lineSegments>
    </group>
  );
}

// ── Context menu (DOM overlay, not in 3D scene) ──────────────────────────────

export function ObjectContextMenu({
  obj,
  position,
  isCancelled,
  isCurrent,
  onCancel,
  onClose,
}: {
  obj: PlateObject;
  position: { x: number; y: number };
  isCancelled: boolean;
  isCurrent: boolean;
  onCancel: () => void;
  onClose: () => void;
}) {
  const bb = obj.boundingBox;
  const dx = (bb.max.x - bb.min.x).toFixed(1);
  const dy = (bb.max.y - bb.min.y).toFixed(1);
  const dz = (bb.max.z - bb.min.z).toFixed(1);

  // Close on escape / outside click
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-mesh-ctx-menu]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);

  return (
    <div
      data-mesh-ctx-menu
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        background: 'var(--bg-secondary, #1a1a2e)',
        border: '1px solid var(--border, #2a2a4a)',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        padding: 8,
        minWidth: 200,
        fontSize: 11,
        zIndex: 50,
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div style={{
        fontWeight: 600, fontSize: 12, marginBottom: 6, paddingBottom: 6,
        borderBottom: '1px solid var(--border, #2a2a4a)',
        display: 'flex', alignItems: 'center', gap: 6,
        color: isCancelled ? '#ef4444' : isCurrent ? '#44aaff' : 'var(--text-primary)',
      }}>
        <Box size={12} /> {obj.name || obj.id.slice(0, 8)}
        {isCurrent && <span style={{ fontSize: 9, color: '#44aaff', fontWeight: 400 }}>· printing</span>}
        {isCancelled && <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 400 }}>· cancelled</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, color: 'var(--text-muted, #aaa)' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Ruler size={10} /> {dx} × {dy} × {dz} mm
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Clock size={10} /> Position {obj.position.x.toFixed(1)}, {obj.position.y.toFixed(1)}
        </div>
      </div>

      <button
        onClick={onCancel}
        disabled={isCancelled}
        style={{
          marginTop: 8, width: '100%',
          padding: '4px 8px',
          background: isCancelled ? 'transparent' : 'rgba(239, 68, 68, 0.12)',
          border: `1px solid ${isCancelled ? 'var(--border)' : '#ef4444'}`,
          color: isCancelled ? 'var(--text-muted)' : '#ef4444',
          borderRadius: 4,
          cursor: isCancelled ? 'not-allowed' : 'pointer',
          fontSize: 11,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        }}
      >
        <XCircle size={12} /> {isCancelled ? 'Already cancelled' : 'Cancel this object'}
      </button>
    </div>
  );
}

function ObjectStatusBadge({
  obj,
  status,
}: {
  obj: PlateObject;
  status: ObjectStatus;
}) {
  const position = useMemo(() => objectWorldCenter(obj), [obj]);
  return (
    <Html
      position={[position.x, position.y, position.z]}
      center
      distanceFactor={110}
      zIndexRange={[20, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div
        style={{
          padding: '2px 5px',
          borderRadius: 4,
          border: `1px solid ${status.color}`,
          background: 'rgba(10, 10, 20, 0.82)',
          color: status.color,
          fontSize: 9,
          fontWeight: 700,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          textTransform: 'uppercase',
        }}
      >
        {status.label}
      </div>
    </Html>
  );
}

function NozzleMarker({
  position,
  trail,
}: {
  position: { x: number; y: number; z: number } | null;
  trail: Array<{ x: number; y: number; z: number }>;
}) {
  const trailPoints = useMemo(
    () => trail.map((point) => [point.x, point.y, point.z + 2] as [number, number, number]),
    [trail],
  );

  if (!position) return null;

  return (
    <>
      {trailPoints.length > 1 && (
        <Line points={trailPoints} color="#facc15" transparent opacity={0.35} depthWrite={false} />
      )}
      <group position={[position.x, position.y, position.z + 3]}>
        <mesh>
          <sphereGeometry args={[1.8, 16, 16]} />
          <meshBasicMaterial color="#facc15" depthWrite={false} />
        </mesh>
        <mesh rotation={[Math.PI, 0, 0]} position={[0, 0, 4]}>
          <coneGeometry args={[2.4, 6, 18]} />
          <meshBasicMaterial color="#facc15" transparent opacity={0.7} depthWrite={false} />
        </mesh>
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[NOZZLE_CROSSHAIR_POSITIONS, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#facc15" transparent opacity={0.8} depthWrite={false} />
        </lineSegments>
        <Text position={[0, 0, 10]} fontSize={4} color="#facc15" anchorX="center" anchorY="middle">
          nozzle
        </Text>
      </group>
    </>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function MeshPreviewPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<HoverState | null>(null);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const boardType = usePrinterStore((s) => s.config.boardType);
  const model = usePrinterStore((s) => s.model);
  const cancelObject = usePrinterStore((s) => s.cancelObject);
  const sendGCode = usePrinterStore((s) => s.sendGCode);

  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const previewLayer = useSlicerStore((s) => s.previewLayer);
  const printerProfile = useSlicerStore((s) => s.getActivePrinterProfile());
  const materialProfile = useSlicerStore((s) => s.getActiveMaterialProfile());
  const printabilityReport = useSlicerStore((s) => s.printabilityReport);

  const bv = useMemo(() => printerProfile?.buildVolume ?? { x: 220, y: 220, z: 250 }, [printerProfile?.buildVolume]);
  const previewBounds = useMemo(() => computePreviewBounds(plateObjects, bv), [plateObjects, bv]);
  const hiddenTypes = useMemo(() => new Set<string>(), []);
  const storageScope = activePrinterId || boardType || 'default';
  const storageKey = `cindr3d:dashboard-print-preview:${storageScope}`;
  const initialStoredSettings = useMemo(() => readStoredPreviewSettings(storageKey), [storageKey]);
  const [viewPreset, setViewPreset] = useState<PreviewViewPreset>(() => initialStoredSettings.view);
  const [colorMode, setColorMode] = useState<DashboardPreviewColorMode>(() => initialStoredSettings.color);
  const [loadedStorageKey, setLoadedStorageKey] = useState(storageKey);
  const [viewRevision, setViewRevision] = useState(0);
  const [layerOverride, setLayerOverride] = useState<number | null>(null);
  const [nozzleTrail, setNozzleTrail] = useState<Array<{ x: number; y: number; z: number }>>([]);

  // Klipper has no in-store live layer; the shared hook polls Moonraker every
  // 3 s while connected and returns the latest synthesised status (null otherwise).
  const klipperStatus = useKlipperPrintStatus();
  const buildObjects = useMemo(() => model.job?.build?.objects ?? [], [model.job?.build?.objects]);
  const buildCurrentIdx = model.job?.build?.currentObject ?? -1;

  // ── Current layer (cross-firmware) ─────────────────────────────────────────
  // Returns a 0-based layer INDEX suitable for InlineGCodeWirePreview.
  // `model.job.layer` (Duet, Marlin via parser) and `klipperStatus.currentLayer`
  // are 1-based to match the rest of the printer UI; this hook converts.
  // The slicerStore preview slider is already 0-based.
  const totalLayers = sliceResult?.layerCount ?? 0;
  const currentLayer = useMemo(() => {
    const fromOneBased = (n: number) => Math.max(0, Math.min(Math.max(0, totalLayers - 1), n - 1));
    // Duet — live RRF object model
    if (boardType === 'duet' && model.job?.layer !== undefined) return fromOneBased(model.job.layer);
    // Marlin — DuetService.handleSerialLine populates model.job.layer from M73
    if (boardType === 'marlin' && model.job?.layer !== undefined) return fromOneBased(model.job.layer);
    // Klipper — Moonraker print-status; prefer explicit layer, else estimate from progress
    if (boardType === 'klipper' && klipperStatus) {
      if (klipperStatus.currentLayer !== undefined) return fromOneBased(klipperStatus.currentLayer);
      if (totalLayers > 0) return fromOneBased(layerFromPercent(klipperStatus.progress * 100, totalLayers));
    }
    // Fallback — slicer preview slider (already 0-based)
    return previewLayer ?? Math.max(0, totalLayers - 1);
  }, [boardType, model.job?.layer, klipperStatus, previewLayer, totalLayers]);
  const displayedLayer = layerOverride ?? currentLayer;
  const isLiveLayer = layerOverride === null;
  const displayedLayerData = sliceResult?.layers[displayedLayer];
  const layerTimeRange = useMemo<[number, number]>(() => {
    const times = sliceResult?.layers.map((layer) => layer.layerTime).filter((time) => Number.isFinite(time)) ?? [];
    if (times.length === 0) return [0, 1];
    return [Math.min(...times), Math.max(...times)];
  }, [sliceResult?.layers]);
  const sliceStats = useMemo(() => {
    if (!sliceResult) return null;
    return computeSliceStats(sliceResult, {
      diameterMm: printerProfile?.filamentDiameter ?? 1.75,
      densityGPerCm3: materialProfile?.density ?? 1.24,
      costPerKg: materialProfile?.costPerKg,
    });
  }, [materialProfile?.costPerKg, materialProfile?.density, printerProfile?.filamentDiameter, sliceResult]);
  const printIssues = useMemo(
    () => (sliceResult && sliceStats ? detectPrintIssues(sliceResult, sliceStats) : []),
    [sliceResult, sliceStats],
  );
  const currentLayerIssues = useMemo(
    () => printIssues.filter((issue) => issue.layerIndex === displayedLayer),
    [displayedLayer, printIssues],
  );
  const printabilityByObjectId = useMemo(
    () => new Map((printabilityReport?.objects ?? []).map((entry) => [entry.objectId, entry])),
    [printabilityReport?.objects],
  );
  const nozzlePosition = useMemo(() => axisPosition(model), [model]);
  const progressPercent = boardType === 'klipper' && klipperStatus
    ? klipperStatus.progress * 100
    : model.job?.filePosition !== undefined && model.job?.file?.size
      ? (model.job.filePosition / model.job.file.size) * 100
      : totalLayers > 0
        ? ((currentLayer + 1) / totalLayers) * 100
        : null;
  const elapsedSeconds = boardType === 'klipper' && klipperStatus ? klipperStatus.printDuration : model.job?.duration;
  const remainingSeconds = model.job?.timesLeft?.file;
  const activeObjectName = useMemo(() => {
    if (boardType === 'duet' && model.job?.build && buildCurrentIdx >= 0) {
      return model.job.build.objects[buildCurrentIdx]?.name ?? null;
    }
    if (boardType === 'klipper' && klipperStatus?.message) return klipperStatus.message;
    return null;
  }, [boardType, buildCurrentIdx, klipperStatus?.message, model.job?.build]);

  useEffect(() => {
    if (totalLayers <= 0) {
      setLayerOverride(null);
      return;
    }
    setLayerOverride((layer) => layer === null ? null : Math.max(0, Math.min(totalLayers - 1, layer)));
  }, [totalLayers]);

  useEffect(() => {
    const saved = readStoredPreviewSettings(storageKey);
    setLoadedStorageKey(storageKey);
    setViewPreset(saved.view);
    setColorMode(saved.color);
    setViewRevision((revision) => revision + 1);
  }, [storageKey]);

  useEffect(() => {
    if (loadedStorageKey !== storageKey) return;
    try {
      window.localStorage.setItem(`${storageKey}:view`, viewPreset);
      window.localStorage.setItem(`${storageKey}:color`, colorMode);
    } catch {
      /* ignore */
    }
  }, [colorMode, loadedStorageKey, storageKey, viewPreset]);

  useEffect(() => {
    if (!nozzlePosition) return;
    setNozzleTrail((trail) => {
      const previous = trail.at(-1);
      if (previous && Math.hypot(previous.x - nozzlePosition.x, previous.y - nozzlePosition.y, previous.z - nozzlePosition.z) < 0.1) return trail;
      return [...trail, nozzlePosition].slice(-16);
    });
  }, [nozzlePosition]);

  // ── Cancelled / currently-printing detection ───────────────────────────────
  const m486Labels = useMemo(
    () => parseM486Labels(sliceResult?.gcode ?? '').labels,
    [sliceResult?.gcode],
  );

  const cancelledNames = useMemo(() => {
    const set = new Set<string>();
    for (const o of buildObjects) if (o.cancelled) set.add(o.name);
    return set;
  }, [buildObjects]);

  const matchByName = useCallback((plateObj: PlateObject) => {
    // Try the live build-object list first (Duet only); fall back to M486
    // labels parsed out of the slicer output. Use the shared name matcher
    // so slicer-emitted suffixes like "_id_0_copy_1" don't break the match.
    const fromBuild = findMatchingObject(plateObj.name, buildObjects, (o) => o.name);
    if (fromBuild) return fromBuild.name;
    const fromLabels = findMatchingObject(plateObj.name, m486Labels, (l) => l.name);
    return fromLabels ? fromLabels.name : null;
  }, [buildObjects, m486Labels]);

  const isCurrentObject = useCallback((plateObj: PlateObject) => {
    // Duet exposes the live currently-printing object index in the model.
    if (boardType === 'duet' && buildCurrentIdx >= 0) {
      const cur = buildObjects[buildCurrentIdx];
      if (cur && matchObjectNames(plateObj.name, cur.name)) return true;
    }
    // Klipper exposes the active object name on print_stats.
    if (boardType === 'klipper' && klipperStatus?.message) {
      // Klipper sets `message` to e.g. "Printing object Cube" — best-effort match.
      if (matchObjectNames(plateObj.name, klipperStatus.message)) return true;
    }
    return false;
  }, [boardType, buildCurrentIdx, buildObjects, klipperStatus]);

  const isCancelledObject = useCallback((plateObj: PlateObject) => {
    const matched = matchByName(plateObj);
    return matched ? cancelledNames.has(matched) : false;
  }, [matchByName, cancelledNames]);

  const objectStatus = useCallback((plateObj: PlateObject): ObjectStatus => {
    if (isCancelledObject(plateObj)) return { label: 'cancelled', color: '#ef4444' };
    if (isCurrentObject(plateObj)) return { label: 'printing', color: '#44aaff' };
    const report = printabilityByObjectId.get(plateObj.id);
    if (report?.issues.some((issue) => issue.severity === 'error')) return { label: 'risk', color: '#f97316' };
    if (report?.issues.some((issue) => issue.severity === 'warning')) return { label: 'check', color: '#facc15' };
    return { label: 'queued', color: '#a7f3d0' };
  }, [isCancelledObject, isCurrentObject, printabilityByObjectId]);

  // ── Context menu state ─────────────────────────────────────────────────────
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => () => {
    if (hoverFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverFrameRef.current);
    }
  }, []);

  const setPreviewView = useCallback((view: PreviewViewPreset) => {
    setViewPreset(view);
    setViewRevision((revision) => revision + 1);
  }, []);

  const setManualLayer = useCallback((layer: number) => {
    if (totalLayers <= 0) return;
    setLayerOverride(clampLayerIndex(layer, totalLayers));
  }, [totalLayers]);

  const handleLayerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setManualLayer(displayedLayer - (event.shiftKey ? 10 : 1));
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      setManualLayer(displayedLayer + (event.shiftKey ? 10 : 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setManualLayer(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setManualLayer(totalLayers - 1);
    } else if (event.key.toLowerCase() === 'l') {
      event.preventDefault();
      setLayerOverride(null);
    }
  }, [displayedLayer, setManualLayer, totalLayers]);

  const syncCameraOverlay = useCallback(() => {
    window.dispatchEvent(new CustomEvent('cindr3d:print-preview-sync-camera', {
      detail: {
        layer: displayedLayer,
        objectName: activeObjectName,
        view: viewPreset,
        bounds: { center: previewBounds.center.toArray(), radius: previewBounds.radius },
      },
    }));
  }, [activeObjectName, displayedLayer, previewBounds.center, previewBounds.radius, viewPreset]);

  const handleObjectContextMenu = (objectId: string) => (e: ThreeEvent<MouseEvent>) => {
    e.nativeEvent.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenu({
      objectId,
      // Clamp to [0, max] so the menu stays inside the panel even when the
      // panel is narrower than the menu itself.
      x: Math.max(0, Math.min(e.nativeEvent.clientX - rect.left, rect.width - 220)),
      y: Math.max(0, Math.min(e.nativeEvent.clientY - rect.top, rect.height - 140)),
    });
  };

  const clearObjectHover = useCallback(() => {
    pendingHoverRef.current = null;
    if (hoverFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = null;
    }
    setHover(null);
  }, []);

  const handleObjectHover = (objectId: string) => (e: ThreeEvent<PointerEvent>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    pendingHoverRef.current = {
      objectId,
      x: Math.max(8, Math.min(e.nativeEvent.clientX - rect.left + 10, rect.width - 210)),
      y: Math.max(8, Math.min(e.nativeEvent.clientY - rect.top + 10, rect.height - 92)),
    };
    if (hoverFrameRef.current !== null) return;
    hoverFrameRef.current = window.requestAnimationFrame(() => {
      hoverFrameRef.current = null;
      const nextHover = pendingHoverRef.current;
      if (!nextHover) return;
      setHover((previous) => {
        if (
          previous
          && previous.objectId === nextHover.objectId
          && Math.abs(previous.x - nextHover.x) < 4
          && Math.abs(previous.y - nextHover.y) < 4
        ) {
          return previous;
        }
        return nextHover;
      });
    });
  };

  const menuObj = menu ? plateObjects.find((p) => p.id === menu.objectId) : null;
  const hoverObj = hover ? plateObjects.find((p) => p.id === hover.objectId) : null;
  const hoverReport = hoverObj ? printabilityByObjectId.get(hoverObj.id) : null;

  const handleCancelFromMenu = useCallback(async () => {
    if (!menuObj) return;
    const matched = matchByName(menuObj);
    try {
      if (boardType === 'duet' && matched) {
        const idx = buildObjects.findIndex((o) => matchObjectNames(o.name, matched));
        if (idx >= 0) await cancelObject(idx);
      } else if (boardType === 'klipper' && matched) {
        await sendGCode(`EXCLUDE_OBJECT NAME=${matched}`);
      } else if (boardType === 'marlin' && matched) {
        const label = m486Labels.find((l) => matchObjectNames(l.name, matched));
        if (label) await sendGCode(`M486 P${label.id}`);
      }
    } finally {
      setMenu(null);
    }
  }, [menuObj, matchByName, boardType, buildObjects, cancelObject, sendGCode, m486Labels]);

  // ── Empty state ────────────────────────────────────────────────────────────
  const hasContent = plateObjects.length > 0 || (sliceResult && sliceResult.layers.length > 0);

  return (
    <div style={panelStyle({ display: 'flex', flexDirection: 'column', minHeight: 220, padding: 0 })} ref={containerRef}>
      <div style={{ ...labelStyle({ padding: '8px 10px 4px' }), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Layers size={14} /> Print Preview
        </span>
        <span style={{ fontSize: 10, color: COLORS.textDim ?? '#666', display: 'flex', gap: 6 }}>
          {totalLayers > 0 && (
            <span>{isLiveLayer ? 'Live' : 'Preview'} L{Math.min(displayedLayer + 1, totalLayers)} / {totalLayers}</span>
          )}
          {boardType === 'klipper' && klipperStatus && klipperStatus.progress > 0 && (
            <span>{(klipperStatus.progress * 100).toFixed(0)}%</span>
          )}
        </span>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 180, background: 'var(--bg-secondary, #0d0d1a)' }}>
        {!hasContent ? (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: COLORS.textDim ?? '#666', fontSize: 11, padding: 16, textAlign: 'center',
          }}>
            Slice a model in the Prepare workspace to populate the preview.
          </div>
        ) : (
          <>
            <Canvas
              camera={{
                position: [bv.x * 1.2, -bv.y * 0.8, bv.z * 1.4],
                fov: 45,
                near: 0.5,
                far: Math.max(bv.x, bv.y, bv.z) * 12,
                up: [0, 0, 1],
              }}
              frameloop="demand"
              style={{ width: '100%', height: '100%' }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <PrintSpaceLights />

              <BuildVolumeScene bv={bv} />

              {plateObjects.map((obj) => (
                <ObjectSilhouette
                  key={obj.id}
                  obj={obj}
                  isCurrent={isCurrentObject(obj)}
                  isCancelled={isCancelledObject(obj)}
                  colorMode={colorMode}
                  onContextMenu={handleObjectContextMenu(obj.id)}
                  onHover={handleObjectHover(obj.id)}
                  onHoverEnd={clearObjectHover}
                />
              ))}

              {plateObjects.map((obj) => (
                <ObjectStatusBadge key={`${obj.id}:status`} obj={obj} status={objectStatus(obj)} />
              ))}

              <NozzleMarker position={nozzlePosition} trail={nozzleTrail} />

              {sliceResult && (
                <LayeredGCodePreview
                  sliceResult={sliceResult}
                  displayedLayer={displayedLayer}
                  colorMode={colorModeForPreview(colorMode)}
                  hiddenTypes={hiddenTypes}
                  layerTimeRange={layerTimeRange}
                />
              )}

              {displayedLayerData && currentLayerIssues.length > 0 && (
                <RiskMarkers issues={currentLayerIssues} z={displayedLayerData.z} />
              )}

              <PreviewCameraControls
                buildVolume={bv}
                bounds={previewBounds}
                revision={viewRevision}
                view={viewPreset}
              />
            </Canvas>
            <div
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                display: 'flex',
                gap: 4,
                pointerEvents: 'auto',
              }}
            >
              {[
                ['iso', 'Isometric view', Rotate3D],
                ['top', 'Top view', Square],
                ['front', 'Front view', ArrowUp],
                ['side', 'Side view', ArrowRight],
                ['fit', 'Fit print', Maximize2],
                ['sync', 'Sync camera overlay', Eye],
              ].map(([view, title, Icon]) => (
                <button
                  key={view as string}
                  type="button"
                  title={title as string}
                  aria-label={title as string}
                  onClick={() => view === 'sync' ? syncCameraOverlay() : setPreviewView(view as PreviewViewPreset)}
                  style={{
                    width: 24,
                    height: 24,
                    border: `1px solid ${viewPreset === view ? '#44aaff' : 'var(--border, #2a2a4a)'}`,
                    borderRadius: 4,
                    background: viewPreset === view ? 'rgba(68, 170, 255, 0.18)' : 'rgba(10, 10, 20, 0.76)',
                    color: viewPreset === view ? '#9bd7ff' : 'var(--text-muted, #aaa)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <Icon size={13} />
                </button>
              ))}
            </div>

            <label
              style={{
                position: 'absolute',
                top: 8,
                left: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 6px',
                border: '1px solid var(--border, #2a2a4a)',
                borderRadius: 6,
                background: 'rgba(10, 10, 20, 0.76)',
                color: 'var(--text-muted, #aaa)',
                fontSize: 10,
                pointerEvents: 'auto',
              }}
            >
              <Palette size={12} />
              <select
                value={colorMode}
                aria-label="Preview color mode"
                onChange={(event) => setColorMode(event.currentTarget.value as DashboardPreviewColorMode)}
                style={{
                  background: 'transparent',
                  border: 0,
                  color: 'inherit',
                  fontSize: 10,
                  outline: 'none',
                }}
              >
                <option value="type">Type</option>
                <option value="speed">Speed</option>
                <option value="layer-time">Layer time</option>
                <option value="flow">Extrusion</option>
                <option value="width">Width</option>
                <option value="object">Object</option>
              </select>
            </label>

            {colorMode !== 'type' && colorMode !== 'object' && (
              <div
                style={{
                  position: 'absolute',
                  top: 42,
                  left: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 6px',
                  border: '1px solid var(--border, #2a2a4a)',
                  borderRadius: 6,
                  background: 'rgba(10, 10, 20, 0.76)',
                  color: 'var(--text-muted, #aaa)',
                  fontSize: 9,
                  pointerEvents: 'none',
                }}
              >
                <span style={{ width: 32, height: 5, borderRadius: 999, background: 'linear-gradient(90deg, #3b82f6, #22c55e, #f97316)' }} />
                <span>{colorMode === 'flow' ? 'low to high extrusion' : colorMode === 'layer-time' ? 'fast to slow layer' : colorMode === 'speed' ? 'slow to fast' : 'narrow to wide'}</span>
              </div>
            )}

            {totalLayers > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: 8,
                  right: 8,
                  bottom: 8,
                  display: 'grid',
                  gridTemplateColumns: 'minmax(90px, 1fr) auto',
                  gap: 8,
                  alignItems: 'center',
                  padding: '6px 8px',
                  background: 'rgba(10, 10, 20, 0.82)',
                  border: '1px solid var(--border, #2a2a4a)',
                  borderRadius: 6,
                  pointerEvents: 'auto',
                  backdropFilter: 'blur(6px)',
                }}
              >
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, totalLayers - 1)}
                  value={displayedLayer}
                  aria-label="Preview layer"
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={handleLayerKeyDown}
                  onWheel={(e) => {
                    e.stopPropagation();
                    setManualLayer(displayedLayer + (e.deltaY > 0 ? 1 : -1));
                  }}
                  onChange={(e) => setManualLayer(Number(e.currentTarget.value))}
                  style={{ width: '100%', minWidth: 0 }}
                />
                <button
                  type="button"
                  onClick={() => setLayerOverride(null)}
                  disabled={isLiveLayer}
                  title="Return to live layer"
                  aria-label="Return to live layer"
                  style={{
                    border: '1px solid var(--border, #2a2a4a)',
                    borderRadius: 4,
                    background: isLiveLayer ? 'transparent' : 'rgba(68, 170, 255, 0.14)',
                    color: isLiveLayer ? 'var(--text-muted, #777)' : '#9bd7ff',
                    cursor: isLiveLayer ? 'default' : 'pointer',
                    fontSize: 10,
                    padding: '3px 7px',
                  }}
                >
                  Live
                </button>
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--text-muted, #aaa)', fontSize: 10, flexWrap: 'wrap' }}>
                  <span>Layer {displayedLayer + 1} / {totalLayers}</span>
                  <span>Z {sliceResult?.layers[displayedLayer]?.z?.toFixed(2) ?? '--'} mm</span>
                  {progressPercent !== null && <span>{progressPercent.toFixed(0)}%</span>}
                  {activeObjectName && <span>{activeObjectName}</span>}
                  <span>Elapsed {formatDurationWords(elapsedSeconds, '--', false)}</span>
                  <span>ETA {formatDurationWords(remainingSeconds, '--', false)}</span>
                  {currentLayerIssues.length > 0 && <span>{currentLayerIssues.length} issue{currentLayerIssues.length === 1 ? '' : 's'}</span>}
                  {currentLayerIssues[0] && <span title={currentLayerIssues[0].message}>{currentLayerIssues[0].message}</span>}
                </div>
              </div>
            )}
          </>
        )}

        {hover && hoverObj && !menu && (
          <div
            style={{
              position: 'absolute',
              left: hover.x,
              top: hover.y,
              minWidth: 180,
              padding: '6px 8px',
              border: '1px solid var(--border, #2a2a4a)',
              borderRadius: 6,
              background: 'rgba(10, 10, 20, 0.9)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
              color: 'var(--text-primary, #f0f0f5)',
              fontSize: 11,
              pointerEvents: 'none',
              zIndex: 40,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4, color: isCurrentObject(hoverObj) ? '#44aaff' : 'var(--text-primary, #f0f0f5)' }}>
              {hoverObj.name || hoverObj.id.slice(0, 8)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--text-muted, #aaa)' }}>
              <span>{(hoverObj.boundingBox.max.x - hoverObj.boundingBox.min.x).toFixed(1)} x {(hoverObj.boundingBox.max.y - hoverObj.boundingBox.min.y).toFixed(1)} mm</span>
              <span>{isCancelledObject(hoverObj) ? 'cancelled' : isCurrentObject(hoverObj) ? 'printing' : 'queued'}</span>
            </div>
            <div style={{ marginTop: 3, display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--text-muted, #aaa)' }}>
              <span>{objectApproxFilament(sliceResult?.filamentWeight, plateObjects.length)}</span>
              <span>{objectStatus(hoverObj).label}</span>
            </div>
            {hoverReport?.issues[0] && (
              <div style={{ marginTop: 4, color: '#facc15' }}>
                {hoverReport.issues[0].message}
              </div>
            )}
          </div>
        )}

        {menu && menuObj && (
          <ObjectContextMenu
            obj={menuObj}
            position={{ x: menu.x, y: menu.y }}
            isCurrent={isCurrentObject(menuObj)}
            isCancelled={isCancelledObject(menuObj)}
            onCancel={() => void handleCancelFromMenu()}
            onClose={() => setMenu(null)}
          />
        )}
      </div>
    </div>
  );
}
