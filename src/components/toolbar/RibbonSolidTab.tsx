import {
  PenTool, ArrowUpFromLine, RotateCcw,
  Blend, Copy, Layers,
  Axis3D, Ruler, FolderOpen,
  Image, Edit2, MousePointer2, Box,
  Wrench, FileCode, Boxes, SlidersHorizontal,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';
import type { MenuItem } from '../../types/toolbar.types';
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
const MI = 16; // menu item icon size

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
  const activeDialog = useCADStore((s) => s.activeDialog);
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);
  const sketchPlaneSelecting = useCADStore((s) => s.sketchPlaneSelecting);
  const startSketch = useCADStore((s) => s.startSketch);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const openDecalDialog = useCADStore((s) => s.openDecalDialog);
  const openAttachedCanvasDialog = useCADStore((s) => s.openAttachedCanvasDialog);
  const openBoundingSolidDialog = useCADStore((s) => s.openBoundingSolidDialog);
  const designConfigurations = useCADStore((s) => s.designConfigurations);
  const activeDesignConfigurationId = useCADStore((s) => s.activeDesignConfigurationId);
  const switchDesignConfiguration = useCADStore((s) => s.switchDesignConfiguration);

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
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, minWidth: 112 }}>
          <select
            aria-label="Design configuration"
            value={activeDesignConfigurationId}
            onChange={(event) => switchDesignConfiguration(event.target.value)}
            style={{ height: 24, fontSize: 11 }}
          >
            {designConfigurations.map((configuration) => (
              <option key={configuration.id} value={configuration.id}>{configuration.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setActiveDialog('design-configurations')}
            style={{ height: 22, fontSize: 11 }}
          >
            Configurations
          </button>
        </div>
      </RibbonSection>

      <RibbonSection title="MODIFY" menuItems={modifyMenuItems} accentColor="#ff6b00">
        <ToolButton icon={<Blend size={ICON_LG} />} label="Fillet" onClick={() => setActiveDialog('fillet')} active={activeDialog === 'fillet'} large colorClass="icon-orange" />
        <ToolButton icon={<Blend size={ICON_LG} />} label="Chamfer" onClick={() => setActiveDialog('chamfer')} active={activeDialog === 'chamfer'} large colorClass="icon-orange" />
      </RibbonSection>

      <RibbonSection title="ASSEMBLE" menuItems={assembleMenuItems} accentColor="#4caf50">
        <ToolButton icon={<Copy size={ICON_LG} />} label="Component" onClick={() => setStatusMessage('Use the Browser panel to add components')} large colorClass="icon-green" />
      </RibbonSection>

      <RibbonSection title="CONSTRUCT" menuItems={constructMenuItems} accentColor="#7b1fa2">
        <ToolButton icon={<Layers size={ICON_LG} />} label="Plane" onClick={() => setActiveDialog('construction-plane')} large colorClass="icon-purple" />
        <ToolButton icon={<Axis3D size={ICON_LG} />} label="Axis" onClick={() => setStatusMessage('Click two points to define an axis')} large colorClass="icon-purple" />
      </RibbonSection>

      <RibbonSection title="INSPECT" menuItems={inspectMenuItems} accentColor="#00897b">
        <ToolButton icon={<Ruler size={ICON_LG} />} label="Measure" tool="measure" large colorClass="icon-teal" />
      </RibbonSection>

      <RibbonSection title="INSERT" menuItems={[
        { icon: <Image size={MI} />, label: 'Decal', onClick: openDecalDialog },
        { icon: <Edit2 size={MI} />, label: 'Attached Canvas', onClick: () => openAttachedCanvasDialog() },
        { icon: <Box size={MI} />, label: 'Bounding Solid', onClick: openBoundingSolidDialog },
        { icon: <Boxes size={MI} />, label: 'Parametric Library', onClick: () => setActiveDialog('parametric-library') },
        { icon: <SlidersHorizontal size={MI} />, label: 'Design Configurations', onClick: () => setActiveDialog('design-configurations') },
        { icon: <Wrench size={MI} />, label: 'Insert Fastener', onClick: () => setActiveDialog('insert-fastener') },
        { icon: <FileCode size={MI} />, label: 'Derive', onClick: () => setActiveDialog('derive') },
      ]}>
        <ToolButton icon={<FolderOpen size={ICON_LG} />} label="Import" onClick={() => fileInputRef.current?.click()} large colorClass="icon-gray" />
      </RibbonSection>

      <RibbonSection title="SELECT" menuItems={selectMenuItems} accentColor="#0078d7">
        <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
      </RibbonSection>
    </>
  );
}
