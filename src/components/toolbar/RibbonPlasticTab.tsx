import { Box, Zap, Layers, Blend, MousePointer2 } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';

const ICON_LG = 28;

export function RibbonPlasticTab() {
  const openBossDialog = useCADStore((s) => s.openBossDialog);
  const openSnapFitDialog = useCADStore((s) => s.openSnapFitDialog);
  const openLipGrooveDialog = useCADStore((s) => s.openLipGrooveDialog);
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);

  return (
    <>
      <RibbonSection title="CREATE">
        <ToolButton icon={<Box size={ICON_LG} />} label="Boss" onClick={openBossDialog} large colorClass="icon-blue" />
        <ToolButton icon={<Zap size={ICON_LG} />} label="Snap Fit" onClick={openSnapFitDialog} large colorClass="icon-blue" />
        <ToolButton icon={<Layers size={ICON_LG} />} label="Lip / Groove" onClick={openLipGrooveDialog} large colorClass="icon-blue" />
      </RibbonSection>
      <RibbonSection title="MODIFY">
        <ToolButton icon={<Blend size={ICON_LG} />} label="Draft" onClick={() => setActiveDialog('draft')} large colorClass="icon-blue" />
      </RibbonSection>
      <RibbonSection title="SELECT">
        <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
      </RibbonSection>
    </>
  );
}
