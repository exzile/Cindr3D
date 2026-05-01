import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import { BODY_MATERIAL, DIM_MATERIAL } from './bodyMaterial';
import { isComponentVisible } from './componentVisibility';

/** Primitive solid bodies — Box / Cylinder / Sphere / Torus */
export default function PrimitiveBodies() {
  const features = useCADStore((s) => s.features);
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const rootComponentId = useComponentStore((s) => s.rootComponentId);
  const components = useComponentStore((s) => s.components);

  const editingInPlace = !!activeComponentId && activeComponentId !== rootComponentId;

  const bodies = useMemo(() => {
    const out: { id: string; geom: THREE.BufferGeometry; componentId?: string }[] = [];
    for (const f of features) {
      if (f.type !== 'primitive') continue;
      // D187 suppress + D190 rollback + visibility
      if (!f.visible || f.suppressed) continue;
      if (!isComponentVisible(components, f.componentId)) continue;
      if (rollbackIndex >= 0) {
        const idx = features.indexOf(f);
        if (idx > rollbackIndex) continue;
      }
      const kind = f.params.kind as 'box' | 'cylinder' | 'sphere' | 'torus';
      let geom: THREE.BufferGeometry | null = null;
      if (kind === 'box') {
        geom = new THREE.BoxGeometry(
          (f.params.width as number) || 20,
          (f.params.height as number) || 20,
          (f.params.depth as number) || 20,
        );
      } else if (kind === 'cylinder') {
        geom = new THREE.CylinderGeometry(
          (f.params.radius as number) || 10,
          (f.params.radius as number) || 10,
          (f.params.height as number) || 20,
          48,
        );
      } else if (kind === 'sphere') {
        geom = new THREE.SphereGeometry((f.params.radius as number) || 10, 48, 32);
      } else if (kind === 'torus') {
        geom = new THREE.TorusGeometry(
          (f.params.radius as number) || 15,
          (f.params.tubeRadius as number) || 3,
          24,
          48,
        );
      }
      if (geom) out.push({ id: f.id, geom, componentId: f.componentId });
    }
    return out;
  }, [features, rollbackIndex, components]);

  useEffect(() => {
    return () => { for (const b of bodies) b.geom.dispose(); };
  }, [bodies]);

  return (
    <>
      {bodies.map((b) => {
        const dim = editingInPlace && b.componentId !== activeComponentId;
        return (
          <mesh
            key={b.id}
            geometry={b.geom}
            material={dim ? DIM_MATERIAL : BODY_MATERIAL}
            castShadow
            receiveShadow
            onUpdate={(m) => { m.userData.pickable = true; m.userData.featureId = b.id; }}
          />
        );
      })}
    </>
  );
}
