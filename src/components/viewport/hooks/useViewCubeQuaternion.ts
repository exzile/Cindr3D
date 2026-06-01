import { useEffect, useState } from 'react';
import * as THREE from 'three';

const _quatA = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
let _quatToggle = false;
const _latestQuat = new THREE.Quaternion();
let _snapshotQuat = new THREE.Quaternion();
let _notifyTimer: number | null = null;
const _listeners = new Set<(q: THREE.Quaternion) => void>();

function flushViewCubeQuaternion() {
  _notifyTimer = null;
  if (_latestQuat.equals(_snapshotQuat)) return;

  _quatToggle = !_quatToggle;
  const scratch = _quatToggle ? _quatA : _quatB;
  scratch.copy(_latestQuat);
  _snapshotQuat = scratch;

  for (const listener of _listeners) listener(_snapshotQuat);
}

export function publishViewCubeQuaternion(q: THREE.Quaternion) {
  if (_latestQuat.equals(q)) return;
  _latestQuat.copy(q);
  if (_notifyTimer != null) return;
  _notifyTimer = window.setTimeout(flushViewCubeQuaternion, 100);
}

export function useViewCubeQuaternion() {
  const [camQuat, setCamQuat] = useState(() => _snapshotQuat);

  useEffect(() => {
    const listener = (q: THREE.Quaternion) => setCamQuat(q);
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  }, []);

  return camQuat;
}
