import { useFrame } from '@react-three/fiber';
import { useComponentStore } from '../../../store/componentStore';

/**
 * A19 — Drive Joints animation player.
 * Runs inside the R3F Canvas; uses useFrame to advance animation each tick.
 * Returns null — no rendered geometry.
 */
export default function JointAnimationPlayer() {
  const animationPlaying = useComponentStore((s) => s.animationPlaying);
  const tickAnimation = useComponentStore((s) => s.tickAnimation);

  useFrame((_, delta) => {
    if (animationPlaying) tickAnimation(delta);
  });

  return null;
}
