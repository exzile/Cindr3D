import { useState, useCallback, useMemo, useRef } from 'react';
import type * as React from 'react';
import { Canvas } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { OrbitControls, TransformControls, Line, Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  Plus, Trash2, LayoutGrid, XCircle,
  Edit3, Eye, EyeOff, Download, Send, Play, X, Settings, Layers,
  Box, Printer, Droplets, SlidersHorizontal,
  Upload, Move, RotateCw, Maximize2, FlipHorizontal, Search, RefreshCw,
  Lock, Unlock, ArrowDownToLine, Puzzle,
} from 'lucide-react';
import PluginsPage from './PluginsPage';
import { useSlicerStore } from '../../store/slicerStore';
import { useCADStore } from '../../store/cadStore';
import { usePrinterStore } from '../../store/printerStore';
import type {
  PrinterProfile, MaterialProfile, PrintProfile, PlateObject,
  SliceResult,
} from '../../types/slicer';

// =============================================================================
// Theme — use shared CSS-var tokens so all workspaces follow the active theme
// =============================================================================
import { colors, sharedStyles } from '../../utils/theme';
import { normalizeRotationRadians, normalizeScale } from '../../utils/slicerTransforms';
import { Num, Check, Sel, Density, SectionDivider } from './SettingsFieldControls';
import { SlicerSection } from './SlicerSection';

const panelStyle: React.CSSProperties = {
  background: colors.panel,
  borderRight: `1px solid ${colors.panelBorder}`,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const btnBase     = sharedStyles.btnBase;
const btnAccent   = sharedStyles.btnAccent;
const btnDanger   = sharedStyles.btnDanger;
const inputStyle  = sharedStyles.input;
const selectStyle = sharedStyles.select;
const labelStyle  = sharedStyles.label;

// =============================================================================
// 3D Scene: Build Plate Grid
// =============================================================================
function BuildPlateGrid({ sizeX, sizeY }: { sizeX: number; sizeY: number }) {
  const linesX: [number, number, number][][] = [];
  const linesY: [number, number, number][][] = [];

  for (let x = 0; x <= sizeX; x += 10) {
    linesX.push([[x, 0, 0], [x, sizeY, 0]]);
  }
  for (let y = 0; y <= sizeY; y += 10) {
    linesY.push([[0, y, 0], [sizeY > 0 ? sizeX : 0, y, 0]]);
  }

  return (
    <group>
      {linesX.map((pts, i) => (
        <Line key={`gx${i}`} points={pts} color="#2a2a4a" lineWidth={0.5} />
      ))}
      {linesY.map((pts, i) => (
        <Line key={`gy${i}`} points={pts} color="#2a2a4a" lineWidth={0.5} />
      ))}
      {/* Solid border */}
      <Line
        points={[[0,0,0],[sizeX,0,0],[sizeX,sizeY,0],[0,sizeY,0],[0,0,0]]}
        color="#4a4a6a"
        lineWidth={1.5}
      />
    </group>
  );
}

// =============================================================================
// 3D Scene: Build Volume Wireframe
// =============================================================================
function BuildVolumeWireframe({ x, y, z }: { x: number; y: number; z: number }) {
  const geo = useMemo(() => new THREE.BoxGeometry(x, y, z), [x, y, z]);
  return (
    <mesh position={[x / 2, y / 2, z / 2]}>
      <boxGeometry args={[x, y, z]} />
      <meshBasicMaterial color="#3344aa" transparent opacity={0.06} wireframe={false} />
      <lineSegments>
        <edgesGeometry args={[geo]} />
        <lineBasicMaterial color="#3344aa" transparent opacity={0.25} />
      </lineSegments>
    </mesh>
  );
}

// =============================================================================
// 3D Scene: Axis Indicators
// =============================================================================
function AxisIndicators() {
  const len = 20;
  return (
    <group>
      <Line points={[[0,0,0],[len,0,0]]} color="red" lineWidth={2} />
      <Line points={[[0,0,0],[0,len,0]]} color="green" lineWidth={2} />
      <Line points={[[0,0,0],[0,0,len]]} color="#4488ff" lineWidth={2} />
      <Text position={[len + 3, 0, 0]} fontSize={4} color="red">X</Text>
      <Text position={[0, len + 3, 0]} fontSize={4} color="green">Y</Text>
      <Text position={[0, 0, len + 3]} fontSize={4} color="#4488ff">Z</Text>
    </group>
  );
}

// =============================================================================
// 3D Scene: Plate Object Mesh
// =============================================================================
function PlateObjectMesh({
  obj,
  isSelected,
  materialColor,
  onClick,
  transformMode,
  onTransformCommit,
}: {
  obj: PlateObject;
  isSelected: boolean;
  materialColor: string;
  onClick: () => void;
  transformMode: 'move' | 'scale' | 'rotate' | 'mirror' | 'settings';
  onTransformCommit: (id: string, pos: {x:number;y:number;z:number}, rot: {x:number;y:number;z:number}, scl: {x:number;y:number;z:number}) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  // Callback-ref wrapper so the gizmo can re-render once the mesh mounts.
  // Reading `meshRef.current` directly in render violates React's rules
  // (the ref is null on the first render and never triggers an update).
  const [meshInstance, setMeshInstance] = useState<THREE.Mesh | null>(null);
  const setMeshRef = useCallback((m: THREE.Mesh | null) => {
    meshRef.current = m;
    setMeshInstance(m);
  }, []);

  const pos = obj.position as { x: number; y: number; z?: number };
  const rot = normalizeRotationRadians((obj as { rotation?: unknown }).rotation);
  const scl = normalizeScale((obj as { scale?: unknown }).scale);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onClick();
  }, [onClick]);

  const geometry = obj.geometry as unknown;
  const hasGeometry =
    geometry instanceof THREE.BufferGeometry ||
    (!!geometry && typeof geometry === 'object' && (geometry as { isBufferGeometry?: boolean }).isBufferGeometry === true);

  // Three.js gizmo mode (TransformControls only supports translate/rotate/scale)
  const locked = !!obj.locked;
  const gizmoMode = transformMode === 'rotate' ? 'rotate' : transformMode === 'scale' ? 'scale' : 'translate';
  const showGizmo = isSelected && !locked && (transformMode === 'move' || transformMode === 'rotate' || transformMode === 'scale');

  // Sync the gizmo's result back to the store on drag end
  const handleDragEnd = useCallback(() => {
    const m = meshRef.current;
    if (!m) return;
    onTransformCommit(
      obj.id,
      { x: m.position.x, y: m.position.y, z: m.position.z },
      { x: m.rotation.x, y: m.rotation.y, z: m.rotation.z },
      { x: m.scale.x,    y: m.scale.y,    z: m.scale.z    },
    );
  }, [obj.id, onTransformCommit]);

  const boxArgs: [number, number, number] = [
    obj.boundingBox.max.x - obj.boundingBox.min.x || 10,
    obj.boundingBox.max.y - obj.boundingBox.min.y || 10,
    obj.boundingBox.max.z - obj.boundingBox.min.z || 10,
  ];

  return (
    <>
      <mesh
        ref={setMeshRef}
        position={[pos.x, pos.y, pos.z ?? 0]}
        rotation={[rot.x, rot.y, rot.z]}
        scale={[scl.x, scl.y, scl.z]}
        geometry={hasGeometry ? obj.geometry : undefined}
        onClick={handleClick}
      >
        {!hasGeometry && <boxGeometry args={boxArgs} />}
        <meshStandardMaterial
          color={materialColor}
          transparent={isSelected}
          opacity={isSelected ? 0.85 : 1}
        />
        {isSelected && (
          <lineSegments>
            <edgesGeometry args={[
              hasGeometry
                ? obj.geometry
                : new THREE.BoxGeometry(...boxArgs),
            ]} />
            <lineBasicMaterial color="#ffaa00" linewidth={2} />
          </lineSegments>
        )}
      </mesh>

      {/* Interactive transform gizmo — only for move/rotate/scale modes */}
      {showGizmo && meshInstance && (
        <TransformControls
          object={meshInstance}
          mode={gizmoMode}
          onMouseUp={handleDragEnd}
        />
      )}
    </>
  );
}

// =============================================================================
// 3D Scene: GCode Preview (layer lines)
// =============================================================================
function InlineGCodePreview({
  sliceResult,
  currentLayer,
  showTravel,
  colorMode,
}: {
  sliceResult: SliceResult;
  currentLayer: number;
  showTravel: boolean;
  colorMode: 'type' | 'speed' | 'flow';
}) {
  const moveTypeColors: Record<string, string> = {
    'wall-outer': '#ff8844',
    'wall-inner': '#ffbb66',
    'infill': '#44aaff',
    'top-bottom': '#44ff88',
    'support': '#ff44ff',
    'skirt': '#aaaaaa',
    'brim': '#aaaaaa',
    'raft': '#888888',
    'bridge': '#ff4444',
    'ironing': '#88ff88',
    'travel': '#666666',
  };

  const visibleLayers = sliceResult.layers.filter((l) => l.layerIndex <= currentLayer);

  return (
    <group>
      {visibleLayers.map((layer) => {
        const extrusions: [number, number, number][] = [];
        const travels: [number, number, number][] = [];

        const extColors: string[] = [];
        for (const move of layer.moves) {
          if (move.type === 'travel') {
            if (showTravel) {
              travels.push([move.from.x, move.from.y, layer.z]);
              travels.push([move.to.x, move.to.y, layer.z]);
            }
          } else {
            extrusions.push([move.from.x, move.from.y, layer.z]);
            extrusions.push([move.to.x, move.to.y, layer.z]);
            const c = colorMode === 'type'
              ? moveTypeColors[move.type] || '#ffffff'
              : colorMode === 'speed'
                ? `hsl(${Math.max(0, 240 - move.speed * 2)}, 80%, 55%)`
                : `hsl(${Math.max(0, 120 - move.extrusion * 100)}, 80%, 55%)`;
            extColors.push(c);
            extColors.push(c);
          }
        }

        return (
          <group key={layer.layerIndex}>
            {extrusions.length > 1 && (
              <Line points={extrusions} vertexColors={extColors.map(c => new THREE.Color(c))} lineWidth={1.2} />
            )}
            {travels.length > 1 && (
              <Line points={travels} color="#333355" lineWidth={0.3} />
            )}
          </group>
        );
      })}
    </group>
  );
}

// =============================================================================
// 3D Scene: Main Scene
// =============================================================================
function SlicerScene() {
  const printerProfile    = useSlicerStore((s) => s.getActivePrinterProfile());
  const materialProfile   = useSlicerStore((s) => s.getActiveMaterialProfile());
  const plateObjects      = useSlicerStore((s) => s.plateObjects);
  const selectedId        = useSlicerStore((s) => s.selectedPlateObjectId);
  const selectPlateObject = useSlicerStore((s) => s.selectPlateObject);
  const updatePlateObject = useSlicerStore((s) => s.updatePlateObject);
  const transformMode     = useSlicerStore((s) => s.transformMode);
  const previewMode       = useSlicerStore((s) => s.previewMode);
  const sliceResult       = useSlicerStore((s) => s.sliceResult);
  const previewLayer      = useSlicerStore((s) => s.previewLayer);
  const previewShowTravel = useSlicerStore((s) => s.previewShowTravel);
  const previewColorMode  = useSlicerStore((s) => s.previewColorMode);

  const bv = printerProfile?.buildVolume ?? { x: 220, y: 220, z: 250 };

  const handleMiss = useCallback(() => {
    selectPlateObject(null);
  }, [selectPlateObject]);

  // Called by PlateObjectMesh when the user finishes dragging a gizmo handle
  const handleTransformCommit = useCallback((
    id: string,
    pos: { x: number; y: number; z: number },
    rot: { x: number; y: number; z: number },
    scl: { x: number; y: number; z: number },
  ) => {
    updatePlateObject(id, { position: pos, rotation: rot, scale: scl });
  }, [updatePlateObject]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[bv.x, bv.y, bv.z * 1.5]} intensity={0.8} />
      <directionalLight position={[-bv.x / 2, -bv.y / 2, bv.z]} intensity={0.3} />

      <BuildPlateGrid sizeX={bv.x} sizeY={bv.y} />
      <BuildVolumeWireframe x={bv.x} y={bv.y} z={bv.z} />
      <AxisIndicators />

      {previewMode === 'model' && plateObjects.map((obj) => (
        <PlateObjectMesh
          key={obj.id}
          obj={obj}
          isSelected={obj.id === selectedId}
          materialColor={materialProfile?.color ?? '#4fc3f7'}
          onClick={() => selectPlateObject(obj.id)}
          transformMode={transformMode}
          onTransformCommit={handleTransformCommit}
        />
      ))}

      {previewMode === 'preview' && sliceResult && (
        <InlineGCodePreview
          sliceResult={sliceResult}
          currentLayer={previewLayer}
          showTravel={previewShowTravel}
          colorMode={previewColorMode}
        />
      )}

      {/* Click on empty space to deselect */}
      <mesh position={[bv.x / 2, bv.y / 2, -0.1]} onClick={handleMiss} visible={false}>
        <planeGeometry args={[bv.x * 2, bv.y * 2]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* makeDefault lets TransformControls auto-disable OrbitControls while dragging */}
      <OrbitControls
        makeDefault
        target={[bv.x / 2, bv.y / 2, 0]}
        minDistance={50}
        maxDistance={bv.x * 4}
        enableDamping
      />
    </>
  );
}

// =============================================================================
// Viewport Overlays — left toolbar + mode-specific properties panel (Cura-style)
// =============================================================================
type TransformMode = 'move' | 'scale' | 'rotate' | 'mirror' | 'settings';

