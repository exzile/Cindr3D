import {
  Diamond, Repeat, FlipHorizontal, Move, RotateCw,
  Maximize2, AlignCenter, Grid3X3, Magnet,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';
import type { MenuItem } from '../../types/toolbar.types';

const ICON_LG = 28;
const MI = 16;

export function RibbonManageTab() {
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);
  const activeDialog = useCADStore((s) => s.activeDialog);
  const setActiveTool = useCADStore((s) => s.setActiveTool);
  const gridVisible = useCADStore((s) => s.gridVisible);
  const setGridVisible = useCADStore((s) => s.setGridVisible);
  const snapEnabled = useCADStore((s) => s.snapEnabled);
  const setSnapEnabled = useCADStore((s) => s.setSnapEnabled);

  const patternMenuItems: MenuItem[] = [
    { icon: <Repeat size={MI} />, ribbonIcon: <Repeat size={ICON_LG} />, ribbonColorClass: 'icon-teal', promoteToRibbon: true, label: 'Linear', onClick: () => setActiveDialog('linear-pattern') },
    { icon: <Repeat size={MI} />, ribbonIcon: <Repeat size={ICON_LG} />, ribbonColorClass: 'icon-teal', promoteToRibbon: true, label: 'Rectangular', onClick: () => setActiveDialog('rectangular-pattern') },
    { icon: <Repeat size={MI} />, ribbonIcon: <Repeat size={ICON_LG} />, ribbonColorClass: 'icon-teal', promoteToRibbon: true, label: 'Circular', onClick: () => setActiveDialog('circular-pattern') },
    { icon: <FlipHorizontal size={MI} />, ribbonIcon: <FlipHorizontal size={ICON_LG} />, ribbonColorClass: 'icon-teal', promoteToRibbon: true, label: 'Mirror', onClick: () => setActiveDialog('mirror') },
  ];

  const transformMenuItems: MenuItem[] = [
    { icon: <Move size={MI} />, ribbonIcon: <Move size={ICON_LG} />, ribbonColorClass: 'icon-purple', ribbonTool: 'move', promoteToRibbon: true, label: 'Move', onClick: () => setActiveTool('move') },
    { icon: <RotateCw size={MI} />, ribbonIcon: <RotateCw size={ICON_LG} />, ribbonColorClass: 'icon-purple', ribbonTool: 'rotate', promoteToRibbon: true, label: 'Rotate', onClick: () => setActiveTool('rotate') },
    { icon: <Maximize2 size={MI} />, ribbonIcon: <Maximize2 size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Scale', onClick: () => setActiveDialog('scale') },
    { icon: <AlignCenter size={MI} />, ribbonIcon: <AlignCenter size={ICON_LG} />, ribbonColorClass: 'icon-purple', ribbonTool: 'align', promoteToRibbon: true, label: 'Align', onClick: () => setActiveTool('align') },
  ];

  const displayMenuItems: MenuItem[] = [
    { icon: <Grid3X3 size={MI} />, ribbonIcon: <Grid3X3 size={ICON_LG} />, ribbonColorClass: 'icon-blue', promoteToRibbon: true, label: 'Grid', checked: gridVisible, onClick: () => setGridVisible(!gridVisible) },
    { icon: <Magnet size={MI} />, ribbonIcon: <Magnet size={ICON_LG} />, ribbonColorClass: 'icon-blue', promoteToRibbon: true, label: 'Snap', checked: snapEnabled, onClick: () => setSnapEnabled(!snapEnabled) },
  ];

  return (
    <>
      <RibbonSection title="PARAMETERS">
        <ToolButton
          icon={<Diamond size={ICON_LG} />}
          label="Parameters"
          onClick={() => setActiveDialog('parameters')}
          active={activeDialog === 'parameters'}
          large
          colorClass="icon-teal"
        />
      </RibbonSection>
      <RibbonSection title="PATTERN" menuItems={patternMenuItems} accentColor="#00897b" maxVisible={4}>
        <ToolButton icon={<Repeat size={ICON_LG} />} label="Linear" onClick={() => setActiveDialog('linear-pattern')} active={activeDialog === 'linear-pattern'} large colorClass="icon-teal" />
        <ToolButton icon={<Repeat size={ICON_LG} />} label="Rectangular" onClick={() => setActiveDialog('rectangular-pattern')} active={activeDialog === 'rectangular-pattern'} large colorClass="icon-teal" />
        <ToolButton icon={<Repeat size={ICON_LG} />} label="Circular" onClick={() => setActiveDialog('circular-pattern')} active={activeDialog === 'circular-pattern'} large colorClass="icon-teal" />
        <ToolButton icon={<FlipHorizontal size={ICON_LG} />} label="Mirror" onClick={() => setActiveDialog('mirror')} active={activeDialog === 'mirror'} large colorClass="icon-teal" />
      </RibbonSection>
      <RibbonSection title="TRANSFORM" menuItems={transformMenuItems} accentColor="#7b1fa2" maxVisible={4}>
        <ToolButton icon={<Move size={ICON_LG} />} label="Move" tool="move" large colorClass="icon-purple" />
        <ToolButton icon={<RotateCw size={ICON_LG} />} label="Rotate" tool="rotate" large colorClass="icon-purple" />
        <ToolButton icon={<Maximize2 size={ICON_LG} />} label="Scale" onClick={() => setActiveDialog('scale')} active={activeDialog === 'scale'} large colorClass="icon-purple" />
        <ToolButton icon={<AlignCenter size={ICON_LG} />} label="Align" tool="align" large colorClass="icon-purple" />
      </RibbonSection>
      <RibbonSection title="DISPLAY" menuItems={displayMenuItems} accentColor="#0078d7" maxVisible={2}>
        <ToolButton icon={<Grid3X3 size={ICON_LG} />} label="Grid" active={gridVisible} onClick={() => setGridVisible(!gridVisible)} large colorClass="icon-blue" />
        <ToolButton icon={<Magnet size={ICON_LG} />} label="Snap" active={snapEnabled} onClick={() => setSnapEnabled(!snapEnabled)} large colorClass="icon-blue" />
      </RibbonSection>
    </>
  );
}
