import { Box, ArrowUpFromLine, Scissors, Layers, MousePointer2 } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';

const ICON_LG = 28;

export function RibbonSheetMetalTab() {
  const openFlangeDialog = useCADStore((s) => s.openFlangeDialog);
  const openBendDialog = useCADStore((s) => s.openBendDialog);
  const openUnfoldDialog = useCADStore((s) => s.openUnfoldDialog);
  const openFlatPatternDialog = useCADStore((s) => s.openFlatPatternDialog);

  return (
    <>
      <RibbonSection title="CREATE">
        <ToolButton icon={<Box size={ICON_LG} />} label="Flange" onClick={openFlangeDialog} large colorClass="icon-teal" />
        <ToolButton icon={<ArrowUpFromLine size={ICON_LG} />} label="Bend" onClick={openBendDialog} large colorClass="icon-teal" />
      </RibbonSection>
      <RibbonSection title="MODIFY">
        <ToolButton icon={<Scissors size={ICON_LG} />} label="Unfold" onClick={openUnfoldDialog} large colorClass="icon-teal" />
        <ToolButton icon={<Layers size={ICON_LG} />} label="Flat Pattern" onClick={openFlatPatternDialog} large colorClass="icon-teal" />
      </RibbonSection>
      <RibbonSection title="SELECT">
        <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
      </RibbonSection>
    </>
  );
}
