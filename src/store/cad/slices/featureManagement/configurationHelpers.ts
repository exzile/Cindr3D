import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { PARAMETRIC_MODELS } from '../../../../parametric';
import type { ParametricParameterValue } from '../../../../parametric';
import type { DesignConfiguration } from '../../state/coreState';

export const BASE_CONFIGURATION_ID = 'default';

export function captureConfigurationFromFeatures(
  features: Feature[],
  existing?: DesignConfiguration,
  name = 'Default',
): DesignConfiguration {
  const featureSuppression: DesignConfiguration['featureSuppression'] = {};
  const parametricParameters: DesignConfiguration['parametricParameters'] = {};

  for (const feature of features) {
    featureSuppression[feature.id] = !!feature.suppressed;
    if (feature.params?.kind === 'parametric' && feature.params.parametricParameters) {
      parametricParameters[feature.id] = {
        ...(feature.params.parametricParameters as Record<string, ParametricParameterValue>),
      };
    }
  }

  return {
    id: existing?.id ?? BASE_CONFIGURATION_ID,
    name: existing?.name ?? name,
    featureSuppression,
    parametricParameters,
    updatedAt: Date.now(),
  };
}

function rebuildParametricMesh(feature: Feature, params: Record<string, ParametricParameterValue>): Feature {
  const modelId = typeof feature.params?.parametricModelId === 'string' ? feature.params.parametricModelId : '';
  const model = PARAMETRIC_MODELS.find((candidate) => candidate.id === modelId);
  if (!model) {
    return {
      ...feature,
      params: { ...feature.params, parametricParameters: params },
    };
  }

  const oldMesh = feature.mesh;
  let mesh: THREE.Mesh | undefined;
  try {
    mesh = model.build(params);
  } catch {
    return { ...feature, params: { ...feature.params, parametricParameters: params } };
  }
  if (oldMesh instanceof THREE.Mesh) {
    const oldGeometry = oldMesh.geometry;
    const oldMaterial = oldMesh.material;
    setTimeout(() => {
      oldGeometry?.dispose();
      const materials = Array.isArray(oldMaterial) ? oldMaterial : [oldMaterial];
      for (const material of materials) {
        if (!material?.userData?.shared) material?.dispose?.();
      }
    }, 0);
  }
  return {
    ...feature,
    params: { ...feature.params, parametricParameters: params },
    mesh,
  };
}

export function applyDesignConfiguration(features: Feature[], configuration: DesignConfiguration): Feature[] {
  return features.map((feature) => {
    const parametricParams = configuration.parametricParameters[feature.id];
    const nextFeature = {
      ...feature,
      suppressed: configuration.featureSuppression[feature.id] ?? !!feature.suppressed,
    };
    return parametricParams ? rebuildParametricMesh(nextFeature, parametricParams) : nextFeature;
  });
}
