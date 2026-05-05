import React from 'react';
import {
  LayoutDashboard,
  Activity,
  Terminal,
  Play,
  FolderOpen,
  FileCode,
  Grid3x3,
  Grid2X2,
  History,
  Braces,
  Settings,
  TrendingUp,
  Trophy,
  Router,
  Plug,
  Camera,
  Layers,
  ArrowUpCircle,
  Zap,
  Cpu,
  Package,
  Film,
  ListOrdered,
  Images,
  FlaskConical,
  CalendarDays,
  ScanLine,
  ClipboardList,
} from 'lucide-react';
import DuetDashboard from '../DuetDashboard';
import DuetStatus from '../DuetStatus';
import DuetConsole from '../DuetConsole';
import DuetJobStatus from '../DuetJobStatus';
import DuetPrintHistory from '../DuetPrintHistory';
import DuetFileManager from '../DuetFileManager';
import { PrintQueue } from '../jobStatus/PrintQueue';
import DuetFilamentManager from '../DuetFilamentManager';
import DuetMacros from '../DuetMacros';
import DuetObjectModelBrowser from '../DuetObjectModelBrowser';
import DuetSettings from '../DuetSettings';
import DuetConfigEditor from '../DuetConfigEditor';
import DuetAnalytics from '../DuetAnalytics';
import DuetNetworkAndFirmware from '../DuetNetworkAndFirmware';
import DuetPlugins from '../DuetPlugins';
import PrinterFleetDashboard from '../dashboard/PrinterFleetDashboard';
import CameraDashboardPanel from '../dashboard/CameraDashboardPanel';
import AllCamerasGrid from '../cameras/AllCamerasGrid';
import LayerGalleryPanel from '../cameras/LayerGalleryPanel';
import CrossPrinterComparison from '../comparison/CrossPrinterComparison';
import BedMap from '../BedMap';
// Universal cross-firmware tabs
import ExcludeObject from '../ExcludeObject';
import UpdateManager from '../UpdateManager';
import PowerDevices from '../PowerDevices';
import InputShaper from '../InputShaper';
import PressureAdvance from '../PressureAdvance';
import SpoolManager from '../SpoolManager';
import Timelapse from '../Timelapse';
import PrinterCalibrationPanel from '../calibration/PrinterCalibrationPanel';
import PrintCalendar from '../scheduling/PrintCalendar';
import BedClearPanel from '../scheduling/BedClearPanel';
import ChecklistSettingsPanel from '../scheduling/StartChecklist';

export const TABS = [
  { key: 'dashboard' as const, label: 'Dashboard', Icon: LayoutDashboard },
  { key: 'camera' as const, label: 'Camera', Icon: Camera },
  { key: 'all-cameras' as const, label: 'All Cameras', Icon: Grid2X2 },
  { key: 'layer-gallery' as const, label: 'Layer Gallery', Icon: Images },
  { key: 'status' as const, label: 'Status', Icon: Activity },
  { key: 'console' as const, label: 'Console', Icon: Terminal },
  { key: 'job' as const, label: 'Job', Icon: Play },
  { key: 'history' as const, label: 'History', Icon: History },
  { key: 'analytics' as const, label: 'Analytics', Icon: TrendingUp },
  { key: 'comparison' as const, label: 'A/B Compare', Icon: Trophy },
  { key: 'files' as const, label: 'Files', Icon: FolderOpen },
  { key: 'queue' as const, label: 'Queue', Icon: ListOrdered },
  { key: 'schedule' as const, label: 'Schedule', Icon: CalendarDays },
  { key: 'bed-clear' as const, label: 'Bed Clear', Icon: ScanLine },
  { key: 'checklist' as const, label: 'Checklist', Icon: ClipboardList },
  { key: 'calibration' as const, label: 'Calibration', Icon: FlaskConical },
  // Duet-only: reads 0:/filaments via Duet file API
  { key: 'filaments' as const, label: 'Filaments', Icon: FileCode },
  { key: 'macros' as const, label: 'Macros', Icon: FileCode },
  // Unified: DuetHeightMap / KlipperBedMesh / MarlinBedLevel by boardType
  { key: 'heightmap' as const, label: 'Bed Map', Icon: Grid3x3 },
  // Duet-only: RRF/DSF object model browser
  { key: 'model' as const, label: 'Model', Icon: Braces },
  { key: 'config' as const, label: 'Config', Icon: FileCode },
  { key: 'network' as const, label: 'Network', Icon: Router },
  // Duet SBC only: DSF plugin manager
  { key: 'plugins' as const, label: 'Plugins', Icon: Plug },
  { key: 'settings' as const, label: 'Settings', Icon: Settings },
  // ── Universal cross-firmware tabs ────────────────────────────────────────────
  // Each has a Klipper-specific path and a firmware-agnostic workaround path
  { key: 'exclude-object' as const, label: 'Exclude Object', Icon: Layers },
  { key: 'updates' as const, label: 'Updates', Icon: ArrowUpCircle },
  { key: 'power' as const, label: 'Power', Icon: Zap },
  { key: 'input-shaper' as const, label: 'Input Shaper', Icon: Cpu },
  { key: 'pressure-advance' as const, label: 'Press. Advance', Icon: TrendingUp },
  { key: 'spool-manager' as const, label: 'Spools', Icon: Package },
  { key: 'timelapse' as const, label: 'Timelapse', Icon: Film },
];

export type TabKey = (typeof TABS)[number]['key'] | 'printers';

/**
 * Tabs that only appear for Klipper printers.
 * All previously-Klipper-only features now have universal implementations,
 * so this set is empty. Preserved for future truly-Klipper-only additions.
 */
export const KLIPPER_ONLY_TABS = new Set<TabKey>([]);

/**
 * Tabs that only make sense for Duet-based printers.
 * Hidden when boardType === 'klipper' (or other non-Duet firmware).
 */
export const DUET_ONLY_TABS = new Set<TabKey>([
  'filaments', // reads 0:/filaments via Duet file API — no Moonraker equivalent
  'model',     // RRF/DSF object model — Klipper has no equivalent endpoint
  'plugins',   // DSF SBC plugin manager — not present on Klipper
]);

export const TAB_COMPONENTS: Record<TabKey, React.ComponentType> = {
  printers: PrinterFleetDashboard,
  dashboard: DuetDashboard,
  camera: CameraDashboardPanel,
  'all-cameras': AllCamerasGrid,
  'layer-gallery': LayerGalleryPanel,
  status: DuetStatus,
  console: DuetConsole,
  job: DuetJobStatus,
  history: DuetPrintHistory,
  analytics: DuetAnalytics,
  comparison: CrossPrinterComparison,
  files: DuetFileManager,
  queue: PrintQueue,
  schedule: PrintCalendar,
  'bed-clear': BedClearPanel,
  checklist: ChecklistSettingsPanel,
  calibration: PrinterCalibrationPanel,
  filaments: DuetFilamentManager,
  macros: DuetMacros,
  heightmap: BedMap,             // unified — delegates to Klipper / Marlin / Duet internally
  model: DuetObjectModelBrowser,
  config: DuetConfigEditor,
  network: DuetNetworkAndFirmware,
  plugins: DuetPlugins,
  settings: DuetSettings,
  // Universal cross-firmware tabs
  'exclude-object': ExcludeObject,
  updates: UpdateManager,
  power: PowerDevices,
  'input-shaper': InputShaper,
  'pressure-advance': PressureAdvance,
  'spool-manager': SpoolManager,
  timelapse: Timelapse,
};
