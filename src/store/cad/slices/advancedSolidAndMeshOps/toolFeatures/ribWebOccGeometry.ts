import * as THREE from 'three';
import type { BRepBody } from '../../../../../engine/occ/brepBody';
import { globalBRepBodyRegistry } from '../../../../../engine/occ/globalRegistry';
import { createOccPlaneFrame } from '../../../../../engine/occ/plane';
import { performOccBooleanWithInstance } from '../../../../../engine/occ/ops/booleanCore';
import { occExtrudeWithInstance } from '../../../../../engine/occ/ops/extrude';
import type { SketchProfile } from '../../../../../engine/occ/ops/sketchToWire';
import type { OcctRaw } from '../../../../../engine/occ/types';

export function buildOccRibBody(
  oc: OcctRaw,
  pts: THREE.Vector3[],
  thickness: number,
  height: number,
  sketchNormal: THREE.Vector3,
  featureId: string,
): BRepBody | null {
  const hw = thickness / 2;
  const profile: SketchProfile = {
    outer: [
      new THREE.Vector2(-hw, 0),
      new THREE.Vector2(hw, 0),
      new THREE.Vector2(hw, height),
      new THREE.Vector2(-hw, height),
    ],
    holes: [],
  };

  let combinedBody: BRepBody | null = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const rawDir = p1.clone().sub(p0);
    const segLen = rawDir.length();
    if (segLen < 1e-6) continue;

    const segDir = rawDir.normalize();
    const rawSide = new THREE.Vector3().crossVectors(segDir, sketchNormal);
    if (rawSide.length() < 1e-9) continue;

    const sideDir = rawSide.normalize();
    const frame = createOccPlaneFrame(p0, segDir, sideDir);
    frame.vDir.copy(sketchNormal).normalize();

    const segBody = occExtrudeWithInstance(oc, profile, segLen, frame, {
      id: combinedBody ? undefined : featureId,
      sourceFeatureId: featureId,
    });

    if (!combinedBody) {
      combinedBody = segBody;
      continue;
    }

    const merged = performOccBooleanWithInstance(oc, 'union', combinedBody, segBody, {
      id: featureId,
      sourceFeatureId: featureId,
    });
    if (merged) {
      combinedBody = merged;
    } else {
      globalBRepBodyRegistry.delete(segBody.id);
    }
  }

  return combinedBody;
}