function ViewportOverlays() {
  const [uniformScale, setUniform] = useState(true);
  const [snapScale, setSnap]       = useState(false);

  const selectedId        = useSlicerStore((s) => s.selectedPlateObjectId);
  const plateObjects      = useSlicerStore((s) => s.plateObjects);
  const updatePlateObject = useSlicerStore((s) => s.updatePlateObject);
  const mode              = useSlicerStore((s) => s.transformMode) as TransformMode;
  const setMode           = useSlicerStore((s) => s.setTransformMode);

  const obj = plateObjects.find((o) => o.id === selectedId) ?? null;

  const upd = (changes: Record<string, unknown>) => {
    if (!obj) return;
    updatePlateObject(obj.id, changes as Partial<PlateObject>);
  };

  // ── shared styles ────────────────────────────────────────────────────────────
  const panelBox: React.CSSProperties = {
    position: 'absolute',
    top: 12,
    left: 52,          // right of the toolbar
    zIndex: 20,
    background: colors.elevated,
    border: `1px solid ${colors.panelBorder}`,
    borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    padding: '10px 12px',
    minWidth: 220,
    userSelect: 'none',
  };

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 };

  const axisColor = ['#e05555', '#44bb66', '#4488ff'];

  const numIn = (
    val: string,
    onChange: (v: string) => void,
    disabled = false,
    width = 72,
  ) => (
    <input
      type="number"
      disabled={disabled}
      style={{ ...inputStyle, width, padding: '3px 6px', fontSize: 12, textAlign: 'right' }}
      value={val}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  const checkRow = (label: React.ReactNode, checked: boolean, onClick: () => void) => (
    <label
      style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 5, fontSize: 12, color: colors.text }}
      onClick={(e) => { e.preventDefault(); onClick(); }}
    >
      <input type="checkbox" checked={checked} onChange={onClick} style={{ accentColor: colors.accent, cursor: 'pointer' }} />
      {label}
    </label>
  );

  const divider = <div style={{ borderTop: `1px solid ${colors.panelBorder}`, margin: '8px 0' }} />;

  // ── Left toolbar ─────────────────────────────────────────────────────────────
  const toolbarItems: { id: TransformMode; icon: React.ReactNode; title: string }[] = [
    { id: 'move',     icon: <Move size={18} />,             title: 'Move'              },
    { id: 'scale',    icon: <Maximize2 size={18} />,        title: 'Scale'             },
    { id: 'rotate',   icon: <RotateCw size={18} />,         title: 'Rotate'            },
    { id: 'mirror',   icon: <FlipHorizontal size={18} />,   title: 'Mirror'            },
    { id: 'settings', icon: <SlidersHorizontal size={18} />,title: 'Per-object Settings'},
  ];

  const toolbar = (
    <div style={{
      position: 'absolute', top: 12, left: 8, zIndex: 20,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      {toolbarItems.map(({ id, icon, title }) => (
        <button
          key={id}
          title={title}
          onClick={() => setMode(id)}
          style={{
            width: 36, height: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: mode === id ? colors.accent : colors.elevated,
            border: `1px solid ${mode === id ? colors.accent : colors.panelBorder}`,
            borderRadius: 6,
            color: mode === id ? '#fff' : colors.text,
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
            transition: 'background 0.15s',
          }}
        >
          {icon}
        </button>
      ))}
    </div>
  );

  // ── No object selected ───────────────────────────────────────────────────────
  if (!obj) return toolbar;

  const pos    = obj.position as { x: number; y: number; z: number };
  const rot = normalizeRotationRadians((obj as { rotation?: unknown }).rotation);
  const scl = normalizeScale((obj as { scale?: unknown }).scale);
  const locked = !!obj.locked;

  const bboxSize = {
    x: Math.abs(obj.boundingBox.max.x - obj.boundingBox.min.x),
    y: Math.abs(obj.boundingBox.max.y - obj.boundingBox.min.y),
    z: Math.abs(obj.boundingBox.max.z - obj.boundingBox.min.z),
  };

  // ── Object name header shared across panels ──────────────────────────────────
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
        {obj.name}
      </div>
      <button
        title={locked ? 'Unlock model' : 'Lock model'}
        onClick={() => upd({ locked: !locked })}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: locked ? colors.accent : colors.textDim, display: 'flex' }}
      >
        {locked ? <Lock size={13} /> : <Unlock size={13} />}
      </button>
    </div>
  );

  // ── MOVE panel ───────────────────────────────────────────────────────────────
  const movePanel = (
    <div style={panelBox}>
      {header}
      {(['x', 'y', 'z'] as const).map((ax, i) => (
        <div key={ax} style={rowStyle}>
          <span style={{ fontSize: 12, fontWeight: 700, color: axisColor[i], width: 14, flexShrink: 0 }}>{ax.toUpperCase()}</span>
          {numIn(pos[ax].toFixed(1), (v) => { if (!locked) upd({ position: { ...pos, [ax]: parseFloat(v) || 0 } }); }, locked)}
          <span style={{ fontSize: 11, color: colors.textDim }}>mm</span>
        </div>
      ))}
      {divider}
      {checkRow('Lock Model', locked, () => upd({ locked: !locked }))}
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: locked ? 'not-allowed' : 'pointer', marginTop: 5, fontSize: 12, color: colors.text }}
        onClick={() => {
          if (locked) return;
          const minZ = isFinite(obj.boundingBox.min.z) ? obj.boundingBox.min.z * (scl.z) : 0;
          upd({ position: { ...pos, z: -minZ } });
        }}
      >
        <ArrowDownToLine size={13} color={locked ? colors.textDim : colors.accent} />
        Drop Down <span style={{ color: colors.accent, fontWeight: 600, marginLeft: 3 }}>Model</span>
      </label>
      <button
        style={{ ...btnBase, marginTop: 8, width: '100%', justifyContent: 'center', fontSize: 11 }}
        disabled={locked}
        title="Center the object on the build plate"
        onClick={() => {
          const bv  = useSlicerStore.getState().getActivePrinterProfile()?.buildVolume ?? { x: 220, y: 220, z: 250 };
          const b   = obj.boundingBox;
          const w   = (b.max.x - b.min.x) * scl.x;
          const d   = (b.max.y - b.min.y) * scl.y;
          const minZ = b.min.z * scl.z;
          upd({ position: {
            x: bv.x / 2 - b.min.x * scl.x - w / 2,
            y: bv.y / 2 - b.min.y * scl.y - d / 2,
            z: isFinite(minZ) ? -minZ : pos.z,
          }});
        }}
      >
        Center on Plate
      </button>
    </div>
  );

  // ── Lay Flat algorithm (rotation-aware) ─────────────────────────────────────
  // Considers the object's current rotation. Transforms each face's local normal
  // into world space, then finds the face that is already CLOSEST to flat
  // (needs the smallest correction). Applies only the minimal additional rotation
  // needed, rather than overwriting the entire rotation from scratch.
  const layFlat = () => {
    if (locked) return;
    const geom: THREE.BufferGeometry | null = obj.geometry ?? null;

    if (!geom?.attributes?.position) {
      upd({ rotation: { x: 0, y: 0, z: 0 } });
      return;
    }

    const posAttr   = geom.attributes.position;
    const indexAttr = geom.index;
    const triCount  = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

    // Current rotation as quaternion — used to bring local normals into world space
    const currentQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rot.x, rot.y, rot.z, 'XYZ'),
    );

    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const vc = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const cross = new THREE.Vector3();
    const down = new THREE.Vector3(0, 0, -1);

    // Bucket by quantized WORLD-SPACE normal so coplanar faces in the current
    // orientation group together (not in raw local space)
    const buckets = new Map<string, { worldNormal: THREE.Vector3; area: number }>();

    for (let i = 0; i < triCount; i++) {
      const i0 = indexAttr ? indexAttr.getX(i * 3)     : i * 3;
      const i1 = indexAttr ? indexAttr.getX(i * 3 + 1) : i * 3 + 1;
      const i2 = indexAttr ? indexAttr.getX(i * 3 + 2) : i * 3 + 2;

      va.fromBufferAttribute(posAttr, i0);
      vb.fromBufferAttribute(posAttr, i1);
      vc.fromBufferAttribute(posAttr, i2);

      e1.subVectors(vb, va);
      e2.subVectors(vc, va);
      cross.crossVectors(e1, e2);

      const area = cross.length() / 2;
      if (area < 1e-6) continue;

      // Rotate local normal into world space
      const worldNorm = cross.clone().normalize().applyQuaternion(currentQuat);

      // Bucket by quantized world normal (2 dp → ~1° grouping tolerance)
      const key = `${worldNorm.x.toFixed(2)},${worldNorm.y.toFixed(2)},${worldNorm.z.toFixed(2)}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.area += area;
      } else {
        buckets.set(key, { worldNormal: worldNorm, area });
      }
    }

    // Scoring: find the face that is CLOSEST to facing down AND has significant area.
    // Score = dot(worldNormal, -Z) × area  — maximise to pick the face needing least rotation.
    let bestWorldNormal = new THREE.Vector3(0, 0, -1);
    let bestScore = -Infinity;
    for (const { worldNormal, area } of buckets.values()) {
      const dotDown = worldNormal.dot(down); // +1 = already perfectly facing down
      const score   = dotDown * area;
      if (score > bestScore) {
        bestScore = score;
        bestWorldNormal = worldNormal.clone();
      }
    }

    // Minimal additional quaternion to bring that world normal exactly to -Z
    const correctionQuat = new THREE.Quaternion().setFromUnitVectors(bestWorldNormal, down);

    // Final rotation = correction applied ON TOP of the current rotation
    const finalQuat  = new THREE.Quaternion().multiplyQuaternions(correctionQuat, currentQuat);
    const finalEuler = new THREE.Euler().setFromQuaternion(finalQuat, 'XYZ');

    // Drop to bed: find lowest Z corner under the final rotation + current scale
    const tmpBox = new THREE.Box3().setFromBufferAttribute(posAttr as THREE.BufferAttribute);
    const rotMat = new THREE.Matrix4().makeRotationFromQuaternion(finalQuat);
    const cornerOffsets: [number, number, number][] = [
      [tmpBox.min.x, tmpBox.min.y, tmpBox.min.z], [tmpBox.max.x, tmpBox.min.y, tmpBox.min.z],
      [tmpBox.min.x, tmpBox.max.y, tmpBox.min.z], [tmpBox.max.x, tmpBox.max.y, tmpBox.min.z],
      [tmpBox.min.x, tmpBox.min.y, tmpBox.max.z], [tmpBox.max.x, tmpBox.min.y, tmpBox.max.z],
      [tmpBox.min.x, tmpBox.max.y, tmpBox.max.z], [tmpBox.max.x, tmpBox.max.y, tmpBox.max.z],
    ];
    let newMinZ = Infinity;
    for (const [cx, cy, cz] of cornerOffsets) {
      // Scale is applied before rotation in Three.js SRT order
      const scaled = new THREE.Vector3(cx * scl.x, cy * scl.y, cz * scl.z);
      scaled.applyMatrix4(rotMat);
      if (scaled.z < newMinZ) newMinZ = scaled.z;
    }

    upd({
      rotation: { x: finalEuler.x, y: finalEuler.y, z: finalEuler.z },
      position: { ...pos, z: isFinite(newMinZ) ? -newMinZ : pos.z },
    });
  };

  // ── SCALE panel ──────────────────────────────────────────────────────────────
  const setScale = (axis: 'x' | 'y' | 'z', raw: string, fromMm: boolean) => {
    if (locked) return;
    const parsed = parseFloat(raw);
    if (!isFinite(parsed) || parsed <= 0) return;
    const baseMm  = bboxSize[axis] || 1;
    const newFactor = fromMm ? parsed / baseMm : parsed / 100;
    const snapped   = snapScale ? Math.round(newFactor * 20) / 20 : newFactor; // snap to 5%

    if (uniformScale) {
      const ratio = snapped / (scl[axis] || 1);
      upd({ scale: { x: scl.x * ratio, y: scl.y * ratio, z: scl.z * ratio } });
    } else {
      upd({ scale: { ...scl, [axis]: snapped } });
    }
  };

  const scalePanel = (
    <div style={panelBox}>
      {header}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: colors.textDim, width: 14 }} />
        <span style={{ fontSize: 10, color: colors.textDim, flex: 1, textAlign: 'center' }}>Size (mm)</span>
        <span style={{ fontSize: 10, color: colors.textDim, flex: 1, textAlign: 'center' }}>Scale (%)</span>
      </div>
      {(['x', 'y', 'z'] as const).map((ax, i) => {
        const sizeMm  = (bboxSize[ax] * scl[ax]).toFixed(1);
        const pct     = (scl[ax] * 100).toFixed(1);
        return (
          <div key={ax} style={rowStyle}>
            <span style={{ fontSize: 12, fontWeight: 700, color: axisColor[i], width: 14, flexShrink: 0 }}>{ax.toUpperCase()}</span>
            {numIn(sizeMm, (v) => setScale(ax, v, true),  locked, 72)}
            <span style={{ fontSize: 11, color: colors.textDim, width: 16 }}>mm</span>
            {numIn(pct,    (v) => setScale(ax, v, false), locked, 56)}
            <span style={{ fontSize: 11, color: colors.textDim }}>%</span>
          </div>
        );
      })}
      {divider}
      {checkRow('Snap Scaling',    snapScale,   () => setSnap(!snapScale))}
      {checkRow('Uniform Scaling', uniformScale, () => setUniform(!uniformScale))}
      <button
        style={{ ...btnBase, marginTop: 8, width: '100%', justifyContent: 'center', fontSize: 11 }}
        disabled={locked}
        onClick={() => upd({ scale: { x: 1, y: 1, z: 1 } })}
      >
        <RefreshCw size={11} /> Reset Scale
      </button>
    </div>
  );

  // ── ROTATE panel ─────────────────────────────────────────────────────────────
  const rotatePanel = (
    <div style={panelBox}>
      {header}
      {(['x', 'y', 'z'] as const).map((ax, i) => (
        <div key={ax} style={rowStyle}>
          <span style={{ fontSize: 12, fontWeight: 700, color: axisColor[i], width: 14, flexShrink: 0 }}>{ax.toUpperCase()}</span>
          {numIn(
            ((rot[ax] * 180) / Math.PI % 360).toFixed(1),
            (v) => { if (!locked) upd({ rotation: { ...rot, [ax]: (parseFloat(v) || 0) * Math.PI / 180 } }); },
            locked,
          )}
          <span style={{ fontSize: 11, color: colors.textDim }}>°</span>
        </div>
      ))}
      {divider}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['x', 'y', 'z'] as const).map((ax, i) => (
          <button
            key={ax}
            disabled={locked}
            style={{ ...btnBase, flex: 1, justifyContent: 'center', fontSize: 11 }}
            title={`Rotate 90° around ${ax.toUpperCase()}`}
            onClick={() => {
              const cur = rot[ax];
              upd({ rotation: { ...rot, [ax]: cur + Math.PI / 2 } });
            }}
          >
            <span style={{ color: axisColor[i], fontWeight: 700 }}>{ax.toUpperCase()}</span> +90°
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button
          style={{ ...btnBase, flex: 1, justifyContent: 'center', fontSize: 11 }}
          disabled={locked}
          onClick={layFlat}
          title="Rotate so the largest flat face rests on the build plate"
        >
          <ArrowDownToLine size={11} /> Lay Flat
        </button>
        <button
          style={{ ...btnBase, flex: 1, justifyContent: 'center', fontSize: 11 }}
          disabled={locked}
          onClick={() => upd({ rotation: { x: 0, y: 0, z: 0 } })}
        >
          <RefreshCw size={11} /> Reset
        </button>
      </div>
    </div>
  );

  // ── MIRROR panel ─────────────────────────────────────────────────────────────
  const mirrorPanel = (
    <div style={panelBox}>
      {header}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['x', 'y', 'z'] as const).map((ax, i) => {
          const key = `mirror${ax.toUpperCase()}` as 'mirrorX' | 'mirrorY' | 'mirrorZ';
          const active = !!(obj as { mirrorX?: boolean; mirrorY?: boolean; mirrorZ?: boolean })[key];
          return (
            <button
              key={ax}
              disabled={locked}
              style={{
                ...btnBase, flex: 1, justifyContent: 'center',
                background: active ? colors.accentDim : colors.elevated,
                border: `1px solid ${active ? colors.accent : colors.panelBorder}`,
              }}
              onClick={() => upd({ [key]: !active })}
            >
              <FlipHorizontal size={13} />
              <span style={{ color: axisColor[i], fontWeight: 700, marginLeft: 2 }}>{ax.toUpperCase()}</span>
            </button>
          );
        })}
      </div>
      {divider}
      <div style={{ fontSize: 11, color: colors.textDim, textAlign: 'center' }}>
        Click an axis to toggle mirroring
      </div>
    </div>
  );

  // ── PER-OBJECT SETTINGS panel ────────────────────────────────────────────────
  const settingsPanel = (
    <div style={panelBox}>
      {header}
      <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 8 }}>
        Override global print settings for this object only.
      </div>
      {([
        ['infillDensity',    'Infill Density',  '%', 0, 100],
        ['wallCount',        'Wall Count',      '',  1, 20 ],
        ['layerHeight',      'Layer Height',    'mm',0.05,1],
      ] as [string, string, string, number, number][]).map(([key, label, unit, min, max]) => {
        const perObj = (obj as { perObjectSettings?: Record<string, number | undefined> }).perObjectSettings ?? {};
        const val = perObj[key] ?? '';
        return (
          <div key={key} style={rowStyle}>
            <span style={{ fontSize: 12, color: colors.text, flex: 1 }}>{label}</span>
            <input
              type="number" min={min} max={max}
              placeholder="(global)"
              disabled={locked}
              style={{ ...inputStyle, width: 64, padding: '3px 6px', fontSize: 12, textAlign: 'right' }}
              value={val}
              onChange={(e) => {
                const v = e.target.value === '' ? undefined : parseFloat(e.target.value);
                const next = { ...perObj };
                if (v === undefined) delete next[key]; else next[key] = v;
                upd({ perObjectSettings: next });
              }}
            />
            {unit && <span style={{ fontSize: 11, color: colors.textDim, width: 18 }}>{unit}</span>}
          </div>
        );
      })}
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  const panels: Record<TransformMode, React.ReactNode> = {
    move:     movePanel,
    scale:    scalePanel,
    rotate:   rotatePanel,
    mirror:   mirrorPanel,
    settings: settingsPanel,
  };

  return (
    <>
      {toolbar}
      {panels[mode]}
    </>
  );
}

// =============================================================================
// Left Panel: Objects List
// =============================================================================
function ObjectsPanel() {
  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const selectedId = useSlicerStore((s) => s.selectedPlateObjectId);
  const selectPlateObject = useSlicerStore((s) => s.selectPlateObject);
  const removeFromPlate = useSlicerStore((s) => s.removeFromPlate);
  const autoArrange = useSlicerStore((s) => s.autoArrange);
  const clearPlate = useSlicerStore((s) => s.clearPlate);
  const addToPlate = useSlicerStore((s) => s.addToPlate);
  const updatePlateObject = useSlicerStore((s) => s.updatePlateObject);
  const importFileToPlate = useSlicerStore((s) => s.importFileToPlate);
  const getActivePrinterProfile = useSlicerStore((s) => s.getActivePrinterProfile);
  const features = useCADStore((s) => s.features);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedObj = plateObjects.find((o) => o.id === selectedId) ?? null;

  const handleImportFile = useCallback(async (file: File) => {
    setImporting(true);
    setImportError(null);
    try {
      await importFileToPlate(file);
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }, [importFileToPlate]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImportFile(file);
    if (e.target) e.target.value = '';
  }, [handleImportFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleImportFile(file);
  }, [handleImportFile]);

  const handleAddModel = useCallback((feature: typeof features[0]) => {
    addToPlate(feature.id, feature.name, null);
    setShowAddMenu(false);
  }, [addToPlate]);

  const sizeStr = (obj: PlateObject) => {
    const sx = (obj.boundingBox.max.x - obj.boundingBox.min.x).toFixed(1);
    const sy = (obj.boundingBox.max.y - obj.boundingBox.min.y).toFixed(1);
    const sz = (obj.boundingBox.max.z - obj.boundingBox.min.z).toFixed(1);
    return `${sx} × ${sy} × ${sz} mm`;
  };

  const updObj = useCallback((updates: Record<string, unknown>) => {
    if (!selectedId) return;
    updatePlateObject(selectedId, updates as Partial<PlateObject>);
  }, [selectedId, updatePlateObject]);

  const pos = selectedObj ? (selectedObj.position as { x: number; y: number; z: number }) : null;
  const rot = selectedObj ? normalizeRotationRadians((selectedObj as { rotation?: unknown }).rotation) : null;
  const scl = selectedObj ? normalizeScale((selectedObj as { scale?: unknown }).scale) : null;

  const numStyle: React.CSSProperties = { ...inputStyle, width: 52, padding: '2px 4px', fontSize: 11 };
  const xyzRow = (
    label: string,
    vals: { x: number; y: number; z: number },
    onChange: (axis: 'x' | 'y' | 'z', v: number) => void,
    step = 1,
  ) => (
    <div style={{ marginBottom: 6 }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {(['x', 'y', 'z'] as const).map((ax) => (
          <label key={ax} style={{ display: 'flex', alignItems: 'center', gap: 2, color: colors.textDim, fontSize: 10 }}>
            {ax.toUpperCase()}
            <input type="number" style={numStyle} step={step}
              value={vals[ax].toFixed(step < 1 ? 3 : 1)}
              onChange={(e) => onChange(ax, parseFloat(e.target.value) || 0)} />
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ ...panelStyle, width: 240, borderRight: `1px solid ${colors.panelBorder}`, flexShrink: 0 }}>
      {/* Header */}
      <div style={{
        padding: '10px', borderBottom: `1px solid ${colors.panelBorder}`,
        display: 'flex', alignItems: 'center', gap: 6,
        color: colors.text, fontSize: 13, fontWeight: 600,
      }}>
        <Layers size={16} />
        Objects on Plate
      </div>

      {/* Object list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          style={{
            margin: 8,
            padding: '10px 8px',
            border: `2px dashed ${isDragging ? colors.accent : colors.panelBorder}`,
            borderRadius: 6,
            textAlign: 'center',
            fontSize: 11,
            color: isDragging ? colors.accent : colors.textDim,
            cursor: 'pointer',
            background: isDragging ? colors.accentLight : 'transparent',
            transition: 'all 0.15s',
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={16} style={{ margin: '0 auto 4px', display: 'block', opacity: 0.6 }} />
          {importing ? 'Importing...' : 'Drop STL/OBJ/3MF or click'}
        </div>
        {importError && (
          <div style={{ padding: '4px 8px', color: colors.danger, fontSize: 11 }}>{importError}</div>
        )}
        <input ref={fileInputRef} type="file" accept=".stl,.obj,.3mf,.amf,.step,.stp"
          style={{ display: 'none' }} onChange={handleFileInput} />

        {plateObjects.length === 0 && !importing && (
          <div style={{ padding: '8px 10px', color: colors.textDim, fontSize: 11, textAlign: 'center' }}>
            No objects on the build plate.
          </div>
        )}
        {plateObjects.map((obj) => (
          <div key={obj.id} onClick={() => selectPlateObject(obj.id)}
            style={{
              padding: '5px 10px',
              background: obj.id === selectedId ? colors.panelLight : 'transparent',
              borderLeft: obj.id === selectedId ? `3px solid ${colors.accent}` : '3px solid transparent',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
            <div>
              <div style={{ color: colors.text, fontSize: 12 }}>{obj.name}</div>
              <div style={{ color: colors.textDim, fontSize: 10 }}>{sizeStr(obj)}</div>
            </div>
            <button title="Remove" onClick={(e) => { e.stopPropagation(); removeFromPlate(obj.id); }}
              style={{ background: 'transparent', border: 'none', color: colors.danger, cursor: 'pointer', padding: 2, display: 'flex' }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Selected object transform controls */}
      {selectedObj && pos && rot && scl && (
        <div style={{ borderTop: `1px solid ${colors.panelBorder}`, padding: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Transform
          </div>
          {xyzRow('Position (mm)', pos, (ax, v) => updObj({ position: { ...pos, [ax]: v } }), 0.1)}
          {xyzRow('Rotation (°)', rot, (ax, v) => updObj({ rotation: { ...rot, [ax]: v } }), 1)}
          {xyzRow('Scale', scl, (ax, v) => updObj({ scale: { ...scl, [ax]: Math.max(0.001, v) } }), 0.01)}
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <button style={{ ...btnBase, fontSize: 10, padding: '3px 6px', flex: 1 }}
              onClick={() => updObj({ scale: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 } })}>
              <RefreshCw size={10} /> Reset
            </button>
            <button style={{ ...btnBase, fontSize: 10, padding: '3px 6px', flex: 1 }}
              onClick={() => {
                const b   = selectedObj.boundingBox;
                const bv  = getActivePrinterProfile()?.buildVolume ?? { x: 220, y: 220, z: 250 };
                const s = normalizeScale((selectedObj as { scale?: unknown }).scale);
                const w   = (b.max.x - b.min.x) * s.x;
                const d   = (b.max.y - b.min.y) * s.y;
                const minZ = b.min.z * s.z;
                updObj({ position: {
                  x: bv.x / 2 - b.min.x * s.x - w / 2,
                  y: bv.y / 2 - b.min.y * s.y - d / 2,
                  z: isFinite(minZ) ? -minZ : 0,
                }});
              }}>
              Center
            </button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={{ ...btnBase, fontSize: 10, padding: '3px 6px', flex: 1 }}
              title="Mirror X"
              onClick={() => updObj({ mirrorX: !(selectedObj as { mirrorX?: boolean }).mirrorX })}>
              <FlipHorizontal size={10} /> X
            </button>
            <button style={{ ...btnBase, fontSize: 10, padding: '3px 6px', flex: 1 }}
              title="Mirror Y"
              onClick={() => updObj({ mirrorY: !(selectedObj as { mirrorY?: boolean }).mirrorY })}>
              <FlipHorizontal size={10} /> Y
            </button>
            <button style={{ ...btnBase, fontSize: 10, padding: '3px 6px', flex: 1 }}
              title="Mirror Z"
              onClick={() => updObj({ mirrorZ: !(selectedObj as { mirrorZ?: boolean }).mirrorZ })}>
              <FlipHorizontal size={10} /> Z
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${colors.panelBorder}` }}>
        <div style={{ position: 'relative' }}>
          <button style={{ ...btnAccent, width: '100%', justifyContent: 'center' }} onClick={() => setShowAddMenu(!showAddMenu)}>
            <Plus size={14} /> Add from CAD
          </button>
          {showAddMenu && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, right: 0,
              background: colors.panelLight, border: `1px solid ${colors.panelBorder}`,
              borderRadius: 4, marginBottom: 4, maxHeight: 180, overflowY: 'auto', zIndex: 10,
            }}>
              {features.length === 0 && (
                <div style={{ padding: 10, color: colors.textDim, fontSize: 11 }}>
                  No CAD features available.
                </div>
              )}
              {features.filter(f => f.type !== 'sketch').map((f) => (
                <div key={f.id} onClick={() => handleAddModel(f)}
                  style={{ padding: '5px 10px', cursor: 'pointer', fontSize: 12, color: colors.text, borderBottom: `1px solid ${colors.panelBorder}` }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = colors.panel)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <Box size={12} style={{ marginRight: 6 }} />
                  {f.name}
                </div>
              ))}
            </div>
          )}
        </div>
        <button style={{ ...btnBase, justifyContent: 'center' }} onClick={() => autoArrange()}>
          <LayoutGrid size={14} /> Auto Arrange
        </button>
        <button style={{ ...btnDanger, justifyContent: 'center' }} onClick={() => clearPlate()} disabled={plateObjects.length === 0}>
          <XCircle size={14} /> Clear Plate
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Right Panel: Settings
// =============================================================================
function SettingsPanel({ onEditProfile }: { onEditProfile: (type: 'printer' | 'material' | 'print') => void }) {
  const printerProfiles = useSlicerStore((s) => s.printerProfiles);
  const materialProfiles = useSlicerStore((s) => s.materialProfiles);
  const printProfiles = useSlicerStore((s) => s.printProfiles);
  const activePrinterId = useSlicerStore((s) => s.activePrinterProfileId);
  const activeMaterialId = useSlicerStore((s) => s.activeMaterialProfileId);
  const activePrintId = useSlicerStore((s) => s.activePrintProfileId);
  const setActivePrinter = useSlicerStore((s) => s.setActivePrinterProfile);
  const setActiveMaterial = useSlicerStore((s) => s.setActiveMaterialProfile);
  const setActivePrint = useSlicerStore((s) => s.setActivePrintProfile);
  const getActivePrinterProfile = useSlicerStore((s) => s.getActivePrinterProfile);
  const getActiveMaterialProfile = useSlicerStore((s) => s.getActiveMaterialProfile);
  const getActivePrintProfile = useSlicerStore((s) => s.getActivePrintProfile);
  const updatePrintProfile = useSlicerStore((s) => s.updatePrintProfile);

  const printer = getActivePrinterProfile();
  const material = getActiveMaterialProfile();
  const print = getActivePrintProfile();

  const [settingsSearch, setSettingsSearch] = useState('');

  const upd = useCallback((updates: Record<string, unknown>) => {
    if (print) updatePrintProfile(print.id, updates as Partial<PrintProfile>);
  }, [print, updatePrintProfile]);

  return (
    <div style={{ ...panelStyle, width: 300, borderLeft: `1px solid ${colors.panelBorder}`, borderRight: 'none' }}>
      <div style={{
        padding: '10px', borderBottom: `1px solid ${colors.panelBorder}`,
        display: 'flex', alignItems: 'center', gap: 6,
        color: colors.text, fontSize: 13, fontWeight: 600,
      }}>
        <Settings size={16} />
        Slicer Settings
      </div>

      {/* Search bar */}
      <div style={{ padding: '6px 10px', borderBottom: `1px solid ${colors.panelBorder}` }}>
        <div style={{ position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: colors.textDim }} />
          <input
            type="text"
            placeholder="Search settings..."
            value={settingsSearch}
            onChange={(e) => setSettingsSearch(e.target.value)}
            style={{ ...inputStyle, paddingLeft: 24, fontSize: 11 }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ── Printer ──────────────────────────────────────────────────── */}
        <SlicerSection title="Printer" icon={<Printer size={14} />}>
          <select style={selectStyle} value={activePrinterId} onChange={(e) => setActivePrinter(e.target.value)}>
            {printerProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {printer && (
            <div style={{ marginTop: 6, fontSize: 11, color: colors.textDim, lineHeight: 1.7 }}>
              <div>Build: {printer.buildVolume.x} × {printer.buildVolume.y} × {printer.buildVolume.z} mm</div>
              <div>Nozzle: {printer.nozzleDiameter} mm · Filament: {printer.filamentDiameter} mm</div>
              <div>Heated Bed: {printer.hasHeatedBed ? 'Yes' : 'No'}{printer.hasHeatedChamber ? ' · Chamber: Yes' : ''}</div>
            </div>
          )}
          <button style={{ ...btnBase, marginTop: 6, fontSize: 11 }} onClick={() => onEditProfile('printer')}>
            <Edit3 size={12} /> Edit Printer
          </button>
        </SlicerSection>

        {/* ── Material ─────────────────────────────────────────────────── */}
        <SlicerSection title="Material" icon={<Droplets size={14} />}>
          <select style={selectStyle} value={activeMaterialId} onChange={(e) => setActiveMaterial(e.target.value)}>
            {materialProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {material && (
            <div style={{ marginTop: 6, fontSize: 11, color: colors.textDim, lineHeight: 1.7 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: material.color, border: '1px solid #555', flexShrink: 0 }} />
                {material.type} · {material.name}
              </div>
              <div>Nozzle: {material.nozzleTemp}°C (FL {material.nozzleTempFirstLayer}°C)</div>
              <div>Bed: {material.bedTemp}°C (FL {material.bedTempFirstLayer}°C)</div>
              <div>Fan: {material.fanSpeedMin}–{material.fanSpeedMax}% (off {material.fanDisableFirstLayers} layers)</div>
              <div>Retract: {material.retractionDistance}mm @ {material.retractionSpeed}mm/s · Z-hop: {material.retractionZHop}mm</div>
            </div>
          )}
          <button style={{ ...btnBase, marginTop: 6, fontSize: 11 }} onClick={() => onEditProfile('material')}>
            <Edit3 size={12} /> Edit Material
          </button>
        </SlicerSection>

        {/* ── Print Profile selector ────────────────────────────────────── */}
        <SlicerSection title="Print Profile" icon={<SlidersHorizontal size={14} />}>
          <div style={{ display: 'flex', gap: 6 }}>
            <select style={{ ...selectStyle, flex: 1 }} value={activePrintId} onChange={(e) => setActivePrint(e.target.value)}>
              {printProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button style={{ ...btnBase, padding: '3px 8px', fontSize: 11 }} onClick={() => onEditProfile('print')}>
              <Edit3 size={12} />
            </button>
          </div>
        </SlicerSection>

        {/* ── Per-category settings (only when a print profile is active) ── */}
        {print && (<>

          {/* ── Quality ─────────────────────────────────────────────────── */}
          <SlicerSection title="Quality" defaultOpen={true}>
            <Num label="Layer Height" unit="mm" value={print.layerHeight} step={0.05} min={0.01} max={1.0} onChange={(v) => upd({ layerHeight: v })} />
            <Num label="First Layer Height" unit="mm" value={print.firstLayerHeight} step={0.05} min={0.05} max={1.0} onChange={(v) => upd({ firstLayerHeight: v })} />
            <SectionDivider label="Line Widths" />
            <Num label="Line Width" unit="mm" value={print.lineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ lineWidth: v })} />
            <Num label="Outer Wall Line Width" unit="mm" value={print.outerWallLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ outerWallLineWidth: v })} />
            <Num label="Top/Bottom Line Width" unit="mm" value={print.topBottomLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ topBottomLineWidth: v })} />
            <Num label="Initial Layer Width Factor" unit="%" value={print.initialLayerLineWidthFactor ?? 120} step={5} min={50} max={200} onChange={(v) => upd({ initialLayerLineWidthFactor: v })} />
            <SectionDivider label="Adaptive Layers" />
            <Check label="Enable Adaptive Layers" value={(print as unknown as Record<string, unknown>).adaptiveLayersEnabled as boolean ?? false} onChange={(v) => upd({ adaptiveLayersEnabled: v })} />
            {((print as unknown as Record<string, unknown>).adaptiveLayersEnabled as boolean ?? false) && (<>
              <Num label="Max Variation" unit="mm" value={(print as unknown as Record<string, unknown>).adaptiveLayersMaxVariation as number ?? 0.1} step={0.01} min={0.01} max={0.5} onChange={(v) => upd({ adaptiveLayersMaxVariation: v })} />
              <Num label="Variation Step" unit="mm" value={(print as unknown as Record<string, unknown>).adaptiveLayersVariationStep as number ?? 0.05} step={0.01} min={0.01} max={0.2} onChange={(v) => upd({ adaptiveLayersVariationStep: v })} />
            </>)}
          </SlicerSection>

          {/* ── Walls ────────────────────────────────────────────────────── */}
          <SlicerSection title="Walls" defaultOpen={false}>
            <Num label="Wall Count" value={print.wallCount} min={1} max={20} onChange={(v) => upd({ wallCount: v })} />
            <Num label="Wall Line Width" unit="mm" value={print.wallLineWidth} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ wallLineWidth: v })} />
            <Check label="Outer Wall First" value={print.outerWallFirst ?? false} onChange={(v) => upd({ outerWallFirst: v })} />
            <Check label="Alternate Extra Wall" value={print.alternateExtraWall ?? false} onChange={(v) => upd({ alternateExtraWall: v })} />
            <Sel label="Z Seam Alignment" value={print.zSeamAlignment}
              onChange={(v) => upd({ zSeamAlignment: v })}
              options={[
                { value: 'sharpest_corner', label: 'Sharpest Corner' },
                { value: 'aligned', label: 'Aligned' },
                { value: 'shortest', label: 'Shortest' },
                { value: 'random', label: 'Random' },
              ]} />
            <Check label="Thin Wall Detection" value={print.thinWallDetection} onChange={(v) => upd({ thinWallDetection: v })} />
            <SectionDivider label="Advanced" />
            <Num label="Min Wall Line Width" unit="mm" value={(print as unknown as Record<string, unknown>).minWallLineWidth as number ?? 0.2} step={0.01} min={0.05} max={1} onChange={(v) => upd({ minWallLineWidth: v })} />
            <Num label="Wall Transition Length" unit="mm" value={(print as unknown as Record<string, unknown>).wallTransitionLength as number ?? 1.0} step={0.1} min={0.1} max={10} onChange={(v) => upd({ wallTransitionLength: v })} />
            <Num label="Outer Wall Wipe Distance" unit="mm" value={(print as unknown as Record<string, unknown>).outerWallWipeDistance as number ?? 0} step={0.1} min={0} max={5} onChange={(v) => upd({ outerWallWipeDistance: v })} />
          </SlicerSection>

          {/* ── Top / Bottom ─────────────────────────────────────────────── */}
          <SlicerSection title="Top / Bottom" defaultOpen={false}>
            <Num label="Top Layers" value={print.topLayers} min={0} max={50} onChange={(v) => upd({ topLayers: v })} />
            <Num label="Bottom Layers" value={print.bottomLayers} min={0} max={50} onChange={(v) => upd({ bottomLayers: v })} />
            <Sel label="Pattern" value={print.topBottomPattern}
              onChange={(v) => upd({ topBottomPattern: v })}
              options={[
                { value: 'lines', label: 'Lines' },
                { value: 'concentric', label: 'Concentric' },
                { value: 'zigzag', label: 'Zigzag' },
              ]} />
            <Num label="Top Surface Speed" unit="mm/s" value={print.topSpeed} min={1} max={500} onChange={(v) => upd({ topSpeed: v })} />
            <SectionDivider label="Ironing" />
            <Check label="Enable Ironing" value={print.ironingEnabled} onChange={(v) => upd({ ironingEnabled: v })} />
            {print.ironingEnabled && (<>
              <Num label="Ironing Speed" unit="mm/s" value={print.ironingSpeed} min={1} max={100} onChange={(v) => upd({ ironingSpeed: v })} />
              <Num label="Ironing Flow" unit="%" value={print.ironingFlow} step={0.5} min={0} max={30} onChange={(v) => upd({ ironingFlow: v })} />
              <Num label="Ironing Spacing" unit="mm" value={print.ironingSpacing} step={0.01} min={0.01} max={1.0} onChange={(v) => upd({ ironingSpacing: v })} />
            </>)}
            <SectionDivider label="Monotonic & Roof" />
            <Check label="Monotonic Top/Bottom Order" value={(print as unknown as Record<string, unknown>).monotonicTopBottomOrder as boolean ?? false} onChange={(v) => upd({ monotonicTopBottomOrder: v })} />
            <Num label="Top Surface Layers (Roofing)" value={(print as unknown as Record<string, unknown>).roofingLayers as number ?? 0} min={0} max={10} onChange={(v) => upd({ roofingLayers: v })} />
            <SectionDivider label="Bridges" />
            <Num label="Bridge Wall Speed" unit="mm/s" value={(print as unknown as Record<string, unknown>).bridgeWallSpeed as number ?? 25} min={1} max={300} onChange={(v) => upd({ bridgeWallSpeed: v })} />
            <Num label="Bridge Skin Speed" unit="mm/s" value={(print as unknown as Record<string, unknown>).bridgeSkinSpeed as number ?? 25} min={1} max={300} onChange={(v) => upd({ bridgeSkinSpeed: v })} />
            <Num label="Bridge Skin Flow" unit="%" value={(print as unknown as Record<string, unknown>).bridgeSkinFlow as number ?? 60} min={10} max={200} onChange={(v) => upd({ bridgeSkinFlow: v })} />
            <Num label="Bridge Angle Override" unit="°" value={(print as unknown as Record<string, unknown>).bridgeAngle as number ?? 0} min={0} max={180} onChange={(v) => upd({ bridgeAngle: v })} />
          </SlicerSection>

          {/* ── Infill ───────────────────────────────────────────────────── */}
          <SlicerSection title="Infill" defaultOpen={true}>
            <Density value={print.infillDensity} onChange={(v) => upd({ infillDensity: v })} />
            <Sel label="Pattern" value={print.infillPattern}
              onChange={(v) => upd({ infillPattern: v })}
              options={[
                { value: 'grid', label: 'Grid' },
                { value: 'lines', label: 'Lines' },
                { value: 'triangles', label: 'Triangles' },
                { value: 'cubic', label: 'Cubic' },
                { value: 'gyroid', label: 'Gyroid' },
                { value: 'honeycomb', label: 'Honeycomb' },
                { value: 'lightning', label: 'Lightning' },
                { value: 'concentric', label: 'Concentric' },
                { value: 'cross', label: 'Cross' },
                { value: 'cross3d', label: 'Cross 3D' },
                { value: 'quarter_cubic', label: 'Quarter Cubic' },
                { value: 'octet', label: 'Octet' },
                { value: 'tri_hexagon', label: 'Tri-Hexagon' },
                { value: 'zigzag', label: 'Zigzag' },
                { value: 'tetrahedral', label: 'Tetrahedral' },
                { value: 'cubicsubdiv', label: 'Cubic Subdivision' },
              ]} />
            <Num label="Infill Line Width" unit="mm" value={print.infillLineWidth} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ infillLineWidth: v })} />
            <Num label="Infill Overlap" unit="%" value={print.infillOverlap} min={0} max={50} onChange={(v) => upd({ infillOverlap: v })} />
            <Num label="Extra Infill Walls" value={print.infillWallCount ?? 0} min={0} max={5} onChange={(v) => upd({ infillWallCount: v })} />
            <Num label="Gradual Infill Steps" value={print.gradualInfillSteps ?? 0} min={0} max={5} onChange={(v) => upd({ gradualInfillSteps: v })} />
            <SectionDivider label="Advanced" />
            <Check label="Infill Before Walls" value={(print as unknown as Record<string, unknown>).infillBeforeWalls as boolean ?? false} onChange={(v) => upd({ infillBeforeWalls: v })} />
            <Check label="Randomize Infill Start" value={(print as unknown as Record<string, unknown>).randomInfillStart as boolean ?? false} onChange={(v) => upd({ randomInfillStart: v })} />
            <Num label="Multiply Infill Lines" value={(print as unknown as Record<string, unknown>).multiplyInfill as number ?? 1} min={1} max={8} onChange={(v) => upd({ multiplyInfill: v })} />
          </SlicerSection>

          {/* ── Speed ────────────────────────────────────────────────────── */}
          <SlicerSection title="Speed" defaultOpen={false}>
            <Num label="Print Speed" unit="mm/s" value={print.printSpeed} min={1} max={1000} onChange={(v) => upd({ printSpeed: v })} />
            <Num label="Travel Speed" unit="mm/s" value={print.travelSpeed} min={1} max={1000} onChange={(v) => upd({ travelSpeed: v })} />
            <Num label="First Layer Speed" unit="mm/s" value={print.firstLayerSpeed} min={1} max={200} onChange={(v) => upd({ firstLayerSpeed: v })} />
            <SectionDivider label="Per-Feature" />
            <Num label="Outer Wall Speed" unit="mm/s" value={print.outerWallSpeed} min={1} max={500} onChange={(v) => upd({ outerWallSpeed: v })} />
            <Num label="Inner Wall Speed" unit="mm/s" value={print.wallSpeed} min={1} max={500} onChange={(v) => upd({ wallSpeed: v })} />
            <Num label="Infill Speed" unit="mm/s" value={print.infillSpeed} min={1} max={500} onChange={(v) => upd({ infillSpeed: v })} />
            <Num label="Support Speed" unit="mm/s" value={print.supportSpeed ?? 40} min={1} max={500} onChange={(v) => upd({ supportSpeed: v })} />
            <Num label="Small Area Speed" unit="mm/s" value={print.smallAreaSpeed ?? 20} min={1} max={200} onChange={(v) => upd({ smallAreaSpeed: v })} />
          </SlicerSection>

          {/* ── Travel ───────────────────────────────────────────────────── */}
          <SlicerSection title="Travel" defaultOpen={false}>
            <Sel label="Combing Mode" value={print.combingMode}
              onChange={(v) => upd({ combingMode: v })}
              options={[
                { value: 'all', label: 'All — avoid everything' },
                { value: 'noskin', label: 'No Skin — avoid skin only' },
                { value: 'infill', label: 'Infill Only' },
                { value: 'off', label: 'Off — shortest path' },
              ]} />
            <Check label="Avoid Crossing Perimeters" value={print.avoidCrossingPerimeters} onChange={(v) => upd({ avoidCrossingPerimeters: v })} />
            <Num label="Min Travel Before Retract" unit="mm" value={print.retractionMinTravel ?? 1.5} step={0.1} min={0} max={20} onChange={(v) => upd({ retractionMinTravel: v })} />
            <Check label="Retract at Layer Change" value={(print as unknown as Record<string, unknown>).retractAtLayerChange as boolean ?? true} onChange={(v) => upd({ retractAtLayerChange: v })} />
            <Check label="Retract Before Outer Wall" value={(print as unknown as Record<string, unknown>).travelRetractBeforeOuterWall as boolean ?? false} onChange={(v) => upd({ travelRetractBeforeOuterWall: v })} />
            <Check label="Combing Avoids Supports" value={(print as unknown as Record<string, unknown>).combingAvoidsSupports as boolean ?? false} onChange={(v) => upd({ combingAvoidsSupports: v })} />
            <SectionDivider label="Retraction Limits" />
            <Num label="Max Retraction Count" value={(print as unknown as Record<string, unknown>).maxRetractionCount as number ?? 90} min={1} max={300} onChange={(v) => upd({ maxRetractionCount: v })} />
            <Num label="Extra Prime Amount" unit="mm³" value={(print as unknown as Record<string, unknown>).retractionExtraPrimeAmount as number ?? 0} step={0.01} min={0} max={1} onChange={(v) => upd({ retractionExtraPrimeAmount: v })} />
          </SlicerSection>

          {/* ── Cooling ──────────────────────────────────────────────────── */}
          <SlicerSection title="Cooling" defaultOpen={false}>
            <Num label="Min Layer Time" unit="s" value={print.minLayerTime} min={0} max={120} onChange={(v) => upd({ minLayerTime: v })} />
            <Num label="Full Fan Speed at Layer" value={print.fanFullLayer ?? 4} min={1} max={50} onChange={(v) => upd({ fanFullLayer: v })} />
            <Num label="Min Print Speed" unit="mm/s" value={print.minPrintSpeed ?? 10} min={1} max={100} onChange={(v) => upd({ minPrintSpeed: v })} />
            <Check label="Lift Head on Min Layer Time" value={print.liftHeadEnabled ?? false} onChange={(v) => upd({ liftHeadEnabled: v })} />
            <Check label="Bridge Fan" value={print.enableBridgeFan} onChange={(v) => upd({ enableBridgeFan: v })} />
            {print.enableBridgeFan && (
              <Num label="Bridge Fan Speed" unit="%" value={print.bridgeFanSpeed} min={0} max={100} onChange={(v) => upd({ bridgeFanSpeed: v })} />
            )}
            <SectionDivider label="Fan Ramp-up" />
            <Num label="Regular Fan Speed at Layer" value={(print as unknown as Record<string, unknown>).regularFanSpeedLayer as number ?? 1} min={0} max={100} onChange={(v) => upd({ regularFanSpeedLayer: v })} />
            <Num label="Fan Kickstart Time" unit="ms" value={(print as unknown as Record<string, unknown>).fanKickstartTime as number ?? 100} step={10} min={0} max={5000} onChange={(v) => upd({ fanKickstartTime: v })} />
          </SlicerSection>

          {/* ── Support ──────────────────────────────────────────────────── */}
          <SlicerSection title="Support" defaultOpen={print.supportEnabled}>
            <Check label="Enable Support" value={print.supportEnabled} onChange={(v) => upd({ supportEnabled: v })} />
            {print.supportEnabled && (<>
              <Sel label="Support Structure" value={print.supportType}
                onChange={(v) => upd({ supportType: v })}
                options={[
                  { value: 'normal', label: 'Normal' },
                  { value: 'tree', label: 'Tree' },
                  { value: 'organic', label: 'Organic' },
                ]} />
              <Num label="Overhang Angle" unit="°" value={print.supportAngle} min={0} max={89} onChange={(v) => upd({ supportAngle: v })} />
              <Density value={print.supportDensity} onChange={(v) => upd({ supportDensity: v })} />
              <Sel label="Support Pattern" value={print.supportPattern}
                onChange={(v) => upd({ supportPattern: v })}
                options={[
                  { value: 'lines', label: 'Lines' },
                  { value: 'grid', label: 'Grid' },
                  { value: 'zigzag', label: 'Zigzag' },
                ]} />
              <SectionDivider label="Distances" />
              <Num label="Z Distance" unit="mm" value={print.supportZDistance} step={0.05} min={0} max={5} onChange={(v) => upd({ supportZDistance: v })} />
              <Num label="XY Distance" unit="mm" value={print.supportXYDistance} step={0.05} min={0} max={5} onChange={(v) => upd({ supportXYDistance: v })} />
              <SectionDivider label="Interface" />
              <Check label="Support Interface Layers" value={print.supportInterface} onChange={(v) => upd({ supportInterface: v })} />
              {print.supportInterface && (
                <Num label="Interface Layer Count" value={print.supportInterfaceLayers} min={1} max={10} onChange={(v) => upd({ supportInterfaceLayers: v })} />
              )}
              {(print.supportType === 'tree' || print.supportType === 'organic') && (<>
                <SectionDivider label="Tree Support" />
                <Num label="Branch Angle" unit="°" value={print.supportTreeAngle ?? 60} min={10} max={85} onChange={(v) => upd({ supportTreeAngle: v })} />
                <Num label="Branch Diameter" unit="mm" value={print.supportTreeBranchDiameter ?? 5} step={0.5} min={1} max={20} onChange={(v) => upd({ supportTreeBranchDiameter: v })} />
              </>)}
              <SectionDivider label="Placement" />
              <Check label="Build Plate Only" value={(print as unknown as Record<string, unknown>).supportBuildplateOnly as boolean ?? false} onChange={(v) => upd({ supportBuildplateOnly: v })} />
              <Num label="Support Wall Count" value={(print as unknown as Record<string, unknown>).supportWallCount as number ?? 0} min={0} max={5} onChange={(v) => upd({ supportWallCount: v })} />
              <Num label="Bottom Support Distance" unit="mm" value={(print as unknown as Record<string, unknown>).supportBottomDistance as number ?? 0.2} step={0.05} min={0} max={5} onChange={(v) => upd({ supportBottomDistance: v })} />
              <SectionDivider label="Roof / Floor" />
              <Check label="Support Roof" value={(print as unknown as Record<string, unknown>).supportRoofEnable as boolean ?? false} onChange={(v) => upd({ supportRoofEnable: v })} />
              <Check label="Support Floor" value={(print as unknown as Record<string, unknown>).supportFloorEnable as boolean ?? false} onChange={(v) => upd({ supportFloorEnable: v })} />
              {(((print as unknown as Record<string, unknown>).supportRoofEnable as boolean ?? false) || ((print as unknown as Record<string, unknown>).supportFloorEnable as boolean ?? false)) && (<>
                <Sel label="Interface Pattern" value={(print as unknown as Record<string, unknown>).supportInterfacePattern as 'lines' | 'grid' | 'concentric' | 'zigzag' ?? 'lines'}
                  onChange={(v) => upd({ supportInterfacePattern: v })}
                  options={[
                    { value: 'lines', label: 'Lines' },
                    { value: 'grid', label: 'Grid' },
                    { value: 'concentric', label: 'Concentric' },
                    { value: 'zigzag', label: 'Zigzag' },
                  ]} />
                <Num label="Interface Density" unit="%" value={(print as unknown as Record<string, unknown>).supportInterfaceDensity as number ?? 100} min={0} max={100} onChange={(v) => upd({ supportInterfaceDensity: v })} />
              </>)}
            </>)}
          </SlicerSection>

          {/* ── Build Plate Adhesion ─────────────────────────────────────── */}
          <SlicerSection title="Build Plate Adhesion" defaultOpen={false}>
            <Sel label="Type" value={print.adhesionType}
              onChange={(v) => upd({ adhesionType: v })}
              options={[
                { value: 'none', label: 'None' },
                { value: 'skirt', label: 'Skirt' },
                { value: 'brim', label: 'Brim' },
                { value: 'raft', label: 'Raft' },
              ]} />
            {print.adhesionType === 'skirt' && (<>
              <Num label="Skirt Lines" value={print.skirtLines} min={1} max={20} onChange={(v) => upd({ skirtLines: v })} />
              <Num label="Skirt Distance" unit="mm" value={print.skirtDistance} step={0.5} min={0} max={20} onChange={(v) => upd({ skirtDistance: v })} />
            </>)}
            {print.adhesionType === 'brim' && (<>
              <Num label="Brim Width" unit="mm" value={print.brimWidth} step={0.5} min={0} max={50} onChange={(v) => upd({ brimWidth: v })} />
              <Num label="Brim Gap" unit="mm" value={print.brimGap ?? 0} step={0.1} min={0} max={5} onChange={(v) => upd({ brimGap: v })} />
              <Sel label="Brim Location" value={print.brimLocation ?? 'outside'}
                onChange={(v) => upd({ brimLocation: v })}
                options={[
                  { value: 'outside', label: 'Outside' },
                  { value: 'inside', label: 'Inside' },
                  { value: 'everywhere', label: 'Everywhere' },
                ]} />
            </>)}
            {print.adhesionType === 'raft' && (<>
              <Num label="Raft Layers" value={print.raftLayers} min={1} max={10} onChange={(v) => upd({ raftLayers: v })} />
              <Num label="Raft Margin" unit="mm" value={print.raftMargin ?? 5} step={0.5} min={0} max={30} onChange={(v) => upd({ raftMargin: v })} />
              <SectionDivider label="Raft Layers (Advanced)" />
              <Num label="Base Thickness" unit="mm" value={(print as unknown as Record<string, unknown>).raftBaseThickness as number ?? 0.3} step={0.05} min={0.1} max={2} onChange={(v) => upd({ raftBaseThickness: v })} />
              <Num label="Base Line Width" unit="mm" value={(print as unknown as Record<string, unknown>).raftBaseLineWidth as number ?? 0.8} step={0.05} min={0.1} max={3} onChange={(v) => upd({ raftBaseLineWidth: v })} />
              <Num label="Base Speed" unit="mm/s" value={(print as unknown as Record<string, unknown>).raftBaseSpeed as number ?? 20} min={1} max={200} onChange={(v) => upd({ raftBaseSpeed: v })} />
              <Num label="Interface Thickness" unit="mm" value={(print as unknown as Record<string, unknown>).raftInterfaceThickness as number ?? 0.27} step={0.05} min={0.1} max={2} onChange={(v) => upd({ raftInterfaceThickness: v })} />
              <Num label="Surface Air Gap" unit="mm" value={(print as unknown as Record<string, unknown>).raftAirGap as number ?? 0.3} step={0.05} min={0} max={2} onChange={(v) => upd({ raftAirGap: v })} />
            </>)}
            {print.adhesionType === 'skirt' && (
              <Num label="Skirt Height (layers)" value={(print as unknown as Record<string, unknown>).skirtHeight as number ?? 1} min={1} max={10} onChange={(v) => upd({ skirtHeight: v })} />
            )}
          </SlicerSection>

          {/* ── Special Modes ────────────────────────────────────────────── */}
          <SlicerSection title="Special Modes" defaultOpen={false}>
            <Check label="Vase Mode (Spiralize Contour)" value={print.spiralizeContour ?? false} onChange={(v) => upd({ spiralizeContour: v })} />
            <Sel label="Surface Mode" value={(print as unknown as Record<string, unknown>).surfaceMode as 'normal' | 'surface' | 'both' ?? 'normal'}
              onChange={(v) => upd({ surfaceMode: v })}
              options={[
                { value: 'normal', label: 'Normal — solid model' },
                { value: 'surface', label: 'Surface — shell only' },
                { value: 'both', label: 'Both — normal + surface' },
              ]} />
            <Sel label="Print Sequence" value={print.printSequence ?? 'all_at_once'}
              onChange={(v) => upd({ printSequence: v })}
              options={[
                { value: 'all_at_once', label: 'All at Once' },
                { value: 'one_at_a_time', label: 'One at a Time' },
              ]} />
            <SectionDivider label="Mold" />
            <Check label="Enable Mold Mode" value={(print as unknown as Record<string, unknown>).moldEnabled as boolean ?? false} onChange={(v) => upd({ moldEnabled: v })} />
            {((print as unknown as Record<string, unknown>).moldEnabled as boolean ?? false) && (<>
              <Num label="Mold Draft Angle" unit="°" value={(print as unknown as Record<string, unknown>).moldAngle as number ?? 40} min={0} max={89} onChange={(v) => upd({ moldAngle: v })} />
              <Num label="Mold Roof Height" unit="mm" value={(print as unknown as Record<string, unknown>).moldRoofHeight as number ?? 0.5} step={0.1} min={0} max={10} onChange={(v) => upd({ moldRoofHeight: v })} />
            </>)}
          </SlicerSection>

          {/* ── Experimental ─────────────────────────────────────────────── */}
          <SlicerSection title="Experimental" defaultOpen={false}>
            <Check label="Draft Shield" value={print.draftShieldEnabled ?? false} onChange={(v) => upd({ draftShieldEnabled: v })} />
            {print.draftShieldEnabled && (
              <Num label="Draft Shield Distance" unit="mm" value={print.draftShieldDistance ?? 10} step={1} min={1} max={50} onChange={(v) => upd({ draftShieldDistance: v })} />
            )}
            <Check label="Coasting" value={print.coastingEnabled ?? false} onChange={(v) => upd({ coastingEnabled: v })} />
            {print.coastingEnabled && (
              <Num label="Coasting Volume" unit="mm³" value={print.coastingVolume ?? 0.064} step={0.001} min={0} max={1} onChange={(v) => upd({ coastingVolume: v })} />
            )}
            <SectionDivider label="Fuzzy Skin" />
            <Check label="Enable Fuzzy Skin" value={(print as unknown as Record<string, unknown>).fuzzySkinsEnabled as boolean ?? false} onChange={(v) => upd({ fuzzySkinsEnabled: v })} />
            {((print as unknown as Record<string, unknown>).fuzzySkinsEnabled as boolean ?? false) && (<>
              <Num label="Fuzzy Thickness" unit="mm" value={(print as unknown as Record<string, unknown>).fuzzySkinThickness as number ?? 0.3} step={0.05} min={0.01} max={2} onChange={(v) => upd({ fuzzySkinThickness: v })} />
              <Num label="Fuzzy Point Distance" unit="mm" value={(print as unknown as Record<string, unknown>).fuzzySkinPointDist as number ?? 0.8} step={0.05} min={0.1} max={5} onChange={(v) => upd({ fuzzySkinPointDist: v })} />
            </>)}
            <SectionDivider label="Overhang" />
            <Check label="Make Overhang Printable" value={(print as unknown as Record<string, unknown>).makeOverhangPrintable as boolean ?? false} onChange={(v) => upd({ makeOverhangPrintable: v })} />
            {((print as unknown as Record<string, unknown>).makeOverhangPrintable as boolean ?? false) && (
              <Num label="Max Overhang Angle" unit="°" value={(print as unknown as Record<string, unknown>).makeOverhangPrintableMaxAngle as number ?? 50} min={0} max={89} onChange={(v) => upd({ makeOverhangPrintableMaxAngle: v })} />
            )}
            <SectionDivider label="Slicing" />
            <Sel label="Slicing Tolerance" value={(print as unknown as Record<string, unknown>).slicingTolerance as 'middle' | 'inclusive' | 'exclusive' ?? 'middle'}
              onChange={(v) => upd({ slicingTolerance: v })}
              options={[
                { value: 'middle', label: 'Middle — balanced' },
                { value: 'inclusive', label: 'Inclusive — thicker' },
                { value: 'exclusive', label: 'Exclusive — thinner' },
              ]} />
            <Num label="Min Polygon Circumference" unit="mm" value={(print as unknown as Record<string, unknown>).minimumPolygonCircumference as number ?? 1.0} step={0.1} min={0.1} max={10} onChange={(v) => upd({ minimumPolygonCircumference: v })} />
            <Num label="Small Hole Max Size" unit="mm" value={(print as unknown as Record<string, unknown>).smallHoleMaxSize as number ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ smallHoleMaxSize: v })} />
          </SlicerSection>

          {/* ── Acceleration & Jerk ───────────────────────────────────────── */}
          <SlicerSection title="Acceleration & Jerk" defaultOpen={false}>
            <Check label="Enable Acceleration Control" value={(print as unknown as Record<string, unknown>).accelerationEnabled as boolean ?? false} onChange={(v) => upd({ accelerationEnabled: v })} />
            {((print as unknown as Record<string, unknown>).accelerationEnabled as boolean ?? false) && (<>
              <SectionDivider label="Acceleration (mm/s²)" />
              <Num label="Print" unit="mm/s²" value={(print as unknown as Record<string, unknown>).accelerationPrint as number ?? 3000} min={100} max={20000} onChange={(v) => upd({ accelerationPrint: v })} />
              <Num label="Travel" unit="mm/s²" value={(print as unknown as Record<string, unknown>).accelerationTravel as number ?? 3000} min={100} max={20000} onChange={(v) => upd({ accelerationTravel: v })} />
              <Num label="Outer Wall" unit="mm/s²" value={(print as unknown as Record<string, unknown>).accelerationWall as number ?? 1000} min={100} max={20000} onChange={(v) => upd({ accelerationWall: v })} />
              <Num label="Infill" unit="mm/s²" value={(print as unknown as Record<string, unknown>).accelerationInfill as number ?? 3000} min={100} max={20000} onChange={(v) => upd({ accelerationInfill: v })} />
              <Num label="Top/Bottom" unit="mm/s²" value={(print as unknown as Record<string, unknown>).accelerationTopBottom as number ?? 1000} min={100} max={20000} onChange={(v) => upd({ accelerationTopBottom: v })} />
              <Num label="Support" unit="mm/s²" value={(print as unknown as Record<string, unknown>).accelerationSupport as number ?? 2000} min={100} max={20000} onChange={(v) => upd({ accelerationSupport: v })} />
            </>)}
            <Check label="Enable Jerk Control" value={(print as unknown as Record<string, unknown>).jerkEnabled as boolean ?? false} onChange={(v) => upd({ jerkEnabled: v })} />
            {((print as unknown as Record<string, unknown>).jerkEnabled as boolean ?? false) && (<>
              <SectionDivider label="Jerk (mm/s)" />
              <Num label="Print Jerk" unit="mm/s" value={(print as unknown as Record<string, unknown>).jerkPrint as number ?? 10} min={1} max={30} onChange={(v) => upd({ jerkPrint: v })} />
              <Num label="Travel Jerk" unit="mm/s" value={(print as unknown as Record<string, unknown>).jerkTravel as number ?? 10} min={1} max={30} onChange={(v) => upd({ jerkTravel: v })} />
              <Num label="Wall Jerk" unit="mm/s" value={(print as unknown as Record<string, unknown>).jerkWall as number ?? 8} min={1} max={30} onChange={(v) => upd({ jerkWall: v })} />
              <Num label="Infill Jerk" unit="mm/s" value={(print as unknown as Record<string, unknown>).jerkInfill as number ?? 10} min={1} max={30} onChange={(v) => upd({ jerkInfill: v })} />
              <Num label="Top/Bottom Jerk" unit="mm/s" value={(print as unknown as Record<string, unknown>).jerkTopBottom as number ?? 8} min={1} max={30} onChange={(v) => upd({ jerkTopBottom: v })} />
            </>)}
          </SlicerSection>

          {/* ── Mesh Fixes ───────────────────────────────────────────────── */}
          <SlicerSection title="Mesh Fixes" defaultOpen={false}>
            <Check label="Union Overlapping Volumes" value={(print as unknown as Record<string, unknown>).unionOverlappingVolumes as boolean ?? true} onChange={(v) => upd({ unionOverlappingVolumes: v })} />
            <Check label="Remove All Holes" value={(print as unknown as Record<string, unknown>).removeAllHoles as boolean ?? false} onChange={(v) => upd({ removeAllHoles: v })} />
            <Check label="Extensive Stitching" value={(print as unknown as Record<string, unknown>).extensiveStitching as boolean ?? false} onChange={(v) => upd({ extensiveStitching: v })} />
            <Check label="Keep Disconnected Faces" value={(print as unknown as Record<string, unknown>).keepDisconnectedFaces as boolean ?? false} onChange={(v) => upd({ keepDisconnectedFaces: v })} />
            <SectionDivider label="Precision" />
            <Num label="Maximum Resolution" unit="mm" value={(print as unknown as Record<string, unknown>).maxResolution as number ?? 0.5} step={0.01} min={0.01} max={2} onChange={(v) => upd({ maxResolution: v })} />
            <Num label="Maximum Deviation" unit="mm" value={(print as unknown as Record<string, unknown>).maxDeviation as number ?? 0.025} step={0.005} min={0.001} max={1} onChange={(v) => upd({ maxDeviation: v })} />
            <Num label="Max Travel Resolution" unit="mm" value={(print as unknown as Record<string, unknown>).maxTravelResolution as number ?? 0.8} step={0.1} min={0.1} max={5} onChange={(v) => upd({ maxTravelResolution: v })} />
          </SlicerSection>

        </>)}
      </div>
    </div>
  );
}

