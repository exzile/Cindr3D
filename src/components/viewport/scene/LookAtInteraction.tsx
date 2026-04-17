import { useCallback } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useFacePicker, type FacePickResult } from '../../../hooks/useFacePicker';

// Module-level scratch — no per-frame allocation
const _mat = new THREE.Matrix4();
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _zero = new THREE.Vector3();

/**
 * NAV-6 / CTX-13: When cameraNavMode === 'look-at', the next face click
 * reorients the camera to look straight at that face, then clears the mode.
 */
export default function LookAtInteraction() {
  const cameraNavMode = useCADStore((s) => s.cameraNavMode);
  const setCameraNavMode = useCADStore((s) => s.setCameraNavMode);
  const setCameraTargetQuaternion = useCADStore((s) => s.setCameraTargetQuaternion);

  const enabled = cameraNavMode === 'look-at';

  const handleClick = useCallback(
    (result: FacePickResult) => {
      // Camera looks INTO the face — view direction = -normal
      _dir.copy(result.normal).negate();
      _up.set(0, 1, 0);
      // If the look direction is nearly parallel to world-up, use world-X instead
      if (Math.abs(_up.dot(_dir)) > 0.99) _up.set(1, 0, 0);
      // lookAt: -Z of matrix points toward target. Here target = origin + _dir.
      _mat.lookAt(_zero, _dir, _up);
      const q = new THREE.Quaternion().setFromRotationMatrix(_mat);
      setCameraTargetQuaternion(q);
      setCameraNavMode(null);
    },
    [setCameraTargetQuaternion, setCameraNavMode],
  );

  useFacePicker({ enabled, onClick: handleClick });

  return null;
}
