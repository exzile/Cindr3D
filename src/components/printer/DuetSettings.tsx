import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  ArrowLeft, Plug, Settings as SettingsIcon, ToggleLeft, Bell, Cpu, BadgeInfo,
  Zap, Download,
  Monitor, Camera, Droplet, Braces,
} from 'lucide-react';
import type { PrinterBoardType } from '../../types/duet';
import { downloadSettings, importSettingsFromFile, type ImportResult } from '../../utils/settingsExport';
import { errorMessage } from '../../utils/errorHandling';
import { usePrinterStore } from '../../store/printerStore';
import { SettingsTabContent } from './duetSettings/SettingsTabContent';
import { useFirmwareUpdate } from './duetSettings/useFirmwareUpdate';
import { usePanelDue } from './duetSettings/usePanelDue';
import {
  getDuetPrefs, updateDuetPrefs,
  type DuetPrefs,
} from '../../utils/duetPrefs';
import './DuetSettings.css';

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const ALL_TABS = [
  { key: 'connection'    as const, label: 'Connection',    Icon: Plug },
  { key: 'general'       as const, label: 'General',       Icon: SettingsIcon },
  { key: 'camera'        as const, label: 'Camera',        Icon: Camera },
  { key: 'behaviour'     as const, label: 'Behaviour',     Icon: ToggleLeft },
  { key: 'notifications' as const, label: 'Notifications', Icon: Bell },
  { key: 'machine'       as const, label: 'Machine',       Icon: Cpu },
  { key: 'filaments'     as const, label: 'Filaments',     Icon: Droplet },
  { key: 'printer-model' as const, label: 'Printer Model',  Icon: Braces,  duetOnly: true },
  { key: 'firmware'      as const, label: 'Firmware',      Icon: Zap,     duetOnly: true },
  { key: 'paneldue'      as const, label: 'PanelDue',      Icon: Monitor, duetOnly: true },
  { key: 'backup'        as const, label: 'Backup',        Icon: Download },
  { key: 'about'         as const, label: 'About',         Icon: BadgeInfo },
];
type TabKey = (typeof ALL_TABS)[number]['key'];

const DUET_BOARD_TYPES: PrinterBoardType[] = ['duet'];

