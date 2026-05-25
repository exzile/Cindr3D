import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useComponentStore, _liveJointValues } from '../../../store/componentStore';

/**
 * A19 — Drive Joints animation player.
 * Runs inside the R3F Canvas; uses useFrame to advance animation each tick.
 * Returns null — no rendered geometry.
 *
 * Performance: tickAnimation writes joint values to the module-level
 * _liveJointValues map instead of calling Zustand set({ joints }). This
 * prevents 60Hz React re-renders across all joint subscribers during playback.
 * Body mesh transforms are then applied imperatively here, also bypassing React.
 */

// Module-level temporaries — never allocate inside useFrame.
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export default function JointAnimationPlayer() {
  const animationPlaying = useComponentStore((s) => s.animationPlaying);
  const tickAnimation = useComponentStore((s) => s.tickAnimation);

  // Snapshot of each body mesh's original position + quaternion, captured when
  // animation starts. Used as the stable base for each frame's incremental
  // transform so rotations don't accumulate across ticks.
  const baseTransforms = useRef<
    Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>
  >(new Map());

  // Capture base transforms when animation starts; restore meshes when it stops.
  useEffect(() => {
    const { bodies } = useComponentStore.getState();
    if (animationPlaying) {
      baseTransforms.current.clear();
      for (const body of Object.values(bodies)) {
        if (!body.mesh) continue;
        baseTransforms.current.set(body.id, {
          position: body.mesh.position.clone(),
          quaternion: body.mesh.quaternion.clone(),
        });
      }
    } else {
      // Reset all driven meshes back to their pre-animation transforms.
      for (const [bodyId, orig] of baseTransforms.current) {
        const body = bodies[bodyId];
        if (!body?.mesh) continue;
        body.mesh.position.copy(orig.position);
        body.mesh.quaternion.copy(orig.quaternion);
      }
      baseTransforms.current.clear();
    }
  }, [animationPlaying]);

  useFrame(({ invalidate }, delta) => {
    if (!animationPlaying) return;
    tickAnimation(delta);
    invalidate();

    // Apply joint-driven transforms imperatively — bypasses React render cycle.
    const { joints, bodies } = useComponentStore.getState();

    for (const [jointId, vals] of Object.entries(_liveJointValues)) {
      const joint = joints[jointId];
      // Revolute / cylindrical / pin-slot: need a rotation axis.
      if (!joint?.axis) continue;

      const axis = _v.copy(joint.axis).normalize();
      const origin = joint.origin;
      const angle = vals.rotationValue;

      _q.setFromAxisAngle(axis, angle);

      // Apply to every body belonging to the driven component (componentId2).
      for (const body of Object.values(bodies)) {
        if (body.componentId !== joint.componentId2 || !body.mesh) continue;

        const orig = baseTransforms.current.get(body.id);
        if (!orig) continue;

        // Rotate original position around the joint origin:
        //   newPos = origin + rotate(origPos - origin, q)
        body.mesh.position
          .copy(orig.position)
          .sub(origin)
          .applyQuaternion(_q)
          .add(origin);

        // Compose new orientation: q * originalQuaternion.
        body.mesh.quaternion.copy(_q).premultiply(orig.quaternion);
      }
    }
  });

  return null;
}
