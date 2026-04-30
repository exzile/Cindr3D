import { useEffect, useMemo, useRef } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { MoveHoverInfo, ShaftMoveData } from '../../../../types/slicer-preview.types';
import { getCapsuleTemplate } from './capsuleTemplate';
import { getExtrusionMaterial } from './extrusionMaterial';
import type { LayerInstanceData } from './extrusionInstances';
import { makeCapsuleRaycaster } from './capsuleRaycast';

// One InstancedMesh for all extrusion segments in a layer. The capsule
// template + shader material are shared across every layer; only the
// per-instance attribute buffers (iA, iB, iRadius, iHalfHeight, iColor)
// change.
//
// Picking: capsule vertices are positioned ENTIRELY in the shader from the
// per-instance attributes — instanceMatrix stays identity. Three.js's
// default InstancedMesh.raycast multiplies instanceMatrix by the geometry's
// CPU position attribute, which would test every ray against a unit capsule
// at the world origin and report instanceId 0 (or miss). Override raycast
// with `makeCapsuleRaycaster` so picking actually intersects the rendered
// capsules analytically.

const HOVER_WORLD_POS = new THREE.Vector3();

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

    const iAAttr          = new THREE.InstancedBufferAttribute(data.iA, 3);
    const iBAttr          = new THREE.InstancedBufferAttribute(data.iB, 3);
    const iRadiusAttr     = new THREE.InstancedBufferAttribute(data.iRadius, 2);
    const iHalfHeightAttr = new THREE.InstancedBufferAttribute(data.iHalfHeight, 1);
    const iColorAttr      = new THREE.InstancedBufferAttribute(data.iColor, 3);
    inst.setAttribute('iA',          iAAttr);
    inst.setAttribute('iB',          iBAttr);
    inst.setAttribute('iRadius',     iRadiusAttr);
    inst.setAttribute('iHalfHeight', iHalfHeightAttr);
    inst.setAttribute('iColor',      iColorAttr);
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

  // Override raycast on the instanced mesh once it mounts. Three.js's
  // default InstancedMesh.raycast tests rays against the geometry's CPU
  // `position` attribute multiplied by `instanceMatrix[i]` per instance —
  // which for our shader-positioned capsules means every ray gets tested
  // against a unit capsule at world origin and picking always reports
  // instanceId 0. Replace it with an analytic ray-vs-capsule test.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.raycast = makeCapsuleRaycaster(mesh, data.iA, data.iB, data.iRadius, data.count);
  }, [data]);

  // Free per-layer GPU resources when the layer unmounts or its data
  // changes. Detach the shared template attributes/index BEFORE calling
  // geometry.dispose() so the renderer's dispose path can't accidentally
  // evict the cached template buffers via this geometry's dispose event.
  // (In current Three.js the dispose event doesn't cascade to attribute
  // GPU buffers — but being explicit makes the lifecycle obvious and
  // robust against future renderer changes.) The per-instance attribute
  // GPU buffers ARE ours to free; r156+ exposes BufferAttribute.dispose()
  // for that.
  useEffect(() => () => {
    type Disposable = { dispose?: () => void };
    const iA          = geometry.getAttribute('iA');
    const iB          = geometry.getAttribute('iB');
    const iRadius     = geometry.getAttribute('iRadius');
    const iHalfHeight = geometry.getAttribute('iHalfHeight');
    const iColor      = geometry.getAttribute('iColor');
    (iA          as unknown as Disposable | undefined)?.dispose?.();
    (iB          as unknown as Disposable | undefined)?.dispose?.();
    (iRadius     as unknown as Disposable | undefined)?.dispose?.();
    (iHalfHeight as unknown as Disposable | undefined)?.dispose?.();
    (iColor      as unknown as Disposable | undefined)?.dispose?.();
    geometry.deleteAttribute('iA');
    geometry.deleteAttribute('iB');
    geometry.deleteAttribute('iRadius');
    geometry.deleteAttribute('iHalfHeight');
    geometry.deleteAttribute('iColor');
    geometry.deleteAttribute('position');
    geometry.deleteAttribute('aSide');
    geometry.deleteAttribute('aLocal');
    geometry.setIndex(null);
    geometry.dispose();
  }, [geometry]);

  const material = getExtrusionMaterial();

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
