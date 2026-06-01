import {
  BarChart2, Download, Pipette,
  Eye, EyeOff,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';
import type { MenuItem } from '../../types/toolbar.types';

const ICON_LG = 28;
const MI = 16;

export function RibbonUtilitiesTab() {
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const setShowExportDialog = useCADStore((s) => s.setShowExportDialog);
  const openBOMDialog = useCADStore((s) => s.openBOMDialog);
  const showAllFeatures = useCADStore((s) => s.showAllFeatures);
  const hideFeature = useCADStore((s) => s.hideFeature);
  const selectedFeatureId = useCADStore((s) => s.selectedFeatureId);

  const changeAppearance = () => setStatusMessage('Select a body to change materials');
  const hideSelectedFeature = () => {
    if (selectedFeatureId) hideFeature(selectedFeatureId);
    else setStatusMessage('Hide: select a feature first');
  };

  const inspectMenuItems: MenuItem[] = [
    { icon: <BarChart2 size={MI} />, ribbonIcon: <BarChart2 size={ICON_LG} />, ribbonColorClass: 'icon-green', promoteToRibbon: true, label: 'Bill of Materials', onClick: openBOMDialog },
  ];

  const makeMenuItems: MenuItem[] = [
    { icon: <Download size={MI} />, ribbonIcon: <Download size={ICON_LG} />, ribbonColorClass: 'icon-teal', promoteToRibbon: true, label: 'Export', onClick: () => setShowExportDialog(true) },
  ];

  const displayMenuItems: MenuItem[] = [
    { icon: <Pipette size={MI} />, ribbonIcon: <Pipette size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Appearance', onClick: changeAppearance },
    { icon: <Eye size={MI} />, ribbonIcon: <Eye size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Show All', onClick: showAllFeatures },
    { icon: <EyeOff size={MI} />, ribbonIcon: <EyeOff size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Hide', onClick: hideSelectedFeature },
  ];

  return (
    <>
      <RibbonSection title="INSPECT" menuItems={inspectMenuItems} accentColor="#4caf50" maxVisible={1}>
        <ToolButton icon={<BarChart2 size={ICON_LG} />} label="Bill of Materials" onClick={openBOMDialog} large colorClass="icon-green" />
      </RibbonSection>
      <RibbonSection title="MAKE" menuItems={makeMenuItems} accentColor="#00897b" maxVisible={1}>
        <ToolButton icon={<Download size={ICON_LG} />} label="Export" onClick={() => setShowExportDialog(true)} large colorClass="icon-teal" />
      </RibbonSection>
      <RibbonSection title="DISPLAY" menuItems={displayMenuItems} accentColor="#7b1fa2" maxVisible={3}>
        <ToolButton icon={<Pipette size={ICON_LG} />} label="Appearance" onClick={changeAppearance} large colorClass="icon-purple" />
        <ToolButton icon={<Eye size={ICON_LG} />} label="Show All" onClick={showAllFeatures} large colorClass="icon-purple" />
        <ToolButton icon={<EyeOff size={ICON_LG} />} label="Hide" onClick={hideSelectedFeature} large colorClass="icon-purple" />
      </RibbonSection>
    </>
  );
}