// =============================================================================
// Bottom Bar
// =============================================================================
function BottomBar() {
  const sliceProgress = useSlicerStore((s) => s.sliceProgress);
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const previewMode = useSlicerStore((s) => s.previewMode);
  const previewLayer = useSlicerStore((s) => s.previewLayer);
  const previewLayerMax = useSlicerStore((s) => s.previewLayerMax);
  const startSlice = useSlicerStore((s) => s.startSlice);
  const cancelSlice = useSlicerStore((s) => s.cancelSlice);
  const setPreviewMode = useSlicerStore((s) => s.setPreviewMode);
  const setPreviewLayer = useSlicerStore((s) => s.setPreviewLayer);
  const downloadGCode = useSlicerStore((s) => s.downloadGCode);
  const sendToPrinter = useSlicerStore((s) => s.sendToPrinter);
  const connected = usePrinterStore((s) => s.connected);

  const isSlicing = sliceProgress.stage === 'preparing' || sliceProgress.stage === 'slicing' || sliceProgress.stage === 'generating';
  const hasResult = sliceResult !== null;

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const formatLength = (mm: number) => {
    if (mm > 1000) return `${(mm / 1000).toFixed(2)}m`;
    return `${mm.toFixed(0)}mm`;
  };

  return (
    <div style={{
      background: colors.panel,
      borderTop: `1px solid ${colors.panelBorder}`,
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minHeight: 48,
    }}>
      {/* Slice Button */}
      {!isSlicing ? (
        <button
          style={{
            ...btnAccent,
            padding: '8px 24px',
            fontSize: 14,
            fontWeight: 700,
            background: '#4466ff',
            borderColor: '#4466ff',
            opacity: plateObjects.length === 0 ? 0.5 : 1,
            cursor: plateObjects.length === 0 ? 'not-allowed' : 'pointer',
          }}
          onClick={() => startSlice()}
          disabled={plateObjects.length === 0}
        >
          <Play size={16} /> Slice
        </button>
      ) : (
        <button style={{ ...btnDanger, padding: '8px 16px', fontSize: 13 }} onClick={() => cancelSlice()}>
          <X size={14} /> Cancel
        </button>
      )}

      {/* Progress bar during slicing */}
      {isSlicing && (
        <div style={{ flex: 1, maxWidth: 300 }}>
          <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 2 }}>
            {sliceProgress.message} {sliceProgress.totalLayers > 0 && `(${sliceProgress.currentLayer}/${sliceProgress.totalLayers})`}
          </div>
          <div style={{ background: colors.bg, borderRadius: 4, height: 6, overflow: 'hidden' }}>
            <div style={{
              background: colors.accent,
              height: '100%',
              width: `${sliceProgress.percent}%`,
              borderRadius: 4,
              transition: 'width 0.2s',
            }} />
          </div>
        </div>
      )}

      {/* Slice result stats */}
      {hasResult && !isSlicing && (
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: colors.textDim }}>
          <span>Time: <span style={{ color: colors.text }}>{formatTime(sliceResult!.printTime)}</span></span>
          <span>Filament: <span style={{ color: colors.text }}>{formatLength(sliceResult!.filamentUsed)}</span></span>
          <span>Weight: <span style={{ color: colors.text }}>{sliceResult!.filamentWeight.toFixed(1)}g</span></span>
          <span>Cost: <span style={{ color: colors.text }}>${sliceResult!.filamentCost.toFixed(2)}</span></span>
          <span>Layers: <span style={{ color: colors.text }}>{sliceResult!.layerCount}</span></span>
        </div>
      )}

      {/* Error message */}
      {sliceProgress.stage === 'error' && (
        <div style={{ color: colors.danger, fontSize: 12 }}>
          {sliceProgress.message}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Preview toggle */}
      {hasResult && (
        <button
          style={{
            ...btnBase,
            background: previewMode === 'preview' ? colors.accent : colors.panelLight,
            color: previewMode === 'preview' ? '#fff' : colors.text,
            borderColor: previewMode === 'preview' ? colors.accent : colors.panelBorder,
          }}
          onClick={() => setPreviewMode(previewMode === 'model' ? 'preview' : 'model')}
        >
          {previewMode === 'preview' ? <Eye size={14} /> : <EyeOff size={14} />}
          Preview
        </button>
      )}

      {/* Layer slider in preview mode */}
      {previewMode === 'preview' && hasResult && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: colors.textDim }}>Layer:</span>
          <input
            type="range"
            min={0}
            max={previewLayerMax}
            value={previewLayer}
            onChange={(e) => setPreviewLayer(parseInt(e.target.value))}
            style={{ width: 120, accentColor: colors.accent }}
          />
          <span style={{ fontSize: 11, color: colors.text, minWidth: 40 }}>
            {previewLayer}/{previewLayerMax}
          </span>
        </div>
      )}

      {/* Export */}
      {hasResult && (
        <>
          <button style={btnBase} onClick={() => downloadGCode()}>
            <Download size={14} /> Export G-code
          </button>
          {connected && (
            <button style={btnAccent} onClick={() => sendToPrinter()}>
              <Send size={14} /> Send to Printer
            </button>
          )}
        </>
      )}
    </div>
  );
}

