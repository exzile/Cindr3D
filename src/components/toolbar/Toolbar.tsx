import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  MousePointer2, Minus, Circle, Square, Spline,
  ArrowUpFromLine, RotateCcw, Blend, Ruler, Hexagon,
  Move, Layers, Download,
  PenTool, Diamond,
  Box, Combine, Scissors, FlipHorizontal,
  CircleDot, Repeat, Copy, Link2, Axis3D,
  Pipette, AlignCenter,
  Eye,
  ArrowUp,
  Trash2, Wrench, Crosshair,
  Target, Package, Globe,
  RectangleHorizontal, Waypoints,
  CornerDownRight,
  ArrowLeftRight, ArrowUpDown, Equal, Tangent,
  GitMerge, Zap, Type, Shield,
  Lock, LocateFixed,
  ArrowRight, Dot,
  Pencil, Image,
  GitFork,
  TrendingDown, Activity, Grid, BarChart2, AlertCircle,
  MapPin,
  Anchor,
  Expand,
  AlertTriangle,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { useComponentStore } from '../../store/componentStore';
import type { Tool, Feature } from '../../types/cad';
import type * as THREE from 'three';
import './Toolbar.css';

// Subcomponents
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
import type { Workspace, DesignTab, PrepareTab, RibbonTab, MenuItem } from './toolbar.types';

// ─── Main Toolbar ──────────────────────────────────────────────────────────

