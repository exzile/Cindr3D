import type { Sketch } from '../../../../types/cad';
import { useComponentStore } from '../../../componentStore';

export function upsertSketch(sketches: Sketch[], sketch: Sketch): Sketch[] {
  const index = sketches.findIndex((candidate) => candidate.id === sketch.id);
  if (index < 0) return [...sketches, sketch];

  const next = [...sketches];
  next[index] = sketch;
  return next;
}

export function getActiveComponentId(): string | undefined {
  const componentStore = useComponentStore.getState();
  const id = componentStore.activeComponentId ?? componentStore.rootComponentId;
  if (id && componentStore.components[id]) return id;
  return componentStore.rootComponentId;
}

export function registerSketchWithComponent(sketch: Sketch) {
  const componentId = sketch.componentId;
  if (!componentId) return;
  useComponentStore.setState((state) => {
    const component = state.components[componentId];
    if (!component || component.sketchIds.includes(sketch.id)) return state;
    return {
      components: {
        ...state.components,
        [componentId]: {
          ...component,
          sketchIds: [...component.sketchIds, sketch.id],
        },
      },
    };
  });
}

export function readWorkspaceMode(): 'design' | 'prepare' | 'printer' {
  try {
    return (localStorage.getItem('cindr3d-workspace-mode') as 'design' | 'prepare' | 'printer') ?? 'design';
  } catch {
    return 'design';
  }
}

export function writeWorkspaceMode(mode: 'design' | 'prepare' | 'printer') {
  try {
    localStorage.setItem('cindr3d-workspace-mode', mode);
  } catch {
    // Some test and embedded browser contexts disable localStorage.
  }
}
