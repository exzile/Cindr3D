import * as THREE from 'three';
import { BOUNDING_SOLID_MATERIAL } from '../../../../../components/viewport/scene/bodyMaterial';
import type { Feature } from '../../../../../types/cad';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createBoundingSolidActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    openBoundingSolidDialog: () => set({ activeDialog: 'bounding-solid' }),
    closeBoundingSolidDialog: () => set({ activeDialog: null }),
    commitBoundingSolid: (params) => {
      const { features, setActiveDialog } = get();
      const { shape, padding } = params;
      const n = features.filter((f) => f.type === 'bounding-solid').length + 1;

      const box = new THREE.Box3();
      let hasGeometry = false;
      for (const f of features) {
        if (!f.mesh || !f.visible) continue;
        const b = new THREE.Box3().setFromObject(f.mesh);
        if (!b.isEmpty()) {
          box.union(b);
          hasGeometry = true;
        }
      }

      let geom: THREE.BufferGeometry;
      if (!hasGeometry) {
        geom = new THREE.BoxGeometry(1, 1, 1);
      } else {
        box.expandByScalar(padding);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        if (shape === 'box') {
          geom = new THREE.BoxGeometry(size.x, size.y, size.z);
        } else {
          const sphere = new THREE.Sphere();
          box.getBoundingSphere(sphere);
          const r = sphere.radius;
          geom = new THREE.CylinderGeometry(r, r, size.y + padding * 2, 32);
        }

        const mesh = new THREE.Mesh(geom, BOUNDING_SOLID_MATERIAL);
        const center2 = new THREE.Vector3();
        box.getCenter(center2);
        mesh.position.copy(center2);

        const feature: Feature = {
          id: crypto.randomUUID(),
          name: `Bounding Solid ${n}`,
          type: 'bounding-solid',
          params: { shape, padding },
          mesh,
          visible: true,
          suppressed: false,
          timestamp: Date.now(),
        };
        get().addFeature(feature);
        setActiveDialog(null);
        return;
      }

      const mesh = new THREE.Mesh(geom, BOUNDING_SOLID_MATERIAL);
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Bounding Solid ${n}`,
        type: 'bounding-solid',
        params: { shape, padding },
        mesh,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      get().addFeature(feature);
      setActiveDialog(null);
    },
  };
}
