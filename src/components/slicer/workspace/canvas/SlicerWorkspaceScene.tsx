import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Line, OrbitControls, Text, TransformControls } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useSlicerStore } from '../../../../store/slicerStore';
import type { PlateObject, SliceResult } from '../../../../types/slicer';
import { normalizeRotationRadians, normalizeScale } from '../../../../utils/slicerTransforms';

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
      <Line
        points={[[0, 0, 0], [sizeX, 0, 0], [sizeX, sizeY, 0], [0, sizeY, 0], [0, 0, 0]]}
        color="#4a4a6a"
        lineWidth={1.5}
      />
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
}: {
  obj: PlateObject;
  isSelected: boolean;
  materialColor: string;
  onClick: () => void;
  transformMode: 'move' | 'scale' | 'rotate' | 'mirror' | 'settings';
  onTransformCommit: (id: string, pos: { x: number; y: number; z: number }, rot: { x: number; y: number; z: number }, scl: { x: number; y: number; z: number }) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
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

  const locked = !!obj.locked;
  const gizmoMode = transformMode === 'rotate' ? 'rotate' : transformMode === 'scale' ? 'scale' : 'translate';
  const showGizmo = isSelected && !locked && (transformMode === 'move' || transformMode === 'rotate' || transformMode === 'scale');

  const handleDragEnd = useCallback(() => {
    const m = meshRef.current;
    if (!m) return;
    onTransformCommit(
      obj.id,
      { x: m.position.x, y: m.position.y, z: m.position.z },
      { x: m.rotation.x, y: m.rotation.y, z: m.rotation.z },
      { x: m.scale.x, y: m.scale.y, z: m.scale.z },
    );
  }, [obj.id, onTransformCommit]);

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
            <edgesGeometry args={[hasGeometry ? obj.geometry : placeholderBoxGeo!]} />
            <lineBasicMaterial color="#ffaa00" linewidth={2} />
          </lineSegments>
        )}
      </mesh>

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
    infill: '#44aaff',
    'top-bottom': '#44ff88',
    support: '#ff44ff',
    skirt: '#aaaaaa',
    brim: '#aaaaaa',
    raft: '#888888',
    bridge: '#ff4444',
    ironing: '#88ff88',
    travel: '#666666',
  };

  const visibleLayers = sliceResult.layers.filter((l) => l.layerIndex <= currentLayer);

  return (
    <group>
      {visibleLayers.map((layer) => {
        const extrusions: [number, number, number][] = [];
        const travels: [number, number, number][] = [];

        const extColors: THREE.Color[] = [];
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
            const col = new THREE.Color(c);
            extColors.push(col);
            extColors.push(col);
          }
        }

        return (
          <group key={layer.layerIndex}>
            {extrusions.length > 1 && (
              <Line points={extrusions} vertexColors={extColors} lineWidth={1.2} />
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

export function SlicerWorkspaceScene() {
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
  const previewShowTravel = useSlicerStore((s) => s.previewShowTravel);
  const previewColorMode = useSlicerStore((s) => s.previewColorMode);

  const bv = printerProfile?.buildVolume ?? { x: 220, y: 220, z: 250 };

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
