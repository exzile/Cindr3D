import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { BODY_MATERIAL } from './bodyMaterial';

/**
 * D54 Slice + D38 Section Analysis — manages clipping planes on the body
 * material. Sketch-plane slice and section-analysis plane are combined when
 * both are active.
 */
export default function SliceEffect() {
  const { gl } = useThree();
  const activeSketch = useCADStore((s) => s.activeSketch);
  const sliceEnabled = useCADStore((s) => s.sliceEnabled);
  const sectionEnabled = useCADStore((s) => s.sectionEnabled);
  const sectionAxis = useCADStore((s) => s.sectionAxis);
  const sectionOffset = useCADStore((s) => s.sectionOffset);
  const sectionFlip = useCADStore((s) => s.sectionFlip);

  useEffect(() => {
    const planes: THREE.Plane[] = [];

    if (sliceEnabled && activeSketch) {
      const n = activeSketch.planeNormal.clone().normalize();
      const d = -n.dot(activeSketch.planeOrigin);
      planes.push(new THREE.Plane(n, d));
    }

    if (sectionEnabled) {
      const axisVec =
        sectionAxis === 'x' ? new THREE.Vector3(1, 0, 0) :
        sectionAxis === 'y' ? new THREE.Vector3(0, 1, 0) :
                              new THREE.Vector3(0, 0, 1);
      if (sectionFlip) axisVec.negate();
      planes.push(new THREE.Plane(axisVec, -sectionOffset));
    }

    if (planes.length > 0) {
      gl.localClippingEnabled = true;
      BODY_MATERIAL.clippingPlanes = planes;
      BODY_MATERIAL.needsUpdate = true;
    } else {
      gl.localClippingEnabled = false;
      BODY_MATERIAL.clippingPlanes = [];
      BODY_MATERIAL.needsUpdate = true;
    }

    return () => {
      gl.localClippingEnabled = false;
      BODY_MATERIAL.clippingPlanes = [];
      BODY_MATERIAL.needsUpdate = true;
    };
  }, [sliceEnabled, activeSketch, sectionEnabled, sectionAxis, sectionOffset, sectionFlip, gl]);

  return null;
}
