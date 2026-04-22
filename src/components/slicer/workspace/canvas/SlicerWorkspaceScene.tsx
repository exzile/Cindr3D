import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Line, OrbitControls, Text, TransformControls } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useSlicerStore } from '../../../../store/slicerStore';
import type { PlateObject, SliceResult, SliceMove, SliceLayer } from '../../../../types/slicer';
import { normalizeRotationRadians, normalizeScale } from '../../../../utils/slicerTransforms';

function BuildPlateGrid({ sizeX, sizeY }: { sizeX: number; sizeY: number }) {
  // Pack all grid lines into a single BufferGeometry so the GPU draws them
  // in one call instead of one draw call per line (which was 60+ on a 300mm bed).
  const gridGeo = useMemo(() => {
    const verts: number[] = [];
    for (let x = 0; x <= sizeX; x += 10) {
      verts.push(x, 0, 0, x, sizeY, 0);
    }
    for (let y = 0; y <= sizeY; y += 10) {
      verts.push(0, y, 0, sizeX, y, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    return geo;
  }, [sizeX, sizeY]);
  useEffect(() => () => { gridGeo.dispose(); }, [gridGeo]);

  const borderGeo = useMemo(() => {
    const pts = [
      0, 0, 0, sizeX, 0, 0,
      sizeX, 0, 0, sizeX, sizeY, 0,
      sizeX, sizeY, 0, 0, sizeY, 0,
      0, sizeY, 0, 0, 0, 0,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  }, [sizeX, sizeY]);
  useEffect(() => () => { borderGeo.dispose(); }, [borderGeo]);

  return (
    <group>
      <lineSegments geometry={gridGeo}>
        <lineBasicMaterial color="#2a2a4a" />
      </lineSegments>
      <lineSegments geometry={borderGeo}>
        <lineBasicMaterial color="#4a4a6a" />
      </lineSegments>
    </group>
  );
}

function BuildVolumeWireframe({ x, y, z }: { x: number; y: number; z: number }) {
  const geo = useMemo(() => new THREE.BoxGeometry(x, y, z), [x, y, z]);
  // Dispose the prior BoxGeometry on volume resize / unmount. Without this
  // every print-bed dimension change leaks one BoxGeometry to the GPU.
  useEffect(() => () => { geo.dispose(); }, [geo]);
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

function AxisIndicators() {
  const len = 20;
  return (
    <group>
      <Line points={[[0, 0, 0], [len, 0, 0]]} color="red" lineWidth={2} />
      <Line points={[[0, 0, 0], [0, len, 0]]} color="green" lineWidth={2} />
      <Line points={[[0, 0, 0], [0, 0, len]]} color="#4488ff" lineWidth={2} />
      <Text position={[len + 3, 0, 0]} fontSize={4} color="red">X</Text>
      <Text position={[0, len + 3, 0]} fontSize={4} color="green">Y</Text>
      <Text position={[0, 0, len + 3]} fontSize={4} color="#4488ff">Z</Text>
    </group>
  );
}

function PlateObjectMesh({
  obj,
  isSelected,
  materialColor,
  onClick,
  transformMode,
  onTransformCommit,
  highlightedTriangles,
}: {
  obj: PlateObject;
  isSelected: boolean;
  materialColor: string;
  onClick: () => void;
  transformMode: 'move' | 'scale' | 'rotate' | 'mirror' | 'settings';
  onTransformCommit: (id: string, pos: { x: number; y: number; z: number }, rot: { x: number; y: number; z: number }, scl: { x: number; y: number; z: number }) => void;
  highlightedTriangles?: Set<number>;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [meshInstance, setMeshInstance] = useState<THREE.Mesh | null>(null);
  const setMeshRef = useCallback((m: THREE.Mesh | null) => {
    meshRef.current = m;
    setMeshInstance(m);
  }, []);

  const pos = obj.position as { x: number; y: number; z?: number };
  const rot = normalizeRotationRadians((obj as { rotation?: unknown }).rotation);
  const rawScl = normalizeScale((obj as { scale?: unknown }).scale);
  // Fold mirror flags into the rendered scale so the mesh visually flips.
  // Three.js handles negative scale correctly for transform math; it does
  // invert face winding though, so we set `side = DoubleSide` when an odd
  // number of axes are mirrored to keep both faces shaded.
  const mir = obj as { mirrorX?: boolean; mirrorY?: boolean; mirrorZ?: boolean };
  const mirrorCount = (mir.mirrorX ? 1 : 0) + (mir.mirrorY ? 1 : 0) + (mir.mirrorZ ? 1 : 0);
  const windingFlipped = mirrorCount % 2 === 1;
  const scl = {
    x: rawScl.x * (mir.mirrorX ? -1 : 1),
    y: rawScl.y * (mir.mirrorY ? -1 : 1),
    z: rawScl.z * (mir.mirrorZ ? -1 : 1),
  };

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onClick();
  }, [onClick]);

  const geometry = obj.geometry as unknown;
  const hasGeometry =
    geometry instanceof THREE.BufferGeometry ||
    (!!geometry && typeof geometry === 'object' && (geometry as { isBufferGeometry?: boolean }).isBufferGeometry === true);

  const locked = !!obj.locked;
  const gizmoMode = transformMode === 'rotate' ? 'rotate' : transformMode === 'scale' ? 'scale' : 'translate';
  const showGizmo = isSelected && !locked && (transformMode === 'move' || transformMode === 'rotate' || transformMode === 'scale');

  const handleDragEnd = useCallback(() => {
    const m = meshRef.current;
    if (!m) return;
    // The rendered mesh has mirror flags already folded into its scale
    // (see `scl` above). Strip them back out before committing, otherwise
    // the stored scale would drift every time the user dragged a mirrored
    // object — on the next render we'd flip the already-flipped scale and
    // the part would jump back to its un-mirrored orientation.
    const sx = mir.mirrorX ? -1 : 1;
    const sy = mir.mirrorY ? -1 : 1;
    const sz = mir.mirrorZ ? -1 : 1;
    onTransformCommit(
      obj.id,
      { x: m.position.x, y: m.position.y, z: m.position.z },
      { x: m.rotation.x, y: m.rotation.y, z: m.rotation.z },
      { x: m.scale.x * sx, y: m.scale.y * sy, z: m.scale.z * sz },
    );
  }, [obj.id, mir.mirrorX, mir.mirrorY, mir.mirrorZ, onTransformCommit]);

  const rawX = obj.boundingBox.max.x - obj.boundingBox.min.x;
  const rawY = obj.boundingBox.max.y - obj.boundingBox.min.y;
  const rawZ = obj.boundingBox.max.z - obj.boundingBox.min.z;
  const boxArgs: [number, number, number] = [
    isFinite(rawX) && rawX > 0 ? rawX : 10,
    isFinite(rawY) && rawY > 0 ? rawY : 10,
    isFinite(rawZ) && rawZ > 0 ? rawZ : 10,
  ];

  // Cache the placeholder BoxGeometry used for selection edges when there's no
  // real geometry. Previous code did `new THREE.BoxGeometry(...)` inline in JSX
  // every render, which `<edgesGeometry>` cloned internally, leaking the
  // un-disposed source BoxGeometry on every render of any selected plate object.
  const placeholderBoxGeo = useMemo(
    () => (hasGeometry ? null : new THREE.BoxGeometry(boxArgs[0], boxArgs[1], boxArgs[2])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasGeometry, boxArgs[0], boxArgs[1], boxArgs[2]],
  );
  useEffect(() => () => { placeholderBoxGeo?.dispose(); }, [placeholderBoxGeo]);

  // Build a secondary geometry containing ONLY the overhang-problem triangles
  // so we can render them in red on top of the main mesh. This is built
  // lazily from the highlight set so we pay for it only when the check runs.
  const overhangGeom = useMemo(() => {
    if (!highlightedTriangles || highlightedTriangles.size === 0 || !hasGeometry) return null;
    const src = obj.geometry as THREE.BufferGeometry;
    const posAttr = src.getAttribute('position');
    const indexAttr = src.getIndex();
    if (!posAttr) return null;
    const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
    const out = new Float32Array(highlightedTriangles.size * 9);
    let w = 0;
    for (let t = 0; t < triCount; t++) {
      if (!highlightedTriangles.has(t)) continue;
      const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
      const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
      const ids = [i0, i1, i2];
      for (const i of ids) {
        out[w++] = posAttr.getX(i);
        out[w++] = posAttr.getY(i);
        out[w++] = posAttr.getZ(i);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
    geo.computeVertexNormals();
    return geo;
  }, [highlightedTriangles, hasGeometry, obj.geometry]);
  useEffect(() => () => { overhangGeom?.dispose(); }, [overhangGeom]);

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
          // A single-axis mirror flips winding; DoubleSide keeps both sides
          // shaded so the user still sees a solid part instead of gaps.
          side={windingFlipped ? THREE.DoubleSide : THREE.FrontSide}
        />
        {isSelected && (
          <lineSegments>
            <edgesGeometry args={[hasGeometry ? obj.geometry : placeholderBoxGeo!]} />
            <lineBasicMaterial color="#ffaa00" linewidth={2} />
          </lineSegments>
        )}
      </mesh>

      {overhangGeom && (
        <mesh
          position={[pos.x, pos.y, pos.z ?? 0]}
          rotation={[rot.x, rot.y, rot.z]}
          scale={[scl.x, scl.y, scl.z]}
          geometry={overhangGeom}
          renderOrder={5}
        >
          <meshBasicMaterial
            color="#ff3344"
            transparent
            opacity={0.75}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      )}

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

const MOVE_TYPE_COLORS: Record<string, THREE.Color> = {
  'wall-outer': new THREE.Color('#aa1111'),
  'wall-inner': new THREE.Color('#33dd55'),
  infill:       new THREE.Color('#cc5500'),
  'top-bottom': new THREE.Color('#1144bb'),
  support:      new THREE.Color('#ff44ff'),
  skirt:        new THREE.Color('#aaaaaa'),
  brim:         new THREE.Color('#aaaaaa'),
  raft:         new THREE.Color('#888888'),
  bridge:       new THREE.Color('#ff4444'),
  ironing:      new THREE.Color('#88ff88'),
  travel:       new THREE.Color('#666666'),
};
const FALLBACK_COLOR = new THREE.Color('#ffffff');

// Shared unit extrusion-bead geometry used by every LayerLines InstancedMesh.
// A cylinder of length=1, diameter=1, axis aligned to +X so per-instance scale
// (length, width, height) maps cleanly. 12 radial segments keeps the bead round
// without wrecking draw-call cost. Created once at module load; never disposed.
const UNIT_BOX_GEO = (() => {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false);
  g.rotateZ(Math.PI / 2);
  return g;
})();

// Reusable scratch objects to avoid per-frame allocations inside useMemo.
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _pos3 = new THREE.Vector3();
const _scl3 = new THREE.Vector3();

// Visual exaggeration factor for line width. 1.0 = physical width; raising this
// makes walls overlap and blend together, obscuring individual line segments.
const PREVIEW_LINE_SCALE = 1.0;

// Each extrusion move is rendered as a physical box (lineWidth × layerHeight ×
// segmentLength), matching Cura's geometry-shader technique. Adjacent layers
// share the same Z range so they appear visually connected from the side.
function LayerLines({
  layer,
  layerHeight,
  isCurrentLayer,
  currentLayerMoveCount,
  showTravel,
  colorMode,
  hiddenTypes,
}: {
  layer: SliceLayer;
  layerHeight: number;
  isCurrentLayer: boolean;
  currentLayerMoveCount: number | undefined;
  showTravel: boolean;
  colorMode: 'type' | 'speed' | 'flow';
  hiddenTypes: ReadonlySet<string>;
}) {
  const { meshes, travelGeo } = useMemo(() => {
    const moves = (isCurrentLayer && currentLayerMoveCount !== undefined)
      ? layer.moves.slice(0, currentLayerMoveCount)
      : layer.moves;

    type Bucket = { mids: number[]; dirs: number[]; lens: number[]; lws: number[]; cols: number[] };
    const byType = new Map<string, Bucket>();
    const travPos: number[] = [];

    for (const move of moves) {
      if (move.type === 'travel') {
        if (showTravel) {
          travPos.push(move.from.x, move.from.y, layer.z, move.to.x, move.to.y, layer.z);
        }
        continue;
      }
      if (hiddenTypes.has(move.type)) continue;

      const dx = move.to.x - move.from.x;
      const dy = move.to.y - move.from.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;

      if (!byType.has(move.type)) byType.set(move.type, { mids: [], dirs: [], lens: [], lws: [], cols: [] });
      const b = byType.get(move.type)!;
      b.mids.push((move.from.x + move.to.x) / 2, (move.from.y + move.to.y) / 2, layer.z - layerHeight / 2);
      b.dirs.push(dx / len, dy / len);
      b.lens.push(len);
      b.lws.push(move.lineWidth ?? 0.4);

      let col: THREE.Color;
      if (colorMode === 'type') {
        col = MOVE_TYPE_COLORS[move.type] ?? FALLBACK_COLOR;
      } else if (colorMode === 'speed') {
        col = new THREE.Color().setHSL(Math.max(0, (240 - move.speed * 2) / 360), 0.8, 0.55);
      } else {
        col = new THREE.Color().setHSL(Math.max(0, (120 - move.extrusion * 100) / 360), 0.8, 0.55);
      }
      b.cols.push(col.r, col.g, col.b);
    }

    const meshList: Array<{ mesh: THREE.InstancedMesh; type: string }> = [];
    for (const [type, { mids, dirs, lens, lws, cols }] of byType) {
      const count = lens.length;
      if (count === 0) continue;
      // Lambert gives each bead visible top/side shading under the scene's
      // directional + ambient lights — critical for distinguishing stacked
      // walls on sloped surfaces that would otherwise blend into a solid mass.
      const mat = new THREE.MeshLambertMaterial();
      const mesh = new THREE.InstancedMesh(UNIT_BOX_GEO, mat, count);
      const col3 = new THREE.Color();
      for (let i = 0; i < count; i++) {
        const angle = Math.atan2(dirs[i * 2 + 1], dirs[i * 2]);
        _quat.setFromAxisAngle(_zAxis, angle);
        _pos3.set(mids[i * 3], mids[i * 3 + 1], mids[i * 3 + 2]);
        _scl3.set(lens[i], lws[i] * PREVIEW_LINE_SCALE, layerHeight);
        _mat4.compose(_pos3, _quat, _scl3);
        mesh.setMatrixAt(i, _mat4);
        col3.setRGB(cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]);
        mesh.setColorAt(i, col3);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      meshList.push({ mesh, type });
    }

    const tg = travPos.length > 0 ? new THREE.BufferGeometry() : null;
    if (tg) tg.setAttribute('position', new THREE.Float32BufferAttribute(travPos, 3));

    return { meshes: meshList, travelGeo: tg };
  }, [layer, layerHeight, isCurrentLayer, currentLayerMoveCount, showTravel, colorMode, hiddenTypes]);

  useEffect(() => () => {
    for (const { mesh } of meshes) {
      // Don't dispose mesh.geometry — it's UNIT_BOX_GEO, shared across all instances.
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    travelGeo?.dispose();
  }, [meshes, travelGeo]);

  return (
    <>
      {meshes.map(({ mesh, type }) => (
        <primitive key={`${layer.layerIndex}-${type}`} object={mesh} />
      ))}
      {travelGeo && (
        <lineSegments key={`${layer.layerIndex}-travel`} geometry={travelGeo}>
          <lineBasicMaterial color="#333355" transparent opacity={0.4} />
        </lineSegments>
      )}
    </>
  );
}

function InlineGCodePreview({
  sliceResult,
  startLayer,
  currentLayer,
  currentLayerMoveCount,
  showTravel,
  colorMode,
  hiddenTypes,
}: {
  sliceResult: SliceResult;
  startLayer: number;
  currentLayer: number;
  currentLayerMoveCount?: number;
  showTravel: boolean;
  colorMode: 'type' | 'speed' | 'flow';
  hiddenTypes: ReadonlySet<string>;
}) {
  const layers = useMemo(
    () => sliceResult.layers.filter((l) => l.layerIndex >= startLayer && l.layerIndex <= currentLayer),
    [sliceResult, startLayer, currentLayer],
  );

  return (
    <group>
      {layers.map((layer) => {
        const prevZ = layer.layerIndex > 0
          ? (sliceResult.layers[layer.layerIndex - 1]?.z ?? 0)
          : 0;
        const layerH = Math.max(0.05, layer.z - prevZ);
        return (
          <LayerLines
            key={layer.layerIndex}
            layer={layer}
            layerHeight={layerH}
            isCurrentLayer={layer.layerIndex === currentLayer}
            currentLayerMoveCount={currentLayerMoveCount}
            showTravel={showTravel}
            colorMode={colorMode}
            hiddenTypes={hiddenTypes}
          />
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Nozzle Simulation
// ---------------------------------------------------------------------------

interface MoveTimeline {
  cumulative: Float32Array;
  moves: Array<{ move: SliceMove; z: number }>;
  /** layer.layerIndex for each flat move entry */
  layerIndices: Int32Array;
  /** move index within its layer for each flat move entry */
  moveWithinLayer: Int32Array;
  total: number;
}

function estimateMoveDistance(
  move: SliceMove,
  fallbackLayerHeight: number,
  filamentDiameter: number,
): number {
  const dx = move.to.x - move.from.x;
  const dy = move.to.y - move.from.y;
  const xyDistance = Math.hypot(dx, dy);
  if (xyDistance > 1e-6) return xyDistance;

  if (move.extrusion <= 1e-9) return 0;

  const layerHeight = Math.max(move.layerHeight ?? fallbackLayerHeight, 1e-6);
  const lineWidth = Math.max(move.lineWidth ?? 0.4, 1e-6);
  const filamentArea = Math.PI * Math.pow(Math.max(filamentDiameter, 0.1) / 2, 2);
  return (move.extrusion * filamentArea) / (lineWidth * layerHeight);
}

function buildMoveTimeline(sliceResult: SliceResult, filamentDiameter: number): MoveTimeline {
  const flat: Array<{ move: SliceMove; z: number }> = [];
  let totalMoves = 0;
  for (const layer of sliceResult.layers) totalMoves += layer.moves.length;
  const cumulative = new Float32Array(totalMoves);
  const layerIndices = new Int32Array(totalMoves);
  const moveWithinLayer = new Int32Array(totalMoves);

  let t = 0;
  let i = 0;
  let prevLayerZ = 0;
  for (const layer of sliceResult.layers) {
    const fallbackLayerHeight = Math.max(layer.z - prevLayerZ, 0.001);
    for (let mi = 0; mi < layer.moves.length; mi++) {
      const move = layer.moves[mi];
      const distance = estimateMoveDistance(move, fallbackLayerHeight, filamentDiameter);
      t += move.speed > 0 ? distance / move.speed : 0;
      cumulative[i] = t;
      layerIndices[i] = layer.layerIndex;
      moveWithinLayer[i] = mi;
      flat.push({ move, z: layer.z });
      i++;
    }
    prevLayerZ = layer.z;
  }
  return { cumulative, moves: flat, layerIndices, moveWithinLayer, total: t };
}

function NozzleSimulator({
  timeline,
  simTime,
  playing,
  speed,
  onAdvance,
}: {
  timeline: MoveTimeline;
  simTime: number;
  playing: boolean;
  speed: number;
  onAdvance: (deltaSeconds: number) => void;
}) {
  const { invalidate } = useThree();

  // Playback loop — delegates clamping/pausing to the store setter.
  useFrame((_, delta) => {
    if (!playing) return;
    onAdvance(delta * speed);
    invalidate();
  });

  // Find the current move using binary search over cumulative times.
  const pos = useMemo(() => {
    if (timeline.moves.length === 0) return new THREE.Vector3();
    const cum = timeline.cumulative;
    const clampedT = Math.max(0, Math.min(simTime, timeline.total));
    // Binary search for the first cumulative >= clampedT.
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < clampedT) lo = mid + 1;
      else hi = mid;
    }
    const { move, z } = timeline.moves[lo];
    const prevCum = lo > 0 ? cum[lo - 1] : 0;
    const moveDur = Math.max(1e-6, cum[lo] - prevCum);
    const alpha = Math.max(0, Math.min(1, (clampedT - prevCum) / moveDur));
    const x = move.from.x + (move.to.x - move.from.x) * alpha;
    const y = move.from.y + (move.to.y - move.from.y) * alpha;
    return new THREE.Vector3(x, y, z + 0.2);
  }, [timeline, simTime]);

  return (
    <group>
      {/* Nozzle marker */}
      <mesh position={pos}>
        <sphereGeometry args={[1.2, 16, 16]} />
        <meshStandardMaterial
          color="#ffcc00"
          emissive="#ff8800"
          emissiveIntensity={0.8}
        />
      </mesh>
      {/* Guide line to bed */}
      <Line
        points={[[pos.x, pos.y, 0], [pos.x, pos.y, pos.z]]}
        color="#ffcc00"
        lineWidth={0.5}
        transparent
        opacity={0.35}
      />
    </group>
  );
}

export function SlicerWorkspaceScene() {
  const { invalidate } = useThree();

  const printerProfile = useSlicerStore((s) => s.getActivePrinterProfile());
  const materialProfile = useSlicerStore((s) => s.getActiveMaterialProfile());
  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const selectedId = useSlicerStore((s) => s.selectedPlateObjectId);
  const selectPlateObject = useSlicerStore((s) => s.selectPlateObject);
  const updatePlateObject = useSlicerStore((s) => s.updatePlateObject);
  const transformMode = useSlicerStore((s) => s.transformMode);
  const previewMode = useSlicerStore((s) => s.previewMode);
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const previewLayer = useSlicerStore((s) => s.previewLayer);
  const previewLayerStart = useSlicerStore((s) => s.previewLayerStart);
  const previewShowTravel = useSlicerStore((s) => s.previewShowTravel);
  const previewColorMode = useSlicerStore((s) => s.previewColorMode);
  const previewHiddenTypesArr = useSlicerStore((s) => s.previewHiddenTypes);
  const previewHiddenTypesKey = useMemo(
    () => previewHiddenTypesArr.join('|'),
    [previewHiddenTypesArr],
  );
  const hiddenTypes = useMemo(() => new Set(previewHiddenTypesArr), [previewHiddenTypesKey]);
  const previewSimEnabled = useSlicerStore((s) => s.previewSimEnabled);
  const previewSimPlaying = useSlicerStore((s) => s.previewSimPlaying);
  const previewSimSpeed = useSlicerStore((s) => s.previewSimSpeed);
  const previewSimTime = useSlicerStore((s) => s.previewSimTime);
  const advancePreviewSimTime = useSlicerStore((s) => s.advancePreviewSimTime);
  const printabilityReport = useSlicerStore((s) => s.printabilityReport);
  const printabilityHighlight = useSlicerStore((s) => s.printabilityHighlight);

  const highlightByObject = useMemo(() => {
    const map = new Map<string, Set<number>>();
    if (!printabilityReport || !printabilityHighlight) return map;
    for (const o of printabilityReport.objects) {
      if (o.highlightedTriangles.size > 0) map.set(o.objectId, o.highlightedTriangles);
    }
    return map;
  }, [printabilityReport, printabilityHighlight]);

  // When any visible state changes, ask R3F to render one new frame.
  // Without this, frameloop="demand" would never repaint after store updates.
  useEffect(() => { invalidate(); }, [invalidate, plateObjects, selectedId, transformMode]);
  useEffect(() => { invalidate(); }, [
    invalidate, previewMode, sliceResult, previewLayer, previewLayerStart,
  ]);
  useEffect(() => { invalidate(); }, [
    invalidate, previewShowTravel, previewColorMode, previewHiddenTypesKey,
  ]);
  useEffect(() => { invalidate(); }, [
    invalidate, previewSimEnabled, previewSimPlaying, previewSimTime,
  ]);
  useEffect(() => { invalidate(); }, [
    invalidate, printabilityReport, printabilityHighlight,
  ]);

  const bv = printerProfile?.buildVolume ?? { x: 220, y: 220, z: 250 };

  // Build the full move timeline once per slice result. Shared by NozzleSimulator
  // and the sim-state lookup below so we pay the O(n) build cost only once.
  const moveTimeline = useMemo(
    () => (sliceResult ? buildMoveTimeline(sliceResult, printerProfile?.filamentDiameter ?? 1.75) : null),
    [sliceResult, printerProfile?.filamentDiameter],
  );

  // Map simTime → { layerIndex, moveCount } so InlineGCodePreview reveals
  // moves one at a time instead of entire layers at once.
  const simState = useMemo(() => {
    if (!previewSimEnabled || !moveTimeline || moveTimeline.moves.length === 0) {
      return { layerIndex: previewLayer, moveCount: undefined as number | undefined };
    }
    const cum = moveTimeline.cumulative;
    const clampedT = Math.max(0, Math.min(previewSimTime, moveTimeline.total));
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < clampedT) lo = mid + 1;
      else hi = mid;
    }
    return {
      layerIndex: moveTimeline.layerIndices[lo],
      moveCount: moveTimeline.moveWithinLayer[lo] + 1,
    };
  }, [previewSimEnabled, moveTimeline, previewSimTime, previewLayer]);

  const handleMiss = useCallback(() => {
    selectPlateObject(null);
  }, [selectPlateObject]);

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
          highlightedTriangles={highlightByObject.get(obj.id)}
          onClick={() => selectPlateObject(obj.id)}
          transformMode={transformMode}
          onTransformCommit={handleTransformCommit}
        />
      ))}

      {previewMode === 'preview' && sliceResult && (
        <InlineGCodePreview
          sliceResult={sliceResult}
          startLayer={previewLayerStart}
          currentLayer={simState.layerIndex}
          currentLayerMoveCount={simState.moveCount}
          showTravel={previewShowTravel}
          colorMode={previewColorMode}
          hiddenTypes={hiddenTypes}
        />
      )}

      {previewMode === 'preview' && sliceResult && previewSimEnabled && moveTimeline && (
        <NozzleSimulator
          timeline={moveTimeline}
          simTime={previewSimTime}
          playing={previewSimPlaying}
          speed={previewSimSpeed}
          onAdvance={advancePreviewSimTime}
        />
      )}

      <mesh position={[bv.x / 2, bv.y / 2, -0.1]} onClick={handleMiss} visible={false}>
        <planeGeometry args={[bv.x * 2, bv.y * 2]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

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
