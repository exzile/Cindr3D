import {
  Activity,
  AlertCircle,
  AlertTriangle,
  AlignCenter,
  Anchor,
  ArrowRight,
  ArrowUp,
  ArrowUpFromLine,
  Axis3D,
  BarChart2,
  Blend,
  Box,
  Circle,
  CircleDot,
  Combine,
  Copy,
  Diamond,
  Download,
  Expand,
  Eye,
  FlipHorizontal,
  GitFork,
  GitMerge,
  Globe,
  Grid,
  Hexagon,
  Image,
  Layers,
  Link2,
  LocateFixed,
  MapPin,
  Minus,
  Move,
  Package,
  PenTool,
  Pencil,
  Pipette,
  Repeat,
  RotateCcw,
  Ruler,
  Scissors,
  Shield,
  Spline,
  Square,
  Target,
  Trash2,
  TrendingDown,
  Wrench,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import type { MenuItem } from '../../types/toolbar.types';
import type { DesignMenuDeps } from './menuBuilderTypes';

const MI = 16;

export function buildDesignMenus({
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
  setActiveAnalysis,
  setActiveDialog,
  setActiveTool,
  setComponentGrounded,
  setSectionEnabled,
  setStatusMessage,
  startExtrudeTool,
  startLoftTool,
  startPatchTool,
  startRibTool,
  startSweepTool,
  toggleExplode,
}: DesignMenuDeps) {
  const createMenuItems: MenuItem[] = [
    { icon: <Package size={MI} />, label: 'New Component', onClick: handleNewComponent },
    { icon: <Package size={MI} />, label: 'Create Base Feature', onClick: () => setActiveDialog('base-feature') },
    { icon: <PenTool size={MI} />, label: 'Create Sketch', shortcut: 'S', onClick: () => useCADStore.getState().setSketchPlaneSelecting(true) },
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
    { separator: true, icon: <Move size={MI} />, label: 'Move/Copy', shortcut: 'M', onClick: () => setActiveTool('move') },
    { icon: <Move size={MI} />, label: 'Move/Copy Body', onClick: () => setActiveDialog('move-body') },
    { icon: <AlignCenter size={MI} />, label: 'Align', onClick: () => setActiveDialog('align-dialog') },
    {
      icon: <Trash2 size={MI} />,
      label: 'Delete',
      shortcut: 'Del',
      onClick: () => {
        if (selectedFeatureId) {
          removeFeature(selectedFeatureId);
          setStatusMessage('Feature deleted');
        } else {
          setStatusMessage('Select a feature to delete');
        }
      },
    },
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
    { icon: <MapPin size={MI} />, label: 'Joint Origin', onClick: openJointOriginDialog },
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
        const grounded = !(activeComponent?.grounded ?? false);
        setComponentGrounded(activeComponentId, grounded);
        setStatusMessage(`${activeComponent?.name ?? 'Component'}: ${grounded ? 'Grounded' : 'Ungrounded'}`);
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
    { separator: true, icon: <LocateFixed size={MI} />, label: 'Point at Vertex', onClick: () => { setActiveTool('construct-point-vertex'); setStatusMessage('Point at Vertex: click a vertex to create a construction point'); } },
    { icon: <Target size={MI} />, label: 'Point Through Two Edges', onClick: () => { setActiveTool('construct-point-two-edges'); setStatusMessage('Point Through Two Edges: click first edge, then second edge'); } },
    { icon: <Target size={MI} />, label: 'Point Through Three Planes', onClick: () => { setActiveTool('construct-point-three-planes'); setStatusMessage('Point Through Three Planes: select three construction planes in the panel'); } },
    { icon: <CircleDot size={MI} />, label: 'Point at Center of Circle/Sphere/Torus', onClick: () => { setActiveTool('construct-point-center'); setStatusMessage('Point at Center: click a circular face to create a point at its center'); } },
    { icon: <CircleDot size={MI} />, label: 'Point At Edge And Plane', onClick: () => setActiveDialog('point-at-edge-plane') },
    { icon: <CircleDot size={MI} />, label: 'Point Along Path', onClick: () => setActiveDialog('point-along-path') },
  ];

  const inspectMenuItems: MenuItem[] = [
    { icon: <Ruler size={MI} />, label: 'Measure', shortcut: 'I', onClick: () => { setActiveTool('measure'); setStatusMessage('Measure: click two points or entities to measure distance'); } },
    { icon: <AlertTriangle size={MI} />, label: 'Interference', onClick: openInterferenceDialog },
    { separator: true, icon: <BarChart2 size={MI} />, label: 'Curvature Comb Analysis', onClick: () => setActiveAnalysis('curvature-comb') },
    { icon: <Layers size={MI} />, label: 'Zebra Analysis', onClick: () => setActiveAnalysis('zebra') },
    { icon: <TrendingDown size={MI} />, label: 'Draft Analysis', onClick: () => setActiveAnalysis('draft') },
    { icon: <Activity size={MI} />, label: 'Curvature Map Analysis', onClick: () => setActiveAnalysis('curvature-map') },
    { icon: <Grid size={MI} />, label: 'Isocurve Analysis', onClick: () => setActiveAnalysis('isocurve') },
    { icon: <Eye size={MI} />, label: 'Accessibility Analysis', onClick: () => setActiveAnalysis('accessibility') },
    { icon: <AlertCircle size={MI} />, label: 'Minimum Radius Analysis', onClick: () => setActiveAnalysis('min-radius') },
    { icon: <Scissors size={MI} />, label: 'Section Analysis', onClick: () => setSectionEnabled(true) },
    {
      icon: <Target size={MI} />,
      label: 'Center of Mass',
      onClick: () => {
        const features = useCADStore.getState().features.filter((feature) => feature.visible && feature.type === 'primitive');
        if (features.length === 0) {
          setStatusMessage('No primitive bodies visible — Center of Mass: (0, 0, 0) mm');
          return;
        }
        const sum = features.reduce((acc, feature) => {
          const params = feature.params as Record<string, number>;
          return { x: acc.x + (params.x ?? 0), y: acc.y + (params.y ?? 0), z: acc.z + (params.z ?? 0) };
        }, { x: 0, y: 0, z: 0 });
        setStatusMessage(`Center of Mass (approx): X=${(sum.x / features.length).toFixed(2)} Y=${(sum.y / features.length).toFixed(2)} Z=${(sum.z / features.length).toFixed(2)} mm`);
      },
    },
    {
      separator: true,
      icon: <Pipette size={MI} />,
      label: 'Display Component Colors',
      shortcut: 'Shift+N',
      checked: useCADStore.getState().showComponentColors,
      onClick: () => {
        const state = useCADStore.getState();
        state.setShowComponentColors(!state.showComponentColors);
        state.setStatusMessage(state.showComponentColors ? 'Component colors: OFF' : 'Component colors: ON');
      },
    },
  ];

  return { createMenuItems, modifyMenuItems, assembleMenuItems, constructMenuItems, inspectMenuItems };
}
