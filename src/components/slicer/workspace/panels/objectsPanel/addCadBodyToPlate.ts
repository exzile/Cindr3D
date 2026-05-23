import * as THREE from "three";
import { useComponentStore } from "../../../../../store/componentStore";
import {
  bodyGeometryCache,
  bodyIdGeometryCache,
  liveBodyMeshes,
} from "../../../../../store/meshRegistry";
import type { Feature } from "../../../../../types/cad";

export function resolveCadBodyGeometry(
  bodyId: string,
  features: Feature[],
): THREE.BufferGeometry | null {
  let geo: THREE.BufferGeometry | null =
    bodyIdGeometryCache.get(bodyId) ?? null;

  if (!geo) {
    const body = useComponentStore.getState().bodies[bodyId];
    if (body) {
      for (const fid of body.featureIds) {
        const cached = bodyGeometryCache.get(fid);
        if (cached) {
          geo = cached;
          break;
        }
      }
    }
  }

  if (!geo) {
    for (const [, m] of liveBodyMeshes) {
      if (m.userData?.bodyId === bodyId && m.geometry) {
        geo = m.geometry;
        break;
      }
    }
  }

  if (!geo) {
    const body = useComponentStore.getState().bodies[bodyId];
    if (body) {
      for (const fid of body.featureIds) {
        const f = features.find((feat) => feat.id === fid);
        const fm = f?.mesh as THREE.Mesh | undefined;
        if (fm?.isMesh && fm.geometry) {
          geo = fm.geometry;
          break;
        }
      }
    }
  }

  return geo;
}