// =============================================================================
// Profile Editor Modal
// =============================================================================
function ProfileEditorModal({
  type,
  onClose,
}: {
  type: 'printer' | 'material' | 'print';
  onClose: () => void;
}) {
  const getActivePrinterProfile = useSlicerStore((s) => s.getActivePrinterProfile);
  const getActiveMaterialProfile = useSlicerStore((s) => s.getActiveMaterialProfile);
  const getActivePrintProfile = useSlicerStore((s) => s.getActivePrintProfile);
  const updatePrinterProfile = useSlicerStore((s) => s.updatePrinterProfile);
  const updateMaterialProfile = useSlicerStore((s) => s.updateMaterialProfile);
  const updatePrintProfile = useSlicerStore((s) => s.updatePrintProfile);

  const printer = getActivePrinterProfile();
  const material = getActiveMaterialProfile();
  const print = getActivePrintProfile();

  const [activeTab, setActiveTab] = useState(0);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    background: active ? colors.panelLight : 'transparent',
    color: active ? colors.text : colors.textDim,
    border: 'none',
    borderBottom: active ? `2px solid ${colors.accent}` : '2px solid transparent',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
  });

  const fieldRow: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10,
  };

  // ---------- Printer Editor ----------
  const renderPrinterEditor = () => {
    if (!printer) return null;
    const tabs = ['General', 'Limits', 'G-code'];
    return (
      <>
        <div style={{ display: 'flex', borderBottom: `1px solid ${colors.panelBorder}` }}>
          {tabs.map((t, i) => <button key={t} style={tabStyle(activeTab === i)} onClick={() => setActiveTab(i)}>{t}</button>)}
        </div>
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {activeTab === 0 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Name</div>
                <input style={inputStyle} value={printer.name} onChange={(e) => updatePrinterProfile(printer.id, { name: e.target.value })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Build Volume X (mm)</div>
                <input type="number" style={inputStyle} value={printer.buildVolume.x}
                  onChange={(e) => updatePrinterProfile(printer.id, { buildVolume: { ...printer.buildVolume, x: parseFloat(e.target.value) || 0 } })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Build Volume Y (mm)</div>
                <input type="number" style={inputStyle} value={printer.buildVolume.y}
                  onChange={(e) => updatePrinterProfile(printer.id, { buildVolume: { ...printer.buildVolume, y: parseFloat(e.target.value) || 0 } })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Build Volume Z (mm)</div>
                <input type="number" style={inputStyle} value={printer.buildVolume.z}
                  onChange={(e) => updatePrinterProfile(printer.id, { buildVolume: { ...printer.buildVolume, z: parseFloat(e.target.value) || 0 } })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Nozzle Diameter (mm)</div>
                <input type="number" style={inputStyle} value={printer.nozzleDiameter} step={0.1}
                  onChange={(e) => updatePrinterProfile(printer.id, { nozzleDiameter: parseFloat(e.target.value) || 0.4 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Nozzle Count</div>
                <input type="number" style={inputStyle} value={printer.nozzleCount} min={1}
                  onChange={(e) => updatePrinterProfile(printer.id, { nozzleCount: parseInt(e.target.value) || 1 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Filament Diameter (mm)</div>
                <select style={selectStyle} value={printer.filamentDiameter}
                  onChange={(e) => updatePrinterProfile(printer.id, { filamentDiameter: parseFloat(e.target.value) })}>
                  <option value={1.75}>1.75</option>
                  <option value={2.85}>2.85</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={printer.hasHeatedBed}
                  onChange={(e) => updatePrinterProfile(printer.id, { hasHeatedBed: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Heated Bed
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={printer.hasHeatedChamber}
                  onChange={(e) => updatePrinterProfile(printer.id, { hasHeatedChamber: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Heated Chamber
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={printer.originCenter}
                  onChange={(e) => updatePrinterProfile(printer.id, { originCenter: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Origin Center
              </label>
              <div style={fieldRow}>
                <div style={labelStyle}>G-code Flavor</div>
                <select style={selectStyle} value={printer.gcodeFlavorType}
                  onChange={(e) => updatePrinterProfile(printer.id, { gcodeFlavorType: e.target.value as PrinterProfile['gcodeFlavorType'] })}>
                  <option value="reprap">RepRap</option>
                  <option value="marlin">Marlin</option>
                  <option value="klipper">Klipper</option>
                  <option value="duet">Duet</option>
                </select>
              </div>
            </>
          )}
          {activeTab === 1 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Max Nozzle Temp (&deg;C)</div>
                <input type="number" style={inputStyle} value={printer.maxNozzleTemp}
                  onChange={(e) => updatePrinterProfile(printer.id, { maxNozzleTemp: parseInt(e.target.value) || 260 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Max Bed Temp (&deg;C)</div>
                <input type="number" style={inputStyle} value={printer.maxBedTemp}
                  onChange={(e) => updatePrinterProfile(printer.id, { maxBedTemp: parseInt(e.target.value) || 110 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Max Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={printer.maxSpeed}
                  onChange={(e) => updatePrinterProfile(printer.id, { maxSpeed: parseInt(e.target.value) || 200 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Max Acceleration (mm/s&sup2;)</div>
                <input type="number" style={inputStyle} value={printer.maxAcceleration}
                  onChange={(e) => updatePrinterProfile(printer.id, { maxAcceleration: parseInt(e.target.value) || 2000 })} />
              </div>
            </>
          )}
          {activeTab === 2 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Start G-code</div>
                <textarea
                  style={{ ...inputStyle, height: 180, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
                  value={printer.startGCode}
                  onChange={(e) => updatePrinterProfile(printer.id, { startGCode: e.target.value })}
                />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>End G-code</div>
                <textarea
                  style={{ ...inputStyle, height: 180, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
                  value={printer.endGCode}
                  onChange={(e) => updatePrinterProfile(printer.id, { endGCode: e.target.value })}
                />
              </div>
            </>
          )}
        </div>
      </>
    );
  };

  // ---------- Material Editor ----------
  const renderMaterialEditor = () => {
    if (!material) return null;
    const tabs = ['General', 'Temperature', 'Retraction', 'Flow & Cost'];
    return (
      <>
        <div style={{ display: 'flex', borderBottom: `1px solid ${colors.panelBorder}`, flexWrap: 'wrap' }}>
          {tabs.map((t, i) => <button key={t} style={tabStyle(activeTab === i)} onClick={() => setActiveTab(i)}>{t}</button>)}
        </div>
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {activeTab === 0 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Name</div>
                <input style={inputStyle} value={material.name} onChange={(e) => updateMaterialProfile(material.id, { name: e.target.value })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Material Type</div>
                <select style={selectStyle} value={material.type}
                  onChange={(e) => updateMaterialProfile(material.id, { type: e.target.value as MaterialProfile['type'] })}>
                  {['PLA','ABS','PETG','TPU','Nylon','ASA','PC','PVA','HIPS','Custom'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Color</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="color" value={material.color}
                    onChange={(e) => updateMaterialProfile(material.id, { color: e.target.value })}
                    style={{ width: 32, height: 32, border: 'none', cursor: 'pointer', background: 'transparent' }} />
                  <input style={{ ...inputStyle, width: 90 }} value={material.color}
                    onChange={(e) => updateMaterialProfile(material.id, { color: e.target.value })} />
                </div>
              </div>
            </>
          )}
          {activeTab === 1 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Nozzle Temp (&deg;C)</div>
                <input type="number" style={inputStyle} value={material.nozzleTemp}
                  onChange={(e) => updateMaterialProfile(material.id, { nozzleTemp: parseInt(e.target.value) || 200 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Nozzle Temp First Layer (&deg;C)</div>
                <input type="number" style={inputStyle} value={material.nozzleTempFirstLayer}
                  onChange={(e) => updateMaterialProfile(material.id, { nozzleTempFirstLayer: parseInt(e.target.value) || 200 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Bed Temp (&deg;C)</div>
                <input type="number" style={inputStyle} value={material.bedTemp}
                  onChange={(e) => updateMaterialProfile(material.id, { bedTemp: parseInt(e.target.value) || 60 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Bed Temp First Layer (&deg;C)</div>
                <input type="number" style={inputStyle} value={material.bedTempFirstLayer}
                  onChange={(e) => updateMaterialProfile(material.id, { bedTempFirstLayer: parseInt(e.target.value) || 60 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Chamber Temp (&deg;C)</div>
                <input type="number" style={inputStyle} value={material.chamberTemp}
                  onChange={(e) => updateMaterialProfile(material.id, { chamberTemp: parseInt(e.target.value) || 0 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Fan Speed Min (%)</div>
                <input type="number" style={inputStyle} value={material.fanSpeedMin} min={0} max={100}
                  onChange={(e) => updateMaterialProfile(material.id, { fanSpeedMin: parseInt(e.target.value) || 0 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Fan Speed Max (%)</div>
                <input type="number" style={inputStyle} value={material.fanSpeedMax} min={0} max={100}
                  onChange={(e) => updateMaterialProfile(material.id, { fanSpeedMax: parseInt(e.target.value) || 100 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Disable Fan First N Layers</div>
                <input type="number" style={inputStyle} value={material.fanDisableFirstLayers} min={0}
                  onChange={(e) => updateMaterialProfile(material.id, { fanDisableFirstLayers: parseInt(e.target.value) || 0 })} />
              </div>
            </>
          )}
          {activeTab === 2 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Retraction Distance (mm)</div>
                <input type="number" style={inputStyle} value={material.retractionDistance} step={0.1}
                  onChange={(e) => updateMaterialProfile(material.id, { retractionDistance: parseFloat(e.target.value) || 0.8 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Retraction Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={material.retractionSpeed}
                  onChange={(e) => updateMaterialProfile(material.id, { retractionSpeed: parseInt(e.target.value) || 45 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Retraction Z Hop (mm)</div>
                <input type="number" style={inputStyle} value={material.retractionZHop} step={0.05}
                  onChange={(e) => updateMaterialProfile(material.id, { retractionZHop: parseFloat(e.target.value) || 0 })} />
              </div>
            </>
          )}
          {activeTab === 3 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Flow Rate (multiplier)</div>
                <input type="number" style={inputStyle} value={material.flowRate} step={0.01} min={0.5} max={2.0}
                  onChange={(e) => updateMaterialProfile(material.id, { flowRate: parseFloat(e.target.value) || 1.0 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Density (g/cm&sup3;)</div>
                <input type="number" style={inputStyle} value={material.density} step={0.01}
                  onChange={(e) => updateMaterialProfile(material.id, { density: parseFloat(e.target.value) || 1.24 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Cost per kg ($)</div>
                <input type="number" style={inputStyle} value={material.costPerKg} step={1}
                  onChange={(e) => updateMaterialProfile(material.id, { costPerKg: parseFloat(e.target.value) || 20 })} />
              </div>
            </>
          )}
        </div>
      </>
    );
  };

  // ---------- Print Profile Editor ----------
  const renderPrintEditor = () => {
    if (!print) return null;
    const tabs = ['Layers', 'Walls', 'Infill', 'Speed', 'Support', 'Adhesion', 'Advanced'];
    return (
      <>
        <div style={{ display: 'flex', borderBottom: `1px solid ${colors.panelBorder}`, flexWrap: 'wrap' }}>
          {tabs.map((t, i) => <button key={t} style={tabStyle(activeTab === i)} onClick={() => setActiveTab(i)}>{t}</button>)}
        </div>
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {activeTab === 0 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Name</div>
                <input style={inputStyle} value={print.name} onChange={(e) => updatePrintProfile(print.id, { name: e.target.value })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Layer Height (mm)</div>
                <input type="number" style={inputStyle} value={print.layerHeight} step={0.05}
                  onChange={(e) => updatePrintProfile(print.id, { layerHeight: parseFloat(e.target.value) || 0.2 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>First Layer Height (mm)</div>
                <input type="number" style={inputStyle} value={print.firstLayerHeight} step={0.05}
                  onChange={(e) => updatePrintProfile(print.id, { firstLayerHeight: parseFloat(e.target.value) || 0.3 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Top Layers</div>
                <input type="number" style={inputStyle} value={print.topLayers} min={0}
                  onChange={(e) => updatePrintProfile(print.id, { topLayers: parseInt(e.target.value) || 4 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Bottom Layers</div>
                <input type="number" style={inputStyle} value={print.bottomLayers} min={0}
                  onChange={(e) => updatePrintProfile(print.id, { bottomLayers: parseInt(e.target.value) || 4 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Top/Bottom Pattern</div>
                <select style={selectStyle} value={print.topBottomPattern}
                  onChange={(e) => updatePrintProfile(print.id, { topBottomPattern: e.target.value as PrintProfile['topBottomPattern'] })}>
                  <option value="lines">Lines</option>
                  <option value="concentric">Concentric</option>
                  <option value="zigzag">Zigzag</option>
                </select>
              </div>
            </>
          )}
          {activeTab === 1 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Wall Count</div>
                <input type="number" style={inputStyle} value={print.wallCount} min={1}
                  onChange={(e) => updatePrintProfile(print.id, { wallCount: parseInt(e.target.value) || 3 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Wall Line Width (mm)</div>
                <input type="number" style={inputStyle} value={print.wallLineWidth} step={0.01}
                  onChange={(e) => updatePrintProfile(print.id, { wallLineWidth: parseFloat(e.target.value) || 0.45 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Wall Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={print.wallSpeed}
                  onChange={(e) => updatePrintProfile(print.id, { wallSpeed: parseInt(e.target.value) || 45 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Outer Wall Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={print.outerWallSpeed}
                  onChange={(e) => updatePrintProfile(print.id, { outerWallSpeed: parseInt(e.target.value) || 30 })} />
              </div>
            </>
          )}
          {activeTab === 2 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Infill Density (%)</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="range" min={0} max={100} value={print.infillDensity}
                    onChange={(e) => updatePrintProfile(print.id, { infillDensity: parseInt(e.target.value) })}
                    style={{ flex: 1, accentColor: colors.accent }} />
                  <input type="number" style={{ ...inputStyle, width: 50 }} value={print.infillDensity} min={0} max={100}
                    onChange={(e) => updatePrintProfile(print.id, { infillDensity: parseInt(e.target.value) || 0 })} />
                </div>
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Infill Pattern</div>
                <select style={selectStyle} value={print.infillPattern}
                  onChange={(e) => updatePrintProfile(print.id, { infillPattern: e.target.value as PrintProfile['infillPattern'] })}>
                  {['grid','lines','triangles','cubic','gyroid','honeycomb','lightning','concentric'].map((p) => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Infill Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={print.infillSpeed}
                  onChange={(e) => updatePrintProfile(print.id, { infillSpeed: parseInt(e.target.value) || 60 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Infill Line Width (mm)</div>
                <input type="number" style={inputStyle} value={print.infillLineWidth} step={0.01}
                  onChange={(e) => updatePrintProfile(print.id, { infillLineWidth: parseFloat(e.target.value) || 0.45 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Infill Overlap (%)</div>
                <input type="number" style={inputStyle} value={print.infillOverlap} min={0} max={50}
                  onChange={(e) => updatePrintProfile(print.id, { infillOverlap: parseInt(e.target.value) || 10 })} />
              </div>
            </>
          )}
          {activeTab === 3 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Print Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={print.printSpeed}
                  onChange={(e) => updatePrintProfile(print.id, { printSpeed: parseInt(e.target.value) || 50 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Travel Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={print.travelSpeed}
                  onChange={(e) => updatePrintProfile(print.id, { travelSpeed: parseInt(e.target.value) || 150 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>First Layer Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={print.firstLayerSpeed}
                  onChange={(e) => updatePrintProfile(print.id, { firstLayerSpeed: parseInt(e.target.value) || 25 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Top Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={print.topSpeed}
                  onChange={(e) => updatePrintProfile(print.id, { topSpeed: parseInt(e.target.value) || 40 })} />
              </div>
            </>
          )}
          {activeTab === 4 && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={print.supportEnabled}
                  onChange={(e) => updatePrintProfile(print.id, { supportEnabled: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Enable Support
              </label>
              {print.supportEnabled && (
                <>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Support Type</div>
                    <select style={selectStyle} value={print.supportType}
                      onChange={(e) => updatePrintProfile(print.id, { supportType: e.target.value as PrintProfile['supportType'] })}>
                      <option value="normal">Normal</option>
                      <option value="tree">Tree</option>
                      <option value="organic">Organic</option>
                    </select>
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Overhang Angle (&deg;)</div>
                    <input type="number" style={inputStyle} value={print.supportAngle} min={0} max={90}
                      onChange={(e) => updatePrintProfile(print.id, { supportAngle: parseInt(e.target.value) || 50 })} />
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Support Density (%)</div>
                    <input type="number" style={inputStyle} value={print.supportDensity} min={0} max={100}
                      onChange={(e) => updatePrintProfile(print.id, { supportDensity: parseInt(e.target.value) || 15 })} />
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Support Pattern</div>
                    <select style={selectStyle} value={print.supportPattern}
                      onChange={(e) => updatePrintProfile(print.id, { supportPattern: e.target.value as PrintProfile['supportPattern'] })}>
                      <option value="lines">Lines</option>
                      <option value="grid">Grid</option>
                      <option value="zigzag">Zigzag</option>
                    </select>
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Support Z Distance (mm)</div>
                    <input type="number" style={inputStyle} value={print.supportZDistance} step={0.05}
                      onChange={(e) => updatePrintProfile(print.id, { supportZDistance: parseFloat(e.target.value) || 0.2 })} />
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Support XY Distance (mm)</div>
                    <input type="number" style={inputStyle} value={print.supportXYDistance} step={0.1}
                      onChange={(e) => updatePrintProfile(print.id, { supportXYDistance: parseFloat(e.target.value) || 0.7 })} />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={print.supportInterface}
                      onChange={(e) => updatePrintProfile(print.id, { supportInterface: e.target.checked })}
                      style={{ accentColor: colors.accent }} />
                    Dense Support Interface
                  </label>
                  {print.supportInterface && (
                    <div style={fieldRow}>
                      <div style={labelStyle}>Interface Layers</div>
                      <input type="number" style={inputStyle} value={print.supportInterfaceLayers} min={0}
                        onChange={(e) => updatePrintProfile(print.id, { supportInterfaceLayers: parseInt(e.target.value) || 2 })} />
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {activeTab === 5 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Adhesion Type</div>
                <select style={selectStyle} value={print.adhesionType}
                  onChange={(e) => updatePrintProfile(print.id, { adhesionType: e.target.value as PrintProfile['adhesionType'] })}>
                  <option value="none">None</option>
                  <option value="skirt">Skirt</option>
                  <option value="brim">Brim</option>
                  <option value="raft">Raft</option>
                </select>
              </div>
              {(print.adhesionType === 'skirt' || print.adhesionType === 'none') && (
                <>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Skirt Lines</div>
                    <input type="number" style={inputStyle} value={print.skirtLines} min={0}
                      onChange={(e) => updatePrintProfile(print.id, { skirtLines: parseInt(e.target.value) || 3 })} />
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Skirt Distance (mm)</div>
                    <input type="number" style={inputStyle} value={print.skirtDistance}
                      onChange={(e) => updatePrintProfile(print.id, { skirtDistance: parseFloat(e.target.value) || 5 })} />
                  </div>
                </>
              )}
              {print.adhesionType === 'brim' && (
                <div style={fieldRow}>
                  <div style={labelStyle}>Brim Width (mm)</div>
                  <input type="number" style={inputStyle} value={print.brimWidth}
                    onChange={(e) => updatePrintProfile(print.id, { brimWidth: parseFloat(e.target.value) || 8 })} />
                </div>
              )}
              {print.adhesionType === 'raft' && (
                <div style={fieldRow}>
                  <div style={labelStyle}>Raft Layers</div>
                  <input type="number" style={inputStyle} value={print.raftLayers} min={1}
                    onChange={(e) => updatePrintProfile(print.id, { raftLayers: parseInt(e.target.value) || 3 })} />
                </div>
              )}
            </>
          )}
          {activeTab === 6 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Z Seam Alignment</div>
                <select style={selectStyle} value={print.zSeamAlignment}
                  onChange={(e) => updatePrintProfile(print.id, { zSeamAlignment: e.target.value as PrintProfile['zSeamAlignment'] })}>
                  <option value="random">Random</option>
                  <option value="aligned">Aligned</option>
                  <option value="sharpest_corner">Sharpest Corner</option>
                  <option value="shortest">Shortest</option>
                </select>
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Combing Mode</div>
                <select style={selectStyle} value={print.combingMode}
                  onChange={(e) => updatePrintProfile(print.id, { combingMode: e.target.value as PrintProfile['combingMode'] })}>
                  <option value="off">Off</option>
                  <option value="all">All</option>
                  <option value="noskin">No Skin</option>
                  <option value="infill">Infill Only</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={print.avoidCrossingPerimeters}
                  onChange={(e) => updatePrintProfile(print.id, { avoidCrossingPerimeters: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Avoid Crossing Perimeters
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={print.thinWallDetection}
                  onChange={(e) => updatePrintProfile(print.id, { thinWallDetection: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Thin Wall Detection
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={print.enableBridgeFan}
                  onChange={(e) => updatePrintProfile(print.id, { enableBridgeFan: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Enable Bridge Fan
              </label>
              {print.enableBridgeFan && (
                <div style={fieldRow}>
                  <div style={labelStyle}>Bridge Fan Speed (%)</div>
                  <input type="number" style={inputStyle} value={print.bridgeFanSpeed} min={0} max={100}
                    onChange={(e) => updatePrintProfile(print.id, { bridgeFanSpeed: parseInt(e.target.value) || 100 })} />
                </div>
              )}
              <div style={fieldRow}>
                <div style={labelStyle}>Min Layer Time (s)</div>
                <input type="number" style={inputStyle} value={print.minLayerTime} min={0}
                  onChange={(e) => updatePrintProfile(print.id, { minLayerTime: parseInt(e.target.value) || 10 })} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={print.ironingEnabled}
                  onChange={(e) => updatePrintProfile(print.id, { ironingEnabled: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Enable Ironing
              </label>
              {print.ironingEnabled && (
                <>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Ironing Speed (mm/s)</div>
                    <input type="number" style={inputStyle} value={print.ironingSpeed}
                      onChange={(e) => updatePrintProfile(print.id, { ironingSpeed: parseInt(e.target.value) || 15 })} />
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Ironing Flow (%)</div>
                    <input type="number" style={inputStyle} value={print.ironingFlow}
                      onChange={(e) => updatePrintProfile(print.id, { ironingFlow: parseInt(e.target.value) || 10 })} />
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Ironing Spacing (mm)</div>
                    <input type="number" style={inputStyle} value={print.ironingSpacing} step={0.01}
                      onChange={(e) => updatePrintProfile(print.id, { ironingSpacing: parseFloat(e.target.value) || 0.1 })} />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </>
    );
  };

  const titles = { printer: 'Printer Profile Editor', material: 'Material Profile Editor', print: 'Print Profile Editor' };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
    }}
      onClick={onClose}
    >
      <div
        style={{
          background: colors.panel,
          border: `1px solid ${colors.panelBorder}`,
          borderRadius: 8,
          width: 560,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: `1px solid ${colors.panelBorder}`,
        }}>
          <span style={{ color: colors.text, fontSize: 14, fontWeight: 600 }}>{titles[type]}</span>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', display: 'flex' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal body */}
        {type === 'printer' && renderPrinterEditor()}
        {type === 'material' && renderMaterialEditor()}
        {type === 'print' && renderPrintEditor()}

        {/* Modal footer */}
        <div style={{
          padding: '10px 16px', borderTop: `1px solid ${colors.panelBorder}`,
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <button style={btnAccent} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Export: SlicerWorkspace
// =============================================================================
// =============================================================================
// Workspace nav bar
// =============================================================================
type SlicerPage = 'prepare' | 'plugins';

function WorkspaceNavBar({
  currentPage,
  onChangePage,
}: {
  currentPage: SlicerPage;
  onChangePage: (page: SlicerPage) => void;
}) {
  const navStyle: React.CSSProperties = {
    background: colors.panel,
    borderBottom: `1px solid ${colors.panelBorder}`,
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '0 12px',
    height: 36,
    flexShrink: 0,
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: active ? colors.active : 'transparent',
    color: active ? colors.text : colors.textDim,
    border: 'none',
    borderBottom: active ? `2px solid ${colors.accent}` : '2px solid transparent',
    borderRadius: 0,
    padding: '0 14px',
    height: '100%',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    transition: 'color 0.12s, border-color 0.12s',
  });

  return (
    <div style={navStyle}>
      <button style={tabStyle(currentPage === 'prepare')} onClick={() => onChangePage('prepare')}>
        <Layers size={13} />
        Prepare
      </button>
      <button style={tabStyle(currentPage === 'plugins')} onClick={() => onChangePage('plugins')}>
        <Puzzle size={13} />
        Plugins
      </button>
    </div>
  );
}

// =============================================================================
// Main Export: SlicerWorkspace
// =============================================================================
export default function SlicerWorkspace() {
  const [editingProfile, setEditingProfile] = useState<'printer' | 'material' | 'print' | null>(null);
  const [currentPage, setCurrentPage] = useState<SlicerPage>('prepare');

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: colors.bg,
      color: colors.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      overflow: 'hidden',
    }}>
      {/* Workspace navigation tabs */}
      <WorkspaceNavBar currentPage={currentPage} onChangePage={setCurrentPage} />

      {/* Plugins page */}
      {currentPage === 'plugins' && <PluginsPage />}

      {/* Prepare page: left panel + 3D view + right panel (hidden when plugins active) */}
      <div style={{ flex: 1, display: currentPage === 'prepare' ? 'flex' : 'none', overflow: 'hidden' }}>
        {/* Left Panel - Objects */}
        <ObjectsPanel />

        {/* Center - 3D Canvas */}
        <div style={{ flex: 1, position: 'relative' }}>
          <Canvas
            camera={{ position: [300, -200, 250], fov: 45, near: 1, far: 10000, up: [0, 0, 1] }}
            style={{ background: colors.bg }}
          >
            <SlicerScene />
          </Canvas>
          {/* Viewport toolbar + mode-specific properties overlay */}
          <ViewportOverlays />
        </div>

        {/* Right Panel - Settings */}
        <SettingsPanel onEditProfile={(type) => setEditingProfile(type)} />
      </div>

      {/* Bottom Bar — only shown on Prepare page */}
      {currentPage === 'prepare' && <BottomBar />}

      {/* Profile Editor Modal */}
      {editingProfile && (
        <ProfileEditorModal type={editingProfile} onClose={() => setEditingProfile(null)} />
      )}
    </div>
  );
}
