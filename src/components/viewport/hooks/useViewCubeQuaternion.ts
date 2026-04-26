import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const _quatA = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
let _quatToggle = false;

export function useViewCubeQuaternion() {
  const [camQuat, setCamQuat] = useState(() => new THREE.Quaternion());
  const quatRef = useRef(new THREE.Quaternion());

  const handleQuaternionChange = useCallback((q: THREE.Quaternion) => {
    if (!quatRef.current.equals(q)) {
      quatRef.current.copy(q);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setCamQuat((previous) => {
        if (quatRef.current.equals(previous)) return previous;
        _quatToggle = !_quatToggle;
        const scratch = _quatToggle ? _quatA : _quatB;
        scratch.copy(quatRef.current);
        return scratch;
      });
    }, 100);
    return () => clearInterval(id);
  }, []);

  return { camQuat, handleQuaternionChange };
}
