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
// face arithmetic required.

const HOVER_WORLD_POS = new THREE.Vector3();

interface Props {
  data: LayerInstanceData;
  onHoverMove?: (info: MoveHoverInfo | null) => void;
}

export function ExtrusionInstancedMesh({ data, onHoverMove }: Props) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // The capsule template is module-cached; we rebuild a fresh
  // InstancedBufferGeometry per layer because each layer needs its own set
  // of per-instance attribute buffers (and a unique InstancedBufferGeometry
  // is the cleanest way to attach them in r3f).
  const geometry = useMemo(() => {
    const template = getCapsuleTemplate();
    const inst = new THREE.InstancedBufferGeometry();
    inst.index = template.geometry.index;
    inst.attributes = template.geometry.attributes;
    inst.boundingSphere = template.geometry.boundingSphere;
    inst.boundingBox = template.geometry.boundingBox;
    inst.setAttribute('iA',      new THREE.InstancedBufferAttribute(data.iA, 3));
    inst.setAttribute('iB',      new THREE.InstancedBufferAttribute(data.iB, 3));
    inst.setAttribute('iRadius', new THREE.InstancedBufferAttribute(data.iRadius, 2));
    inst.setAttribute('iColor',  new THREE.InstancedBufferAttribute(data.iColor, 3));
    inst.instanceCount = data.count;
    return inst;
  }, [data]);

  // Free per-layer GPU resources when the layer is unmounted or its data
  // changes. The template geometry's index/attribute objects are shared and
  // must NOT be disposed here — only the InstancedBufferGeometry wrapper
  // and the per-instance attribute buffers (which Three.js disposes
  // automatically on geometry.dispose()).
  useEffect(() => () => { geometry.dispose(); }, [geometry]);

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
