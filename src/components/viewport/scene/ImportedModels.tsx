import { useEffect } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import { DIM_MATERIAL } from './bodyMaterial';
import { isComponentVisible } from './componentVisibility';

export default function ImportedModels() {
  const features = useCADStore((s) => s.features);
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const rootComponentId = useComponentStore((s) => s.rootComponentId);
  const components = useComponentStore((s) => s.components);

  const editingInPlace = !!activeComponentId && activeComponentId !== rootComponentId;

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

  // Apply / restore dim material in an effect — never in render to avoid side effects
  // and ensure cleanup when Edit In Place mode exits.
  useEffect(() => {
    const visible = features.filter(f => (
      f.type === 'import'
      && f.mesh
      && f.visible
      && !f.suppressed
      && isComponentVisible(components, f.componentId)
    ));
    visible.forEach((feature) => {
      const dim = editingInPlace && feature.componentId !== activeComponentId;
      feature.mesh!.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (!m.isMesh) return;
        if (dim) {
          // Stash original material the first time we dim this mesh
          if (!m.userData._origMaterial) m.userData._origMaterial = m.material;
          m.material = DIM_MATERIAL;
        } else {
          // Restore original if we stashed one
          if (m.userData._origMaterial) {
            m.material = m.userData._origMaterial as THREE.Material;
            m.userData._origMaterial = undefined;
          }
        }
      });
    });
  }, [features, editingInPlace, activeComponentId, components]);

  return (
    <>
      {features.filter((f, i) => {
        // D187 suppress + D190 rollback + visibility
        if (f.type !== 'import' || !f.visible || f.suppressed || !f.mesh) return false;
        if (!isComponentVisible(components, f.componentId)) return false;
        if (rollbackIndex >= 0 && i > rollbackIndex) return false;
        return true;
      }).map((feature) => (
        <primitive key={feature.id} object={feature.mesh!} />
      ))}
    </>
  );
}
