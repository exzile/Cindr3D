import { useEffect } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';

export default function ImportedModels() {
  const features = useCADStore((s) => s.features);

  // Tag imported meshes as pickable so the SketchPlaneSelector can hit-test them
  useEffect(() => {
    features.filter(f => f.type === 'import' && f.mesh).forEach((f) => {
      const mesh = f.mesh!;
      mesh.userData.pickable = true;
      mesh.userData.featureId = f.id;
      mesh.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          obj.userData.pickable = true;
          obj.userData.featureId = f.id;
        }
      });
    });
  }, [features]);

  return (
    <>
      {features.filter(f => f.type === 'import' && f.visible && f.mesh).map((feature) => (
        <primitive key={feature.id} object={feature.mesh!} />
      ))}
    </>
  );
}
