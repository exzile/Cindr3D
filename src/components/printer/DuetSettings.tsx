import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Plug, Settings as SettingsIcon, Palette, ToggleLeft, Bell, Cpu, BadgeInfo,
  Zap, Download,
  Monitor,
} from 'lucide-react';
import { downloadSettings, importSettingsFromFile, type ImportResult } from '../../utils/settingsExport';
import { usePrinterStore } from '../../store/printerStore';
import { useThemeStore } from '../../store/themeStore';
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
const TABS = [
  { key: 'connection'    as const, label: 'Connection',    Icon: Plug },
  { key: 'general'       as const, label: 'General',       Icon: SettingsIcon },
  { key: 'appearance'    as const, label: 'Appearance',    Icon: Palette },
  { key: 'behaviour'     as const, label: 'Behaviour',     Icon: ToggleLeft },
  { key: 'notifications' as const, label: 'Notifications', Icon: Bell },
  { key: 'machine'       as const, label: 'Machine',       Icon: Cpu },
  { key: 'firmware'      as const, label: 'Firmware',      Icon: Zap },
  { key: 'paneldue'      as const, label: 'PanelDue',      Icon: Monitor },
  { key: 'backup'        as const, label: 'Backup',        Icon: Download },
  { key: 'about'         as const, label: 'About',         Icon: BadgeInfo },
];
type TabKey = (typeof TABS)[number]['key'];

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
  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const addPrinter = usePrinterStore((s) => s.addPrinter);
  const removePrinter = usePrinterStore((s) => s.removePrinter);
  const renamePrinter = usePrinterStore((s) => s.renamePrinter);
  const selectPrinter = usePrinterStore((s) => s.selectPrinter);
  const error = usePrinterStore((s) => s.error);
  const model = usePrinterStore((s) => s.model);
  const uploading = usePrinterStore((s) => s.uploading);
  const uploadProgress = usePrinterStore((s) => s.uploadProgress);
  const uploadFirmware = usePrinterStore((s) => s.uploadFirmware);
  const installFirmware = usePrinterStore((s) => s.installFirmware);
  const firmwareUpdatePending = usePrinterStore((s) => s.firmwareUpdatePending);

  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

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

  const handleTest = useCallback(async () => {
    setConfig({ hostname: hostname.trim(), password });
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
      setTestResult({ success: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }, [hostname, password, setConfig, testConnection]);

  const handleConnect = useCallback(async () => {
    setConfig({ hostname: hostname.trim(), password });
    setTestResult(null);
    await connect();
  }, [hostname, password, setConfig, connect]);

  const handleDisconnect = useCallback(async () => {
    setTestResult(null);
    await disconnect();
  }, [disconnect]);

  const axes = useMemo(() => model.move?.axes ?? [], [model.move?.axes]);
  const board = model.boards?.[0];
  const canConnect = hostname.trim().length > 0 && !connecting;

  const handleAddPrinter = useCallback(() => {
    const name = window.prompt('Name for new printer:', `Printer ${printers.length + 1}`);
    if (!name) return;
    const id = addPrinter(name);
    selectPrinter(id).catch(() => {});
  }, [addPrinter, selectPrinter, printers.length]);

  const handleRenamePrinter = useCallback(() => {
    const current = printers.find((p) => p.id === activePrinterId);
    if (!current) return;
    const name = window.prompt('Rename printer:', current.name);
    if (!name || name === current.name) return;
    renamePrinter(activePrinterId, name);
  }, [activePrinterId, printers, renamePrinter]);

  const handleRemovePrinter = useCallback(() => {
    const current = printers.find((p) => p.id === activePrinterId);
    if (!current) return;
    if (printers.length <= 1) {
      window.alert('At least one printer must remain.');
      return;
    }
    if (!window.confirm(`Remove "${current.name}"? Its saved connection and preferences will be deleted.`)) return;
    removePrinter(activePrinterId);
  }, [activePrinterId, printers, removePrinter]);

  const pageContent = useMemo(() => (
    <SettingsTabContent
      activePrinterId={activePrinterId}
      autoUpdate={autoUpdate}
      axes={axes}
      board={board}
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
      handleAddPrinter={handleAddPrinter}
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
      handleRemovePrinter={handleRemovePrinter}
      handleRenamePrinter={handleRenamePrinter}
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
      printers={printers}
      selectPrinter={(printerId) => { selectPrinter(printerId).catch(() => {}); }}
      setAutoUpdate={setAutoUpdate}
      setHostname={setHostname}
      setMode={setMode}
      setPanelDueAsset={setPanelDueAsset}
      setPanelDueUpdate={setPanelDueUpdate}
      setPassword={setPassword}
      setShowPanelDueNotes={setShowPanelDueNotes}
      setShowReleaseNotes={setShowReleaseNotes}
      setTheme={setTheme}
      showPanelDueNotes={showPanelDueNotes}
      showReleaseNotes={showReleaseNotes}
      tab={tab}
      testResult={testResult}
      testing={testing}
      theme={theme}
      updateCheck={updateCheck}
      uploadProgress={uploadProgress}
      uploading={uploading}
    />
  ), [activePrinterId, autoUpdate, axes, board, canConnect, config, connected, connecting, error, firmwareFile, firmwareStatus, firmwareUpdatePending, handleAddPrinter, handleAutoUpdate, handleCheckForUpdate, handleCheckPanelDueUpdate, handleConnect, handleDisconnect, handleFirmwareInstall, handleFirmwareSelect, handleFirmwareUpload, handleIapSelect, handleIapUpload, handlePanelDueInstall, handleRemovePrinter, handleRenamePrinter, handleTest, handleUpdateDwcOnly, hostname, iapFile, iapInputRef, iapStatus, importInputRef, importResult, importing, loadPanelDueInfo, mode, panelDueAsset, panelDueCheck, panelDueFlashed, panelDueInfo, panelDueLogRef, panelDueUpdate, password, patchPrefs, prefs, printers, selectPrinter, setAutoUpdate, setHostname, setMode, setPanelDueAsset, setPanelDueUpdate, setPassword, setShowPanelDueNotes, setShowReleaseNotes, setTheme, showPanelDueNotes, showReleaseNotes, tab, testResult, testing, theme, updateCheck, uploadProgress, uploading]);

  return (
    <div className="duet-settings__page">
      <nav className="duet-settings__nav">
        {TABS.map(({ key, label, Icon }) => (
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
      <div className="duet-settings__body">{pageContent}</div>
    </div>
  );
}
