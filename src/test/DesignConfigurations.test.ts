import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Feature } from '../types/cad';

const defaultConfiguration = {
  id: 'default',
  name: 'Default',
  featureSuppression: {},
  parametricParameters: {},
  updatedAt: 0,
};

function makeParametricFeature(id: string, width: number): Feature {
  return {
    id,
    name: id,
    type: 'primitive',
    params: {
      kind: 'parametric',
      parametricModelId: 'project-box',
      parametricModelName: 'Project Box',
      parametricParameters: { width, depth: 50, height: 28 },
    } as Feature['params'],
    mesh: new THREE.Mesh(new THREE.BoxGeometry(width, 28, 50), new THREE.MeshBasicMaterial()),
    visible: true,
    suppressed: false,
    timestamp: Date.now(),
    bodyKind: 'solid',
  };
}

describe('design configurations', () => {
  beforeEach(async () => {
    const { useCADStore } = await import('../store/cadStore');
    useCADStore.setState({
      features: [],
      designConfigurations: [defaultConfiguration],
      activeDesignConfigurationId: 'default',
      statusMessage: undefined,
    });
  });

  it('captures and restores per-configuration suppression and parametric parameters', async () => {
    const { useCADStore } = await import('../store/cadStore');
    const feature = makeParametricFeature('box-a', 80);

    useCADStore.getState().addFeature(feature);
    useCADStore.getState().createDesignConfiguration('Small');
    useCADStore.setState((state) => ({
      features: state.features.map((candidate) =>
        candidate.id === 'box-a'
          ? {
              ...candidate,
              suppressed: true,
              params: {
                ...candidate.params,
                parametricParameters: { width: 40, depth: 50, height: 28 },
              } as Feature['params'],
            }
          : candidate,
      ),
    }));
    useCADStore.getState().captureDesignConfiguration();
    useCADStore.getState().switchDesignConfiguration('default');

    expect(useCADStore.getState().features[0].suppressed).toBe(false);
    expect(useCADStore.getState().features[0].params.parametricParameters).toMatchObject({ width: 80 });

    const smallId = useCADStore.getState().designConfigurations.find((configuration) => configuration.name === 'Small')?.id;
    expect(smallId).toBeTruthy();
    useCADStore.getState().switchDesignConfiguration(smallId!);

    expect(useCADStore.getState().features[0].suppressed).toBe(true);
    expect(useCADStore.getState().features[0].params.parametricParameters).toMatchObject({ width: 40 });
  });
});
