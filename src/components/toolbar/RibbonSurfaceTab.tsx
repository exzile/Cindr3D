import {
  PenTool, ArrowUpFromLine, RotateCcw, Spline, Layers, Diamond,
  Grid3X3, ZoomOut, Scissors, FlipHorizontal, Link, Unlink,
  SplitSquareHorizontal, RefreshCw, Combine, Trash2,
  MousePointer2, MoveRight, Grid3x3, Blend,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';
import type { MenuItem } from '../../types/toolbar.types';

const ICON_LG = 28;
const MI = 16;

export function RibbonSurfaceTab() {
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);
  const activeDialog = useCADStore((s) => s.activeDialog);
  const activeTool = useCADStore((s) => s.activeTool);
  const startExtrudeTool = useCADStore((s) => s.startExtrudeTool);
  const startRevolveTool = useCADStore((s) => s.startRevolveTool);
  const startSweepTool = useCADStore((s) => s.startSweepTool);
  const startLoftTool = useCADStore((s) => s.startLoftTool);
  const startPatchTool = useCADStore((s) => s.startPatchTool);
  const startRuledSurfaceTool = useCADStore((s) => s.startRuledSurfaceTool);
  const openFillDialog = useCADStore((s) => s.openFillDialog);
  const openOffsetCurveDialog = useCADStore((s) => s.openOffsetCurveDialog);
  const openSurfaceMergeDialog = useCADStore((s) => s.openSurfaceMergeDialog);
  const openDeleteFaceDialog = useCADStore((s) => s.openDeleteFaceDialog);
  const openSurfacePrimitivesDialog = useCADStore((s) => s.openSurfacePrimitivesDialog);
  const setSketchPlaneSelecting = useCADStore((s) => s.setSketchPlaneSelecting);

  const createMenuItems: MenuItem[] = [
    { icon: <PenTool size={MI} />, ribbonIcon: <PenTool size={ICON_LG} />, ribbonColorClass: 'icon-blue', label: 'Sketch', onClick: () => setSketchPlaneSelecting(true) },
    { icon: <ArrowUpFromLine size={MI} />, ribbonIcon: <ArrowUpFromLine size={ICON_LG} />, ribbonColorClass: 'icon-green', ribbonTool: 'extrude', promoteToRibbon: true, label: 'Extrude', onClick: startExtrudeTool },
    { icon: <RotateCcw size={MI} />, ribbonIcon: <RotateCcw size={ICON_LG} />, ribbonColorClass: 'icon-green', ribbonTool: 'revolve', promoteToRibbon: true, label: 'Revolve', onClick: startRevolveTool },
    { icon: <Spline size={MI} />, ribbonIcon: <Spline size={ICON_LG} />, ribbonColorClass: 'icon-green', ribbonTool: 'sweep', promoteToRibbon: true, label: 'Sweep', onClick: startSweepTool },
    { icon: <Layers size={MI} />, ribbonIcon: <Layers size={ICON_LG} />, ribbonColorClass: 'icon-green', ribbonTool: 'loft', promoteToRibbon: true, label: 'Loft', onClick: startLoftTool },
    { icon: <Diamond size={MI} />, ribbonIcon: <Diamond size={ICON_LG} />, ribbonColorClass: 'icon-green', ribbonTool: 'patch', promoteToRibbon: true, label: 'Patch', onClick: startPatchTool },
    { icon: <Grid3X3 size={MI} />, ribbonIcon: <Grid3X3 size={ICON_LG} />, ribbonColorClass: 'icon-green', ribbonTool: 'ruled-surface', promoteToRibbon: true, label: 'Ruled Surface', onClick: startRuledSurfaceTool },
    { icon: <Layers size={MI} />, ribbonIcon: <Layers size={ICON_LG} />, ribbonColorClass: 'icon-green', promoteToRibbon: true, label: 'Fill', onClick: openFillDialog },
    { icon: <MoveRight size={MI} />, ribbonIcon: <MoveRight size={ICON_LG} />, ribbonColorClass: 'icon-green', promoteToRibbon: true, label: 'Offset Curve', onClick: openOffsetCurveDialog },
    { icon: <Grid3x3 size={MI} />, ribbonIcon: <Grid3x3 size={ICON_LG} />, ribbonColorClass: 'icon-green', promoteToRibbon: true, label: 'Primitives', onClick: openSurfacePrimitivesDialog },
  ];

  const modifyMenuItems: MenuItem[] = [
    { icon: <Blend size={MI} />, ribbonIcon: <Blend size={ICON_LG} />, ribbonColorClass: 'icon-orange', promoteToRibbon: true, label: 'Fillet', onClick: () => setActiveDialog('fillet') },
    { icon: <ZoomOut size={MI} />, ribbonIcon: <ZoomOut size={ICON_LG} />, ribbonColorClass: 'icon-orange', promoteToRibbon: true, label: 'Offset Surface', onClick: () => setActiveDialog('offset-surface') },
    { icon: <Scissors size={MI} />, ribbonIcon: <Scissors size={ICON_LG} />, ribbonColorClass: 'icon-orange', promoteToRibbon: true, label: 'Trim', onClick: () => setActiveDialog('surface-trim') },
    { icon: <FlipHorizontal size={MI} />, ribbonIcon: <FlipHorizontal size={ICON_LG} />, ribbonColorClass: 'icon-orange', promoteToRibbon: true, label: 'Extend', onClick: () => setActiveDialog('surface-extend') },
    { icon: <Link size={MI} />, ribbonIcon: <Link size={ICON_LG} />, ribbonColorClass: 'icon-orange', promoteToRibbon: true, label: 'Stitch', onClick: () => setActiveDialog('stitch') },
    { icon: <Unlink size={MI} />, ribbonIcon: <Unlink size={ICON_LG} />, ribbonColorClass: 'icon-orange', promoteToRibbon: true, label: 'Unstitch', onClick: () => setActiveDialog('unstitch') },
    { icon: <SplitSquareHorizontal size={MI} />, ribbonIcon: <SplitSquareHorizontal size={ICON_LG} />, ribbonColorClass: 'icon-orange', promoteToRibbon: true, label: 'Surface Split', onClick: () => setActiveDialog('surface-split') },
    { icon: <RefreshCw size={MI} />, ribbonIcon: <RefreshCw size={ICON_LG} />, ribbonColorClass: 'icon-orange', promoteToRibbon: true, label: 'Reverse Normal', onClick: () => setActiveDialog('reverse-normal') },
    { icon: <Layers size={MI} />, ribbonIcon: <Layers size={ICON_LG} />, ribbonColorClass: 'icon-orange', promoteToRibbon: true, label: 'Untrim', onClick: () => setActiveDialog('untrim') },
    { icon: <Combine size={MI} />, ribbonIcon: <Combine size={ICON_LG} />, ribbonColorClass: 'icon-orange', promoteToRibbon: true, label: 'Merge', onClick: openSurfaceMergeDialog },
    { icon: <Trash2 size={MI} />, ribbonIcon: <Trash2 size={ICON_LG} />, ribbonColorClass: 'icon-orange', promoteToRibbon: true, label: 'Delete Face', onClick: openDeleteFaceDialog },
    { icon: <Layers size={MI} />, ribbonIcon: <Layers size={ICON_LG} />, ribbonColorClass: 'icon-orange', promoteToRibbon: true, label: 'Thicken', onClick: () => setActiveDialog('thicken') },
  ];

  return (
    <>
      <RibbonSection title="CREATE" menuItems={createMenuItems} accentColor="#1aa04a" maxVisible={5}>
        <ToolButton icon={<PenTool size={ICON_LG} />} label="Sketch" onClick={() => setSketchPlaneSelecting(true)} large colorClass="icon-blue" />
        <ToolButton icon={<ArrowUpFromLine size={ICON_LG} />} label="Extrude" onClick={startExtrudeTool} active={activeTool === 'extrude'} large colorClass="icon-green" />
        <ToolButton icon={<RotateCcw size={ICON_LG} />} label="Revolve" onClick={startRevolveTool} active={activeTool === 'revolve'} large colorClass="icon-green" />
        <ToolButton icon={<Spline size={ICON_LG} />} label="Sweep" onClick={startSweepTool} large colorClass="icon-green" />
        <ToolButton icon={<Layers size={ICON_LG} />} label="Loft" onClick={startLoftTool} large colorClass="icon-green" />
        <ToolButton icon={<Diamond size={ICON_LG} />} label="Patch" onClick={startPatchTool} large colorClass="icon-green" />
        <ToolButton icon={<Grid3X3 size={ICON_LG} />} label="Ruled Surface" onClick={startRuledSurfaceTool} large colorClass="icon-green" />
        <ToolButton icon={<Layers size={ICON_LG} />} label="Fill" onClick={openFillDialog} large colorClass="icon-green" />
        <ToolButton icon={<MoveRight size={ICON_LG} />} label="Offset Curve" onClick={openOffsetCurveDialog} large colorClass="icon-green" />
        <ToolButton icon={<Grid3x3 size={ICON_LG} />} label="Primitives" onClick={openSurfacePrimitivesDialog} large colorClass="icon-green" />
      </RibbonSection>
      <RibbonSection title="MODIFY" menuItems={modifyMenuItems} accentColor="#ff6b00" maxVisible={5}>
        <ToolButton icon={<Blend size={ICON_LG} />} label="Fillet" onClick={() => setActiveDialog('fillet')} active={activeDialog === 'fillet'} large colorClass="icon-orange" />
        <ToolButton icon={<ZoomOut size={ICON_LG} />} label="Offset Surface" onClick={() => setActiveDialog('offset-surface')} large colorClass="icon-orange" />
        <ToolButton icon={<Scissors size={ICON_LG} />} label="Trim" onClick={() => setActiveDialog('surface-trim')} large colorClass="icon-orange" />
        <ToolButton icon={<FlipHorizontal size={ICON_LG} />} label="Extend" onClick={() => setActiveDialog('surface-extend')} large colorClass="icon-orange" />
        <ToolButton icon={<Link size={ICON_LG} />} label="Stitch" onClick={() => setActiveDialog('stitch')} large colorClass="icon-orange" />
        <ToolButton icon={<Unlink size={ICON_LG} />} label="Unstitch" onClick={() => setActiveDialog('unstitch')} large colorClass="icon-orange" />
        <ToolButton icon={<SplitSquareHorizontal size={ICON_LG} />} label="Surface Split" onClick={() => setActiveDialog('surface-split')} large colorClass="icon-orange" />
        <ToolButton icon={<RefreshCw size={ICON_LG} />} label="Reverse Normal" onClick={() => setActiveDialog('reverse-normal')} large colorClass="icon-orange" />
        <ToolButton icon={<Layers size={ICON_LG} />} label="Untrim" onClick={() => setActiveDialog('untrim')} large colorClass="icon-orange" />
        <ToolButton icon={<Combine size={ICON_LG} />} label="Merge" onClick={openSurfaceMergeDialog} large colorClass="icon-orange" />
        <ToolButton icon={<Trash2 size={ICON_LG} />} label="Delete Face" onClick={openDeleteFaceDialog} large colorClass="icon-orange" />
        <ToolButton icon={<Layers size={ICON_LG} />} label="Thicken" onClick={() => setActiveDialog('thicken')} large colorClass="icon-orange" />
      </RibbonSection>
      <RibbonSection title="SELECT">
        <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
      </RibbonSection>
    </>
  );
}
