import * as THREE from "three";
import type { MutableRefObject } from "react";

export interface PreviewSceneRefs {
  previewMeshRef: MutableRefObject<THREE.Mesh | null>;
  hiddenMeshRef: MutableRefObject<THREE.Mesh | null>;
  pickProxyRef: MutableRefObject<THREE.Mesh | null>;
  srcGeoCacheRef: MutableRefObject<{
    meshUuid: string;
    geo: THREE.BufferGeometry;
  } | null>;
}

export function restorePreviewScene(
  scene: THREE.Scene,
  refs: PreviewSceneRefs,
  options?: { disposeSourceCache?: boolean },
) {
  const { hiddenMeshRef, pickProxyRef, previewMeshRef, srcGeoCacheRef } = refs;
  if (hiddenMeshRef.current) {
    hiddenMeshRef.current.visible = true;
    hiddenMeshRef.current = null;
  }
  if (pickProxyRef.current) {
    scene.remove(pickProxyRef.current);
    (pickProxyRef.current.material as THREE.Material).dispose();
    pickProxyRef.current = null;
  }
  if (previewMeshRef.current) {
    scene.remove(previewMeshRef.current);
    previewMeshRef.current.geometry.dispose();
    previewMeshRef.current = null;
  }
  if (options?.disposeSourceCache) {
    srcGeoCacheRef.current?.geo.dispose();
    srcGeoCacheRef.current = null;
  }
}

export function ensureSourceGeometry(
  meshUuid: string,
  liveMesh: THREE.Mesh,
  srcGeoCacheRef: PreviewSceneRefs["srcGeoCacheRef"],
) {
  if (srcGeoCacheRef.current?.meshUuid !== meshUuid) {
    srcGeoCacheRef.current?.geo.dispose();
    const geo = liveMesh.geometry.index
      ? liveMesh.geometry.clone().toNonIndexed()
      : liveMesh.geometry.clone();
    srcGeoCacheRef.current = { meshUuid, geo };
  }
  return srcGeoCacheRef.current.geo;
}

export function showPreviewGeometry(
  scene: THREE.Scene,
  refs: PreviewSceneRefs,
  liveMesh: THREE.Mesh,
  geometry: THREE.BufferGeometry,
) {
  const { hiddenMeshRef, pickProxyRef, previewMeshRef } = refs;
  const oldPreviewGeo = previewMeshRef.current?.geometry ?? null;

  if (hiddenMeshRef.current && hiddenMeshRef.current !== liveMesh) {
    hiddenMeshRef.current.visible = true;
    hiddenMeshRef.current = null;
    if (pickProxyRef.current) {
      scene.remove(pickProxyRef.current);
      (pickProxyRef.current.material as THREE.Material).dispose();
      pickProxyRef.current = null;
    }
  }

  if (!hiddenMeshRef.current) {
    liveMesh.visible = false;
    hiddenMeshRef.current = liveMesh;
  }

  if (!pickProxyRef.current) {
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    const proxy = new THREE.Mesh(liveMesh.geometry, proxyMat);
    proxy.uuid = liveMesh.uuid;
    proxy.userData.pickable = liveMesh.userData.pickable;
    proxy.userData.featureId = liveMesh.userData.featureId;
    proxy.renderOrder = -1;
    scene.add(proxy);
    pickProxyRef.current = proxy;
  }

  if (
    previewMeshRef.current &&
    previewMeshRef.current.material === liveMesh.material
  ) {
    previewMeshRef.current.geometry = geometry;
  } else {
    if (previewMeshRef.current) scene.remove(previewMeshRef.current);
    const previewMesh = new THREE.Mesh(geometry, liveMesh.material);
    previewMesh.castShadow = true;
    previewMesh.receiveShadow = true;
    scene.add(previewMesh);
    previewMeshRef.current = previewMesh;
  }

  if (oldPreviewGeo && oldPreviewGeo !== geometry) oldPreviewGeo.dispose();
}

export function geometryFromWorkerResult(
  positions: ArrayBuffer,
  normals?: ArrayBuffer,
) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(positions), 3),
  );
  if (normals) {
    geo.setAttribute(
      "normal",
      new THREE.BufferAttribute(new Float32Array(normals), 3),
    );
  } else {
    geo.computeVertexNormals();
  }
  return geo;
}
