import * as React from 'react';
import {
  LayoutDashboard, Activity, Terminal, Play,
  History, FolderOpen, FlaskConical, FileCode,
  Grid3x3, Braces, Settings, Wifi, OctagonAlert, FileCode2, Plug,
  Router, TrendingUp, MonitorPlay, Camera, Gauge,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';

type PrinterTabKey =
  | 'dashboard' | 'camera' | 'status' | 'console' | 'job' | 'history'
  | 'analytics' | 'files' | 'filaments' | 'macros' | 'heightmap'
  | 'model' | 'config' | 'network' | 'plugins' | 'calibration' | 'settings';

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
  { key: 'model',       label: 'Model',       Icon: Braces,          color: 'icon-blue'   },
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
      <div className="ribbon-section">
        <div className="ribbon-section-content">
          <button
            className={`ribbon-button large ${showPrinter && activePrinterPage === 'printers' ? 'active' : ''}`}
            onClick={openPrintersPage}
            title="Choose or monitor printers"
          >
            <div className={`ribbon-button-icon ${connected ? 'icon-green' : 'icon-gray'}`}>
              <MonitorPlay size={22} />
            </div>
            <span className="ribbon-button-label">Printers</span>
          </button>
        </div>
        <div className="ribbon-section-label">Printer</div>
      </div>

      {showSelectedPrinterTools && (
        <div className="ribbon-section">
          <div className="ribbon-section-content">
            {PRINTER_TABS.map(({ key, label, Icon, color }) => (
              <button
                key={key}
                className={`ribbon-button large ${activeTab === key ? 'active' : ''}`}
                onClick={() => navigate(key as Parameters<typeof setActiveTab>[0])}
                title={label}
              >
                <div className={`ribbon-button-icon ${color}`}>
                  <Icon size={22} />
                </div>
                <span className="ribbon-button-label">{label}</span>
              </button>
            ))}
          </div>
          <div className="ribbon-section-label">Navigation</div>
        </div>
      )}

      {showSelectedPrinterTools && (
        <div className="ribbon-section">
          <div className="ribbon-section-content">
            {!connected && (
              <button
                className="ribbon-button large"
                title="Connect to printer"
                onClick={() => navigate('settings')}
              >
                <div className="ribbon-button-icon icon-green">
                  <Wifi size={22} />
                </div>
                <span className="ribbon-button-label">Connect</span>
              </button>
            )}
            <button
              className="ribbon-button large"
              title={connected ? 'Emergency Stop (M112)' : 'Connect to a printer before using E-stop'}
              onClick={handleEmergencyStop}
              disabled={!connected}
            >
              <div className="ribbon-button-icon icon-red">
                <OctagonAlert size={22} />
              </div>
              <span className="ribbon-button-label">E-Stop</span>
            </button>
          </div>
          <div className="ribbon-section-label">Actions</div>
        </div>
      )}
    </>
  );
}
