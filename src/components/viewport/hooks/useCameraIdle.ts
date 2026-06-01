import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Returns `false` while the camera is moving (pan / orbit / zoom) and `true`
 * once it has been still for `delay` ms.
 *
 * Heavy per-frame overlays — especially drei <Html> glyphs, which reproject and
 * rewrite DOM styles on every rendered frame — can make panning lag. Gating them
 * on this hook lets them skip rendering during camera movement (when frames
 * redraw continuously) and reappear the moment the camera settles.
 *
 * Works with frameloop="demand": the per-frame check runs only while frames are
 * being produced (i.e. during movement); the settle transition is driven by a
 * timeout that calls invalidate() to repaint the overlays once.
 */
export function useCameraIdle(delay = 160): boolean {
  const { camera, invalidate } = useThree();
  const [idle, setIdle] = useState(true);
  const idleRef = useRef(true);
  const last = useRef<THREE.Matrix4>(new THREE.Matrix4().copy(camera.matrixWorld));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFrame(() => {
    if (camera.matrixWorld.equals(last.current)) return;
    last.current.copy(camera.matrixWorld);
    if (idleRef.current) {
      idleRef.current = false;
      setIdle(false);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      idleRef.current = true;
      setIdle(true);
      invalidate(); // demand mode: request one frame so the overlays repaint
    }, delay);
  });

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return idle;
}
