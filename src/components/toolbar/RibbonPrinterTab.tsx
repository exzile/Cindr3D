import * as React from 'react';
import {
  LayoutDashboard, Activity, Terminal, Play,
  History, FolderOpen, FlaskConical, FileCode,
  Grid3x3, Braces, Settings, Wifi, OctagonAlert,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';

type PrinterTabKey =
  | 'dashboard' | 'status' | 'console' | 'job' | 'history'
  | 'files' | 'filaments' | 'macros' | 'heightmap' | 'model' | 'settings';

const PRINTER_TABS: { key: PrinterTabKey; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'dashboard', label: 'Dashboard',  Icon: LayoutDashboard },
  { key: 'status',    label: 'Status',     Icon: Activity },
  { key: 'console',   label: 'Console',    Icon: Terminal },
  { key: 'job',       label: 'Job',        Icon: Play },
  { key: 'history',   label: 'History',    Icon: History },
  { key: 'files',     label: 'Files',      Icon: FolderOpen },
  { key: 'filaments', label: 'Filaments',  Icon: FlaskConical },
  { key: 'macros',    label: 'Macros',     Icon: FileCode },
  { key: 'heightmap', label: 'Height Map', Icon: Grid3x3 },
  { key: 'model',     label: 'Model',      Icon: Braces },
  { key: 'settings',  label: 'Settings',   Icon: Settings },
];

export function RibbonPrinterTab() {
  const activeTab    = usePrinterStore((s) => s.activeTab);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);
  const setShowPrinter = usePrinterStore((s) => s.setShowPrinter);
  const connected    = usePrinterStore((s) => s.connected);
  const emergencyStop   = usePrinterStore((s) => s.emergencyStop);

  const navigate = (key: Parameters<typeof setActiveTab>[0]) => {
    setShowPrinter(true);
    setActiveTab(key);
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
          {PRINTER_TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              className={`ribbon-button large ${activeTab === key ? 'active' : ''}`}
              onClick={() => navigate(key as Parameters<typeof setActiveTab>[0])}
              title={label}
            >
              <div className="ribbon-button-icon">
                <Icon size={22} />
              </div>
              <span className="ribbon-button-label">{label}</span>
            </button>
          ))}
        </div>
        <div className="ribbon-section-label">Navigation</div>
      </div>

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
            title="Emergency Stop (M112)"
            onClick={handleEmergencyStop}
          >
            <div className="ribbon-button-icon icon-red">
              <OctagonAlert size={22} />
            </div>
            <span className="ribbon-button-label">E-Stop</span>
          </button>
        </div>
        <div className="ribbon-section-label">Actions</div>
      </div>
    </>
  );
}
