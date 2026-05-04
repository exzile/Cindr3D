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
 * Current-layer source by firmware:
 *   Duet     → model.job.layer (live from RRF object model)
 *   Klipper  → fallback to slicerStore.previewLayer (no live layer fetch yet)
 *   Marlin   → fallback to slicerStore.previewLayer (no live layer fetch yet)
 *   Other    → all layers visible
 */
import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Layers, XCircle, Clock, Box, Ruler } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { useSlicerStore } from '../../../store/slicerStore';
import { parseM486Labels } from '../../../services/gcode/m486Labels';
import { findMatchingObject, matchObjectNames } from '../../../services/gcode/objectNameMatch';
import { layerFromPercent } from '../../../services/gcode/marlinProgressParser';
import { MoonrakerService, type MoonrakerPrintStatus } from '../../../services/MoonrakerService';
import {
  BuildPlateGrid,
  BuildVolumeWireframe,
} from '../../slicer/workspace/canvas/scenePrimitives';
import { InlineGCodeWirePreview } from '../../slicer/workspace/canvas/GCodeWirePreview';
import { panelStyle, sectionTitleStyle as labelStyle } from '../../../utils/printerPanelStyles';
import { colors as COLORS } from '../../../utils/theme';
import type { PlateObject } from '../../../types/slicer';

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

// ── Object silhouette + wireframe mesh ────────────────────────────────────────

function ObjectSilhouette({
  obj,
  isCurrent,
  isCancelled,
  onContextMenu,
}: {
  obj: PlateObject;
  isCurrent: boolean;
  isCancelled: boolean;
  onContextMenu: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const matrix = useMemo(() => objectMatrix(obj), [obj.position, obj.rotation, obj.scale, obj.mirrorX, obj.mirrorY, obj.mirrorZ]);
  // Reuse the geometry as-is; PlateObject geometry is already in model-local space.
  const geometry = obj.geometry as THREE.BufferGeometry | undefined;
  if (!geometry) return null;

  const baseColor = isCancelled ? '#ef4444' : isCurrent ? '#44aaff' : (obj.color ?? '#7a89ff');
  const opacity = isCancelled ? 0.08 : isCurrent ? 0.18 : 0.12;
  const edgeOpacity = isCancelled ? 0.5 : isCurrent ? 1 : 0.7;

  return (
    <group matrixAutoUpdate={false} matrix={matrix}>
      <mesh
        geometry={geometry}
        onContextMenu={(e) => { e.stopPropagation(); onContextMenu(e); }}
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

function ObjectContextMenu({
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

// ── Main panel ────────────────────────────────────────────────────────────────

export default function MeshPreviewPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const boardType = usePrinterStore((s) => s.config.boardType);
  const hostname = usePrinterStore((s) => s.config.hostname);
  const connected = usePrinterStore((s) => s.connected);
  const model = usePrinterStore((s) => s.model);
  const cancelObject = usePrinterStore((s) => s.cancelObject);
  const sendGCode = usePrinterStore((s) => s.sendGCode);

  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const previewLayer = useSlicerStore((s) => s.previewLayer);
  const printerProfile = useSlicerStore((s) => s.getActivePrinterProfile());

  const bv = printerProfile?.buildVolume ?? { x: 220, y: 220, z: 250 };

  // ── Klipper print-status polling ───────────────────────────────────────────
  // Klipper has no in-store live layer; poll Moonraker every 3s while connected
  // and expose the synthesised status for rendering. Skipped for other boards.
  const [klipperStatus, setKlipperStatus] = useState<MoonrakerPrintStatus | null>(null);
  useEffect(() => {
    if (boardType !== 'klipper' || !connected || !hostname) return;
    const svc = new MoonrakerService(hostname);
    let cancelled = false;
    const tick = async () => {
      const s = await svc.getPrintStatus();
      if (!cancelled) setKlipperStatus(s);
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [boardType, connected, hostname]);

  // ── Current layer (cross-firmware) ─────────────────────────────────────────
  const totalLayers = sliceResult?.layerCount ?? 0;
  const currentLayer = useMemo(() => {
    // Duet — live RRF object model
    if (boardType === 'duet' && model.job?.layer !== undefined) return model.job.layer;
    // Marlin — DuetService.handleSerialLine populates model.job.layer from M73
    if (boardType === 'marlin' && model.job?.layer !== undefined) return model.job.layer;
    // Klipper — Moonraker print-status; prefer explicit layer, else estimate from progress
    if (boardType === 'klipper' && klipperStatus) {
      if (klipperStatus.currentLayer !== undefined) return klipperStatus.currentLayer;
      if (totalLayers > 0) return layerFromPercent(klipperStatus.progress * 100, totalLayers);
    }
    // Fallback — slicer preview slider
    return previewLayer ?? totalLayers;
  }, [boardType, model.job?.layer, klipperStatus, previewLayer, totalLayers]);

  // ── Cancelled / currently-printing detection ───────────────────────────────
  const buildObjects = model.job?.build?.objects ?? [];
  const buildCurrentIdx = model.job?.build?.currentObject ?? -1;

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

  // ── Context menu state ─────────────────────────────────────────────────────
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const handleObjectContextMenu = (objectId: string) => (e: ThreeEvent<MouseEvent>) => {
    e.nativeEvent.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenu({
      objectId,
      x: Math.min(e.nativeEvent.clientX - rect.left, rect.width - 220),
      y: Math.min(e.nativeEvent.clientY - rect.top, rect.height - 140),
    });
  };

  const menuObj = menu ? plateObjects.find((p) => p.id === menu.objectId) : null;

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
            <span>Layer {Math.min(currentLayer + 1, totalLayers)} / {totalLayers}</span>
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
          <Canvas
            camera={{
              position: [bv.x * 1.2, -bv.y * 0.8, bv.z * 1.4],
              fov: 45,
              near: 1,
              far: bv.x * 20,
              up: [0, 0, 1],
            }}
            frameloop="demand"
            style={{ width: '100%', height: '100%' }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <ambientLight intensity={0.55} />
            <directionalLight position={[bv.x, -bv.y, bv.z * 2]} intensity={0.7} />

            <BuildPlateGrid sizeX={bv.x} sizeY={bv.y} />
            <BuildVolumeWireframe x={bv.x} y={bv.y} z={bv.z} />

            {plateObjects.map((obj) => (
              <ObjectSilhouette
                key={obj.id}
                obj={obj}
                isCurrent={isCurrentObject(obj)}
                isCancelled={isCancelledObject(obj)}
                onContextMenu={handleObjectContextMenu(obj.id)}
              />
            ))}

            {sliceResult && (
              <InlineGCodeWirePreview
                sliceResult={sliceResult}
                startLayer={0}
                currentLayer={currentLayer}
                showTravel={false}
                showRetractions={false}
                colorMode="type"
                hiddenTypes={new Set()}
                layerTimeRange={[0, 1]}
              />
            )}

            <OrbitControls
              target={[bv.x / 2, bv.y / 2, 0]}
              enableDamping
              dampingFactor={0.12}
              minDistance={Math.max(bv.x, bv.y) * 0.4}
              maxDistance={Math.max(bv.x, bv.y) * 4}
            />
          </Canvas>
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
