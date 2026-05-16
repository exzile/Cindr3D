import type { Tool } from '../../types/cad';

export interface DesignMenuDeps {
  activeComponent?: { grounded?: boolean; name?: string };
  activeComponentId?: string | null;
  comingSoon: (feature: string) => () => void;
  explodeActive: boolean;
  handleExtrude: () => void;
  handleNewComponent: () => void;
  handleRevolve: () => void;
  openBoundingSolidDialog: () => void;
  openContactSetsDialog: () => void;
  openDirectEditDialog: () => void;
  openDuplicateWithJointsDialog: (id: string) => void;
  openInsertComponentDialog: () => void;
  openInterferenceDialog: () => void;
  openJointOriginDialog: () => void;
  openMirrorComponentDialog: () => void;
  openReplaceFaceDialog: () => void;
  openSplitFaceDialog: () => void;
  openTextureExtrudeDialog: () => void;
  removeFeature: (id: string) => void;
  selectedFeatureId?: string | null;
  showComponentColors: boolean;
  setActiveAnalysis: (
    analysis:
      | 'draft'
      | 'zebra'
      | 'curvature-map'
      | 'isocurve'
      | 'accessibility'
      | 'min-radius'
      | 'curvature-comb'
      | null
  ) => void;
  setActiveDialog: (dialog: string | null) => void;
  setActiveTool: (tool: Tool) => void;
  setComponentGrounded: (id: string, grounded: boolean) => void;
  setSectionEnabled: (enabled: boolean) => void;
  setStatusMessage: (message: string) => void;
  setShowComponentColors: (value: boolean) => void;
  startExtrudeTool: () => void;
  startLoftTool: () => void;
  startPatchTool: () => void;
  startRibTool: () => void;
  startSweepTool: () => void;
  toggleExplode: () => void;
}

export interface SelectionFilter {
  bodies: boolean;
  faces: boolean;
  edges: boolean;
  vertices: boolean;
  sketches?: boolean;
  construction?: boolean;
}

export interface SketchMenuDeps {
  autoConstrainSketch: () => void;
  selectionFilter: SelectionFilter;
  selectionMode: 'normal' | 'window' | 'lasso';
  comingSoon: (feature: string) => () => void;
  setActiveTool: (tool: Tool) => void;
  setSelectionFilter: (update: Partial<SelectionFilter>) => void;
  setSelectionMode: (mode: 'normal' | 'window' | 'lasso') => void;
  setStatusMessage: (message: string) => void;
  startSketchProjectSurfaceTool: () => void;
  startSketchTextTool: () => void;
}
