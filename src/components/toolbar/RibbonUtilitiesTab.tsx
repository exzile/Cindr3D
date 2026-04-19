import {
  BarChart2, Printer, Download, Pipette,
  Eye, EyeOff, Plug, PlugZap, MonitorSmartphone,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { usePrinterStore } from '../../store/printerStore';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';

const ICON_LG = 28;
const ICON_SM = 18;

export function RibbonUtilitiesTab() {
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const setShowExportDialog = useCADStore((s) => s.setShowExportDialog);
  const openBOMDialog = useCADStore((s) => s.openBOMDialog);
  const showAllFeatures = useCADStore((s) => s.showAllFeatures);
  const hideFeature = useCADStore((s) => s.hideFeature);
  const selectedFeatureId = useCADStore((s) => s.selectedFeatureId);

  const showPrinter = usePrinterStore((s) => s.showPrinter);
  const setShowPrinter = usePrinterStore((s) => s.setShowPrinter);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);
  const printerConnected = usePrinterStore((s) => s.connected);

  return (
    <>
      <RibbonSection title="INSPECT">
        <ToolButton icon={<BarChart2 size={ICON_LG} />} label="Bill of Materials" onClick={openBOMDialog} large colorClass="icon-green" />
      </RibbonSection>
      <RibbonSection title="MAKE">
        <ToolButton icon={<Printer size={ICON_LG} />} label="3D Print" onClick={() => setShowExportDialog(true)} large colorClass="icon-gray" />
        <ToolButton icon={<Download size={ICON_LG} />} label="Export" onClick={() => setShowExportDialog(true)} large colorClass="icon-gray" />
      </RibbonSection>
      <RibbonSection title="DISPLAY">
        <ToolButton icon={<Pipette size={ICON_LG} />} label="Appearance" onClick={() => setStatusMessage('Select a body to change materials')} large colorClass="icon-gray" />
        <div className="ribbon-stack">
          <ToolButton icon={<Eye size={ICON_SM} />} label="Show All" onClick={() => showAllFeatures()} colorClass="icon-gray" />
          <ToolButton
            icon={<EyeOff size={ICON_SM} />}
            label="Hide"
            onClick={() => {
              if (selectedFeatureId) hideFeature(selectedFeatureId);
              else setStatusMessage('Hide: select a feature first');
            }}
            colorClass="icon-gray"
          />
        </div>
      </RibbonSection>
      <RibbonSection title="3D PRINTER">
        <ToolButton
          icon={printerConnected ? <PlugZap size={ICON_LG} /> : <Plug size={ICON_LG} />}
          label={printerConnected ? 'Connected' : 'Connect'}
          active={printerConnected}
          onClick={() => { setShowPrinter(true); setActiveTab('settings'); }}
          large
          colorClass="icon-green"
        />
        {printerConnected && (
          <ToolButton
            icon={<MonitorSmartphone size={ICON_LG} />}
            label="Monitor"
            active={showPrinter}
            onClick={() => setShowPrinter(!showPrinter)}
            large
            colorClass="icon-green"
          />
        )}
      </RibbonSection>
    </>
  );
}
