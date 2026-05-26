import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createFeatureGroupActions({ set }: CADSliceContext): Partial<CADState> {
  return {
  featureGroups: [],
  createFeatureGroup: (name, featureIds) => {
    const groupId = crypto.randomUUID();
    set((state) => ({
      featureGroups: [...state.featureGroups, { id: groupId, name, collapsed: false }],
      features: state.features.map((f) =>
        featureIds.includes(f.id) ? { ...f, groupId } : f,
      ),
      statusMessage: `Group "${name}" created`,
    }));
  },
  renameFeatureGroup: (groupId, name) => set((state) => ({
    featureGroups: state.featureGroups.map((g) => g.id === groupId ? { ...g, name } : g),
    statusMessage: `Group renamed to "${name}"`,
  })),
  deleteFeatureGroup: (groupId) => set((state) => ({
    featureGroups: state.featureGroups.filter((g) => g.id !== groupId),
    features: state.features.map((f) => f.groupId === groupId ? { ...f, groupId: undefined } : f),
    statusMessage: 'Group deleted',
  })),
  moveFeatureToGroup: (featureId, groupId) => set((state) => ({
    features: state.features.map((f) =>
      f.id === featureId ? { ...f, groupId: groupId ?? undefined } : f,
    ),
  })),

  toggleFeatureGroup: (groupId) => set((state) => ({
    featureGroups: state.featureGroups.map((g) =>
      g.id === groupId ? { ...g, collapsed: !g.collapsed } : g,
    ),
  })),
  // CORR-17: nest a group inside another
  nestGroupInGroup: (childGroupId, parentGroupId) => set((state) => ({
    featureGroups: state.featureGroups.map((g) =>
      g.id === childGroupId ? { ...g, parentGroupId: parentGroupId ?? undefined } : g,
    ),
  })),
  };
}