import React from 'react';
import {
  LayoutDashboard,
  Activity,
  Terminal,
  Play,
  FolderOpen,
  FileCode,
  Grid3x3,
  History,
  Braces,
  Settings,
  FlaskConical,
  TrendingUp,
  Router,
  Plug,
  Camera,
  Layers,
  ArrowUpCircle,
  Zap,
  Cpu,
  Package,
  Film,
} from 'lucide-react';
import DuetDashboard from '../DuetDashboard';
import DuetStatus from '../DuetStatus';
import DuetConsole from '../DuetConsole';
import DuetJobStatus from '../DuetJobStatus';
import DuetPrintHistory from '../DuetPrintHistory';
import DuetFileManager from '../DuetFileManager';
import DuetFilamentManager from '../DuetFilamentManager';
import DuetMacros from '../DuetMacros';
import DuetHeightMap from '../DuetHeightMap';
import DuetObjectModelBrowser from '../DuetObjectModelBrowser';
import DuetSettings from '../DuetSettings';
import DuetConfigEditor from '../DuetConfigEditor';
import DuetAnalytics from '../DuetAnalytics';
import DuetNetworkAndFirmware from '../DuetNetworkAndFirmware';
import DuetPlugins from '../DuetPlugins';
import PrinterFleetDashboard from '../dashboard/PrinterFleetDashboard';
import CameraDashboardPanel from '../dashboard/CameraDashboardPanel';
import KlipperExcludeObject from '../KlipperExcludeObject';
import KlipperUpdateManager from '../KlipperUpdateManager';
import KlipperPowerDevices from '../KlipperPowerDevices';
import KlipperBedMesh from '../KlipperBedMesh';
import KlipperInputShaper from '../KlipperInputShaper';
import KlipperPressureAdvance from '../KlipperPressureAdvance';
import KlipperSpoolman from '../KlipperSpoolman';
import KlipperTimelapse from '../KlipperTimelapse';

export const TABS = [
  { key: 'dashboard' as const, label: 'Dashboard', Icon: LayoutDashboard },
  { key: 'camera' as const, label: 'Camera', Icon: Camera },
  { key: 'status' as const, label: 'Status', Icon: Activity },
  { key: 'console' as const, label: 'Console', Icon: Terminal },
  { key: 'job' as const, label: 'Job', Icon: Play },
  { key: 'history' as const, label: 'History', Icon: History },
  { key: 'analytics' as const, label: 'Analytics', Icon: TrendingUp },
  { key: 'files' as const, label: 'Files', Icon: FolderOpen },
  { key: 'filaments' as const, label: 'Filaments', Icon: FlaskConical },
  { key: 'macros' as const, label: 'Macros', Icon: FileCode },
  { key: 'heightmap' as const, label: 'Height Map', Icon: Grid3x3 },
  { key: 'model' as const, label: 'Model', Icon: Braces },
  { key: 'config' as const, label: 'Config', Icon: FileCode },
  { key: 'network' as const, label: 'Network', Icon: Router },
  { key: 'plugins' as const, label: 'Plugins', Icon: Plug },
  { key: 'settings' as const, label: 'Settings', Icon: Settings },
  // Klipper-specific tabs
  { key: 'klipper-exclude' as const, label: 'Exclude Object', Icon: Layers },
  { key: 'klipper-updates' as const, label: 'Updates', Icon: ArrowUpCircle },
  { key: 'klipper-power' as const, label: 'Power', Icon: Zap },
  { key: 'klipper-bedmesh' as const, label: 'Bed Mesh', Icon: Grid3x3 },
  { key: 'klipper-shaper' as const, label: 'Input Shaper', Icon: Cpu },
  { key: 'klipper-pa' as const, label: 'Press. Advance', Icon: TrendingUp },
  { key: 'klipper-spoolman' as const, label: 'Spoolman', Icon: Package },
  { key: 'klipper-timelapse' as const, label: 'Timelapse', Icon: Film },
];

export type TabKey = (typeof TABS)[number]['key'] | 'printers';

/** Keys of tabs that only appear when connected to a Klipper printer. */
export const KLIPPER_ONLY_TABS = new Set<TabKey>([
  'klipper-exclude',
  'klipper-updates',
  'klipper-power',
  'klipper-bedmesh',
  'klipper-shaper',
  'klipper-pa',
  'klipper-spoolman',
  'klipper-timelapse',
]);

export const TAB_COMPONENTS: Record<TabKey, React.ComponentType> = {
  printers: PrinterFleetDashboard,
  dashboard: DuetDashboard,
  camera: CameraDashboardPanel,
  status: DuetStatus,
  console: DuetConsole,
  job: DuetJobStatus,
  history: DuetPrintHistory,
  analytics: DuetAnalytics,
  files: DuetFileManager,
  filaments: DuetFilamentManager,
  macros: DuetMacros,
  heightmap: DuetHeightMap,
  model: DuetObjectModelBrowser,
  config: DuetConfigEditor,
  network: DuetNetworkAndFirmware,
  plugins: DuetPlugins,
  settings: DuetSettings,
  'klipper-exclude': KlipperExcludeObject,
  'klipper-updates': KlipperUpdateManager,
  'klipper-power': KlipperPowerDevices,
  'klipper-bedmesh': KlipperBedMesh,
  'klipper-shaper': KlipperInputShaper,
  'klipper-pa': KlipperPressureAdvance,
  'klipper-spoolman': KlipperSpoolman,
  'klipper-timelapse': KlipperTimelapse,
};
