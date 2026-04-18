import { useFrame } from '@react-three/fiber';
import { useComponentStore, _liveJointValues } from '../../../store/componentStore';

/**
 * A19 — Drive Joints animation player.
 * Runs inside the R3F Canvas; uses useFrame to advance animation each tick.
 * Returns null — no rendered geometry.
 *
 * Performance: tickAnimation now writes joint values to the module-level
 * _liveJointValues map instead of calling Zustand set({ joints }). This
 * prevents 60Hz React re-renders across all joint subscribers during playback.
 *
 * TODO (next step): Read _liveJointValues here and apply transforms directly
 * to body meshes via useComponentStore.getState().bodies — imperative mesh
 * mutation entirely bypasses React's render cycle. This requires the Joint
 * type to carry enough info to resolve which body mesh to rotate and around
 * which axis/origin. Currently the body-mesh transform side is not wired up,
 * so this component only drives the animation clock.
 */
export default function JointAnimationPlayer() {
  const animationPlaying = useComponentStore((s) => s.animationPlaying);
  const tickAnimation = useComponentStore((s) => s.tickAnimation);

  useFrame((_, delta) => {
    if (!animationPlaying) return;
    tickAnimation(delta);
    // _liveJointValues is now populated by tickAnimation above.
    // Direct mesh mutation (bypassing React) would go here once the
    // body-transform logic is implemented.
    // Example skeleton (not yet active):
    //   const { joints, bodies } = useComponentStore.getState();
    //   for (const [jointId, vals] of Object.entries(_liveJointValues)) {
    //     const joint = joints[jointId];
    //     if (!joint?.axis) continue;
    //     const body = Object.values(bodies).find(b => b.componentId === joint.componentId2);
    //     if (body?.mesh) {
    //       const angle = vals.rotationValue;
    //       body.mesh.setRotationFromAxisAngle(joint.axis, angle);
    //     }
    //   }
  });

  // Suppress unused-import warning for _liveJointValues (used in useFrame above
  // as a reference for the TODO skeleton and will be used when mesh transforms
  // are wired up).
  void _liveJointValues;

  return null;
}
