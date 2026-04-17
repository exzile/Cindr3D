import {
  PenTool, ArrowUpFromLine, RotateCcw, CircleDot, Box,
  Blend, Scissors, Combine, Copy, Link2, Layers,
  Anchor, Expand, Axis3D, Ruler, FolderOpen,
  Image, Edit2, MousePointer2,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { useComponentStore } from '../../store/componentStore';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';
import type { MenuItem } from './toolbar.types';
import type { RefObject } from 'react';

interface RibbonSolidTabProps {
  createMenuItems: MenuItem[];
  modifyMenuItems: MenuItem[];
  assembleMenuItems: MenuItem[];
  constructMenuItems: MenuItem[];
  inspectMenuItems: MenuItem[];
  selectMenuItems: MenuItem[];
  beginSketchFlow: () => void;
  handleExtrude: () => void;
  handleRevolve: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
}

const ICON_LG = 28;
const ICON_SM = 18;

export function RibbonSolidTab({
  createMenuItems,
  modifyMenuItems,
  assembleMenuItems,
  constructMenuItems,
  inspectMenuItems,
  selectMenuItems,
  beginSketchFlow,
  handleExtrude,
  handleRevolve,
  fileInputRef,
}: RibbonSolidTabProps) {
  const activeTool = useCADStore((s) => s.activeTool);
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);
  const sketchPlaneSelecting = useCADStore((s) => s.sketchPlaneSelecting);
  const startSketch = useCADStore((s) => s.startSketch);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const openDecalDialog = useCADStore((s) => s.openDecalDialog);
  const openAttachedCanvasDialog = useCADStore((s) => s.openAttachedCanvasDialog);
  const openBoundingSolidDialog = useCADStore((s) => s.openBoundingSolidDialog);

  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const activeComponent = useComponentStore((s) =>
    s.activeComponentId ? s.components[s.activeComponentId] : undefined
  );
  const setComponentGrounded = useComponentStore((s) => s.setComponentGrounded);
  const toggleExplode = useComponentStore((s) => s.toggleExplode);
  const explodeActive = useComponentStore((s) => s.explodeActive);

  return (
    <>
      <RibbonSection title="CREATE" menuItems={createMenuItems} accentColor="#0078d7">
        <ToolButton
          icon={<PenTool size={ICON_LG} />}
          label="Sketch"
          large
          colorClass="icon-blue"
          active={sketchPlaneSelecting}
          dropdown={[
            { label: 'Select Plane (Interactive)', onClick: beginSketchFlow, icon: <PenTool size={14} /> },
            { label: 'Sketch on XY Plane', onClick: () => startSketch('XY'), icon: <PenTool size={14} /> },
            { label: 'Sketch on XZ Plane', onClick: () => startSketch('XZ'), icon: <PenTool size={14} /> },
            { label: 'Sketch on YZ Plane', onClick: () => startSketch('YZ'), icon: <PenTool size={14} /> },
          ]}
          onClick={beginSketchFlow}
        />
        <ToolButton icon={<ArrowUpFromLine size={ICON_LG} />} label="Extrude" onClick={handleExtrude} active={activeTool === 'extrude'} large colorClass="icon-blue" />
        <ToolButton icon={<RotateCcw size={ICON_LG} />} label="Revolve" onClick={handleRevolve} active={activeTool === 'revolve'} large colorClass="icon-blue" />
        <div className="ribbon-stack">
          <ToolButton icon={<CircleDot size={ICON_SM} />} label="Hole" onClick={() => useCADStore.getState().openHoleDialog()} colorClass="icon-blue" />
          <ToolButton icon={<Box size={ICON_SM} />} label="Shell" onClick={() => setActiveDialog('shell')} colorClass="icon-blue" />
        </div>
      </RibbonSection>

      <RibbonSection title="MODIFY" menuItems={modifyMenuItems} accentColor="#ff6b00">
        <ToolButton icon={<Blend size={ICON_LG} />} label="Fillet" tool="fillet" large colorClass="icon-orange" />
        <ToolButton icon={<Blend size={ICON_LG} />} label="Chamfer" tool="chamfer" large colorClass="icon-orange" />
        <div className="ribbon-stack">
          <ToolButton icon={<Scissors size={ICON_SM} />} label="Split" onClick={() => setActiveDialog('split')} colorClass="icon-orange" />
          <ToolButton icon={<Combine size={ICON_SM} />} label="Combine" onClick={() => setActiveDialog('combine')} colorClass="icon-orange" />
        </div>
      </RibbonSection>

      <RibbonSection title="ASSEMBLE" menuItems={assembleMenuItems} accentColor="#4caf50">
        <ToolButton icon={<Copy size={ICON_LG} />} label="Component" onClick={() => setStatusMessage('Use the Browser panel to add components')} large colorClass="icon-green" />
        <div className="ribbon-stack">
          <ToolButton icon={<Link2 size={ICON_SM} />} label="Joint" onClick={() => setActiveDialog('joint')} colorClass="icon-green" />
          <ToolButton icon={<Layers size={ICON_SM} />} label="Plane" onClick={() => setActiveDialog('construction-plane')} colorClass="icon-green" />
          {/* Ground toggle */}
          <ToolButton
            icon={<Anchor size={ICON_SM} />}
            label={activeComponent?.grounded ? 'Unground' : 'Ground'}
            colorClass="icon-green"
            active={activeComponent?.grounded}
            onClick={() => {
              if (!activeComponentId) return;
              const next = !(activeComponent?.grounded ?? false);
              setComponentGrounded(activeComponentId, next);
              setStatusMessage(`${activeComponent?.name ?? 'Component'}: ${next ? 'Grounded' : 'Ungrounded'}`);
            }}
          />
          {/* Exploded View */}
          <ToolButton
            icon={<Expand size={ICON_SM} />}
            label="Exploded View"
            colorClass="icon-green"
            active={explodeActive}
            onClick={toggleExplode}
          />
        </div>
      </RibbonSection>

      <RibbonSection title="CONSTRUCT" menuItems={constructMenuItems} accentColor="#7b1fa2">
        <div className="ribbon-stack">
          <ToolButton icon={<Layers size={ICON_SM} />} label="Plane" onClick={() => setActiveDialog('construction-plane')} colorClass="icon-purple" />
          <ToolButton icon={<Axis3D size={ICON_SM} />} label="Axis" onClick={() => setStatusMessage('Click two points to define an axis')} colorClass="icon-purple" />
        </div>
      </RibbonSection>

      <RibbonSection title="INSPECT" menuItems={inspectMenuItems} accentColor="#00897b">
        <ToolButton icon={<Ruler size={ICON_LG} />} label="Measure" tool="measure" large colorClass="icon-teal" />
      </RibbonSection>

      <RibbonSection title="INSERT">
        <ToolButton icon={<FolderOpen size={ICON_LG} />} label="Import" onClick={() => fileInputRef.current?.click()} large colorClass="icon-gray" />
        <div className="ribbon-stack">
          <ToolButton icon={<Image size={ICON_SM} />} label="Decal" onClick={openDecalDialog} colorClass="icon-gray" />
          <ToolButton icon={<Edit2 size={ICON_SM} />} label="Attached Canvas" onClick={() => openAttachedCanvasDialog()} colorClass="icon-gray" />
          <ToolButton icon={<Box size={ICON_SM} />} label="Bounding Solid" onClick={openBoundingSolidDialog} colorClass="icon-gray" />
        </div>
      </RibbonSection>

      <RibbonSection title="SELECT" menuItems={selectMenuItems} accentColor="#0078d7">
        <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
      </RibbonSection>
    </>
  );
}