export default function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const meshInsertInputRef = useRef<HTMLInputElement>(null);
  const loadFileInputRef = useRef<HTMLInputElement>(null);
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const [designTab, setDesignTab] = useState<DesignTab>('solid');
  const [prepareTab, setPrepareTab] = useState<PrepareTab>('plate');

  // CAD store
  const activeSketch = useCADStore((s) => s.activeSketch);
  const sketchPlaneSelecting = useCADStore((s) => s.sketchPlaneSelecting);
  const setSketchPlaneSelecting = useCADStore((s) => s.setSketchPlaneSelecting);
  const beginSketchFlow = () => setSketchPlaneSelecting(true);
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

  // Component store
  const addComponent = useComponentStore((s) => s.addComponent);
  const rootComponentId = useComponentStore((s) => s.rootComponentId);
  const setComponentGrounded = useComponentStore((s) => s.setComponentGrounded);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const activeComponent = useComponentStore((s) =>
    s.activeComponentId ? s.components[s.activeComponentId] : undefined
  );
  const toggleExplode = useComponentStore((s) => s.toggleExplode);
  const explodeActive = useComponentStore((s) => s.explodeActive);

  // New Component helper
  const handleNewComponent = useCallback(() => {
    const id = addComponent(rootComponentId);
    setStatusMessage(`New component created (${id.slice(0, 8)})`);
  }, [addComponent, rootComponentId, setStatusMessage]);

  // Sketch mode
  const inSketch = !!activeSketch;

  // ─── Helper: "coming soon" action ───
  const comingSoon = useCallback((feature: string) => () => {
    setStatusMessage(`${feature}: coming soon`);
  }, [setStatusMessage]);

  // ─── Keyboard shortcuts: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z ─────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) {
          redoAction();
        } else {
          undoAction();
        }
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        redoAction();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
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

  const handleExtrude = () => {
    if (sketches.length === 0) {
      setStatusMessage('Create a sketch first before extruding');
      return;
    }
    startExtrudeTool();
  };

  const handleRevolve = () => {
    if (sketches.length === 0) {
      setStatusMessage('Create a sketch first before revolving');
      return;
    }
    startRevolveTool();
  };

  const handleWorkspaceSwitch = (ws: Workspace) => {
    setWsDropdownOpen(false);
    setWorkspaceMode(ws);
  };

  const activeTab: RibbonTab = inSketch
    ? 'sketch'
    : workspace === 'design'
    ? designTab
    : prepareTab;

  const handleTabClick = (tabId: RibbonTab) => {
    if (inSketch) return;
    if (workspace === 'design') setDesignTab(tabId as DesignTab);
    else setPrepareTab(tabId as PrepareTab);
  };

  const MI = 16; // menu item icon size

  // ─── Flyout Menu Definitions ─────────────────────────────────────────────

  const createMenuItems: MenuItem[] = [
    { icon: <Package size={MI} />, label: 'New Component', onClick: handleNewComponent },
    { icon: <Package size={MI} />, label: 'Create Base Feature', onClick: () => setActiveDialog('base-feature') },
    { icon: <PenTool size={MI} />, label: 'Create Sketch', shortcut: 'S', onClick: beginSketchFlow },
    { separator: true, icon: <ArrowUpFromLine size={MI} />, label: 'Extrude', shortcut: 'E', onClick: handleExtrude },
    { icon: <RotateCcw size={MI} />, label: 'Revolve', onClick: handleRevolve },
    { icon: <Spline size={MI} />, label: 'Sweep', onClick: startSweepTool },
    { icon: <Layers size={MI} />, label: 'Loft', onClick: startLoftTool },
    { icon: <Diamond size={MI} />, label: 'Patch', onClick: startPatchTool },
    { icon: <Minus size={MI} />, label: 'Rib', onClick: startRibTool },
    { icon: <Move size={MI} />, label: 'Web', onClick: () => setActiveDialog('web') },
    { icon: <ArrowUp size={MI} />, label: 'Emboss', onClick: () => setActiveDialog('emboss') },
    { icon: <AlignCenter size={MI} />, label: 'Rest', onClick: () => setActiveDialog('rest') },
    { separator: true, icon: <CircleDot size={MI} />, label: 'Hole', shortcut: 'H', onClick: () => useCADStore.getState().openHoleDialog() },
    { icon: <Wrench size={MI} />, label: 'Thread', onClick: () => setActiveDialog('thread') },
    { separator: true, icon: <Box size={MI} />, label: 'Box', onClick: () => setActiveDialog('primitive-box') },
    { icon: <Circle size={MI} />, label: 'Cylinder', onClick: () => setActiveDialog('primitive-cylinder') },
    { icon: <Globe size={MI} />, label: 'Sphere', onClick: () => setActiveDialog('primitive-sphere') },
    { icon: <CircleDot size={MI} />, label: 'Torus', onClick: () => setActiveDialog('primitive-torus') },
    { icon: <Spline size={MI} />, label: 'Coil', onClick: () => setActiveDialog('coil') },
    { icon: <Minus size={MI} />, label: 'Pipe', onClick: () => setActiveDialog('pipe') },
    {
      separator: true,
      icon: <Repeat size={MI} />,
      label: 'Pattern',
      submenu: [
        { icon: <Repeat size={MI} />, label: 'Linear Pattern', onClick: () => setActiveDialog('linear-pattern') },
        { icon: <Repeat size={MI} />, label: 'Rectangular Pattern', onClick: () => setActiveDialog('rectangular-pattern') },
        { icon: <Repeat size={MI} />, label: 'Circular Pattern', onClick: () => setActiveDialog('circular-pattern') },
        { icon: <Repeat size={MI} />, label: 'Pattern on Path', onClick: () => setActiveDialog('pattern-on-path') },
      ],
    },
    { icon: <FlipHorizontal size={MI} />, label: 'Mirror', onClick: () => setActiveDialog('mirror') },
    { icon: <Layers size={MI} />, label: 'Thicken', onClick: () => setActiveDialog('thicken') },
    { icon: <Square size={MI} />, label: 'Boundary Fill', onClick: () => setActiveDialog('boundary-fill') },
    { separator: true, icon: <Box size={MI} />, label: 'Bounding Solid', onClick: openBoundingSolidDialog },
  ];

  const modifyMenuItems: MenuItem[] = [
    { icon: <ArrowUpFromLine size={MI} />, label: 'Press Pull', shortcut: 'Q', onClick: startExtrudeTool },
    { icon: <Blend size={MI} />, label: 'Fillet', shortcut: 'F', onClick: () => setActiveDialog('fillet') },
    { icon: <Blend size={MI} />, label: 'Chamfer', onClick: () => setActiveDialog('chamfer') },
    { separator: true, icon: <Box size={MI} />, label: 'Shell', onClick: () => setActiveDialog('shell') },
    { icon: <ArrowUp size={MI} />, label: 'Draft', onClick: () => setActiveDialog('draft') },
    { icon: <Move size={MI} />, label: 'Scale', onClick: () => setActiveDialog('scale') },
    { icon: <Combine size={MI} />, label: 'Combine', onClick: () => setActiveDialog('combine') },
    { separator: true, icon: <Square size={MI} />, label: 'Offset Face', onClick: () => setActiveDialog('offset-face') },
    { icon: <Square size={MI} />, label: 'Replace Face', onClick: openReplaceFaceDialog },
    { icon: <Pencil size={MI} />, label: 'Direct Edit', onClick: openDirectEditDialog },
    { icon: <Image size={MI} />, label: 'Texture Extrude', onClick: openTextureExtrudeDialog },
    { icon: <Scissors size={MI} />, label: 'Split Face', onClick: openSplitFaceDialog },
    { icon: <Scissors size={MI} />, label: 'Split Body', onClick: () => setActiveDialog('split') },
    { icon: <Scissors size={MI} />, label: 'Silhouette Split', onClick: () => setActiveDialog('silhouette-split') },
    { separator: true, icon: <Move size={MI} />, label: 'Move/Copy', shortcut: 'M', onClick: () => setActiveTool('move' as Tool) },
    { icon: <Move size={MI} />, label: 'Move/Copy Body', onClick: () => setActiveDialog('move-body') },
    { icon: <AlignCenter size={MI} />, label: 'Align', onClick: () => setActiveDialog('align-dialog') },
    { icon: <Trash2 size={MI} />, label: 'Delete', shortcut: 'Del', onClick: () => {
      if (selectedFeatureId) { removeFeature(selectedFeatureId); setStatusMessage('Feature deleted'); }
      else setStatusMessage('Select a feature to delete');
    } },
    { icon: <Trash2 size={MI} />, label: 'Remove Face', onClick: () => setActiveDialog('remove-face') },
    { separator: true, icon: <Diamond size={MI} />, label: 'Physical Material', onClick: () => setActiveDialog('physical-material') },
    { icon: <Pipette size={MI} />, label: 'Appearance', shortcut: 'A', onClick: () => setActiveDialog('appearance') },
    { icon: <Diamond size={MI} />, label: 'Change Parameters', shortcut: 'Ctrl+B', onClick: () => setActiveDialog('parameters') },
  ];

  const assembleMenuItems: MenuItem[] = [
    { icon: <Download size={MI} />, label: 'Insert Component', onClick: openInsertComponentDialog },
    { separator: true, icon: <Shield size={MI} />, label: 'Contact Sets', onClick: openContactSetsDialog },
    { icon: <Package size={MI} />, label: 'New Component', onClick: handleNewComponent },
    { icon: <Copy size={MI} />, label: 'Duplicate With Joints', onClick: () => { if (activeComponentId) openDuplicateWithJointsDialog(activeComponentId); else comingSoon('Duplicate With Joints')(); } },
    { icon: <FlipHorizontal size={MI} />, label: 'Mirror Component', onClick: openMirrorComponentDialog },
    { separator: true, icon: <Link2 size={MI} />, label: 'Constrain Components', onClick: () => setActiveDialog('constrain-components') },
    { icon: <Link2 size={MI} />, label: 'Joint', shortcut: 'J', onClick: () => setActiveDialog('joint') },
    { icon: <Link2 size={MI} />, label: 'As-Built Joint', shortcut: 'Shift+J', onClick: () => setActiveDialog('as-built-joint') },
    { separator: true, icon: <Layers size={MI} />, label: 'Rigid Group', onClick: () => setActiveDialog('rigid-group') },
    { icon: <MapPin size={MI} />, label: 'Joint Origin', onClick: () => openJointOriginDialog() },
    { icon: <Diamond size={MI} />, label: 'Drive Joints', onClick: () => setActiveDialog('drive-joints') },
    { icon: <GitMerge size={MI} />, label: 'Motion Link', onClick: () => setActiveDialog('motion-link') },
    { icon: <Move size={MI} />, label: 'Motion Study', onClick: comingSoon('Motion Study') },
    { icon: <Expand size={MI} />, label: 'Exploded View', onClick: toggleExplode, checked: explodeActive },
    { separator: true, icon: <Repeat size={MI} />, label: 'Component Pattern', onClick: () => setActiveDialog('component-pattern') },
    {
      separator: true,
      icon: <Anchor size={MI} />,
      label: activeComponent?.grounded ? 'Unground' : 'Ground',
      onClick: () => {
        if (!activeComponentId) return;
        const next = !(activeComponent?.grounded ?? false);
        setComponentGrounded(activeComponentId, next);
        setStatusMessage(`${activeComponent?.name ?? 'Component'}: ${next ? 'Grounded' : 'Ungrounded'}`);
      },
    },
  ];

  const constructMenuItems: MenuItem[] = [
    { icon: <Layers size={MI} />, label: 'Offset Plane', onClick: () => setActiveDialog('construction-plane') },
    { icon: <Layers size={MI} />, label: 'Plane at Angle', onClick: () => setActiveDialog('construction-plane-angle') },
    { icon: <Hexagon size={MI} />, label: 'Tangent Plane', onClick: () => { setActiveTool('construct-tangent-plane'); setStatusMessage('Tangent Plane: click a curved face'); } },
    { icon: <Layers size={MI} />, label: 'Midplane', onClick: () => setActiveDialog('construction-plane-midplane') },
    { icon: <Layers size={MI} />, label: 'Perpendicular Plane', onClick: () => setActiveDialog('perpendicular-plane') },
    { separator: true, icon: <Square size={MI} />, label: 'Plane Through Two Edges', onClick: () => { setActiveTool('construct-plane-two-edges'); setStatusMessage('Plane Through Two Edges: click first edge, then second edge'); } },
    { icon: <Layers size={MI} />, label: 'Plane Through Three Points', onClick: comingSoon('Plane Through Three Points') },
    { icon: <Layers size={MI} />, label: 'Plane Tangent to Face at Point', onClick: () => { setActiveTool('construct-plane-tangent-at-point'); setStatusMessage('Plane Tangent at Point: click a curved face, then a vertex'); } },
    { icon: <Layers size={MI} />, label: 'Plane Along Path', onClick: () => setActiveDialog('plane-along-path') },
    { separator: true, icon: <RotateCcw size={MI} />, label: 'Axis Through Cylinder/Cone/Torus', onClick: () => { setActiveTool('construct-axis-cylinder'); setStatusMessage('Axis Through Cylinder: click a curved face'); } },
    { icon: <Axis3D size={MI} />, label: 'Axis Perpendicular To Face', onClick: () => setActiveDialog('axis-perp-to-face') },
    { icon: <ArrowUpFromLine size={MI} />, label: 'Axis Perpendicular at Point', onClick: () => { setActiveTool('construct-axis-perp-at-point'); setStatusMessage('Axis Perpendicular at Point: click a planar face, then a vertex'); } },
    { icon: <GitFork size={MI} />, label: 'Axis Through Two Planes', onClick: () => { setActiveTool('construct-axis-two-planes'); setStatusMessage('Axis Through Two Planes: select two construction planes in the panel'); } },
    { icon: <ArrowRight size={MI} />, label: 'Axis Through Two Points', onClick: () => { setActiveTool('construct-axis-two-points'); setStatusMessage('Axis Through Two Points: click first point, then second point'); } },
    { icon: <Minus size={MI} />, label: 'Axis Through Edge', onClick: () => { setActiveTool('construct-axis-through-edge'); setStatusMessage('Axis Through Edge: click an edge to create axis along it'); } },
    { separator: true, icon: <Dot size={MI} />, label: 'Point at Vertex', onClick: () => { setActiveTool('construct-point-vertex'); setStatusMessage('Point at Vertex: click a vertex to create a construction point'); } },
    { icon: <Crosshair size={MI} />, label: 'Point Through Two Edges', onClick: () => { setActiveTool('construct-point-two-edges'); setStatusMessage('Point Through Two Edges: click first edge, then second edge'); } },
    { icon: <Crosshair size={MI} />, label: 'Point Through Three Planes', onClick: () => { setActiveTool('construct-point-three-planes'); setStatusMessage('Point Through Three Planes: select three construction planes in the panel'); } },
    { icon: <Target size={MI} />, label: 'Point at Center of Circle/Sphere/Torus', onClick: () => { setActiveTool('construct-point-center'); setStatusMessage('Point at Center: click a circular face to create a point at its center'); } },
    { icon: <CircleDot size={MI} />, label: 'Point At Edge And Plane', onClick: () => setActiveDialog('point-at-edge-plane') },
    { icon: <CircleDot size={MI} />, label: 'Point Along Path', onClick: () => setActiveDialog('point-along-path') },
  ];

  const inspectMenuItems: MenuItem[] = [
    { icon: <Ruler size={MI} />, label: 'Measure', shortcut: 'I', onClick: () => { setActiveTool('measure' as Tool); setStatusMessage('Measure: click two points or entities to measure distance'); } },
    { icon: <AlertTriangle size={MI} />, label: 'Interference', onClick: () => openInterferenceDialog() },
    { separator: true, icon: <BarChart2 size={MI} />, label: 'Curvature Comb Analysis', onClick: () => setActiveAnalysis('curvature-comb') },
    { icon: <Layers size={MI} />, label: 'Zebra Analysis', onClick: () => setActiveAnalysis('zebra') },
    { icon: <TrendingDown size={MI} />, label: 'Draft Analysis', onClick: () => setActiveAnalysis('draft') },
    { icon: <Activity size={MI} />, label: 'Curvature Map Analysis', onClick: () => setActiveAnalysis('curvature-map') },
    { icon: <Grid size={MI} />, label: 'Isocurve Analysis', onClick: () => setActiveAnalysis('isocurve') },
    { icon: <Eye size={MI} />, label: 'Accessibility Analysis', onClick: () => setActiveAnalysis('accessibility') },
    { icon: <AlertCircle size={MI} />, label: 'Minimum Radius Analysis', onClick: () => setActiveAnalysis('min-radius') },
    { icon: <Scissors size={MI} />, label: 'Section Analysis', onClick: () => setSectionEnabled(true) },
    { icon: <Target size={MI} />, label: 'Center of Mass', onClick: () => {
      const fs = useCADStore.getState().features.filter((f) => f.visible && f.type === 'primitive');
      if (fs.length === 0) { setStatusMessage('No primitive bodies visible — Center of Mass: (0, 0, 0) mm'); return; }
      const sum = fs.reduce((acc, f) => {
        const p = f.params as Record<string, number>;
        return { x: acc.x + (p.x ?? 0), y: acc.y + (p.y ?? 0), z: acc.z + (p.z ?? 0) };
      }, { x: 0, y: 0, z: 0 });
      const n = fs.length;
      const cx = (sum.x / n).toFixed(2); const cy = (sum.y / n).toFixed(2); const cz = (sum.z / n).toFixed(2);
      setStatusMessage(`Center of Mass (approx): X=${cx} Y=${cy} Z=${cz} mm`);
    } },
    { separator: true, icon: <Pipette size={MI} />, label: 'Display Component Colors', shortcut: 'Shift+N', checked: useCADStore.getState().showComponentColors, onClick: () => { const s = useCADStore.getState(); s.setShowComponentColors(!s.showComponentColors); s.setStatusMessage(s.showComponentColors ? 'Component colors: OFF' : 'Component colors: ON'); } },
  ];

  const selectMenuItems = useMemo<MenuItem[]>(() => {
    const sf = selectionFilter;
    // Derive which priority preset (if any) is active from the current filter
    const isBodyPriority    = sf.bodies && !sf.faces && !sf.edges && !sf.vertices;
    const isFacePriority    = sf.faces  && !sf.bodies && !sf.edges && !sf.vertices;
    const isEdgePriority    = sf.edges  && !sf.bodies && !sf.faces && !sf.vertices;
    const isVertexPriority  = sf.vertices && !sf.bodies && !sf.faces && !sf.edges;

    const setPriority = (filter: Partial<typeof sf>, label: string) => {
      setSelectionFilter({ bodies: false, faces: false, edges: false, vertices: false, ...filter });
      setStatusMessage(`Selection priority: ${label}`);
    };

    return [
      { icon: <MousePointer2 size={MI} />, label: 'Select', onClick: () => setActiveTool('select' as Tool) },
      { icon: <Square size={MI} />, label: 'Window Selection', shortcut: '1', onClick: comingSoon('Window Selection') },
      { icon: <Spline size={MI} />, label: 'Freeform Selection', shortcut: '2', onClick: comingSoon('Freeform Selection') },
      { icon: <PenTool size={MI} />, label: 'Paint Selection', shortcut: '3', onClick: comingSoon('Paint Selection') },
      {
        separator: true,
        icon: <MousePointer2 size={MI} />,
        label: 'Selection Priority',
        submenu: [
          { icon: <Box size={MI} />,         label: 'Body Priority',      checked: isBodyPriority,   onClick: () => isBodyPriority   ? setSelectionFilter({ bodies: true, faces: true, edges: true, vertices: true }) : setPriority({ bodies: true }, 'Body') },
          { icon: <Package size={MI} />,     label: 'Component Priority', checked: isBodyPriority,   onClick: () => isBodyPriority   ? setSelectionFilter({ bodies: true, faces: true, edges: true, vertices: true }) : setPriority({ bodies: true }, 'Component') },
          { icon: <Square size={MI} />,      label: 'Face Priority',      checked: isFacePriority,   onClick: () => isFacePriority   ? setSelectionFilter({ bodies: true, faces: true, edges: true, vertices: true }) : setPriority({ faces: true }, 'Face') },
          { icon: <Minus size={MI} />,       label: 'Edge Priority',      checked: isEdgePriority,   onClick: () => isEdgePriority   ? setSelectionFilter({ bodies: true, faces: true, edges: true, vertices: true }) : setPriority({ edges: true }, 'Edge') },
          { icon: <Dot size={MI} />,         label: 'Vertex Priority',    checked: isVertexPriority, onClick: () => isVertexPriority ? setSelectionFilter({ bodies: true, faces: true, edges: true, vertices: true }) : setPriority({ vertices: true }, 'Vertex') },
        ],
      },
      { separator: true, icon: <MousePointer2 size={MI} />, label: 'Select All', onClick: () => { setSelectionFilter({ bodies: true, faces: true, edges: true, vertices: true, sketches: true, construction: true }); setStatusMessage('Selection filter: All'); } },
      { icon: <Box size={MI} />,         label: 'Bodies',       checked: sf.bodies,       onClick: () => setSelectionFilter({ bodies: !sf.bodies }) },
      { icon: <Square size={MI} />,      label: 'Faces',        checked: sf.faces,        onClick: () => setSelectionFilter({ faces: !sf.faces }) },
      { icon: <Minus size={MI} />,       label: 'Edges',        checked: sf.edges,        onClick: () => setSelectionFilter({ edges: !sf.edges }) },
      { icon: <Dot size={MI} />,         label: 'Vertices',     checked: sf.vertices,     onClick: () => setSelectionFilter({ vertices: !sf.vertices }) },
      { icon: <PenTool size={MI} />,     label: 'Sketches',     checked: sf.sketches,     onClick: () => setSelectionFilter({ sketches: !sf.sketches }) },
      { icon: <Layers size={MI} />,      label: 'Construction', checked: sf.construction, onClick: () => setSelectionFilter({ construction: !sf.construction }) },
    ];
  }, [selectionFilter, setActiveTool, setSelectionFilter, setStatusMessage, comingSoon]);

  // ─── Sketch Mode Flyout Menus ──────────────────────────────────────────

  const sketchCreateMenuItems: MenuItem[] = [
    {
      icon: <Minus size={MI} />, label: 'Line', shortcut: 'L',
      submenu: [
        { icon: <Minus size={MI} />, label: 'Line', shortcut: 'L', onClick: () => setActiveTool('line' as Tool) },
        { icon: <Minus size={MI} />, label: 'Construction Line', onClick: () => setActiveTool('construction-line' as Tool) },
        { icon: <Minus size={MI} />, label: 'Centerline', onClick: () => setActiveTool('centerline' as Tool) },
        { icon: <Minus size={MI} />, label: 'Midpoint Line', onClick: () => { setActiveTool('midpoint-line' as Tool); setStatusMessage('Midpoint Line: click the midpoint, then one endpoint'); } },
      ],
    },
    {
      icon: <Square size={MI} />, label: 'Rectangle', shortcut: 'R',
      submenu: [
        { icon: <RectangleHorizontal size={MI} />, label: '2-Point Rectangle', shortcut: 'R', onClick: () => setActiveTool('rectangle' as Tool) },
        { icon: <Square size={MI} />, label: '3-Point Rectangle', onClick: () => setActiveTool('rectangle-3point' as Tool) },
        { icon: <Crosshair size={MI} />, label: 'Center Rectangle', onClick: () => setActiveTool('rectangle-center' as Tool) },
      ],
    },
    {
      icon: <Circle size={MI} />, label: 'Circle', shortcut: 'C',
      submenu: [
        { icon: <Circle size={MI} />, label: 'Center Diameter Circle', shortcut: 'C', onClick: () => setActiveTool('circle' as Tool) },
        { icon: <Circle size={MI} />, label: '2-Point Circle', onClick: () => setActiveTool('circle-2point' as Tool) },
        { icon: <Circle size={MI} />, label: '3-Point Circle', onClick: () => setActiveTool('circle-3point' as Tool) },
        { icon: <Circle size={MI} />, label: '2-Tangent Circle', onClick: () => { setActiveTool('circle-2tangent' as Tool); setStatusMessage('2-Tangent Circle: click first line, then second line — set radius in palette'); } },
        { icon: <Circle size={MI} />, label: '3-Tangent Circle', onClick: () => { setActiveTool('circle-3tangent' as Tool); setStatusMessage('3-Tangent Circle: click three lines to create the incircle'); } },
      ],
    },
    {
      icon: <Spline size={MI} />, label: 'Arc',
      submenu: [
        { icon: <Spline size={MI} />, label: '3-Point Arc', onClick: () => setActiveTool('arc-3point' as Tool) },
        { icon: <Spline size={MI} />, label: 'Center Point Arc', onClick: () => setActiveTool('arc' as Tool) },
        { icon: <Spline size={MI} />, label: 'Tangent Arc', onClick: () => setActiveTool('arc-tangent' as Tool) },
      ],
    },
    {
      icon: <Hexagon size={MI} />, label: 'Polygon',
      submenu: [
        { icon: <Hexagon size={MI} />, label: 'Inscribed Polygon', onClick: () => setActiveTool('polygon-inscribed' as Tool) },
        { icon: <Hexagon size={MI} />, label: 'Circumscribed Polygon', onClick: () => setActiveTool('polygon-circumscribed' as Tool) },
        { icon: <Hexagon size={MI} />, label: 'Edge Polygon', onClick: () => setActiveTool('polygon-edge' as Tool) },
      ],
    },
    {
      separator: true, icon: <CircleDot size={MI} />, label: 'Ellipse',
      onClick: () => { setActiveTool('ellipse'); setStatusMessage('Ellipse: click centre, then major-axis, then minor-axis endpoint'); },
      submenu: [
        { icon: <CircleDot size={MI} />, label: 'Ellipse', onClick: () => { setActiveTool('ellipse'); setStatusMessage('Ellipse: click centre, then major-axis, then minor-axis endpoint'); } },
        { icon: <CircleDot size={MI} />, label: 'Elliptical Arc', onClick: () => { setActiveTool('elliptical-arc' as Tool); setStatusMessage('Elliptical Arc: click centre, major-axis, minor-axis, then end angle point'); } },
      ],
    },
    {
      icon: <Circle size={MI} />, label: 'Slot',
      submenu: [
        { icon: <Circle size={MI} />, label: 'Center to Center Slot', onClick: () => { setActiveTool('slot-center'); setStatusMessage('Center Slot: click first centre, then second centre, then width'); } },
        { icon: <Circle size={MI} />, label: 'Overall Slot', onClick: () => { setActiveTool('slot-overall'); setStatusMessage('Overall Slot: click first end, then second end, then width'); } },
        { icon: <Circle size={MI} />, label: 'Center Point Slot', onClick: () => { setActiveTool('slot-center-point'); setStatusMessage('Center Point Slot: click centre, then end, then width'); } },
        { icon: <Circle size={MI} />, label: 'Three Point Arc Slot', onClick: () => { setActiveTool('slot-3point-arc'); setStatusMessage('Three Point Arc Slot: click arc start, arc end, point on arc, then width'); } },
        { icon: <Circle size={MI} />, label: 'Center Point Arc Slot', onClick: () => { setActiveTool('slot-center-arc'); setStatusMessage('Center Point Arc Slot: click arc centre, arc start, arc end, then width'); } },
      ],
    },
    { separator: true, icon: <Waypoints size={MI} />, label: 'Spline', onClick: () => { setActiveTool('spline' as Tool); setStatusMessage('Spline: click to place fit points, right-click to finish'); },
      submenu: [
        { icon: <Waypoints size={MI} />, label: 'Fit Point Spline', onClick: () => { setActiveTool('spline' as Tool); setStatusMessage('Spline: click to place fit points, right-click to finish'); } },
        { icon: <Waypoints size={MI} />, label: 'Control Point Spline', onClick: () => { setActiveTool('spline-control' as Tool); setStatusMessage('Control Point Spline: click to add control points, right-click to commit'); } },
      ],
    },
    { icon: <Waypoints size={MI} />, label: 'Conic Curve', onClick: () => { setActiveTool('conic' as Tool); setStatusMessage('Conic: click start, then end, then shoulder point — set ρ in palette'); } },
    { separator: true, icon: <CircleDot size={MI} />, label: 'Point', onClick: () => setActiveTool('point' as Tool) },
    { separator: true, icon: <ArrowUpFromLine size={MI} />, label: 'Project / Include', shortcut: 'P', onClick: () => { setActiveTool('sketch-project' as Tool); setStatusMessage('Project: click a solid face to project its boundary onto the sketch plane'); } },
    { icon: <Scissors size={MI} />, label: 'Intersect', onClick: () => { setActiveTool('sketch-intersect' as Tool); setStatusMessage('Click a solid face to create intersection curve with sketch plane'); } },
    { icon: <Download size={MI} />, label: 'Project to Surface', onClick: startSketchProjectSurfaceTool },
    { separator: true, icon: <Type size={MI} />, label: 'Text', onClick: startSketchTextTool },
  ];

  const sketchModifyMenuItems: MenuItem[] = [
    { icon: <Blend size={MI} />, label: 'Fillet', shortcut: 'F', onClick: () => { setActiveTool('sketch-fillet' as Tool); setStatusMessage('Sketch Fillet: click near the corner of two intersecting lines'); } },
    { icon: <Minus size={MI} />, label: 'Linetype', onClick: () => { setActiveTool('linetype-convert' as Tool); setStatusMessage('Linetype Convert: click a line to cycle Normal → Construction → Centerline'); } },
    { icon: <Blend size={MI} />, label: 'Chamfer (Equal)', onClick: () => { setActiveTool('sketch-chamfer-equal' as Tool); setStatusMessage('Sketch Chamfer: click near a corner to chamfer — set distance in palette'); } },
    { icon: <Blend size={MI} />, label: 'Chamfer (Two Dist)', onClick: () => { setActiveTool('sketch-chamfer-two-dist' as Tool); setStatusMessage('Sketch Chamfer: click near a corner — set Dist 1 and Dist 2 in palette'); } },
    { icon: <Blend size={MI} />, label: 'Chamfer (Dist+Angle)', onClick: () => { setActiveTool('sketch-chamfer-dist-angle' as Tool); setStatusMessage('Sketch Chamfer: click near a corner — set Dist and Angle in palette'); } },
    { icon: <Blend size={MI} />, label: 'Blend Curve', onClick: () => { setActiveTool('blend-curve' as Tool); setStatusMessage('Blend Curve: click near an endpoint of a sketch entity, then click a second endpoint'); } },
    { icon: <Scissors size={MI} />, label: 'Trim', shortcut: 'T', onClick: () => { setActiveTool('trim' as Tool); setStatusMessage('Trim: click a segment portion to remove it'); } },
    { icon: <Move size={MI} />, label: 'Extend', onClick: () => { setActiveTool('extend' as Tool); setStatusMessage('Extend: click near an endpoint of a line to extend it to the nearest intersection'); } },
    { icon: <Scissors size={MI} />, label: 'Break', onClick: () => { setActiveTool('break' as Tool); setStatusMessage('Break: click on a line to split it at that point'); } },
    { separator: true, icon: <Copy size={MI} />, label: 'Offset', shortcut: 'O', onClick: () => { setActiveTool('sketch-offset' as Tool); setStatusMessage('Offset: click a line, then click the side to offset towards'); } },
    { icon: <FlipHorizontal size={MI} />, label: 'Mirror', onClick: () => { setActiveTool('sketch-mirror' as Tool); setStatusMessage('Mirror: select axis direction, then click OK'); } },
    { separator: true, icon: <Repeat size={MI} />, label: 'Circular Pattern', onClick: () => { setActiveTool('sketch-circ-pattern' as Tool); setStatusMessage('Circular Pattern: set count and angle, then click OK'); } },
    { icon: <Repeat size={MI} />, label: 'Rectangular Pattern', onClick: () => { setActiveTool('sketch-rect-pattern' as Tool); setStatusMessage('Rectangular Pattern: set counts and spacing, then click OK'); } },
    { icon: <Repeat size={MI} />, label: 'Pattern on Path', onClick: () => { setActiveTool('sketch-path-pattern' as Tool); setStatusMessage('Pattern on Path: select a path curve, set count, then click OK'); } },
    { separator: true, icon: <Move size={MI} />, label: 'Move', shortcut: 'M', onClick: () => { setActiveTool('sketch-move' as Tool); setStatusMessage('Move: set X/Y offset in plane-local coords, then click OK'); } },
    { icon: <Copy size={MI} />, label: 'Copy', onClick: () => { setActiveTool('sketch-copy' as Tool); setStatusMessage('Copy: set X/Y offset, then click OK to duplicate entities'); } },
    { icon: <Move size={MI} />, label: 'Scale', onClick: () => { setActiveTool('sketch-scale' as Tool); setStatusMessage('Scale: set factor about centroid, then click OK'); } },
    { icon: <RotateCcw size={MI} />, label: 'Rotate', onClick: () => { setActiveTool('sketch-rotate' as Tool); setStatusMessage('Rotate: set angle about centroid, then click OK'); } },
  ];

  const sketchConstraintMenuItems: MenuItem[] = [
    { icon: <Ruler size={MI} />, label: 'Sketch Dimension', shortcut: 'D', onClick: () => setActiveTool('dimension' as Tool) },
    { separator: true, icon: <AlignCenter size={MI} />, label: 'Coincident', onClick: () => { setActiveTool('constrain-coincident' as Tool); setStatusMessage('Coincident: click two entities to apply constraint'); } },
    { icon: <Minus size={MI} />, label: 'Collinear', onClick: () => { setActiveTool('constrain-collinear' as Tool); setStatusMessage('Collinear: click two lines to apply constraint'); } },
    { icon: <CircleDot size={MI} />, label: 'Concentric', onClick: () => { setActiveTool('constrain-concentric' as Tool); setStatusMessage('Concentric: click two circles/arcs to apply constraint'); } },
    { icon: <LocateFixed size={MI} />, label: 'Midpoint', onClick: () => { setActiveTool('constrain-midpoint' as Tool); setStatusMessage('Midpoint: click a point and a line to apply constraint'); } },
    { separator: true, icon: <ArrowLeftRight size={MI} />, label: 'Horizontal', onClick: () => { setActiveTool('constrain-horizontal' as Tool); setStatusMessage('Horizontal: click a line or two points to apply constraint'); } },
    { icon: <ArrowUpDown size={MI} />, label: 'Vertical', onClick: () => { setActiveTool('constrain-vertical' as Tool); setStatusMessage('Vertical: click a line or two points to apply constraint'); } },
    { icon: <CornerDownRight size={MI} />, label: 'Perpendicular', onClick: () => { setActiveTool('constrain-perpendicular' as Tool); setStatusMessage('Perpendicular: click two lines to apply constraint'); } },
    { icon: <Minus size={MI} />, label: 'Parallel', onClick: () => { setActiveTool('constrain-parallel' as Tool); setStatusMessage('Parallel: click two lines to apply constraint'); } },
    { icon: <Tangent size={MI} />, label: 'Tangent', onClick: () => { setActiveTool('constrain-tangent' as Tool); setStatusMessage('Tangent: click two curves to apply constraint'); } },
    { separator: true, icon: <Equal size={MI} />, label: 'Equal', onClick: () => { setActiveTool('constrain-equal' as Tool); setStatusMessage('Equal: click two entities to apply constraint'); } },
    { icon: <FlipHorizontal size={MI} />, label: 'Symmetric', onClick: () => { setActiveTool('constrain-symmetric' as Tool); setStatusMessage('Symmetric: click two entities and a symmetry line'); } },
    { icon: <Lock size={MI} />, label: 'Fix / Unfix', onClick: () => { setActiveTool('constrain-fix' as Tool); setStatusMessage('Fix: click an entity to fix its position'); } },
    { icon: <GitMerge size={MI} />, label: 'Curvature (G2)', onClick: () => { setActiveTool('constrain-curvature' as Tool); setStatusMessage('Curvature (G2): click two splines sharing a point to apply G2 continuity'); } },
    { separator: true, icon: <Zap size={MI} />, label: 'AutoConstrain', onClick: () => autoConstrainSketch() },
  ];

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="ribbon-toolbar">
      {/* ── Quick Access Bar (title bar) ── */}
      <QuickAccessBar
        fileInputRef={fileInputRef}
        loadFileInputRef={loadFileInputRef}
        onImport={handleImport}
      />

      {/* ── Workspace Selector + Tab Bar ── */}
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

      {/* ── Ribbon Content (tool icons in sections) ── */}
      <div className={`ribbon-content${inSketch ? ' sketch-ribbon' : ''}`}>

        {/* ═══════════════ DESIGN > SOLID TAB ═══════════════ */}
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

        {/* ═══════════════ DESIGN > SURFACE TAB ═══════════════ */}
        {!inSketch && workspace === 'design' && designTab === 'surface' && (
          <RibbonSurfaceTab />
        )}

        {/* ═══════════════ DESIGN > MESH TAB ═══════════════ */}
        {!inSketch && workspace === 'design' && designTab === 'mesh' && (
          <RibbonMeshTab
            meshInsertInputRef={meshInsertInputRef}
            onMeshInsert={handleMeshInsert}
          />
        )}

        {/* ═══════════════ DESIGN > FORM TAB ═══════════════ */}
        {!inSketch && workspace === 'design' && designTab === 'form' && (
          <RibbonFormTab />
        )}

{/* ═══════════════ DESIGN > MANAGE TAB ═══════════════ */}
        {!inSketch && workspace === 'design' && designTab === 'manage' && (
          <RibbonManageTab />
        )}

        {/* ═══════════════ DESIGN > UTILITIES TAB ═══════════════ */}
        {!inSketch && workspace === 'design' && designTab === 'utilities' && (
          <RibbonUtilitiesTab />
        )}

        {/* ═══════════════ SKETCH MODE ═══════════════ */}
        {inSketch && (
          <RibbonSketchMode
            sketchCreateMenuItems={sketchCreateMenuItems}
            sketchModifyMenuItems={sketchModifyMenuItems}
            sketchConstraintMenuItems={sketchConstraintMenuItems}
          />
        )}

        {/* ═══════════════ PREPARE WORKSPACE ═══════════════ */}
        {!inSketch && workspace === 'prepare' && (
          <RibbonPrepareTab prepareTab={prepareTab} />
        )}

        {/* ═══════════════ PRINTER WORKSPACE ═══════════════ */}
        {!inSketch && workspace === 'printer' && (
          <RibbonPrinterTab />
        )}

      </div>
    </div>
  );
}
