import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useCADStore } from '../../store/cadStore';
import { useComponentStore } from '../../store/componentStore';
import type { Tool, Feature } from '../../types/cad';
import type * as THREE from 'three';
import './Toolbar.css';
import { QuickAccessBar } from './QuickAccessBar';
import { WorkspaceTabBar } from './WorkspaceTabBar';
import { RibbonSolidTab } from './RibbonSolidTab';
import { RibbonSurfaceTab } from './RibbonSurfaceTab';
import { RibbonMeshTab } from './RibbonMeshTab';
import { RibbonFormTab } from './RibbonFormTab';
import { RibbonManageTab } from './RibbonManageTab';
import { RibbonUtilitiesTab } from './RibbonUtilitiesTab';
import { RibbonSketchMode } from './RibbonSketchMode';
import { RibbonPrepareTab } from './RibbonPrepareTab';
import { RibbonPrinterTab } from './RibbonPrinterTab';
import { buildDesignMenus, buildSketchMenus } from './menuBuilders';
import type { Workspace, DesignTab, RibbonTab } from '../../types/toolbar.types';

export default function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const meshInsertInputRef = useRef<HTMLInputElement>(null);
  const loadFileInputRef = useRef<HTMLInputElement>(null);
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const [designTab, setDesignTab] = useState<DesignTab>('solid');

  const activeSketch = useCADStore((s) => s.activeSketch);
  const sketchPlaneSelecting = useCADStore((s) => s.sketchPlaneSelecting);
  const setSketchPlaneSelecting = useCADStore((s) => s.setSketchPlaneSelecting);
  const startExtrudeTool = useCADStore((s) => s.startExtrudeTool);
  const startRevolveTool = useCADStore((s) => s.startRevolveTool);
  const startSweepTool = useCADStore((s) => s.startSweepTool);
  const startLoftTool = useCADStore((s) => s.startLoftTool);
  const startPatchTool = useCADStore((s) => s.startPatchTool);
  const startRibTool = useCADStore((s) => s.startRibTool);
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);
  const setSectionEnabled = useCADStore((s) => s.setSectionEnabled);
  const setSelectionFilter = useCADStore((s) => s.setSelectionFilter);
  const selectionFilter = useCADStore((s) => s.selectionFilter);
  const selectedFeatureId = useCADStore((s) => s.selectedFeatureId);
  const removeFeature = useCADStore((s) => s.removeFeature);
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const undoAction = useCADStore((s) => s.undo);
  const redoAction = useCADStore((s) => s.redo);
  const autoConstrainSketch = useCADStore((s) => s.autoConstrainSketch);
  const showComponentColors = useCADStore((s) => s.showComponentColors);
  const setShowComponentColors = useCADStore((s) => s.setShowComponentColors);
  const startSketchTextTool = useCADStore((s) => s.startSketchTextTool);
  const startSketchProjectSurfaceTool = useCADStore((s) => s.startSketchProjectSurfaceTool);
  const sketches = useCADStore((s) => s.sketches);
  const setWorkspaceMode = useCADStore((s) => s.setWorkspaceMode);
  const workspace = useCADStore((s) => s.workspaceMode) as Workspace;
  const setActiveTool = useCADStore((s) => s.setActiveTool);
  const openReplaceFaceDialog = useCADStore((s) => s.openReplaceFaceDialog);
  const openDirectEditDialog = useCADStore((s) => s.openDirectEditDialog);
  const openTextureExtrudeDialog = useCADStore((s) => s.openTextureExtrudeDialog);
  const openSplitFaceDialog = useCADStore((s) => s.openSplitFaceDialog);
  const openBoundingSolidDialog = useCADStore((s) => s.openBoundingSolidDialog);
  const openJointOriginDialog = useCADStore((s) => s.openJointOriginDialog);
  const openInterferenceDialog = useCADStore((s) => s.openInterferenceDialog);
  const openContactSetsDialog = useCADStore((s) => s.openContactSetsDialog);
  const openInsertComponentDialog = useCADStore((s) => s.openInsertComponentDialog);
  const setActiveAnalysis = useCADStore((s) => s.setActiveAnalysis);
  const openMirrorComponentDialog = useCADStore((s) => s.openMirrorComponentDialog);
  const openDuplicateWithJointsDialog = useCADStore((s) => s.openDuplicateWithJointsDialog);

  const addComponent = useComponentStore((s) => s.addComponent);
  const rootComponentId = useComponentStore((s) => s.rootComponentId);
  const setComponentGrounded = useComponentStore((s) => s.setComponentGrounded);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const activeComponent = useComponentStore((s) =>
    s.activeComponentId ? s.components[s.activeComponentId] : undefined,
  );
  const toggleExplode = useComponentStore((s) => s.toggleExplode);
  const explodeActive = useComponentStore((s) => s.explodeActive);

  const beginSketchFlow = useCallback(() => setSketchPlaneSelecting(true), [setSketchPlaneSelecting]);
  const handleNewComponent = useCallback(() => {
    const id = addComponent(rootComponentId);
    setStatusMessage(`New component created (${id.slice(0, 8)})`);
  }, [addComponent, rootComponentId, setStatusMessage]);
  const inSketch = Boolean(activeSketch);
  const comingSoon = useCallback((feature: string) => () => {
    setStatusMessage(`${feature}: coming soon`);
  }, [setStatusMessage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (
        target?.isContentEditable ||
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select'
      ) {
        return;
      }
      if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) redoAction();
        else undoAction();
      } else if (event.key === 'y' || event.key === 'Y') {
        event.preventDefault();
        event.stopPropagation();
        redoAction();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [undoAction, redoAction]);

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatusMessage(`Importing ${file.name}...`);
    try {
      const { FileImporter } = await import('../../engine/FileImporter');
      const group = await FileImporter.importFile(file);
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: file.name,
        type: 'import',
        params: { fileName: file.name },
        mesh: group as unknown as THREE.Mesh,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Imported ${file.name}`);
    } catch (err) {
      setStatusMessage(`Import failed: ${(err as Error).message}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleMeshInsert = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatusMessage(`Inserting mesh ${file.name}...`);
    try {
      const { FileImporter } = await import('../../engine/FileImporter');
      const group = await FileImporter.importFile(file);
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: file.name,
        type: 'import',
        params: { fileName: file.name, bodyKind: 'mesh' },
        mesh: group as unknown as THREE.Mesh,
        bodyKind: 'mesh',
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Inserted mesh body: ${file.name}`);
    } catch (err) {
      setStatusMessage(`Mesh insert failed: ${(err as Error).message}`);
    }
    if (meshInsertInputRef.current) meshInsertInputRef.current.value = '';
  };

  const handleExtrude = useCallback(() => {
    if (sketches.length === 0 && !activeSketch) {
      setStatusMessage('Create a sketch first before extruding');
      return;
    }
    startExtrudeTool();
  }, [activeSketch, sketches.length, setStatusMessage, startExtrudeTool]);

  const handleRevolve = useCallback(() => {
    if (sketches.length === 0) {
      setStatusMessage('Create a sketch first before revolving');
      return;
    }
    startRevolveTool();
  }, [sketches.length, setStatusMessage, startRevolveTool]);

  const handleWorkspaceSwitch = useCallback((ws: Workspace) => {
    setWsDropdownOpen(false);
    setWorkspaceMode(ws);
  }, [setWorkspaceMode]);

  const activeTab: RibbonTab = inSketch
    ? 'sketch'
    : workspace === 'design'
      ? designTab
      : 'solid';

  const handleTabClick = useCallback((tabId: RibbonTab) => {
    if (inSketch) return;
    if (workspace === 'design') setDesignTab(tabId as DesignTab);
  }, [inSketch, workspace]);

  const {
    assembleMenuItems,
    constructMenuItems,
    createMenuItems,
    inspectMenuItems,
    modifyMenuItems,
  } = useMemo(() => buildDesignMenus({
    activeComponent,
    activeComponentId,
    comingSoon,
    explodeActive,
    handleExtrude,
    handleNewComponent,
    handleRevolve,
    openBoundingSolidDialog,
    openContactSetsDialog,
    openDirectEditDialog,
    openDuplicateWithJointsDialog,
    openInsertComponentDialog,
    openInterferenceDialog,
    openJointOriginDialog,
    openMirrorComponentDialog,
    openReplaceFaceDialog,
    openSplitFaceDialog,
    openTextureExtrudeDialog,
    removeFeature,
    selectedFeatureId,
    showComponentColors,
    setActiveAnalysis,
    setActiveDialog,
    setActiveTool: setActiveTool as (tool: Tool) => void,
    setComponentGrounded,
    setSectionEnabled,
    setShowComponentColors,
    setStatusMessage,
    startExtrudeTool,
    startLoftTool,
    startPatchTool,
    startRibTool,
    startSweepTool,
    toggleExplode,
  }), [
    activeComponent,
    activeComponentId,
    comingSoon,
    explodeActive,
    handleExtrude,
    handleNewComponent,
    handleRevolve,
    openBoundingSolidDialog,
    openContactSetsDialog,
    openDirectEditDialog,
    openDuplicateWithJointsDialog,
    openInsertComponentDialog,
    openInterferenceDialog,
    openJointOriginDialog,
    openMirrorComponentDialog,
    openReplaceFaceDialog,
    openSplitFaceDialog,
    openTextureExtrudeDialog,
    removeFeature,
    selectedFeatureId,
    showComponentColors,
    setActiveAnalysis,
    setActiveDialog,
    setActiveTool,
    setComponentGrounded,
    setSectionEnabled,
    setShowComponentColors,
    setStatusMessage,
    startExtrudeTool,
    startLoftTool,
    startPatchTool,
    startRibTool,
    startSweepTool,
    toggleExplode,
  ]);

  const {
    selectMenuItems,
    sketchConstraintMenuItems,
    sketchCreateMenuItems,
    sketchModifyMenuItems,
  } = useMemo(() => buildSketchMenus({
    autoConstrainSketch,
    comingSoon,
    selectionFilter,
    setActiveTool: setActiveTool as (tool: Tool) => void,
    setSelectionFilter,
    setStatusMessage,
    startSketchProjectSurfaceTool,
    startSketchTextTool,
  }), [
    autoConstrainSketch,
    comingSoon,
    selectionFilter,
    setActiveTool,
    setSelectionFilter,
    setStatusMessage,
    startSketchProjectSurfaceTool,
    startSketchTextTool,
  ]);

  return (
    <div className="ribbon-toolbar">
      <QuickAccessBar
        fileInputRef={fileInputRef}
        loadFileInputRef={loadFileInputRef}
        onImport={handleImport}
      />

      <WorkspaceTabBar
        workspace={workspace}
        wsDropdownOpen={wsDropdownOpen}
        setWsDropdownOpen={setWsDropdownOpen}
        onWorkspaceSwitch={handleWorkspaceSwitch}
        inSketch={inSketch}
        activeTab={activeTab}
        onTabClick={handleTabClick}
        sketchPlaneSelecting={sketchPlaneSelecting}
        onCancelPlaneSelect={() => setSketchPlaneSelecting(false)}
      />

      <div className={`ribbon-content${inSketch ? ' sketch-ribbon' : ''}`}>
        {!inSketch && workspace === 'design' && designTab === 'solid' && (
          <RibbonSolidTab
            createMenuItems={createMenuItems}
            modifyMenuItems={modifyMenuItems}
            assembleMenuItems={assembleMenuItems}
            constructMenuItems={constructMenuItems}
            inspectMenuItems={inspectMenuItems}
            selectMenuItems={selectMenuItems}
            beginSketchFlow={beginSketchFlow}
            handleExtrude={handleExtrude}
            handleRevolve={handleRevolve}
            fileInputRef={fileInputRef}
          />
        )}

        {!inSketch && workspace === 'design' && designTab === 'surface' && <RibbonSurfaceTab />}
        {!inSketch && workspace === 'design' && designTab === 'mesh' && (
          <RibbonMeshTab meshInsertInputRef={meshInsertInputRef} onMeshInsert={handleMeshInsert} />
        )}
        {!inSketch && workspace === 'design' && designTab === 'form' && <RibbonFormTab />}
        {!inSketch && workspace === 'design' && designTab === 'manage' && <RibbonManageTab />}
        {!inSketch && workspace === 'design' && designTab === 'utilities' && <RibbonUtilitiesTab />}

        {inSketch && (
          <RibbonSketchMode
            sketchCreateMenuItems={sketchCreateMenuItems}
            sketchModifyMenuItems={sketchModifyMenuItems}
            sketchConstraintMenuItems={sketchConstraintMenuItems}
          />
        )}

        {!inSketch && workspace === 'prepare' && <RibbonPrepareTab />}
        {!inSketch && workspace === 'printer' && <RibbonPrinterTab />}
      </div>
    </div>
  );
}
