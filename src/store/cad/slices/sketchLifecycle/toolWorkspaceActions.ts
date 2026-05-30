import { EXTRUDE_DEFAULTS, REVOLVE_DEFAULTS } from '../../defaults';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { readWorkspaceMode, writeWorkspaceMode } from './helpers';

export function createToolWorkspaceActions({ set }: CADSliceContext): Partial<CADState> {
  return {
    activeTool: 'select',
    setActiveTool: (tool) => set({
      activeTool: tool,
      measurePoints: [],
      ...(tool !== 'extrude' ? EXTRUDE_DEFAULTS : {}),
      ...(tool !== 'revolve' ? REVOLVE_DEFAULTS : {}),
      ...(tool !== 'select' ? { selectionMode: 'normal' as const } : {}),
    }),

    viewMode: '3d',
    setViewMode: (mode) => set({ viewMode: mode }),

    workspaceMode: readWorkspaceMode(),
    setWorkspaceMode: (mode) => {
      writeWorkspaceMode(mode);
      set({ workspaceMode: mode });
    },

    activeSketch: null,
    sketches: [],
    sketchPlaneSelecting: false,
    setSketchPlaneSelecting: (selecting) => set({
      sketchPlaneSelecting: selecting,
      statusMessage: selecting ? 'Select a plane or planar face to start sketching' : 'Ready',
    }),
  };
}
