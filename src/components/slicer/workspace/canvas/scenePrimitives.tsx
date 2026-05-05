import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Line, Text, TransformControls } from '@react-three/drei';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlateObject } from '../../../../types/slicer';
import { normalizeRotationRadians, normalizeScale } from '../../../../utils/slicerTransforms';
import { useSlicerStore } from '../../../../store/slicerStore';

export function BuildPlateGrid({ sizeX, sizeY }: { sizeX: number; sizeY: number }) {
  const gridGeo = useMemo(() => {
    const verts: number[] = [];
    for (let x = 0; x <= sizeX; x += 10) verts.push(x, 0, 0, x, sizeY, 0);
    for (let y = 0; y <= sizeY; y += 10) verts.push(0, y, 0, sizeX, y, 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    return geo;
  }, [sizeX, sizeY]);
  useEffect(() => () => { gridGeo.dispose(); }, [gridGeo]);

  const borderGeo = useMemo(() => {
    const pts = [0, 0, 0, sizeX, 0, 0, sizeX, 0, 0, sizeX, sizeY, 0, sizeX, sizeY, 0, 0, sizeY, 0, 0, sizeY, 0, 0, 0, 0];
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

export function BuildVolumeWireframe({ x, y, z, warning = false }: { x: number; y: number; z: number; warning?: boolean }) {
  const geo = useMemo(() => new THREE.BoxGeometry(x, y, z), [x, y, z]);
  useEffect(() => () => { geo.dispose(); }, [geo]);
  const baseColor = warning ? '#cc4444' : '#3344aa';
  const lineOpacity = warning ? 0.6 : 0.25;
  return (
    <mesh position={[x / 2, y / 2, z / 2]}>
      <boxGeometry args={[x, y, z]} />
      <meshBasicMaterial
        color={baseColor}
        transparent
        opacity={warning ? 0.1 : 0.06}
        wireframe={false}
        depthWrite={false}
      />
      <lineSegments>
        <edgesGeometry args={[geo]} />
        <lineBasicMaterial color={baseColor} transparent opacity={lineOpacity} />
      </lineSegments>
    </mesh>
  );
}

export function AxisIndicators() {
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

export function PlateObjectMesh({
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
  const mir = obj as { mirrorX?: boolean; mirrorY?: boolean; mirrorZ?: boolean };
  const mirrorCount = (mir.mirrorX ? 1 : 0) + (mir.mirrorY ? 1 : 0) + (mir.mirrorZ ? 1 : 0);
  const windingFlipped = mirrorCount % 2 === 1;
  const scl = {
    x: rawScl.x * (mir.mirrorX ? -1 : 1),
    y: rawScl.y * (mir.mirrorY ? -1 : 1),
    z: rawScl.z * (mir.mirrorZ ? -1 : 1),
  };

  const handleContextMenu = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const native = e.nativeEvent as MouseEvent;
    native.preventDefault();
    onClick(); // also select so the panel highlights the right row
    window.dispatchEvent(new CustomEvent('slicer:object-context-menu', {
      detail: { id: obj.id, x: native.clientX, y: native.clientY },
    }));
  }, [obj.id, onClick]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const store = useSlicerStore.getState();
    if (store.viewportPickMode === 'lay-flat' && e.face) {
      // Build the local-space face normal from the picked triangle. e.face
      // gives the THREE.Face object; its `.normal` is the precomputed
      // per-face normal in mesh-local space, exactly what layFlatByFace
      // expects.
      store.layFlatByFace(obj.id, {
        x: e.face.normal.x,
        y: e.face.normal.y,
        z: e.face.normal.z,
      });
      store.setViewportPickMode('none');
      return;
    }
    if (store.viewportPickMode === 'measure' && e.point) {
      store.pushMeasurePoint({ x: e.point.x, y: e.point.y, z: e.point.z });
      return;
    }
    onClick();
  }, [obj.id, onClick]);

  const geometry = obj.geometry as unknown;
  const hasGeometry =
    geometry instanceof THREE.BufferGeometry ||
    (!!geometry && typeof geometry === 'object' && (geometry as { isBufferGeometry?: boolean }).isBufferGeometry === true);

  const locked = !!obj.locked;
  const gizmoMode = transformMode === 'rotate' ? 'rotate' : transformMode === 'scale' ? 'scale' : 'translate';
  const showGizmo = isSelected && !locked && (transformMode === 'move' || transformMode === 'rotate' || transformMode === 'scale');

  const handleDragEnd = useCallback(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const sx = mir.mirrorX ? -1 : 1;
    const sy = mir.mirrorY ? -1 : 1;
    const sz = mir.mirrorZ ? -1 : 1;
    onTransformCommit(
      obj.id,
      { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
      { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
      { x: mesh.scale.x * sx, y: mesh.scale.y * sy, z: mesh.scale.z * sz },
    );
  }, [obj.id, mir.mirrorX, mir.mirrorY, mir.mirrorZ, onTransformCommit]);

  const rawX = obj.boundingBox.max.x - obj.boundingBox.min.x;
  const rawY = obj.boundingBox.max.y - obj.boundingBox.min.y;
  const rawZ = obj.boundingBox.max.z - obj.boundingBox.min.z;
  const boxArgs = useMemo<[number, number, number]>(() => [
    isFinite(rawX) && rawX > 0 ? rawX : 10,
    isFinite(rawY) && rawY > 0 ? rawY : 10,
    isFinite(rawZ) && rawZ > 0 ? rawZ : 10,
  ], [rawX, rawY, rawZ]);

  const placeholderBoxGeo = useMemo(
    () => (hasGeometry ? null : new THREE.BoxGeometry(boxArgs[0], boxArgs[1], boxArgs[2])),
    [hasGeometry, boxArgs],
  );
  useEffect(() => () => { placeholderBoxGeo?.dispose(); }, [placeholderBoxGeo]);

  const overhangGeom = useMemo(() => {
    if (!highlightedTriangles || highlightedTriangles.size === 0 || !hasGeometry) return null;
    const src = obj.geometry as THREE.BufferGeometry;
    const posAttr = src.getAttribute('position');
    const indexAttr = src.getIndex();
    if (!posAttr) return null;
    const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
    const out = new Float32Array(highlightedTriangles.size * 9);
    let writeIndex = 0;
    for (let t = 0; t < triCount; t++) {
      if (!highlightedTriangles.has(t)) continue;
      const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
      const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
      for (const index of [i0, i1, i2]) {
        out[writeIndex++] = posAttr.getX(index);
        out[writeIndex++] = posAttr.getY(index);
        out[writeIndex++] = posAttr.getZ(index);
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
        onContextMenu={handleContextMenu}
      >
        {!hasGeometry && <boxGeometry args={boxArgs} />}
        <meshStandardMaterial
          color={materialColor}
          transparent={isSelected}
          opacity={isSelected ? 0.85 : 1}
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
        <TransformControls object={meshInstance} mode={gizmoMode} onMouseUp={handleDragEnd} />
      )}
    </>
  );
}
