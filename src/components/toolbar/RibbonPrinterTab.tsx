import * as React from 'react';
import {
  LayoutDashboard, Activity, Terminal, Play,
  History, FolderOpen, FlaskConical, FileCode,
  Grid3x3, Settings, Wifi, OctagonAlert, FileCode2, Plug,
  Router, TrendingUp, MonitorPlay, Camera, Gauge,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';

type PrinterTabKey =
  | 'dashboard' | 'camera' | 'status' | 'console' | 'job' | 'history'
  | 'analytics' | 'files' | 'filaments' | 'macros' | 'heightmap'
  | 'config' | 'network' | 'plugins' | 'calibration' | 'settings';

const PRINTER_TABS: { key: PrinterTabKey; label: string; Icon: React.ComponentType<{ size?: number }>; color: string }[] = [
  { key: 'dashboard',   label: 'Dashboard',   Icon: LayoutDashboard, color: 'icon-blue'   },
  { key: 'camera',      label: 'Camera',      Icon: Camera,          color: 'icon-teal'   },
  { key: 'status',      label: 'Status',      Icon: Activity,        color: 'icon-green'  },
  { key: 'console',     label: 'Console',     Icon: Terminal,        color: 'icon-gray'   },
  { key: 'job',         label: 'Job',         Icon: Play,            color: 'icon-orange' },
  { key: 'history',     label: 'History',     Icon: History,         color: 'icon-gray'   },
  { key: 'analytics',   label: 'Analytics',   Icon: TrendingUp,      color: 'icon-purple' },
  { key: 'files',       label: 'Files',       Icon: FolderOpen,      color: 'icon-blue'   },
  { key: 'filaments',   label: 'Filaments',   Icon: FlaskConical,    color: 'icon-teal'   },
  { key: 'macros',      label: 'Macros',      Icon: FileCode,        color: 'icon-orange' },
  { key: 'heightmap',   label: 'Height Map',  Icon: Grid3x3,         color: 'icon-green'  },
  { key: 'config',      label: 'Config',      Icon: FileCode2,       color: 'icon-gray'   },
  { key: 'network',     label: 'Network',     Icon: Router,          color: 'icon-teal'   },
  { key: 'plugins',     label: 'Plugins',     Icon: Plug,            color: 'icon-purple' },
  { key: 'calibration', label: 'Calibration', Icon: Gauge,           color: 'icon-orange' },
  { key: 'settings',    label: 'Settings',    Icon: Settings,        color: 'icon-gray'   },
];

export function RibbonPrinterTab() {
  const activeTab    = usePrinterStore((s) => s.activeTab);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);
  const showPrinter = usePrinterStore((s) => s.showPrinter);
  const setShowPrinter = usePrinterStore((s) => s.setShowPrinter);
  const connected    = usePrinterStore((s) => s.connected);
  const emergencyStop   = usePrinterStore((s) => s.emergencyStop);
  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const activePrinter = printers.find((printer) => printer.id === activePrinterId);
  const hasChosenPrinter = Boolean(activePrinter?.config.hostname.trim());
  const activePrinterPage = activeTab as string;
  const showSelectedPrinterTools = hasChosenPrinter && activePrinterPage !== 'printers';

  const navigate = (key: Parameters<typeof setActiveTab>[0]) => {
    setShowPrinter(true);
    setActiveTab(key);
  };

  const openPrintersPage = () => {
    setShowPrinter(true);
    setActiveTab('printers' as Parameters<typeof setActiveTab>[0]);
  };

  const handleEmergencyStop = () => {
    if (confirm('Send emergency stop (M112)? This will immediately halt the machine.')) {
      emergencyStop();
    }
  };

  return (
    <>
      <RibbonSection title="PRINTER">
        <ToolButton
          icon={<MonitorPlay size={22} />}
          label="Printers"
          active={showPrinter && activePrinterPage === 'printers'}
          onClick={openPrintersPage}
          large
          colorClass={connected ? 'icon-green' : 'icon-gray'}
        />
      </RibbonSection>

      {showSelectedPrinterTools && (
        <RibbonSection title="NAVIGATION">
          {PRINTER_TABS.map(({ key, label, Icon, color }) => (
            <ToolButton
              key={key}
              icon={<Icon size={22} />}
              label={label}
              active={activeTab === key}
              onClick={() => navigate(key as Parameters<typeof setActiveTab>[0])}
              large
              colorClass={color}
            />
          ))}
        </RibbonSection>
      )}

      {showSelectedPrinterTools && (
        <RibbonSection title="ACTIONS">
          {!connected && (
            <ToolButton
              icon={<Wifi size={22} />}
              label="Connect"
              onClick={() => navigate('settings')}
              large
              colorClass="icon-green"
            />
          )}
          <ToolButton
            icon={<OctagonAlert size={22} />}
            label="E-Stop"
            onClick={handleEmergencyStop}
            disabled={!connected}
            large
            colorClass="icon-red"
          />
        </RibbonSection>
      )}
    </>
  );
}
