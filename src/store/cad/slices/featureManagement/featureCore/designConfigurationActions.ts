import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { recomputeBooleanDependents } from '../featureBooleanUtils';
import {
  applyDesignConfiguration,
  BASE_CONFIGURATION_ID,
  captureConfigurationFromFeatures,
} from '../configurationHelpers';

export function createDesignConfigurationActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  designConfigurations: [{
    id: BASE_CONFIGURATION_ID,
    name: 'Default',
    featureSuppression: {},
    parametricParameters: {},
    updatedAt: Date.now(),
  }],
  activeDesignConfigurationId: BASE_CONFIGURATION_ID,

  createDesignConfiguration: (name) => {
    const { features, designConfigurations } = get();
    const label = name?.trim() || `Configuration ${designConfigurations.length + 1}`;
    const id = crypto.randomUUID();
    const configuration = captureConfigurationFromFeatures(
      features,
      { id, name: label, featureSuppression: {}, parametricParameters: {}, updatedAt: Date.now() },
      label,
    );
    set((state) => ({
      designConfigurations: [...state.designConfigurations, configuration],
      activeDesignConfigurationId: id,
      statusMessage: `Created configuration "${label}"`,
    }));
  },
  switchDesignConfiguration: (id) => {
    const { designConfigurations, features } = get();
    const configuration = designConfigurations.find((candidate) => candidate.id === id);
    if (!configuration) return;
    get().pushUndo();
    const applied = applyDesignConfiguration(features, configuration);
    const rebuiltIds = applied.filter((f, i) => f.mesh !== features[i]?.mesh).map((f) => f.id);
    const resolved = rebuiltIds.length > 0 ? recomputeBooleanDependents(applied, rebuiltIds) : applied;
    set({
      features: resolved,
      activeDesignConfigurationId: id,
      statusMessage: `Switched to ${configuration.name}`,
    });
  },
  renameDesignConfiguration: (id, name) => {
    const label = name.trim();
    if (!label) return;
    set((state) => ({
      designConfigurations: state.designConfigurations.map((configuration) =>
        configuration.id === id ? { ...configuration, name: label, updatedAt: Date.now() } : configuration,
      ),
      statusMessage: `Renamed configuration to "${label}"`,
    }));
  },
  removeDesignConfiguration: (id) => {
    if (id === BASE_CONFIGURATION_ID) return;
    set((state) => {
      const nextConfigurations = state.designConfigurations.filter((configuration) => configuration.id !== id);
      const activeId = state.activeDesignConfigurationId === id ? BASE_CONFIGURATION_ID : state.activeDesignConfigurationId;
      const activeConfiguration = nextConfigurations.find((configuration) => configuration.id === activeId);
      return {
        designConfigurations: nextConfigurations,
        activeDesignConfigurationId: activeId,
        features: activeConfiguration ? applyDesignConfiguration(state.features, activeConfiguration) : state.features,
        statusMessage: 'Configuration removed',
      };
    });
  },
  captureDesignConfiguration: (id) => {
    const { features, activeDesignConfigurationId } = get();
    const targetId = id ?? activeDesignConfigurationId;
    set((state) => ({
      designConfigurations: state.designConfigurations.map((configuration) =>
        configuration.id === targetId ? captureConfigurationFromFeatures(features, configuration) : configuration,
      ),
      statusMessage: 'Configuration captured',
    }));
  },
  exportDesignConfigurations: () => {
    const { designConfigurations, features } = get();
    const payload = {
      exportedAt: new Date().toISOString(),
      configurations: designConfigurations,
      variants: designConfigurations.map((configuration) => ({
        id: configuration.id,
        name: configuration.name,
        visibleFeatureIds: features
          .filter((feature) => !(configuration.featureSuppression[feature.id] ?? feature.suppressed))
          .map((feature) => feature.id),
      })),
    };
    if (typeof document === 'undefined') {
      set({ statusMessage: 'Configuration export prepared' });
      return;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'design-configurations.json';
    link.click();
    URL.revokeObjectURL(url);
    set({ statusMessage: `Exported ${designConfigurations.length} configuration(s)` });
  },
  };
}