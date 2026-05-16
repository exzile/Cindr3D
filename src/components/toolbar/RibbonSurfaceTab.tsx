import {
  PenTool, ArrowUpFromLine, RotateCcw, Spline, Layers, Diamond,
  Grid3X3, ZoomOut, Scissors, FlipHorizontal, Link, Unlink,
  SplitSquareHorizontal, RefreshCw, Combine, Trash2,
  MousePointer2, MoveRight, Grid3x3, Blend,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';

const ICON_LG = 28;

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

  return (
    <>
      <RibbonSection title="CREATE">
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
      <RibbonSection title="MODIFY">
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
