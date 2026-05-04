import { useEffect, useMemo, useRef } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { MoveHoverInfo, ShaftMoveData } from '../../../../types/slicer-preview.types';
import { getCapsuleTemplate } from './capsuleTemplate';
import { getExtrusionMaterial } from './extrusionMaterial';
import type { LayerInstanceData } from './extrusionInstances';

// One InstancedMesh for all extrusion segments in a layer. The capsule
// template + shader material are shared across every layer; only the
// per-instance attribute buffers (iA, iB, iRadius, iColor) change.
//
// Picking: InstancedMesh raycasting returns intersection.instanceId which
// directly indexes into the moveRefs array — O(1) lookup, no per-segment
// face arithmetic required. Three.js's raycaster rejects rays against
// `geometry.boundingSphere` BEFORE iterating instances, so we must set a
// world-space bounding sphere that actually contains the instance positions
// (not the unit-radius template sphere).

const HOVER_WORLD_POS = new THREE.Vector3();
const RAY_POINT = new THREE.Vector3();
const SEGMENT_POINT = new THREE.Vector3();
const SEGMENT_A = new THREE.Vector3();
const SEGMENT_B = new THREE.Vector3();

interface Props {
  data: LayerInstanceData;
  onHoverMove?: (info: MoveHoverInfo | null) => void;
}

export function ExtrusionInstancedMesh({ data, onHoverMove }: Props) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Build a fresh InstancedBufferGeometry per layer. Shared template
  // attributes (`position`, `aSide`, `aLocal`) and the index are added via
  // setAttribute()/setIndex() — direct assignment of `inst.attributes` would
  // bypass Three.js's attribute bookkeeping and is fragile across versions.
  const geometry = useMemo(() => {
    const template = getCapsuleTemplate();
    const inst = new THREE.InstancedBufferGeometry();
    inst.setIndex(template.geometry.getIndex());
    inst.setAttribute('position', template.geometry.getAttribute('position'));
    inst.setAttribute('aSide',    template.geometry.getAttribute('aSide'));
    inst.setAttribute('aLocal',   template.geometry.getAttribute('aLocal'));

    const iAAttr      = new THREE.InstancedBufferAttribute(data.iA, 3);
    const iBAttr      = new THREE.InstancedBufferAttribute(data.iB, 3);
    const iRadiusAttr = new THREE.InstancedBufferAttribute(data.iRadius, 2);
    const iHeightAttr = new THREE.InstancedBufferAttribute(data.iHeight, 2);
    const iColorAttr  = new THREE.InstancedBufferAttribute(data.iColor, 3);
    inst.setAttribute('iA',      iAAttr);
    inst.setAttribute('iB',      iBAttr);
    inst.setAttribute('iRadius', iRadiusAttr);
    inst.setAttribute('iHeight', iHeightAttr);
    inst.setAttribute('iColor',  iColorAttr);
    inst.instanceCount = data.count;

    // Instance-aware bounding sphere — required for picking. The template's
    // unit-sphere bounds only covers the world origin, so without this the
    // raycaster's bounding-sphere pre-test rejects every hover event.
    if (data.count > 0) {
      inst.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(data.boundsCenter.x, data.boundsCenter.y, data.boundsCenter.z),
        data.boundsRadius,
      );
      inst.boundingBox = new THREE.Box3().setFromCenterAndSize(
        inst.boundingSphere.center,
        new THREE.Vector3(data.boundsRadius * 2, data.boundsRadius * 2, data.boundsRadius * 2),
      );
    }
    return inst;
  }, [data]);

  // Free per-layer GPU resources when the layer unmounts or its data
  // changes. Three.js r156+ has explicit BufferAttribute.dispose() to drop
  // GPU buffers; without it, scrubbing a 200-layer print accumulates dead
  // VBOs until JS GC eventually reclaims them. Shared template attributes
  // and the shared index are NOT disposed here — the template owns those.
  useEffect(() => () => {
    const iA      = geometry.getAttribute('iA');
    const iB      = geometry.getAttribute('iB');
    const iRadius = geometry.getAttribute('iRadius');
    const iHeight = geometry.getAttribute('iHeight');
    const iColor  = geometry.getAttribute('iColor');
    type Disposable = { dispose?: () => void };
    (iA      as unknown as Disposable | undefined)?.dispose?.();
    (iB      as unknown as Disposable | undefined)?.dispose?.();
    (iRadius as unknown as Disposable | undefined)?.dispose?.();
    (iHeight as unknown as Disposable | undefined)?.dispose?.();
    (iColor  as unknown as Disposable | undefined)?.dispose?.();
    geometry.deleteAttribute('iA');
    geometry.deleteAttribute('iB');
    geometry.deleteAttribute('iRadius');
    geometry.deleteAttribute('iHeight');
    geometry.deleteAttribute('iColor');
    geometry.deleteAttribute('position');
    geometry.deleteAttribute('aSide');
    geometry.deleteAttribute('aLocal');
    geometry.setIndex(null);
    geometry.dispose();
  }, [geometry]);

  const material = getExtrusionMaterial();

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.raycast = (raycaster, intersects) => {
      for (let i = 0; i < data.count; i++) {
        const aOff = i * 3;
        const rOff = i * 2;
        SEGMENT_A.set(data.iA[aOff], data.iA[aOff + 1], data.iA[aOff + 2]);
        SEGMENT_B.set(data.iB[aOff], data.iB[aOff + 1], data.iB[aOff + 2]);
        const radius = Math.max(
          data.iRadius[rOff],
          data.iRadius[rOff + 1],
          data.iHeight[rOff],
          data.iHeight[rOff + 1],
        );
        const distSq = raycaster.ray.distanceSqToSegment(SEGMENT_A, SEGMENT_B, RAY_POINT, SEGMENT_POINT);
        if (distSq > radius * radius) continue;
        const distance = raycaster.ray.origin.distanceTo(RAY_POINT);
        if (distance < raycaster.near || distance > raycaster.far) continue;
        intersects.push({
          distance,
          point: SEGMENT_POINT.clone(),
          object: mesh,
          instanceId: i,
        });
      }
    };
  }, [data]);

  if (data.count === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, data.count]}
      frustumCulled={false}
      onPointerMove={onHoverMove ? (e: ThreeEvent<PointerEvent>) => {
        const id = e.instanceId;
        if (id === undefined || id < 0 || id >= data.moveRefs.length) return;
        e.stopPropagation();
        HOVER_WORLD_POS.copy(e.point);
        const ref: ShaftMoveData = data.moveRefs[id];
        onHoverMove({ ...ref, worldPos: HOVER_WORLD_POS });
      } : undefined}
      onPointerLeave={onHoverMove ? () => onHoverMove(null) : undefined}
    />
  );
}
