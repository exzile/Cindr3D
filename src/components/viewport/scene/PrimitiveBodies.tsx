import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { BODY_MATERIAL } from './bodyMaterial';

/** Primitive solid bodies — Box / Cylinder / Sphere / Torus */
export default function PrimitiveBodies() {
  const features = useCADStore((s) => s.features);
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);
  const bodies = useMemo(() => {
    const out: { id: string; geom: THREE.BufferGeometry }[] = [];
    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      // D187 suppress + D190 rollback + visibility
      if (f.type !== 'primitive' || !f.visible || f.suppressed) continue;
      if (rollbackIndex >= 0 && i > rollbackIndex) continue;
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
      if (geom) out.push({ id: f.id, geom });
    }
    return out;
  }, [features, rollbackIndex]);

  useEffect(() => {
    return () => { for (const b of bodies) b.geom.dispose(); };
  }, [bodies]);

  return (
    <>
      {bodies.map((b) => (
        <mesh
          key={b.id}
          geometry={b.geom}
          material={BODY_MATERIAL}
          castShadow
          receiveShadow
          onUpdate={(m) => { m.userData.pickable = true; m.userData.featureId = b.id; }}
        />
      ))}
    </>
  );
}
