/**
 * DecalProjections — renders committed Decal features (D192).
 *
 * Each `type:'decal'` feature stores { targetFeatureId, point, normal,
 * imageUrl, scaleU, scaleV, rotation, opacity } in feature.params (NO
 * feature.mesh — ExtrudedBodies' material-override effect would clobber the
 * textured material). For each decal we resolve the target body mesh from
 * the live scene (by userData.featureId), build a THREE.DecalGeometry that
 * projects the image onto that face, and render it via <primitive>.
 *
 * One <DecalProjection> child owns one decal's geometry + texture + material
 * and disposes them on unmount / param change. Texture load is async; the
 * decal appears when the image resolves (no setState-in-render).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { useCADStore } from '../../../store/cadStore';
import {
  buildDecalGeometry,
  loadDecalTexture,
  makeDecalMaterial,
  type DecalPlacement,
} from '../../../utils/decalProjection';
import type { Feature } from '../../../types/cad';

interface DecalSpec {
  featureId: string;
  targetFeatureId: string;
  imageUrl: string;
  placement: DecalPlacement;
  opacity: number;
}

function readSpec(f: Feature): DecalSpec | null {
  const p = f.params as Record<string, unknown>;
  const targetFeatureId = typeof p.targetFeatureId === 'string'
    ? p.targetFeatureId
    : typeof p.faceId === 'string' ? p.faceId : '';
  const imageUrl = typeof p.imageUrl === 'string' ? p.imageUrl : '';
  const point = p.point as [number, number, number] | undefined;
  const normal = p.normal as [number, number, number] | undefined;
  if (!targetFeatureId || !imageUrl || !point || !normal) return null;
  const scaleU = typeof p.scaleU === 'number' && p.scaleU > 0 ? p.scaleU : 10;
  const scaleV = typeof p.scaleV === 'number' && p.scaleV > 0 ? p.scaleV : 10;
  const rotation = typeof p.rotation === 'number' ? p.rotation : 0;
  const opacity = typeof p.opacity === 'number' ? p.opacity : 1;
  return {
    featureId: f.id,
    targetFeatureId,
    imageUrl,
    opacity,
    placement: {
      point,
      normal,
      // Dialog scaleU/scaleV act as the decal footprint size in mm.
      width: scaleU,
      height: scaleV,
      rotationDeg: rotation,
    },
  };
}

/** Find the body mesh whose userData.featureId matches, preferring the
 *  highest-vertex-count mesh (the final merged body after CSG, mirroring the
 *  face-picker's disambiguation). Returns null until the body mounts. */
function resolveTargetMesh(scene: THREE.Object3D, featureId: string): THREE.Mesh | null {
  let best: THREE.Mesh | null = null;
  let bestVerts = -1;
  scene.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.userData?.featureId !== featureId) return;
    const verts = m.geometry?.getAttribute('position')?.count ?? 0;
    if (verts > bestVerts) { bestVerts = verts; best = m; }
  });
  return best;
}

function DecalProjection({ spec }: { spec: DecalSpec }) {
  const { scene } = useThree();
  const invalidate = useThree((s) => s.invalidate);
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);

  // Async texture load — own the texture, dispose on cleanup / src change.
  const texRef = useRef<THREE.Texture | null>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTexture(null);
    loadDecalTexture(spec.imageUrl)
      .then((tex) => {
        if (cancelled) { tex.dispose(); return; }
        texRef.current = tex;
        setTexture(tex);
        invalidate();
      })
      .catch(() => { /* unresolved image → decal simply doesn't render */ });
    return () => {
      cancelled = true;
      texRef.current?.dispose();
      texRef.current = null;
    };
  }, [spec.imageUrl, invalidate]);

  // Resolve the target body mesh from the scene. It may mount after this
  // component, so poll on the frame loop until found. Under
  // frameloop="demand" we must keep pumping frames while still searching;
  // once resolved we stop invalidating so the loop goes idle again.
  const targetRef = useRef<THREE.Mesh | null>(null);
  const pollAttemptsRef = useRef(0);
  const [targetReady, setTargetReady] = useState(false);
  useFrame(() => {
    if (targetRef.current) return;
    const t = resolveTargetMesh(scene, spec.targetFeatureId);
    if (t) {
      targetRef.current = t;
      setTargetReady(true);
      return;
    }
    // Bounded: if the host body never mounts (deleted/rebuilt), stop pumping
    // the demand loop after ~300 frames so we don't pin the renderer.
    if (pollAttemptsRef.current++ < 300) invalidate();
  });

  // Build the decal mesh once the target + texture are both ready.
  const placementKey = useMemo(
    () => `${spec.placement.point.join(',')}|${spec.placement.normal.join(',')}|${spec.placement.width}|${spec.placement.height}|${spec.placement.rotationDeg}`,
    [spec.placement],
  );
  useEffect(() => {
    if (!targetReady || !texture || !targetRef.current) { setMesh(null); return; }
    const geom = buildDecalGeometry(targetRef.current, spec.placement);
    if (!geom) { setMesh(null); return; }
    const mat = makeDecalMaterial(texture, spec.opacity);
    const m = new THREE.Mesh(geom, mat);
    m.renderOrder = 50;
    m.userData.pickable = false; // decals are not edge/face pickable
    m.userData.isDecal = true;
    m.frustumCulled = false;
    setMesh(m);
    invalidate();
    return () => {
      geom.dispose();
      mat.dispose();
    };
  // placementKey captures the structural placement; texture/opacity rebuild too.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetReady, texture, placementKey, spec.opacity, invalidate]);

  if (!mesh) return null;
  return <primitive object={mesh} />;
}

export default function DecalProjections() {
  const features = useCADStore((s) => s.features);
  const decals = useMemo(
    () =>
      features
        .filter((f) => f.type === 'decal' && f.visible && !f.suppressed)
        .map(readSpec)
        .filter((s): s is DecalSpec => s !== null),
    [features],
  );

  return (
    <>
      {decals.map((spec) => (
        <DecalProjection key={spec.featureId} spec={spec} />
      ))}
    </>
  );
}