function visibleTabs(boardType: PrinterBoardType) {
  const isDuet = DUET_BOARD_TYPES.includes(boardType);
  return ALL_TABS.filter((t) => !('duetOnly' in t && t.duetOnly) || isDuet);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DuetSettings() {
  const connected = usePrinterStore((s) => s.connected);
  const connecting = usePrinterStore((s) => s.connecting);
  const config = usePrinterStore((s) => s.config);
  const setConfig = usePrinterStore((s) => s.setConfig);
  const connect = usePrinterStore((s) => s.connect);
  const disconnect = usePrinterStore((s) => s.disconnect);
  const testConnection = usePrinterStore((s) => s.testConnection);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const error = usePrinterStore((s) => s.error);
  const model = usePrinterStore((s) => s.model);
  const uploading = usePrinterStore((s) => s.uploading);
  const uploadProgress = usePrinterStore((s) => s.uploadProgress);
  const uploadFirmware = usePrinterStore((s) => s.uploadFirmware);
  const installFirmware = usePrinterStore((s) => s.installFirmware);
  const firmwareUpdatePending = usePrinterStore((s) => s.firmwareUpdatePending);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);

  const boardType: PrinterBoardType = config.boardType ?? 'duet';
  const tabs = useMemo(() => visibleTabs(boardType), [boardType]);

  // Load persisted prefs once per open
  const [prefs, setPrefs] = useState<DuetPrefs>(() => getDuetPrefs());
  const patchPrefs = useCallback((patch: Partial<DuetPrefs>) => {
    setPrefs(updateDuetPrefs(patch));
  }, []);

  const [tab, setTab] = useState<TabKey>('connection');

  const firmwareInputRef = React.useRef<HTMLInputElement | null>(null);

  const iapInputRef = React.useRef<HTMLInputElement | null>(null);

  // Backup / restore state
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const {
    autoUpdate,
    firmwareFile,
    firmwareStatus,
    handleAutoUpdate,
    handleCheckForUpdate,
    handleFirmwareInstall,
    handleFirmwareSelect,
    handleFirmwareUpload,
    handleIapSelect,
    handleIapUpload,
    handleUpdateDwcOnly,
    iapFile,
    iapStatus,
    setAutoUpdate,
    setShowReleaseNotes,
    showReleaseNotes,
    updateCheck,
  } = useFirmwareUpdate({
    config,
    connected,
    firmwareUpdatePending,
    installFirmware,
    uploadFirmware,
  });
  const {
    handleCheckPanelDueUpdate,
    handlePanelDueInstall,
    loadPanelDueInfo,
    panelDueAsset,
    panelDueCheck,
    panelDueFlashed,
    panelDueInfo,
    panelDueLogRef,
    panelDueUpdate,
    setPanelDueAsset,
    setPanelDueUpdate,
    setShowPanelDueNotes,
    showPanelDueNotes,
  } = usePanelDue({
    connected,
    tab,
  });


  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    const result = await importSettingsFromFile(file);
    setImportResult(result);
    setImporting(false);
    if (importInputRef.current) importInputRef.current.value = '';
  };


  // Connection form state
  const [hostname, setHostname] = useState(config.hostname || '');
  const [password, setPassword] = useState(config.password || '');
  const [mode, setMode] = useState<'standalone' | 'sbc'>(
    (config as { mode?: 'standalone' | 'sbc' }).mode ?? 'standalone',
  );
  const setBoardType = useCallback((value: PrinterBoardType) => {
    setConfig({ boardType: value });
  }, [setConfig]);

  // When the user switches active printer, reload the form fields from the
  // newly-active config. Without this, hostname/password/mode would still
  // show the previous printer's values even though `config` has updated.
  useEffect(() => {
    setHostname(config.hostname || '');
    setPassword(config.password || '');
    setMode(config.mode ?? 'standalone');
  }, [activePrinterId, config.hostname, config.password, config.mode]);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    firmwareVersion?: string;
    error?: string;
  } | null>(null);

  const isUsbTransport = config.transport === 'usb';

  const handleTest = useCallback(async () => {
    if (!isUsbTransport) {
      setConfig({ hostname: hostname.trim(), password });
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection();
      setTestResult({
        success: result.success,
        firmwareVersion: result.firmwareVersion,
        error: result.error,
      });
    } catch (err) {
      setTestResult({ success: false, error: errorMessage(err, 'Unknown error') });
    } finally {
      setTesting(false);
    }
  }, [hostname, isUsbTransport, password, setConfig, testConnection]);

  const handleConnect = useCallback(async () => {
    if (!isUsbTransport) {
      setConfig({ hostname: hostname.trim(), password });
    }
    setTestResult(null);
    await connect();
  }, [hostname, isUsbTransport, password, setConfig, connect]);

  const handleDisconnect = useCallback(async () => {
    setTestResult(null);
    await disconnect();
  }, [disconnect]);

  const axes = useMemo(() => model.move?.axes ?? [], [model.move?.axes]);
  const board = model.boards?.[0];
  const canConnect = hostname.trim().length > 0 && !connecting;

  const pageContent = useMemo(() => (
    <SettingsTabContent
      activePrinterId={activePrinterId}
      autoUpdate={autoUpdate}
      axes={axes}
      board={board}
      boardType={boardType}
      canConnect={canConnect}
      config={config}
      connected={connected}
      connecting={connecting}
      downloadSettings={downloadSettings}
      error={error}
      firmwareFile={firmwareFile}
      firmwareInputRef={firmwareInputRef}
      firmwareStatus={firmwareStatus}
      firmwareUpdatePending={firmwareUpdatePending}
      handleAutoUpdate={handleAutoUpdate}
      handleCheckForUpdate={handleCheckForUpdate}
      handleCheckPanelDueUpdate={handleCheckPanelDueUpdate}
      handleConnect={handleConnect}
      handleDisconnect={handleDisconnect}
      handleFirmwareInstall={handleFirmwareInstall}
      handleFirmwareSelect={handleFirmwareSelect}
      handleFirmwareUpload={handleFirmwareUpload}
      handleIapSelect={handleIapSelect}
      handleIapUpload={handleIapUpload}
      handleImport={handleImport}
      handlePanelDueInstall={handlePanelDueInstall}
      handleTest={handleTest}
      handleUpdateDwcOnly={handleUpdateDwcOnly}
      hostname={hostname}
      iapFile={iapFile}
      iapInputRef={iapInputRef}
      iapStatus={iapStatus}
      importInputRef={importInputRef}
      importResult={importResult}
      importing={importing}
      loadPanelDueInfo={loadPanelDueInfo}
      mode={mode}
      panelDueAsset={panelDueAsset}
      panelDueCheck={panelDueCheck}
      panelDueFlashed={panelDueFlashed}
      panelDueInfo={panelDueInfo}
      panelDueLogRef={panelDueLogRef}
      panelDueUpdate={panelDueUpdate}
      password={password}
      patchPrefs={patchPrefs}
      prefs={prefs}
      setAutoUpdate={setAutoUpdate}
      setBoardType={setBoardType}
      setConfigPatch={setConfig}
      setHostname={setHostname}
      setMode={setMode}
      setPanelDueAsset={setPanelDueAsset}
      setPanelDueUpdate={setPanelDueUpdate}
      setPassword={setPassword}
      setShowPanelDueNotes={setShowPanelDueNotes}
      setShowReleaseNotes={setShowReleaseNotes}
      showPanelDueNotes={showPanelDueNotes}
      showReleaseNotes={showReleaseNotes}
      tab={tab}
      testResult={testResult}
      testing={testing}
      updateCheck={updateCheck}
      uploadProgress={uploadProgress}
      uploading={uploading}
    />
  ), [activePrinterId, autoUpdate, axes, board, boardType, canConnect, config, connected, connecting, error, firmwareFile, firmwareStatus, firmwareUpdatePending, handleAutoUpdate, handleCheckForUpdate, handleCheckPanelDueUpdate, handleConnect, handleDisconnect, handleFirmwareInstall, handleFirmwareSelect, handleFirmwareUpload, handleIapSelect, handleIapUpload, handlePanelDueInstall, handleTest, handleUpdateDwcOnly, hostname, iapFile, iapInputRef, iapStatus, importInputRef, importResult, importing, loadPanelDueInfo, mode, panelDueAsset, panelDueCheck, panelDueFlashed, panelDueInfo, panelDueLogRef, panelDueUpdate, password, patchPrefs, prefs, setAutoUpdate, setBoardType, setConfig, setHostname, setMode, setPanelDueAsset, setPanelDueUpdate, setPassword, setShowPanelDueNotes, setShowReleaseNotes, showPanelDueNotes, showReleaseNotes, tab, testResult, testing, updateCheck, uploadProgress, uploading]);

  return (
    <div className="duet-settings__page">
      <nav className="duet-settings__nav">
        <button
          className="duet-settings__nav-item duet-settings__nav-back"
          onClick={() => setActiveTab('printers')}
        >
          <ArrowLeft size={15} />
          Back to Printers
        </button>
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`duet-settings__nav-item${tab === key ? ' is-active' : ''}`}
            onClick={() => setTab(key)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>
      <div className="duet-settings__body">
        <div key={tab} className="duet-settings__tab-pane">{pageContent}</div>
      </div>
    </div>
  );
}
